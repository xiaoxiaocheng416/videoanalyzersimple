const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const execFileAsync = promisify(execFile);

// Sanitize a video file by stripping all container metadata/chapters/subtitles/data tracks
// and moving moov atom to the beginning for faster start. No re-encode (stream copy).
// Returns the output path (or inputPath if sanitization fails).
async function sanitizeVideo(inputPath) {
  try {
    if (!inputPath || !fs.existsSync(inputPath)) return inputPath;
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath).replace(/\.mp4$/i, '');
    const outputPath = path.join(dir, `${base}.clean.mp4`);

    const args = [
      '-y', '-loglevel', 'error',
      '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0?', '-dn', '-sn', '-map_chapters', '-1',
      '-c', 'copy',
      '-map_metadata', '-1',
      '-movflags', '+faststart',
      outputPath,
    ];
    await execFileAsync('ffmpeg', args);

    // Verify output exists and non-empty
    const stat = fs.statSync(outputPath);
    if (stat.size > 0) return outputPath;
    return inputPath;
  } catch (e) {
    return inputPath;
  }
}

module.exports = { sanitizeVideo };

