const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createBatch, readBatch, writeBatch, batchDirs, BATCHES_DIR } = require('../store/batchStore');

const router = express.Router();

// Helper: Get or create a reusable batch for tasks API
async function getOrCreateReusableBatch(req) {
  try {
    // Strategy 1: Try to find the most recent active batch (within 24 hours)
    const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    const bids = await batchDirs();
    let mostRecentBatch = null;
    let mostRecentTime = 0;
    
    for (const bid of bids) {
      try {
        const batch = await readBatch(bid);
        const updatedAt = new Date(batch.updatedAt || batch.createdAt).getTime();
        const age = now - updatedAt;
        
        // Check if batch is active (has activity within 24 hours and not archived)
        if (age <= ACTIVE_WINDOW_MS && !batch.archived) {
          const counts = batch.counts || {};
          const hasActivity = (counts.running > 0) || (counts.queued > 0) || 
                             (counts.success > 0) || (counts.failed > 0);
          
          if (hasActivity && updatedAt > mostRecentTime) {
            mostRecentBatch = batch;
            mostRecentTime = updatedAt;
          }
        }
      } catch (e) {
        // Skip unreadable batches
      }
    }
    
    if (mostRecentBatch) {
      console.log('[tasksCompat] Reusing batch:', mostRecentBatch.id);
      return mostRecentBatch;
    }
    
    // Strategy 2: Create a new batch
    const newBatch = await createBatch('API Tasks ' + new Date().toLocaleString());
    console.log('[tasksCompat] Created new batch:', newBatch.id);
    return newBatch;
    
  } catch (e) {
    console.error('[tasksCompat] Error getting/creating batch:', e);
    // Fallback: always create new batch on error
    const fallbackBatch = await createBatch('API Tasks Fallback ' + new Date().toLocaleString());
    return fallbackBatch;
  }
}

// GET /api/tasks - List tasks (stub for now, returns empty)
router.get('/tasks', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 1000);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    
    // For now, return empty list structure
    // In M3, this will aggregate tasks across all batches with proper pagination
    res.json({
      items: [],
      total: 0,
      limit,
      offset,
      message: 'Tasks API - aggregated view coming in M3'
    });
    
  } catch (e) {
    console.error('[GET /api/tasks] Error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/tasks/url - Add URL tasks
router.post('/tasks/url', async (req, res) => {
  try {
    // Get or create a reusable batch
    const batch = await getOrCreateReusableBatch(req);
    
    // Directly use the existing logic from batches route
    const { createTask } = require('../store/batchStore');
    const { enqueue } = require('../queue/worker');
    const { analyzeUrlTask } = require('../services/analyzeService');
    
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const uniq = Array.from(new Set(urls.map(u => String(u).trim()).filter(Boolean))).slice(0, 200);
    const created = [];
    
    for (const url of uniq) {
      const rec = await createTask(batch.id, { kind: 'url', payload: { url } });
      created.push(rec);
      enqueue({ 
        batchId: batch.id, 
        taskId: rec.id, 
        analyze: async (task, onProgress, isCanceled) => {
          onProgress(10, 'queued');
          if (isCanceled()) throw new Error('canceled');
          onProgress(30, 'analyzing');
          const out = await analyzeUrlTask(task.payload.url);
          onProgress(100, 'done');
          return out;
        }
      });
    }
    
    // Update batch counts
    batch.counts.queued = (batch.counts.queued || 0) + created.length;
    await writeBatch(batch);
    
    res.json({ 
      ok: true, 
      batchId: batch.id,
      created: created.map(t => t.id),
      message: `Added ${created.length} URL tasks to batch ${batch.id}`
    });
    
  } catch (e) {
    console.error('[POST /api/tasks/url] Error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/tasks/upload - Upload files
// Need special handling because multer middleware is involved
router.post('/tasks/upload', async (req, res, next) => {
  try {
    // Get or create a reusable batch first
    const batch = await getOrCreateReusableBatch(req);
    
    // Setup multer with batch-specific storage
    const storage = multer.diskStorage({
      destination: function(req, file, cb) {
        const dir = path.join(BATCHES_DIR, batch.id, 'uploads');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: function(req, file, cb) {
        const name = `${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`;
        cb(null, name);
      }
    });
    
    const upload = multer({ 
      storage, 
      limits: { fileSize: 1000 * 1024 * 1024 } // 1GB limit
    }).array('files', 200);
    
    // Process upload
    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      
      try {
        // Forward to existing batch upload logic
        req.params.id = batch.id;
        
        // Find and execute the existing handler
        const batchesRouter = require('./batches');
        const handler = batchesRouter.stack.find(r => 
          r.route && r.route.path === '/batches/:id/tasks/upload' && r.route.methods.post
        );
        
        if (handler && req.files && req.files.length > 0) {
          // We need to manually handle since multer already processed
          // Import the task creation logic
          const { createTask } = require('../store/batchStore');
          const { enqueue } = require('../queue/worker');
          const { analyzeFileTask } = require('../services/analyzeService');
          
          const created = [];
          for (const f of req.files) {
            const rec = await createTask(batch.id, { 
              kind: 'file', 
              payload: { 
                localPath: f.path, 
                mimetype: f.mimetype || 'video/mp4' 
              } 
            });
            created.push(rec);
            
            enqueue({ 
              batchId: batch.id, 
              taskId: rec.id, 
              analyze: async (task, onProgress, isCanceled) => {
                onProgress(10, 'queued');
                if (isCanceled()) throw new Error('canceled');
                onProgress(30, 'analyzing');
                const out = await analyzeFileTask(task.payload.localPath, task.payload.mimetype);
                onProgress(100, 'done');
                return out;
              }
            });
          }
          
          // Update batch counts
          batch.counts.queued = (batch.counts.queued || 0) + created.length;
          await writeBatch(batch);
          
          res.json({ 
            ok: true, 
            batchId: batch.id,
            created: created.map(t => t.id),
            message: `Uploaded ${created.length} files to batch ${batch.id}`
          });
        } else {
          res.json({ 
            ok: true, 
            batchId: batch.id,
            created: [],
            message: 'No files uploaded'
          });
        }
        
      } catch (e2) {
        console.error('[POST /api/tasks/upload] Processing error:', e2);
        res.status(500).json({ error: String(e2.message || e2) });
      }
    });
    
  } catch (e) {
    console.error('[POST /api/tasks/upload] Error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

module.exports = router;