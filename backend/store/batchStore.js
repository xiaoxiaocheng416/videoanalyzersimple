const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.VIDEO_CACHE_DIR || '/var/tmp/video-cache';
const BATCHES_DIR = path.join(ROOT, 'batches');

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true }).catch(() => {});
}

function uuid() {
  return crypto.randomBytes(16).toString('hex');
}

async function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp-${Date.now()}`;
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, filePath);
}

async function createBatch(title = '') {
  const id = uuid();
  const dir = path.join(BATCHES_DIR, id);
  await ensureDir(path.join(dir, 'tasks'));
  await ensureDir(path.join(dir, 'uploads'));
  await ensureDir(path.join(dir, 'results'));
  const batch = {
    id,
    title,
    createdAt: new Date().toISOString(),
    status: 'active',
    counts: { queued: 0, running: 0, success: 0, failed: 0 },
  };
  await atomicWrite(path.join(dir, 'batch.json'), JSON.stringify(batch, null, 2));
  return batch;
}

async function readBatch(batchId) {
  const file = path.join(BATCHES_DIR, batchId, 'batch.json');
  const txt = await fsp.readFile(file, 'utf-8');
  return JSON.parse(txt);
}

async function writeBatch(batch) {
  const file = path.join(BATCHES_DIR, batch.id, 'batch.json');
  await atomicWrite(file, JSON.stringify(batch, null, 2));
}

async function createTask(batchId, task) {
  const id = uuid();
  const dir = path.join(BATCHES_DIR, batchId, 'tasks');
  await ensureDir(dir);
  const now = new Date().toISOString();
  const record = {
    id,
    batchId,
    kind: task.kind,
    payload: task.payload,
    status: 'queued',
    progress: 0,
    retries: 0,
    createdAt: now,
    updatedAt: now,
  };
  await atomicWrite(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

async function readTask(batchId, taskId) {
  const file = path.join(BATCHES_DIR, batchId, 'tasks', `${taskId}.json`);
  const txt = await fsp.readFile(file, 'utf-8');
  return JSON.parse(txt);
}

async function writeTask(record) {
  const file = path.join(BATCHES_DIR, record.batchId, 'tasks', `${record.id}.json`);
  record.updatedAt = new Date().toISOString();
  await atomicWrite(file, JSON.stringify(record, null, 2));
}

async function listTasks(batchId, { status, limit = 50, cursor } = {}) {
  const dir = path.join(BATCHES_DIR, batchId, 'tasks');
  
  // Safely read directory, return empty if doesn't exist
  let files = [];
  try {
    files = (await fsp.readdir(dir)).filter(f => f.endsWith('.json')).sort();
  } catch (e) {
    console.warn(`Directory ${dir} not accessible:`, e.message);
    return { tasks: [], nextCursor: null };
  }
  
  let start = 0;
  if (cursor) {
    const idx = files.indexOf(cursor);
    if (idx >= 0) start = idx + 1;
  }
  
  const slice = files.slice(start, start + Math.min(limit, 1000)); // Cap limit at 1000
  const tasks = [];
  
  // Read each file with error handling
  for (const f of slice) {
    try {
      const filePath = path.join(dir, f);
      const content = await fsp.readFile(filePath, 'utf-8');
      
      // Parse JSON with error handling
      let rec;
      try {
        rec = JSON.parse(content);
      } catch (parseErr) {
        console.warn(`Corrupted JSON in ${filePath}, skipping:`, parseErr.message);
        continue; // Skip corrupted files
      }
      
      // Apply status filter if provided
      if (!status || rec.status === status) {
        // Ensure required fields exist
        if (!rec.updatedAt) rec.updatedAt = rec.createdAt || new Date().toISOString();
        tasks.push(rec);
      }
    } catch (readErr) {
      console.warn(`Cannot read task file ${f}:`, readErr.message);
      // Continue with other files
    }
  }
  
  const nextCursor = start + limit < files.length ? files[start + limit - 1] : null;
  return { tasks, nextCursor };
}

async function writeResult(batchId, taskId, data) {
  const file = path.join(BATCHES_DIR, batchId, 'results', `${taskId}.result.json`);
  await atomicWrite(file, JSON.stringify(data, null, 2));
  return file;
}

async function readResult(batchId, taskId) {
  const file = path.join(BATCHES_DIR, batchId, 'results', `${taskId}.result.json`);
  const txt = await fsp.readFile(file, 'utf-8');
  return JSON.parse(txt);
}

async function batchDirs() {
  await ensureDir(BATCHES_DIR);
  return (await fsp.readdir(BATCHES_DIR).catch(() => [])).filter(n => !n.startsWith('.'));
}

module.exports = {
  createBatch,
  readBatch,
  writeBatch,
  createTask,
  readTask,
  writeTask,
  listTasks,
  writeResult,
  readResult,
  batchDirs,
  BATCHES_DIR,
  ROOT,
};

