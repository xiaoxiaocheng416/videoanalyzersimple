#!/bin/bash

echo "🚀 启动视频分析工具..."
echo ""

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误：未检测到 Node.js，请先安装 Node.js"
    exit 1
fi

echo "📦 检查并安装依赖..."

# 安装后端依赖
echo "📦 安装后端依赖..."
cd backend
if [ ! -d "node_modules" ]; then
    npm install
fi

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo "⚠️  警告：未找到 .env 文件"
    echo "📝 正在创建 .env 文件..."
    cp .env.example .env
    echo "❗ 请编辑 backend/.env 文件，添加你的 GEMINI_API_KEY"
    echo "   然后重新运行此脚本"
    exit 1
fi

# 检查 API key 是否设置
if grep -q "your_gemini_api_key_here" .env; then
    echo "❗ 错误：请在 backend/.env 文件中设置你的 GEMINI_API_KEY"
    exit 1
fi

# 启动后端
echo "🔧 启动后端服务..."
npm start &
BACKEND_PID=$!

# 安装前端依赖
cd ../frontend
echo "📦 安装前端依赖..."
if [ ! -d "node_modules" ]; then
    npm install
fi

# 启动前端
echo "🎨 启动前端服务..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ 服务启动成功！"
echo "📍 前端地址: http://localhost:3000"
echo "📍 后端地址: http://localhost:5000"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待并清理
trap "echo '正在停止服务...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait