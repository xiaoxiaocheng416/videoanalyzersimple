# Phase 0 - Task Runner 对齐与计划 (P0.1 修订版)

## 1. 范围确认

### 允许修改的文件
- `app/tasks/**` - Task Runner 页面
- `components/tasks-runner/**` - Task Runner 专属组件
- `lib/tasks-runner/**` - Task Runner 专属逻辑
- `uiStrings/i18n/en.ts` - 仅新增 `tasksRunner.*` 前缀的文案

### 严禁修改的文件
- `app/batch/**` - Batch 页面代码
- `components/batch/**` - Batch 组件
- `lib/batch/**` - Batch 业务逻辑
- `lib/uploadManager.ts` - Batch 使用的上传管理器
- `lib/apiClient.ts` - 共享的 API 客户端（如需修改功能，请复制一份到 tasks-runner）

## 2. BASE 配置

```typescript
// 默认使用 '/api'，由环境变量覆盖
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

// 大文件直连 Render（如与 API_BASE 不同）
const BIG_FILE_THRESHOLD_BYTES = 80 * 1024 * 1024; // 80MB
const RENDER_BASE_URL = process.env.NEXT_PUBLIC_RENDER_BASE_URL ?? API_BASE;

// 所有请求路径
POST ${API_BASE}/tasks/url
POST ${API_BASE}/tasks/upload  
GET  ${API_BASE}/tasks
DELETE ${API_BASE}/tasks/:id
POST ${API_BASE}/tasks/:id/retry
```

### 生产环境策略
- 只使用一个 BASE，不混用 shim
- 大文件(>80MB) 使用 RENDER_BASE_URL 直连 Render（仅域名不同，路径相同 /tasks/upload）
- XHR 超时设置为 10 分钟（600000ms / 600秒）

## 3. 凭证方案

```typescript
// 所有 fetch 请求必须携带凭证
fetch(url, {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  }
})

// XHR 上传（用于进度跟踪）
const xhr = new XMLHttpRequest();
xhr.withCredentials = true; // 关键：XHR 也必须带凭证
xhr.upload.onprogress = (e) => {
  if (e.lengthComputable) {
    const progress = (e.loaded / e.total) * 100;
    // 更新进度条
  }
};
xhr.open('POST', url);
xhr.send(formData);

// FormData 上传（如用 fetch）
const formData = new FormData();
formData.append('files', file);
fetch(url, {
  method: 'POST',
  credentials: 'include',
  body: formData
})
```

## 4. CORS 配置（后端已完成）

- 已配置 OPTIONS 处理器返回 204
- CORS 中间件在全局最前面
- 支持的 Origins: localhost:3005, localhost:3000-3002, videoanalyzer.netlify.app（不能用 * 因为需要凭证）
- 允许的方法: GET, POST, PUT, DELETE, OPTIONS
- 允许的 Headers: Content-Type, Authorization
- **关键头**: `Access-Control-Allow-Credentials: true`（必须，因为我们带凭证）
- **跨站 Cookie**: 如为跨站，需 `SameSite=None; Secure`

## 5. 与 Batch 的 UI 对齐方式

### 状态呈现（与 Batch 完全一致）
```typescript
// 状态枚举 - 必须与 Batch 一致
// 如果 Batch 有 'canceled' 状态，使用 'canceled'
// 如果 Batch 没有独立的 'canceled'，使用 'failed' + message: "Aborted"
type Status = 'queued' | 'running' | 'success' | 'failed' | 'canceled';

// 颜色值（直接使用 Batch 的设计 token）
const COLORS = {
  success: 'bg-green-100 text-green-800 hover:bg-green-100',
  failed: 'bg-red-100 text-red-800 hover:bg-red-100',
  running: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  queued: 'bg-gray-100 text-gray-800 hover:bg-gray-100',
  canceled: 'bg-zinc-100 text-zinc-800 hover:bg-zinc-100',
};
```

### UI 组件复用
- Card, CardHeader, CardContent, CardTitle - 来自 `@/components/ui/card`
- Button - 来自 `@/components/ui/button`
- Progress - 来自 `@/components/ui/progress`
- Skeleton - 来自 `@/components/ui/skeleton`

### 布局结构
```
┌─────────────────────────────────────────────────────────┐
│ Task Runner (h1, text-2xl font-semibold)                │
├─────────────────────────────────────────────────────────┤
│ ImportBox (Card)                                         │
│ - URL textarea (左) | File dropzone (右)                 │
│ - Controls: Run, Clear, Concurrency, Cancel All         │
├─────────────────────────────────────────────────────────┤
│ FilterBar                                                │
│ - Status, Source, Sort, Search, Clear Filters           │
├─────────────────────────────────────────────────────────┤
│ TaskTable (Card)                                         │
│ - Columns: □ Title/URL | Status | Progress | Updated |  │
│            Source | Actions                              │
│ - Actions: Retry(failed) | Cancel(running) | Delete     │
├─────────────────────────────────────────────────────────┤
│ ExportBar                                                │
│ - Scope, Format, Per-item checkbox, Export button       │
└─────────────────────────────────────────────────────────┘
```

