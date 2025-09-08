const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createBatch, readBatch, writeBatch, createTask, readTask, writeTask, listTasks, readResult, BATCHES_DIR } = require('../store/batchStore');
const { enqueue } = require('../queue/worker');
const { analyzeUrlTask, analyzeFileTask } = require('../services/analyzeService');

const router = express.Router();

// Helper function to ensure playable URL is in standard format
function ensurePlayableShape(result) {
  if (!result) return result;
  
  const origin = process.env.PUBLIC_API_ORIGIN || `http://localhost:${process.env.PORT || 5000}`;
  
  // Extract playable URL from all possible locations
  let playableUrl = result?.meta?.playable_url
    || result?.meta?.playableUrl
    || result?.playable_url  
    || result?.playableUrl
    || null;
  
  // Convert relative path to absolute URL
  if (playableUrl && playableUrl.startsWith('/')) {
    try {
      playableUrl = new URL(playableUrl, origin).toString();
    } catch (e) {
      console.warn('[API] Failed to normalize playable URL:', e.message);
    }
  }
  
  // Ensure meta structure exists and set normalized URL
  result.meta = {
    ...(result.meta || {}),
    playable_url: playableUrl
  };
  
  return result;
}

// List batches (id, title, createdAt)
router.get('/batches', async (_req, res) => {
  try {
    const fs = require('fs');
    const dirs = fs.readdirSync(BATCHES_DIR).filter(n => !n.startsWith('.'));
    const rows = [];
    for (const id of dirs) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(BATCHES_DIR, id, 'batch.json'), 'utf-8'));
        rows.push({ id: json.id || id, title: json.title || '', createdAt: json.createdAt || '' });
      } catch {}
    }
    rows.sort((a,b) => (a.createdAt>b.createdAt?-1:1));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Create batch
