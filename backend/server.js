const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
// Honor X-Forwarded-* headers from reverse proxies (Render, etc.)
app.set('trust proxy', true);
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Middleware - 明确允许跨域
app.use(cookieParser());
app.use(cors({
  origin: [
    'http://localhost:3005',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    // Netlify production domain (adjust to your actual site domain)
    'https://videoanalyzer.netlify.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

// Video analysis controller
const videoController = require('./controllers/videoController');
const mediaController = require('./controllers/mediaController');
const batchesRouter = require('./routes/batches');
const tasksCompatRouter = require('./routes/tasksCompat');

// OPTIONS handlers for future export routes (M2)
app.options('/api/export', (req, res) => res.sendStatus(204));
app.options('/api/export/:id', (req, res) => res.sendStatus(204));

// Routes
app.post('/api/videos/upload', upload.single('video'), videoController.uploadVideo);
app.post('/api/videos/analyze_url', videoController.analyzeUrl);
app.use('/api', batchesRouter);
app.use('/api', tasksCompatRouter); // Compatibility routes for /tasks page

// Media streaming route with Range support
app.get('/media/:id', mediaController.streamVideo);

// Health check for platform monitoring (Render, etc.)
app.get('/api/health', (req, res) => {
  res.status(200).send('ok');
});

// Ping endpoint for warm-up
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: '服务器错误', 
    error: err.message 
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 服务器运行在端口 ${PORT}`);
  console.log(`📡 API 地址: http://localhost:${PORT}/api`);
  
  // 生产环境日志
  if (process.env.NODE_ENV === 'production') {
    console.log('🌐 生产环境配置:');
    console.log(`  - PUBLIC_API_ORIGIN: ${process.env.PUBLIC_API_ORIGIN || '未设置（将使用动态检测）'}`);
    console.log(`  - 视频缓存目录: ${process.env.VIDEO_CACHE_DIR || '/var/tmp/video-cache'}`);
    console.log(`  - Trust Proxy: 已启用`);
    console.log(`  - CORS 允许域名: ${['http://localhost:3005', 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'https://videoanalyzer.netlify.app'].join(', ')}`);
  }
});
