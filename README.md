# 视频分析工具 - Gemini AI

一个简单易用的视频分析工具，使用 Google Gemini AI 对视频内容进行智能分析。

## 🚀 功能特点

- 📹 支持 MP4、MOV、AVI 格式视频上传
- 🤖 使用 Google Gemini AI 进行智能分析
- 📊 提供详细的视频内容评估报告
- 🎯 包含质量评分、改进建议等
- 💻 简洁的 Web 界面，无需登录

## 📋 系统要求

- Node.js 16.0 或更高版本
- npm 或 yarn 包管理器
- Google Gemini API 密钥

## 🔧 安装步骤

### 1. 获取 Gemini API 密钥

1. 访问 [Google AI Studio](https://makersuite.google.com/app/apikey)
2. 创建或登录 Google 账号
3. 点击 "Get API Key" 获取密钥
4. 保存密钥备用

### 2. 配置后端

```bash
# 进入后端目录
cd backend

# 安装依赖
npm install

# 复制环境变量文件
cp .env.example .env

# 编辑 .env 文件，添加你的 Gemini API 密钥
# GEMINI_API_KEY=你的密钥
```

### 3. 配置前端

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install
```

## 🎮 使用方法

### 启动服务

需要同时启动前端和后端服务：

#### 方法一：分别启动（推荐）

**终端 1 - 启动后端：**
```bash
cd backend
npm start
# 服务将在 http://localhost:5000 运行
```

**终端 2 - 启动前端：**
```bash
cd frontend
npm run dev
# 服务将在 http://localhost:3000 运行
```

#### 方法二：使用启动脚本

如果你使用 macOS 或 Linux：
```bash
# 在项目根目录创建启动脚本
chmod +x start.sh
./start.sh
```

### 访问应用

打开浏览器访问：http://localhost:3000

## 📝 使用流程

1. **上传视频**
   - 点击 "选择视频" 按钮
   - 选择 MP4、MOV 或 AVI 格式的视频文件
   - 文件大小限制：50MB

2. **分析视频**
   - 点击 "分析视频" 按钮
   - 等待 Gemini AI 完成分析（通常需要 10-30 秒）

3. **查看结果**
   - 分析完成后会显示详细报告
   - 包含视频质量评分、内容分析、改进建议等
   - 可以切换查看原始 JSON 数据

## 🛠️ 项目结构

```
video-analyzer-simple/
├── frontend/               # 前端项目
│   ├── src/
│   │   ├── components/    # Vue 组件
│   │   ├── App.vue        # 主应用组件
│   │   ├── main.ts        # 入口文件
│   │   └── style.css      # 全局样式
│   ├── package.json
│   └── vite.config.ts     # Vite 配置
│
├── backend/               # 后端项目
│   ├── controllers/       # 控制器
│   │   └── videoController.js
│   ├── server.js          # 服务器入口
│   ├── package.json
│   └── .env.example       # 环境变量示例
│
└── README.md             # 本文档
```

## ⚙️ 配置说明

### 前端配置 (vite.config.ts)

- 默认端口：3000
- API 代理：自动将 `/api` 请求转发到后端

### 后端配置 (.env)

```env
# Gemini API 密钥（必需）
GEMINI_API_KEY=你的密钥

# 服务器端口（可选，默认 5000）
PORT=5000

# 环境（可选）
NODE_ENV=development
```

## 🚨 常见问题

### 1. API 密钥错误
- 确保 `.env` 文件中的 `GEMINI_API_KEY` 正确
- 检查密钥是否有效且未过期

### 2. 视频上传失败
- 检查视频格式是否为 MP4、MOV 或 AVI
- 确保视频大小不超过 50MB
- 检查网络连接

### 3. 分析超时
- 大视频文件可能需要更长时间
- 检查 Gemini API 配额是否用完
- 尝试使用较小的视频文件

### 4. 端口被占用
- 修改前端端口：编辑 `frontend/vite.config.ts`
- 修改后端端口：编辑 `backend/.env` 文件

## 📦 部署建议

### 本地使用
- 按照上述步骤安装和运行即可

### 部署到 Vercel（前端）
1. 将前端代码推送到 GitHub
2. 在 Vercel 导入项目
3. 设置环境变量
4. 部署

### 部署到 Railway/Render（后端）
1. 将后端代码推送到 GitHub
2. 在平台创建新项目
3. 设置环境变量 `GEMINI_API_KEY`
4. 部署

## 🔒 安全提醒

- **不要** 将 `.env` 文件提交到版本控制
- **不要** 在前端代码中暴露 API 密钥
- 建议在生产环境使用 HTTPS
- 定期更换 API 密钥

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 联系方式

如有问题，请提交 Issue 或联系开发者。

---

**注意：** 本项目仅供学习和研究使用，请遵守相关法律法规和服务条款。