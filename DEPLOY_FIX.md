# 🚨 紧急修复：视频播放问题

## 问题
- 前端使用HTTPS，后端返回HTTP视频URL
- 浏览器Mixed Content Policy阻止HTTPS页面加载HTTP资源
- 导致视频无法播放

## 立即修复步骤

### 1. 登录Render Dashboard
访问 https://dashboard.render.com

### 2. 进入后端服务
找到你的后端服务（应该叫 videoanalyzersimple 或类似名称）

### 3. 设置环境变量
1. 点击 **Environment** 标签
2. 点击 **Add Environment Variable**
3. 添加以下变量：

| Key | Value |
|-----|-------|
| PUBLIC_API_ORIGIN | https://videoanalyzersimple.onrender.com |

⚠️ **重要**：
- 必须是 **https**，不是 http
- 替换为你实际的Render后端服务URL
- 不要加末尾的斜杠

### 4. 重新部署
点击 **Manual Deploy** → **Deploy latest commit**
或者点击 **Restart Service**

### 5. 等待部署完成
通常需要2-3分钟

### 6. 验证修复
1. 使用**新的TikTok链接**测试（避免缓存）
2. 打开浏览器开发者工具
3. 检查Network面板，视频URL应该是 `https://...`
4. Console不应有Mixed Content错误
5. 视频应能正常播放和拖动进度条

## 验证检查清单

✅ API响应中 `playable_url` 是 `https://` 开头  
✅ 浏览器Console无Mixed Content错误  
✅ 视频可以播放  
✅ 视频可以拖动进度条  
✅ Network面板显示206状态码（Range请求）  

## 如果还有问题

### CORS错误
如果看到CORS错误，在Render环境变量中再添加：
- `CORS_ORIGIN`: `https://你的前端域名.netlify.app`

### 仍然是HTTP
1. 确认环境变量已正确设置
2. 确认服务已重新部署
3. 清除浏览器缓存
4. 使用新的视频链接测试

## 已完成的代码更改（无需再改）

✅ 后端支持 `PUBLIC_API_ORIGIN` 环境变量  
✅ 支持 `trust proxy` 配置  
✅ 支持 `x-forwarded-proto` 头  
✅ 动态生成播放URL  

## 技术说明

问题根因：
```
前端(HTTPS) → 后端返回 http://... → 浏览器阻止 ❌
```

修复后：
```
前端(HTTPS) → 后端返回 https://... → 正常播放 ✅
```

---

**完成以上步骤后，视频播放功能应该完全恢复正常。**