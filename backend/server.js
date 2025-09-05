const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const app = express();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Middleware - 明确允许跨域
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

// Routes
app.post('/api/videos/upload', upload.single('video'), videoController.uploadVideo);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: '视频分析服务运行中' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: '服务器错误', 
    error: err.message 
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 服务器运行在端口 ${PORT}`);
  console.log(`📡 API 地址: http://localhost:${PORT}/api`);
});
