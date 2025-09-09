# Phase 3 - UI骨架与接线完成总结

## 已完成内容

### 1. 英文文案 (`uiStrings/i18n/en.ts`)
✅ 添加 `tasksRunner.*` 全套英文文案
- importBox: URL/文件导入相关文案
- filterBar: 过滤器和排序文案
- table: 表格列头和操作文案
- exportBar: 导出功能文案
- validation: 验证错误信息
- status: 状态显示文案

**严禁CJK**: 所有文案纯英文，无中文字符

### 2. UI组件实现

#### ImportBox (`components/tasks-runner/ImportBox.tsx`)
✅ 与Batch像素对齐
- 左右两栏布局：URLs textarea | File dropzone
- 并发控制：2/5/10 选择器，立即生效
- 控制按钮：Run Tasks, Clear Queue, Cancel All
- 文件拖放支持，显示待上传文件列表
- 实时显示 Queued/Running 计数

#### FilterBar (`components/tasks-runner/FilterBar.tsx`)
✅ 状态筛选芯片
- All Tasks 显示总数
- queued/running/success/failed 独立芯片，带计数
- 点击切换，ring-2 高亮当前选中
- 颜色与Batch一致：灰/蓝/绿/红

✅ 其他筛选器
- Source: All/URL/File 下拉
- Sort: Updated/Created/Status 排序
- Search: 实时搜索框
- Clear Filters: 一键清除所有筛选

#### TaskTable (`components/tasks-runner/TaskTable.tsx`)
✅ 表格结构
- 列：Title/URL | Status | Progress | Updated | Source | Actions
- Progress: running时显示进度条，其他显示百分比
- Actions: Retry(failed) | Cancel(running) | Delete(两步确认)
- 编辑模式：批量选择和删除
- Load more: 分页加载更多

✅ 交互细节
- Delete: 3秒内二次确认
- 悬停高亮行
- 空态提示文案
- Skeleton加载状态

#### ExportBar (`components/tasks-runner/ExportBar.tsx`)
✅ 导出控制
- Scope: Current filter/Selected/Time range
- Format: JSON/CSV
- Per-item: 复选框（限50个）
- Export按钮：生成下载
- 15MB限制提示（M2才支持大导出）

### 3. 并发池接线 (`components/tasks-runner/TaskRunner.tsx`)

✅ **状态管理**
```typescript
- tasks: RowState[] - 所有任务状态
- poolRef: ConcurrencyPool - 并发池实例
- processedUrlsRef: Set<string> - URL去重集
```

✅ **核心功能接线**
1. **URL添加**
   - 规范化URL（去UTM参数）
   - 本地去重验证
   - 创建local_id任务
   - 加入并发池处理

2. **文件上传**
   - 检测>80MB大文件（仅提示）
   - XHR上传进度回调
   - 自动路由到RENDER_BASE_URL

3. **并发控制**
   - setCapacity立即生效
   - 队列中任务自动pump
   - Cancel单个/全部

4. **状态同步**
   - onProgress → 更新progress
   - onComplete → 标记success，存储remoteId
   - onError → 标记failed，显示错误

5. **导出功能**
   - JSON/CSV格式
   - 仅导出success任务
   - Blob下载实现

### 4. 验收要点确认

✅ **像素对齐**
- Card/Button/Progress/Skeleton组件复用
- 状态芯片颜色值完全一致
- 布局间距与Batch相同
- 两步删除确认机制

✅ **并发即时生效**
```javascript
// 切换并发度
poolRef.current?.setCapacity(5);
// 立即pump队列中的任务
```

✅ **小集合导出**
```javascript
// JSON导出
const blob = new Blob([JSON.stringify(data)], 
  { type: 'application/json' });
// CSV导出  
const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
```

✅ **Network验证**
- 所有请求走 API_BASE（默认'/api'）
- 大文件(>80MB)走 RENDER_BASE_URL
- XHR带凭证：`xhr.withCredentials = true`

✅ **/batch零影响**
- 未修改任何 `/batch` 文件
- 未引用任何 batch 模块
- 完全独立的组件和逻辑

## 文件清单

### 新增文件
- `components/tasks-runner/ImportBox.tsx` - 导入控制组件
- `components/tasks-runner/FilterBar.tsx` - 过滤栏组件
- `components/tasks-runner/TaskTable.tsx` - 任务表格组件
- `components/tasks-runner/ExportBar.tsx` - 导出栏组件

### 修改文件
- `uiStrings/i18n/en.ts` - 添加tasksRunner.*英文文案
- `components/tasks-runner/TaskRunner.tsx` - 主组件接线

## Smoke测试点

1. **URL导入**
   - 输入多个URL，点击Add URLs
   - 验证去重（相同URL只添加一次）
   - 验证无效URL报错

2. **文件上传**
   - 拖放或选择视频文件
   - 验证>80MB提示
   - 验证进度显示

3. **并发切换**
   - 添加10个任务
   - 切换2→5→10，观察running数量变化

4. **Cancel功能**
   - Cancel单个running任务
   - Cancel All停止所有

5. **筛选排序**
   - 点击状态芯片筛选
   - Source筛选URL/File
   - 搜索功能
   - 排序切换

6. **导出测试**
   - 选择success任务
   - 导出JSON/CSV
   - 验证文件下载

## Phase 3 完成 ✅

UI骨架搭建完成，并发池完全接线，所有交互可用。准备进入Phase 4实际API接线。