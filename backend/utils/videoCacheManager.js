const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// 配置
const CACHE_DIR = process.env.VIDEO_CACHE_DIR || '/var/tmp/video-cache';
const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250MB
const MAX_CACHE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB total
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours
const FAILED_TTL = 30 * 60 * 1000; // 30 minutes

// 内存缓存索引
const cacheIndex = new Map();
const downloadLocks = new Map();

// 确保缓存目录存在
async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    console.error('[VideoCacheManager] Failed to create cache dir:', error);
  }
}

// 生成安全的token ID（不可预测）
function generateTokenId(url) {
  const nonce = crypto.randomBytes(8).toString('hex');
  const hash = crypto.createHash('sha256').update(url + nonce).digest();
  return hash.toString('base64url').substring(0, 16);
}

// 从TikTok URL提取视频ID
function extractTikTokId(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/video\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// 获取缓存文件路径
function getCacheFilePath(tokenId) {
  return path.join(CACHE_DIR, `${tokenId}.mp4`);
}

// 检查文件是否存在且未过期
async function isCacheValid(tokenId, expiresAt) {
  try {
    const filePath = getCacheFilePath(tokenId);
    const stat = await fs.stat(filePath);
    return stat.size > 0 && Date.now() < expiresAt;
  } catch {
    return false;
  }
}

// 下载视频文件
async function downloadVideo(url, tokenId) {
  const filePath = getCacheFilePath(tokenId);
  
  // 使用yt-dlp下载最佳MP4格式 - 注意路径需要用引号包裹
  const ytdlpPath = path.join(__dirname, '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
  const cmd = [
    `"${ytdlpPath}"`,
    `"${url}"`,
    '-f', 'best[ext=mp4]/best',
    '--no-warnings',
    '--no-check-certificates',
    '--referer', 'https://www.tiktok.com/',
    '-o', `"${filePath}"`,
    '--max-filesize', `${MAX_FILE_SIZE}`,
  ].join(' ');

  console.log('[VideoCacheManager] Downloading video:', { tokenId, url });
  
  try {
    const { stdout, stderr } = await execAsync(cmd, { 
      timeout: 60000, // 60 seconds timeout
      maxBuffer: 10 * 1024 * 1024 
    });
    
    // 验证文件
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    console.log('[VideoCacheManager] Download successful:', { tokenId, size: stat.size });
    return { success: true, filePath, size: stat.size };
  } catch (error) {
    console.error('[VideoCacheManager] Download failed:', error.message);
    // 清理失败的文件
    try {
      await fs.unlink(filePath);
    } catch {}
    return { success: false, error: error.message };
  }
}

// 获取或下载视频
async function getOrDownloadVideo(url) {
  const tokenId = generateTokenId(url);
  const tiktokId = extractTikTokId(url);
  
  // 检查内存缓存
  const cached = cacheIndex.get(url);
  if (cached && await isCacheValid(cached.tokenId, cached.expiresAt)) {
    console.log('[VideoCacheManager] Cache hit:', { tokenId: cached.tokenId, url });
    return {
      success: true,
      tokenId: cached.tokenId,
      tiktokId,
      playableUrl: `/media/${cached.tokenId}`,
      expiresAt: cached.expiresAt,
      cacheHit: true,
      storage: 'local'
    };
  }
  
  // 检查是否已有下载任务
  if (downloadLocks.has(url)) {
    console.log('[VideoCacheManager] Waiting for existing download:', url);
    return await downloadLocks.get(url);
  }
  
  // 创建下载任务
  const downloadPromise = (async () => {
    try {
      const result = await downloadVideo(url, tokenId);
      
      if (result.success) {
        const expiresAt = Date.now() + DEFAULT_TTL;
        
        // 更新内存缓存
        cacheIndex.set(url, {
          tokenId,
          tiktokId,
          expiresAt,
          size: result.size,
          createdAt: Date.now()
        });
        
        return {
          success: true,
          tokenId,
          tiktokId,
          playableUrl: `/media/${tokenId}`,
          expiresAt,
          cacheHit: false,
          storage: 'local'
        };
      } else {
        // 失败情况，返回失败信息但设置短TTL
        const expiresAt = Date.now() + FAILED_TTL;
        cacheIndex.set(url, {
          tokenId: null,
          tiktokId,
          expiresAt,
          failed: true,
          error: result.error
        });
        
        return {
          success: false,
          error: result.error,
          tiktokId,
          fallbackEmbed: tiktokId ? `https://www.tiktok.com/embed/v2/${tiktokId}` : null
        };
      }
    } finally {
      downloadLocks.delete(url);
    }
  })();
  
  downloadLocks.set(url, downloadPromise);
  return await downloadPromise;
}

// 清理过期缓存
async function cleanupExpiredCache() {
  console.log('[VideoCacheManager] Starting cache cleanup');
  
  try {
    const now = Date.now();
    const filesToDelete = [];
    
    // 检查内存索引
    for (const [url, cache] of cacheIndex.entries()) {
      if (now > cache.expiresAt) {
        if (cache.tokenId) {
          filesToDelete.push(getCacheFilePath(cache.tokenId));
        }
        cacheIndex.delete(url);
      }
    }
    
    // 删除过期文件
    for (const filePath of filesToDelete) {
      try {
        await fs.unlink(filePath);
        console.log('[VideoCacheManager] Deleted expired file:', filePath);
      } catch (error) {
        console.error('[VideoCacheManager] Failed to delete file:', filePath, error.message);
      }
    }
    
    // 检查总大小，执行LRU清理
    await enforceMaxCacheSize();
    
  } catch (error) {
    console.error('[VideoCacheManager] Cleanup error:', error);
  }
}

// 强制执行最大缓存大小限制
async function enforceMaxCacheSize() {
  try {
    const files = await fs.readdir(CACHE_DIR);
    const fileStats = [];
    let totalSize = 0;
    
    // 获取所有文件信息
    for (const file of files) {
      if (file.endsWith('.mp4')) {
        const filePath = path.join(CACHE_DIR, file);
        try {
          const stat = await fs.stat(filePath);
          fileStats.push({ path: filePath, size: stat.size, mtime: stat.mtime });
          totalSize += stat.size;
        } catch {}
      }
    }
    
    // 如果超过限制，删除最旧的文件
    if (totalSize > MAX_CACHE_SIZE) {
      console.log('[VideoCacheManager] Cache size exceeded:', { totalSize, maxSize: MAX_CACHE_SIZE });
      
      // 按修改时间排序（最旧的在前）
      fileStats.sort((a, b) => a.mtime - b.mtime);
      
      while (totalSize > MAX_CACHE_SIZE && fileStats.length > 0) {
        const oldest = fileStats.shift();
        try {
          await fs.unlink(oldest.path);
          totalSize -= oldest.size;
          console.log('[VideoCacheManager] Deleted for space:', oldest.path);
        } catch {}
      }
    }
  } catch (error) {
    console.error('[VideoCacheManager] Failed to enforce cache size:', error);
  }
}

// 初始化
ensureCacheDir();

// 定期清理（每小时）
setInterval(cleanupExpiredCache, 60 * 60 * 1000);

module.exports = {
  getOrDownloadVideo,
  getCacheFilePath,
  cleanupExpiredCache,
  generateTokenId
};