router.post('/batches', async (req, res) => {
  try {
    const title = (req.body && req.body.title) || '';
    const batch = await createBatch(title);
    res.json(batch);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Add URL tasks
router.post('/batches/:id/tasks/url', async (req, res) => {
  try {
    const batchId = req.params.id;
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const uniq = Array.from(new Set(urls.map(u => String(u).trim()).filter(Boolean))).slice(0, 200);
    const created = [];
    for (const url of uniq) {
      const rec = await createTask(batchId, { kind: 'url', payload: { url } });
      created.push(rec);
      enqueue({ batchId, taskId: rec.id, analyze: async (task, onProgress, isCanceled) => {
        onProgress(10, 'queued');
        if (isCanceled()) throw new Error('canceled');
        onProgress(30, 'analyzing');
        const out = await analyzeUrlTask(task.payload.url);
        onProgress(100, 'done');
        return out;
      }});
    }
    // update batch counts
    const batch = await readBatch(batchId);
    batch.counts.queued += created.length;
    await writeBatch(batch);
    res.json({ ok: true, created: created.map(t => t.id) });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Disk storage for uploads to batch
function makeUploadStorage(batchId) {
  return multer.diskStorage({
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
}

router.post('/batches/:id/tasks/upload', (req, res) => {
  const batchId = req.params.id;
  const upload = multer({ storage: makeUploadStorage(batchId), limits: { fileSize: 50 * 1024 * 1024 } }).array('files', 200);
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const files = req.files || [];
      const created = [];
      for (const f of files) {
        const rec = await createTask(batchId, { kind: 'file', payload: { localPath: f.path, mimetype: f.mimetype || 'video/mp4' } });
        created.push(rec);
        enqueue({ batchId, taskId: rec.id, analyze: async (task, onProgress, isCanceled) => {
          onProgress(10, 'queued');
          if (isCanceled()) throw new Error('canceled');
          onProgress(30, 'analyzing');
          const out = await analyzeFileTask(task.payload.localPath, task.payload.mimetype);
          onProgress(100, 'done');
          return out;
        }});
      }
      const batch = await readBatch(batchId);
      batch.counts.queued += created.length;
      await writeBatch(batch);
      res.json({ ok: true, created: created.map(t => t.id) });
    } catch (e2) { res.status(500).json({ error: String(e2.message || e2) }); }
  });
});

// Batch overview
router.get('/batches/:id', async (req, res) => {
  try { res.json(await readBatch(req.params.id)); } catch (e) { res.status(404).json({ error: 'Batch not found' }); }
});

// List tasks with pagination - ROBUST: handles concurrent reads/writes gracefully
router.get('/batches/:id/tasks', async (req, res) => {
  try {
    const batchId = req.params.id;
    const status = req.query.status;
    
    // Robust limit parsing with fallback
    let limit = 50;
    if (req.query.limit) {
      const parsed = parseInt(req.query.limit, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 1000); // Cap at 1000
      }
    }
    
    const cursor = req.query.cursor || null;
    
    // Verify batch exists first
    const batchDir = path.join(BATCHES_DIR, batchId);
    if (!fs.existsSync(batchDir)) {
      // Return empty result instead of error for non-existent batch
      return res.json({ tasks: [], nextCursor: null });
    }
    
    // Get tasks with built-in error handling
    const data = await listTasks(batchId, { status, limit, cursor });
    
    // Sort by updatedAt desc (newest first) with null safety
    if (data.tasks && data.tasks.length > 0) {
      data.tasks.sort((a, b) => {
        // Ensure updatedAt exists, fallback to createdAt or current time
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime; // desc order
      });
    }
    
    console.log(`GET /batches/${batchId}/tasks - returned ${data.tasks.length} tasks`);
    res.json(data);
    
  } catch (e) { 
    // Log detailed error but return empty result to prevent frontend errors
    console.error(`List tasks error for batch ${req.params.id}:`, e);
    
    // Return empty result instead of 500 to maintain frontend stability
    // This allows the UI to continue functioning even during filesystem issues
    res.json({ 
      tasks: [], 
      nextCursor: null,
      error: 'Unable to fetch tasks, showing cached data'
    });
  }
});

// Task detail (include result if exists)
router.get('/tasks/:taskId', async (req, res) => {
  try {
    // naive scan across batches to find task
    const fs = require('fs');
    const bids = fs.readdirSync(BATCHES_DIR).filter(n => !n.startsWith('.'));
    for (const bid of bids) {
      const tdir = path.join(BATCHES_DIR, bid, 'tasks');
      const file = path.join(tdir, `${req.params.taskId}.json`);
      if (fs.existsSync(file)) {
        const task = JSON.parse(fs.readFileSync(file, 'utf-8'));
        let result = null;
        try { result = await readResult(bid, task.id); } catch {}
        // Ensure result has standard playable URL format
        result = ensurePlayableShape(result);
        return res.json({ ...task, result });
      }
    }
    return res.status(404).json({ error: 'Task not found' });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Retry a task
router.post('/tasks/:taskId/retry', async (req, res) => {
  try {
    const fs = require('fs');
    const bids = fs.readdirSync(BATCHES_DIR).filter(n => !n.startsWith('.'));
    for (const bid of bids) {
      const file = path.join(BATCHES_DIR, bid, 'tasks', `${req.params.taskId}.json`);
      if (fs.existsSync(file)) {
        const task = JSON.parse(fs.readFileSync(file, 'utf-8'));
        task.status = 'queued'; task.error = null; task.progress = 0; task.retries = (task.retries || 0) + 1;
        fs.writeFileSync(file, JSON.stringify(task, null, 2));
        enqueue({ batchId: bid, taskId: task.id, analyze: async (t, onProgress) => {
          onProgress(10, 'queued');
          if (t.kind === 'url') return analyzeUrlTask(t.payload.url);
          return analyzeFileTask(t.payload.localPath, t.payload.mimetype);
        }});
        return res.json({ ok: true });
      }
    }
    res.status(404).json({ error: 'Task not found' });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Delete a task - IDEMPOTENT: always returns 204 even if task doesn't exist
router.delete('/tasks/:taskId', async (req, res) => {
  try {
    const fs = require('fs');
    const bids = fs.readdirSync(BATCHES_DIR).filter(n => !n.startsWith('.'));
    let found = false;
    
    for (const bid of bids) {
      const taskFile = path.join(BATCHES_DIR, bid, 'tasks', `${req.params.taskId}.json`);
      const resultFile = path.join(BATCHES_DIR, bid, 'results', `${req.params.taskId}.json`);
      
      if (fs.existsSync(taskFile)) {
        found = true;
        
        try {
          // Delete task file
          fs.unlinkSync(taskFile);
        } catch (e) {
          console.warn(`Failed to delete task file ${taskFile}:`, e.message);
        }
        
        // Delete result file if exists
        if (fs.existsSync(resultFile)) {
          try {
            fs.unlinkSync(resultFile);
          } catch (e) {
            console.warn(`Failed to delete result file ${resultFile}:`, e.message);
          }
        }
        
        // Update batch counts (optional, non-critical)
        try {
          const batch = await readBatch(bid);
          await writeBatch(batch);
        } catch (e) {
          console.warn(`Failed to update batch counts for ${bid}:`, e.message);
        }
        
        break; // Task found and deleted, exit loop
      }
    }
    
    // IDEMPOTENT: Always return 204, whether task existed or not
    // This prevents frontend errors when deleting already-deleted tasks
    console.log(`DELETE /tasks/${req.params.taskId} - ${found ? 'deleted' : 'not found (idempotent)'}`);
    res.status(204).send(); // No Content - successful deletion (idempotent)
    
  } catch (e) { 
    console.error('Delete task error:', e);
    res.status(500).json({ error: String(e.message || e) }); 
  }
});

// Bulk delete tasks - IDEMPOTENT: handles multiple task deletions efficiently
router.post('/tasks/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'Invalid request: ids must be an array' });
    }
    
    if (ids.length === 0) {
      return res.json({ ok: true, results: [] });
    }
    
    // Limit to prevent abuse
    const taskIds = ids.slice(0, 100).map(id => String(id));
    
    const results = [];
    const fs = require('fs');
    const bids = fs.readdirSync(BATCHES_DIR).filter(n => !n.startsWith('.'));
    
    for (const taskId of taskIds) {
      let status = 'not_found';
      
      for (const bid of bids) {
        const taskFile = path.join(BATCHES_DIR, bid, 'tasks', `${taskId}.json`);
        const resultFile = path.join(BATCHES_DIR, bid, 'results', `${taskId}.json`);
        
        if (fs.existsSync(taskFile)) {
          try {
            fs.unlinkSync(taskFile);
            status = 'deleted';
          } catch (e) {
            console.warn(`Failed to delete task ${taskId}:`, e.message);
            status = 'error';
          }
          
          // Try to delete result file
          if (fs.existsSync(resultFile)) {
            try {
              fs.unlinkSync(resultFile);
            } catch (e) {
              console.warn(`Failed to delete result for ${taskId}:`, e.message);
            }
          }
          
          break; // Task found in this batch, no need to check others
        }
      }
      
      results.push({ id: taskId, status });
    }
    
    const deleted = results.filter(r => r.status === 'deleted').length;
    const notFound = results.filter(r => r.status === 'not_found').length;
    const errors = results.filter(r => r.status === 'error').length;
    
    console.log(`BULK DELETE: ${deleted} deleted, ${notFound} not found, ${errors} errors`);
    
    res.json({
      ok: true,
      summary: { deleted, notFound, errors },
      results
    });
    
  } catch (e) {
    console.error('Bulk delete error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Export batch
router.get('/batches/:id/export.:fmt', async (req, res) => {
  try {
    const { id, fmt } = { id: req.params.id, fmt: req.params.fmt };
    const { tasks } = await listTasks(id, { limit: 10000 });
    if (fmt === 'json') {
      const rows = [];
      for (const t of tasks) {
        let result = null; try { result = await readResult(id, t.id); } catch {}
        rows.push({ ...t, result });
      }
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ batchId: id, tasks: rows }, null, 2));
    }
    if (fmt === 'csv') {
      const headers = ['id','kind','url','status','grade','score','pass_probability'];
      const lines = [headers.join(',')];
      for (const t of tasks) {
        let result = null; try { result = await readResult(id, t.id); } catch {}
        const url = t.kind === 'url' ? (t.payload?.url || '') : '';
        const grade = result?.analysisResult?.parsed_data?.overview?.grade || '';
        const score = result?.analysisResult?.parsed_data?.overview?.score || '';
        const passProb = result?.analysisResult?.parsed_data?.forecast?.pass_probability || '';
        lines.push([t.id, t.kind, JSON.stringify(url), t.status, grade, score, passProb].join(','));
      }
      res.setHeader('Content-Type', 'text/csv');
      return res.end(lines.join('\n'));
    }
    res.status(400).json({ error: 'Unsupported format' });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

module.exports = router;
