const fs = require('fs');
const path = require('path');
const { getCacheFilePath } = require('../utils/videoCacheManager');

// 解析Range头
function parseRange(range, fileSize) {
  if (!range) return null;
  
  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  
  if (!isNaN(start) && !isNaN(end) && start >= 0 && end < fileSize && start <= end) {
    return { start, end };
  }
  
  return null;
}

// 流式传输视频，支持Range请求
exports.streamVideo = async (req, res) => {
  try {
    const { id } = req.params;
    
    // 验证token格式
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid media ID' });
    }
    
    // 获取文件路径
    const filePath = getCacheFilePath(id);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      console.log('[MediaController] File not found:', filePath);
      return res.status(404).json({ error: 'Media not found' });
    }
    
    // 获取文件信息
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    
    // 设置基本响应头
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'private, max-age=3600'); // 1 hour cache
    
    // 处理Range请求
    const range = req.headers.range;
    
    if (range) {
      // 解析Range
      const parsedRange = parseRange(range, fileSize);
      
      if (!parsedRange) {
        // Range格式错误
        res.status(416); // Range Not Satisfiable
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }
      
      const { start, end } = parsedRange;
      const chunkSize = end - start + 1;
      
      // 设置206响应
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);
      
      // 创建读取流并发送
      const stream = fs.createReadStream(filePath, { start, end });
      
      stream.on('error', (error) => {
        console.error('[MediaController] Stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });
      
      stream.pipe(res);
      
      // 日志
      console.log('[MediaController] Streaming partial:', {
        id,
        range: `${start}-${end}/${fileSize}`,
        chunkSize
      });
      
    } else {
      // 无Range请求，返回整个文件
      res.setHeader('Content-Length', fileSize);
      
      // 创建读取流并发送
      const stream = fs.createReadStream(filePath);
      
      stream.on('error', (error) => {
        console.error('[MediaController] Stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });
      
      stream.pipe(res);
      
      // 日志
      console.log('[MediaController] Streaming full file:', {
        id,
        size: fileSize
      });
    }
    
  } catch (error) {
    console.error('[MediaController] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};