### 交互细节
- Delete: 两步确认（3秒内点击 Confirm）
- Progress: running 时显示进度条，其他状态显示百分比文本
- 空态: 使用 Skeleton 组件显示加载状态

## 6. Smoke 测试清单

### 基础功能测试
1. **URL 导入**
   ```bash
   curl -X POST "$API_BASE/tasks/url" \
     -H "Content-Type: application/json" \
     -d '{"urls":["https://example.com/test.mp4"],"importTimestamp":"2025-09-08T12:00:00Z","source":"url","createdBy":"web"}'
   ```
   - 预期: 创建任务，状态 queued → running → success/failed

2. **文件上传（小文件）**
   ```bash
   echo "test" > /tmp/small.txt
   curl -X POST "$API_BASE/tasks/upload" \
     -F "files=@/tmp/small.txt"
   ```
   - 预期: 文件上传成功，任务创建
   - 注意: 字段名必须是 `files`

3. **文件上传（大文件 120MB）**
   ```bash
   dd if=/dev/zero of=/tmp/big.bin bs=1M count=120
   # 如果 >80MB，应使用 RENDER_BASE_URL
   curl -X POST "$RENDER_BASE_URL/tasks/upload" \
     -F "files=@/tmp/big.bin" -m 600
   ```
   - 预期: 成功或明确失败（413 "File too large. Use server export (M2)."），不挂起
   - 超时设置: 10 分钟（600秒）

### 并发控制测试
4. **并发切换**
   - 创建 8 个任务
   - 切换并发 2 → 5 → 10
   - 预期: 运行中任务数符合并发限制

5. **Cancel 单个**
   - 选择一个 running 任务点击 Cancel
   - 预期: 状态变为 canceled 或 failed+Aborted

6. **Cancel All**
   - 有多个 queued/running 任务时点击 Cancel All
   - 预期: 所有任务停止，队列清空

### 错误处理测试
7. **网络错误退避**
   - 模拟后端 500/429 错误
   - 预期: 2s → 4s → 8s 重试 3 次后失败（支持 ±20% 抖动）
   - 如果响应头有 Retry-After，优先使用

8. **4xx 错误不重试**
   - 发送无效请求触发 400/401/403/404/413/415/422 错误
   - 预期: 立即失败，显示具体错误信息+requestId，不重试

### 导出测试
9. **小集合导出**
   - 选择 <10 个任务导出 JSON/CSV
   - 预期: 文件下载成功

10. **大集合限制**
    - 估算 >15MB 的数据集
    - 预期: 弹窗提示 "Use server export (M2)"

### 回归测试
11. **Batch 页面不受影响**
    - 访问 /batch 页面
    - 预期: 正常工作，无任何影响

12. **单一 BASE**
    - 检查 Network 面板
    - 预期: 所有请求只打向配置的 API_BASE（大文件除外，使用 RENDER_BASE_URL）
    - 验证: 控制台/Network 检查只命中一个域（或明确的两个域用于大文件）

## 7. 错误处理与安全性

### 错误分级
- **不重试**: 400, 401, 403, 404, 413, 415, 422（显示具体错误+requestId）
- **退避重试**: 429, 5xx, 网络错误（2s → 4s → 8s ×3，±20% jitter；若有 Retry-After 优先）

### 安全性要点
- 表格显示 Title/URL 时需转义，避免 XSS
- 远端 ID 映射: 成功创建后使用 `created[0].id` 作为 remoteId
- Per-item 导出限制 50 个文件，避免浏览器崩溃
- 文件上传限制: `<input type="file" accept="video/*">` （如只接收视频）

## 8. 已知限制与后续计划

### M1 阶段（当前）
- 前端分页和过滤
- 小集合导出（<15MB）
- 基础并发控制
- URL 去重使用本地去重 + 可选 idempotencyKey

### M2 阶段（后续）
- 服务端导出（大集合、ZIP格式）
- 异步导出任务管理

### M3 阶段（后续）
- 服务端分页和过滤
- 高级搜索功能
- 任务清理功能

## 9. 验收标准

✅ Phase 0 完成标志：
- [x] 路径命名统一（实际使用 /batch）
- [x] BASE 默认 '/api'，生产单一 BASE 策略明确
- [x] fetch & XHR 均带凭证（文档明确）
- [x] CORS 写明 Allow-Credentials: true + 不能用 *
- [x] 大文件策略采用 >80MB → RENDER_BASE_URL + 10min 超时
- [x] /tasks/url 示例补齐 importTimestamp/source/createdBy
- [x] 状态语义与 Batch 对齐（canceled vs failed+Aborted 说明清晰）
- [x] 错误分级明确（4xx不重试，429/5xx退避）
- [x] 安全性要点补充（XSS防护、远端ID映射）
- [x] Smoke 测试清单完整可执行

---

**请确认以上内容 ✅ 后，我将进入 Phase 1 - 脚手架与目录隔离**