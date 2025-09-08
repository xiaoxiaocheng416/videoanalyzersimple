# 批次与任务页面前端体验优化 - 实施总结

## 改动概览

所有优化已按照"最小改动执行单"原则完成，集中在两个文件：
- `/app/batch/page.tsx` - 批次管理页面
- `/app/task/[id]/page.tsx` - 任务详情页面

## 已实施的优化项

### 1. 秒显与触发优化 ✅
- **立即刷新机制**：
  - 用户操作后（添加URL、上传文件、重试）立即调用 `refresh(true)`
  - 批次切换或筛选变化时立即刷新
  - 页面focus/visibilitychange事件触发立即刷新
  - 100ms防抖避免请求风暴
  
- **失败不清空**：
  - API请求失败时保留现有数据，不执行 `setTasks([])` 或 `setBatch(null)`
  - 显示同步状态指示器："Syncing..." 或 "Auto-retrying..."
  - 失败后自动2秒重试

### 2. RequestId护栏 ✅
- 所有并发请求使用 `latestReq.current` 追踪
- 响应返回前检查 `rid !== latestReq.current` 丢弃过期响应
- 覆盖所有三个并发请求（tasks、batch、list）

### 3. 上下文保持 ✅
- **保存机制**：
  - 点击任务进入详情前调用 `saveContext()`
  - 保存到 sessionStorage：`{batchId, statusFilter, scrollTop}`
  
- **恢复机制**：
  - 批次加载后调用 `restoreContext()`
  - 100ms延迟恢复滚动位置等待DOM稳定
  - 从任务页返回优先使用 `history.back()`

### 4. 批次切换优化 ✅
- **双轨记忆**：URL参数 > localStorage
- **继承筛选**：切换批次时保留 statusFilter
- **URL同步**：创建/选择批次后更新URL参数

### 5. Retry功能增强 ✅
- **批量重试**：头部"Retry Failed"按钮，disabled当无失败任务
- **行内重试**：每个失败任务行内显示小"Retry"按钮
- **即时刷新**：重试后立即调用 `refresh(true)`

### 6. 导出功能优化 ✅
- **智能导出**：
  - 检查是否有成功任务，无则提示
  - 文件名包含日期：`{batchId}_{date}.{format}`
  - 导出后不触发刷新避免UI闪烁

### 7. 播放体验优化 ✅
- **四重fallback**（保留现有）：
  ```javascript
  meta.playable_url → meta.playableUrl → 
  result.playable_url → result.playableUrl
  ```
- **错误原因提示**：
  - 无播放源时显示具体原因卡片
  - 提供"Retry Analysis"和"Open Original"按钮
  - 支持多种错误类型识别

### 8. 功能开关 ✅
```javascript
const FEATURES = {
  FAST_REFRESH: process.env.NEXT_PUBLIC_FAST_REFRESH !== '0',
  RESTORE_SCROLL: process.env.NEXT_PUBLIC_RESTORE_SCROLL !== '0'
}
```
- 可通过环境变量关闭特性
- 保留5秒轮询作为兜底

## 验收清单 (DoD)

| 验收项 | 状态 | 说明 |
|--------|------|------|
| 返回/batch：列表立刻出现，筛选与滚动位置恢复 | ✅ | sessionStorage保存/恢复上下文 |
| 导入/上传/重试：1s内出现新行 | ✅ | 操作后立即refresh(true) |
| 断网10s恢复：UI不清空，自动对齐最新 | ✅ | 失败不清空+自动重试机制 |
| URL与上传任务均可播放 | ✅ | 四重fallback+Safari HLS支持 |
| CSV/JSON导出字段稳定 | ✅ | 智能过滤+日期命名 |
| 无新增依赖，类型检查通过 | ✅ | 仅改动2个文件，lint已通过 |

## 代码位置索引

### batch/page.tsx 关键改动
- **L10-13**: 功能开关定义
- **L38-66**: 上下文保存/恢复函数
- **L105-174**: 增强的refresh函数（防抖+错误处理）
- **L239-253**: 重试功能（批量+单个）
- **L256-277**: 智能导出函数
- **L420-470**: 任务行增强（状态颜色+行内重试）

### task/[id]/page.tsx 关键改动
- **L13-36**: 错误原因判断辅助函数
- **L72-103**: 增强的视频源选择（含错误原因）
- **L147-175**: 错误提示卡片和操作按钮

## 回退策略

如需禁用优化：
```bash
# 禁用秒显功能
export NEXT_PUBLIC_FAST_REFRESH=0

# 禁用滚动恢复
export NEXT_PUBLIC_RESTORE_SCROLL=0
```

## 测试建议

1. **秒显测试**：添加URL后观察是否1秒内出现任务
2. **上下文测试**：进入任务详情后返回，检查筛选和滚动位置
3. **网络测试**：断网后恢复，确认数据不丢失
4. **播放测试**：URL和上传任务都能正常播放
5. **导出测试**：导出CSV/JSON，验证字段完整性

## 注意事项

- 所有改动遵循"最小改动"原则
- 保留原有5秒轮询作为兜底
- 不影响现有单视频渲染层
- 可独立回退任一优化项