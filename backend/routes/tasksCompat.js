const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createBatch, readBatch, writeBatch, createTask, listTasks, BATCHES_DIR } = require('../store/batchStore');
const { enqueue } = require('../queue/worker');
const { analyzeUrlTask, analyzeFileTask } = require('../services/analyzeService');

const router = express.Router();

// OPTIONS handlers for CORS preflight (must be before any business logic)
router.options('/tasks', (req, res) => {
  res.sendStatus(204);
});

router.options('/tasks/url', (req, res) => {
  res.sendStatus(204);
});

router.options('/tasks/upload', (req, res) => {
  res.sendStatus(204);
});

// Helper: Get batch ID from request (cookie or create new)
function getBatchIdFromReq(req) {
  return req.cookies?.taskRunnerBatchId || null;
}

// Helper: Ensure batch exists and set cookie if needed
async function ensureBatchId(req, res) {
  try {
    // Check for existing batch in cookie
    const cookieBatchId = getBatchIdFromReq(req);
    if (cookieBatchId) {
      try {
        const batch = await readBatch(cookieBatchId);
        if (batch && !batch.archived) {
          console.log('[tasksCompat] Reusing batch from cookie:', cookieBatchId);
          return batch.id;
        }
      } catch (e) {
        console.log('[tasksCompat] Cookie batch not found:', cookieBatchId);
      }
    }
    
    // Create a new batch
    const newBatch = await createBatch('Task Runner ' + new Date().toLocaleString());
    console.log('[tasksCompat] Created new batch:', newBatch.id);
    
    // Set cookie for batch reuse with environment-specific settings
    if (res) {
      // Detect environment
      const isLocal = req && (
        /^localhost(:\d+)?$/.test(req.hostname) || 
        req.headers.origin?.includes('localhost') ||
        req.headers.host?.includes('localhost')
      );
      
      const cookieOptions = {
        httpOnly: true,
        sameSite: isLocal ? 'lax' : 'none',
        secure: isLocal ? false : true,
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      };
      
      console.log('[tasksCompat] Setting cookie with options:', cookieOptions);
      res.cookie('taskRunnerBatchId', newBatch.id, cookieOptions);
    }
    
    return newBatch.id;
    
  } catch (e) {
    console.error('[tasksCompat] Error ensuring batch:', e);
    throw e;
  }
}

// GET /api/tasks - List tasks from current batch only
router.get('/tasks', async (req, res) => {
  // Set no-cache headers
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  try {
    // Get batch ID from cookie
    const batchId = getBatchIdFromReq(req);
    if (!batchId) {
      // No batch yet, return empty
      return res.json({
        items: [],
        total: 0,
        limit: 50,
        offset: 0
      });
    }
    
    // Verify batch exists
    try {
      await readBatch(batchId);
    } catch (e) {
      // Batch doesn't exist, return empty
      console.log('[GET /api/tasks] Batch not found:', batchId);
      return res.json({
        items: [],
        total: 0,
        limit: 50,
        offset: 0
      });
    }
    
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 1000);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    const status = req.query.status;
    
    // Use batch system's listTasks to read from disk
    const { tasks } = await listTasks(batchId, { 
      status, 
      limit: 1000  // Get all for pagination
    });
    
    // Transform tasks to Task Runner format
    const transformedTasks = tasks.map(task => {
      // Map internal status to 4-state
      let mappedStatus = 'queued';
      if (task.status === 'success' || task.status === 'done') {
        mappedStatus = 'success';
      } else if (task.status === 'failed' || task.status === 'error' || task.status === 'canceled') {
        mappedStatus = 'failed';
      } else if (task.status === 'running' || task.status === 'processing' || task.status === 'downloading' || task.status === 'transcoding' || task.status === 'analyzing') {
        mappedStatus = 'running';
      }
      
      return {
        id: task.id,
        status: mappedStatus,
        progress: task.progress || 0,
        updatedAt: task.updatedAt || task.createdAt,
        title: task.payload?.url || path.basename(task.payload?.localPath || '') || task.id,
        source: task.kind === 'url' ? 'url' : 'file',
        error: task.error,
        createdBy: 'web',
        remoteId: task.id  // For navigation to /video/:id
      };
    });
    
    // Sort by updatedAt desc
    transformedTasks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    // Apply pagination
    const paginatedTasks = transformedTasks.slice(offset, offset + limit);
    
    console.log(`[GET /api/tasks] Batch ${batchId}: returning ${paginatedTasks.length}/${transformedTasks.length} tasks`);
    
    res.json({
      items: paginatedTasks,
      total: transformedTasks.length,
      limit,
      offset
    });
    
  } catch (e) {
    console.error('[GET /api/tasks] Error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/tasks/url - Add URL tasks
router.post('/tasks/url', async (req, res) => {
  // Set no-cache headers
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  try {
    // Ensure batch exists and get ID
    const batchId = await ensureBatchId(req, res);
    
    // Read batch to update counts
    const batch = await readBatch(batchId);
    
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    // Allow duplicates - don't dedupe URLs
    const validUrls = urls.map(u => String(u).trim()).filter(Boolean).slice(0, 200);
    const created = [];
    
    // Use batch system's createTask which writes to disk
    for (const url of validUrls) {
      const rec = await createTask(batchId, { kind: 'url', payload: { url } });
      created.push(rec);
      
      // Enqueue for processing
      enqueue({ 
        batchId: batchId, 
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
    
    // Update batch counts and write to disk
    batch.counts.queued = (batch.counts.queued || 0) + created.length;
    await writeBatch(batch);
    
    console.log(`[POST /tasks/url] Created ${created.length} tasks in batch ${batchId}`);
    
    // Return format expected by frontend
    res.json({ 
      created: created.map(t => ({
        id: t.id,
        title: t.payload?.url || 'URL Task',
        source: 'url',
        status: t.status || 'queued'
      })),
      duplicates: [],
      batchId: batchId,
      message: `Added ${created.length} URL tasks to batch ${batchId}`
    });
    
  } catch (e) {
    console.error('[POST /api/tasks/url] Error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/tasks/upload - Upload files
router.post('/tasks/upload', async (req, res, next) => {
  // Set no-cache headers
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  try {
    // Ensure batch exists and get ID
    const batchId = await ensureBatchId(req, res);
    
    // Setup multer with batch-specific storage
    const storage = multer.diskStorage({
      destination: function(req, file, cb) {
        const dir = path.join(BATCHES_DIR, batchId, 'uploads');
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
        const files = req.files || [];
        const created = [];
        
        // Read batch to update counts
        const batch = await readBatch(batchId);
        
        // Use batch system's createTask which writes to disk
        for (const f of files) {
          const rec = await createTask(batchId, { 
            kind: 'file', 
            payload: { 
              localPath: f.path, 
              mimetype: f.mimetype || 'video/mp4' 
            } 
          });
          created.push(rec);
          
          // Enqueue for processing
          enqueue({ 
            batchId: batchId, 
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
        
        // Update batch counts and write to disk
        if (created.length > 0) {
          batch.counts.queued = (batch.counts.queued || 0) + created.length;
          await writeBatch(batch);
        }
        
        console.log(`[POST /tasks/upload] Created ${created.length} tasks in batch ${batchId}`);
        
        // Return format expected by frontend
        res.json({ 
          created: created.map(t => ({
            id: t.id,
            title: path.basename(t.payload?.localPath || 'File'),
            source: 'file',
            status: t.status || 'queued'
          })),
          duplicates: [],
          batchId: batchId,
          message: created.length > 0 
            ? `Uploaded ${created.length} files to batch ${batchId}`
            : 'No files uploaded'
        });
        
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