const fs = require('fs');
const path = require('path');

const LOCAL_ORIGIN = process.env.PUBLIC_API_ORIGIN || `http://127.0.0.1:${process.env.PORT || 5000}`;

async function analyzeUrlTask(url) {
  const resp = await fetch(`${LOCAL_ORIGIN}/api/videos/analyze_url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`analyzeUrl failed: ${resp.status} ${err}`);
  }
  const json = await resp.json();
  return json;
}

async function analyzeFileTask(localPath, mimetype = 'video/mp4') {
  // Node 18 has global FormData/Blob
  const buf = fs.readFileSync(localPath);
  const blob = new Blob([buf], { type: mimetype });
  const fd = new FormData();
  fd.append('video', blob, path.basename(localPath));

  const resp = await fetch(`${LOCAL_ORIGIN}/api/videos/upload`, {
    method: 'POST',
    body: fd,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`analyzeFile failed: ${resp.status} ${err}`);
  }
  const json = await resp.json();
  return json;
}

module.exports = { analyzeUrlTask, analyzeFileTask };

