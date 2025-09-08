const { readBatch, writeBatch, readTask, writeTask, writeResult, batchDirs, BATCHES_DIR } = require('../store/batchStore');
const path = require('path');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_TASKS || '2', 10);

// Normalize playable URL to standard format: result.meta.playable_url
function normalizePlayableUrl(res) {
  if (!res) return res;
  
  const origin = process.env.PUBLIC_API_ORIGIN || `http://localhost:${process.env.PORT || 5000}`;
  
  // Extract playable URL from all possible locations
  let playableUrl = res?.meta?.playable_url
    || res?.meta?.playableUrl  
    || res?.playable_url
    || res?.playableUrl
    || null;
  
  // Convert relative path to absolute URL
  if (playableUrl && playableUrl.startsWith('/')) {
    try {
      playableUrl = new URL(playableUrl, origin).toString();
    } catch (e) {
      console.warn('[Worker] Failed to normalize playable URL:', e.message);
    }
  }
  
  // Ensure meta structure exists and set normalized URL
  res.meta = {
    ...(res.meta || {}),
    playable_url: playableUrl
  };
  
  return res;
}

const queue = [];
let running = 0;
const cancelFlags = new Map();

function enqueue(taskRef) {
  queue.push(taskRef);
  pump();
}

function cancelTask(taskId) {
  cancelFlags.set(taskId, true);
}

async function pump() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const taskRef = queue.shift();
    running++;
    runTask(taskRef).finally(() => {
      running--;
      pump();
    });
  }
}

async function runTask({ batchId, taskId, analyze }) {
  try {
    let task = await readTask(batchId, taskId);
    if (task.status === 'canceled') return;
    task.status = 'running';
    task.progress = 0;
    await writeTask(task);

    // Execute analysis
    const res = await analyze(task, (p, stage) => {
      task.progress = p; task.stage = stage; writeTask(task).catch(()=>{});
    }, () => cancelFlags.get(taskId));

    // Normalize playable URL before persisting
    const normalized = normalizePlayableUrl(res);
    
    // Persist result (split file)
    const resultPath = await writeResult(batchId, taskId, normalized);
    task.status = 'success';
    task.resultPath = resultPath;
    task.progress = 100;
    await writeTask(task);

    // Update batch counts lazily (optional)
    const batch = await readBatch(batchId);
    batch.counts.success = (batch.counts.success || 0) + 1;
    await writeBatch(batch);
  } catch (e) {
    try {
      const task = await readTask(batchId, taskId);
      task.status = cancelFlags.get(taskId) ? 'canceled' : 'failed';
      task.error = String(e && e.message ? e.message : e);
      await writeTask(task);
      const batch = await readBatch(batchId);
      batch.counts.failed = (batch.counts.failed || 0) + 1;
      await writeBatch(batch);
    } catch {}
  } finally {
    cancelFlags.delete(taskId);
  }
}

// Startup recovery: set running→queued and re-enqueue
async function recover(enqueueCb) {
  const dirs = await batchDirs();
  for (const id of dirs) {
    try {
      const tasksDir = path.join(BATCHES_DIR, id, 'tasks');
      const fs = require('fs');
      const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const task = JSON.parse(fs.readFileSync(path.join(tasksDir, f), 'utf-8'));
        if (task.status === 'running' || task.status === 'queued') {
          task.status = 'queued';
          fs.writeFileSync(path.join(tasksDir, f), JSON.stringify(task, null, 2));
          enqueueCb({ batchId: id, taskId: task.id });
        }
      }
    } catch {}
  }
}

module.exports = { enqueue, cancelTask, recover };

