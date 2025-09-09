# Phase 2 - 私有并发器实现总结

## 已完成内容

### 1. ConcurrencyPool 实现 (`lib/tasks-runner/uploader.ts`)
✅ **核心功能**
- 容量管理：支持 2/5/10 动态切换，立即生效
- 队列机制：FIFO 队列，自动 pump 处理
- 并发控制：inflight Map 追踪运行中任务
- 插槽释放：finally 块确保释放并触发 pump

✅ **取消功能**
- `cancelTask(taskId)`：单个任务取消，支持队列中和运行中
- `cancelAll()`：全部取消，清空队列和运行中任务
- AbortController 集成：优雅中断 XHR/fetch 请求

✅ **重试机制**
- 指数退避：2s → 4s → 8s，最多重试 3 次
- 抖动算法：±20% 随机抖动避免雷暴
- Retry-After 支持：优先使用服务器指定的重试时间
- 错误分级：4xx 不重试，429/5xx/网络错误自动重试

✅ **XHR 上传**
- 进度跟踪：`xhr.upload.onprogress` 实时进度
- 大文件路由：>80MB 自动路由到 RENDER_BASE_URL
- 凭证携带：`xhr.withCredentials = true`
- 超时设置：10 分钟（600000ms）

### 2. API 方法实现 (`lib/tasks-runner/api.ts`)
✅ **URL 任务创建**
```typescript
createUrlTasks(urls, {
  importTimestamp,
  source: 'url',
  createdBy: 'web',
  idempotencyKey?: string
})
```

✅ **文件上传**
```typescript
uploadFiles(files, {
  signal?: AbortSignal,
  onProgress?: (progress) => void
})
```
- 支持多文件上传
- 总大小计算决定路由
- FormData 构建和元数据附加

✅ **错误处理**
- 统一错误处理函数 `handleApiError`
- 提取 requestId、错误码、Retry-After
- 404 DELETE 幂等处理

### 3. 测试演示 (`lib/tasks-runner/test-harness.ts`)
✅ **测试场景**
1. URL 任务处理 - 5 个 URL 并发 2
2. 文件上传进度 - 小文件（10MB）+ 大文件（100MB）
3. 并发动态切换 - 2 → 5 → 10 实时生效
4. 单个任务取消 - 100ms 后取消
5. 全部任务取消 - 200ms 后取消所有
6. 重试逻辑模拟 - 使用 httpstat.us/500

## 关键设计决策

### 1. 状态机设计
```typescript
queued → uploading → completed
                  ↘ failed (含 Aborted)
```
- 没有独立的 canceled 状态
- 使用 failed + message: "Aborted" 表示取消

### 2. 并发控制流程
```
1. addTask() → 加入队列 → 触发 pump()
2. pump() → 检查容量 → 取出任务 → 标记 uploading
3. processTask() → 执行上传 → finally 释放插槽
4. 释放后 → 再次 pump() → 处理下一个
```

### 3. 重试决策树
```
错误发生
├─ 是否 Aborted? → 不重试
├─ 是否 4xx (400/401/403/404/413/415/422)? → 不重试
├─ 是否 429/5xx? → 重试
├─ 是否网络错误? → 重试
└─ 已重试 3 次? → 放弃
```

### 4. 大文件路由
```typescript
if (fileSize > 80MB) {
  url = RENDER_BASE_URL + '/tasks/upload'  // 直连 Render
} else {
  url = API_BASE + '/tasks/upload'         // 正常路由
}
```

## 与 Batch 隔离验证

✅ **代码隔离**
- 所有代码在 `lib/tasks-runner/` 目录下
- 未修改任何 `lib/batch/` 文件
- 未引用任何 Batch 模块

✅ **配置独立**
- 独立的 constants.ts 配置文件
- 独立的 types.ts 类型定义
- 独立的 API 客户端实现

✅ **功能独立**
- 完全独立的并发池实现
- 不依赖 uploadManager.ts
- 不共享任何状态管理

## 待 Phase 3-4 接线内容

1. **UI 组件创建**（Phase 3）
   - ImportBox：URL/文件输入
   - FilterBar：状态筛选
   - TaskTable：任务列表
   - ExportBar：导出控制

2. **状态管理**（Phase 4）
   - 任务状态同步
   - 进度更新
   - 错误显示
   - 远端 ID 映射

3. **实际 API 接线**（Phase 4）
   - 连接真实后端
   - 处理响应数据
   - 更新本地状态

## 验收要点

✅ 并发池核心完整实现
✅ XHR 上传带进度跟踪
✅ 重试机制符合规范（2/4/8s×3，±20% jitter）
✅ 取消功能（单个/全部）
✅ 大文件路由策略（>80MB → RENDER_BASE_URL）
✅ 完全独立于 Batch 系统
✅ 测试演示框架就绪

## Phase 2 完成 ✅

所有 Phase 2 要求已实现完毕，代码位于：
- `lib/tasks-runner/uploader.ts` - 并发池实现
- `lib/tasks-runner/api.ts` - API 方法实现
- `lib/tasks-runner/test-harness.ts` - 测试演示

准备进入 Phase 3（UI 骨架）。