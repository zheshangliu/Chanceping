# Task 040 完成回报：机会库 Tab + 报告 Tab + 页面内截止提醒

**任务类型**：全栈开发（前端 + 后端路由扩展）
**版本**：V1.1 单雷达最小闭环版
**完成日期**：2026-06-29
**前置任务**：Task 039（已验收通过）

---

## 一、修改了哪些文件

### 1. `web/index.html`（panel-opportunities + panel-reports 替换占位）
- `panel-opportunities` 从空占位替换为机会库布局（统计概览 + 截止提醒区 + 筛选栏 + 机会列表 + 分页）
- `panel-reports` 从空占位替换为报告布局（生成区 + 预览区 + 导出栏 + 历史报告区）
- 新增 `<script src="/opportunities.js">` 和 `<script src="/reports.js">` 引入

### 2. `web/home.js`（switchTab 派发 tab-switched 事件）
- `switchTab` 函数末尾新增 `window.dispatchEvent(new CustomEvent("tab-switched", { detail: { tab: tabName } }))`
- 让 opportunities.js / reports.js 能监听 Tab 切换并自动加载数据
- 1 行代码新增，不破坏现有功能

### 3. `web/styles.css`（机会库 + 提醒 + 报告样式）
- 机会库容器：`.opp-library-container` / `.stats-bar` / `.stat-item`
- 截止提醒区：`.reminder-section` / `.reminder-list` / `.reminder-group`（urgent/soon/warning/expired 四色左边框）
- 筛选栏：`.filter-bar` / `.filter-starred-label` / `.btn-refresh`
- 机会列表：`.opp-list` / `.opp-item` / `.opp-item-header` / `.opp-title` / `.opp-deadline` / `.star-indicator`
- 机会项元数据：`.opp-item-meta` / `.opp-status` / `.opp-action` / `.opp-reminder-tag`（四色分级）
- 机会项操作：`.opp-item-actions` / `.btn-view` / `.btn-unstar` / `.btn-delete`
- 分页：`.pagination` / `.page-btn` / `.page-info`
- 报告容器：`.reports-container` / `.report-generate-section` / `.report-preview-section` / `.report-history-section`
- 报告表单：`.report-form` / `.report-field` / `.btn-primary`
- 报告预览：`.report-preview`（h1/h2/h3/ul/a/strong 样式）
- 报告导出：`.report-export-bar` / `.export-btn`
- 历史报告：`.report-history-list` / `.history-item` / `.history-name` / `.history-size` / `.history-date` / `.btn-download-history`
- 响应式布局：`@media (max-width: 768px)` 机会库 + 报告适配

### 4. `src/api/routes/opportunities.ts`（扩展查询参数 + 接入自动过期）
- 新增 `import { batchAutoTransition } from "../../agents/opportunity-state-machine";`
- GET / 路由查询前执行自动过期扫描：
  - `ctx.store.list({ page_size: 10000 })` 获取全量
  - `batchAutoTransition(entries, new Date())` 计算需过期的状态
  - `ctx.store.update(key, { status: t.to })` 回写过期/错过状态
- 新增查询参数解析：`sort_by` / `sort_order` / `expiring_soon` / `deadline_from` / `deadline_to`
- StoreQuery 接口已支持这些字段（opportunity-store.ts 已实现筛选+排序）

### 5. `src/api/routes/web-ui.ts`（新增 /opportunities.js + /reports.js 路由）
- 新增 `GET /opportunities.js` → `web/opportunities.js`
- 新增 `GET /reports.js` → `web/reports.js`
- 与 Task 038/039 添加 JS 路由一致的必要集成修复

### 6. `package.json`（新增 verify:task040 脚本）
- `scripts` 新增 `"verify:task040": "tsx scripts/verify-task040.ts"`

---

## 二、新增了哪些文件

### 1. `web/opportunities.js`（F1-F6 机会库 Tab 逻辑）
- IIFE 包裹，避免全局污染
- 状态变量：`currentPage` / `PAGE_SIZE=20` / `currentFilters`
- 监听 `tab-switched` 事件（tab === 'opportunities' 时自动加载）
- 关键函数：
  - `loadOpportunities()` — 并行加载统计 + 提醒 + 列表
  - `refreshStats()` — GET /api/opportunities/stats，更新 4 个统计指标
  - `refreshReminders()` — GET /api/reminders，渲染分级提醒区
  - `refreshList()` — GET /api/opportunities（带筛选/排序/分页参数）
  - `renderOppItem(entry)` — 渲染单条机会（等级徽章 + 标题 + 截止日期 + 状态 + Star + 行动意图 + 提醒标签）
  - `renderReminderSection(reminderResult)` — 渲染 urgent/soon/warning/expired 四级提醒
  - `unstar(key)` — DELETE /api/opportunities/:key/star
  - `deleteOpp(key)` — DELETE /api/opportunities/:key
  - `renderPagination(data)` — 分页控件
  - `bindFilters()` — 筛选/排序事件绑定
- 状态标签映射 + 行动意图标签映射 + 提醒级别配置

### 2. `web/reports.js`（F7-F10 报告 Tab 逻辑）
- IIFE 包裹
- 状态变量：`currentReportParams` / `currentMarkdown`
- 监听 `tab-switched` 事件（tab === 'reports' 时加载历史）
- 关键函数：
  - `generateReport()` — POST /api/reports/generate，渲染 Markdown 预览
  - `renderReportPreview(data)` — 展示预览 + 统计（总数/S/A/B/C 分布）
  - `exportReport(format)` — POST /api/reports/export?format=，Blob 下载
  - `loadHistory()` — GET /api/reports/export/list
  - `renderHistoryList(files)` — 渲染历史文件列表
  - `downloadHistory(filename)` — GET /api/reports/export/:filename
  - `renderMarkdown(md)` — 正则简单转换（标题/加粗/链接/列表/段落，不引入解析库）
  - `bindReportActions()` — 生成 + 导出按钮事件绑定
- 默认填充周期：最近 7 天

### 3. `scripts/verify-task040.ts`（F11 验证脚本）
- 75 项验收检查，覆盖 7 大类：
  1. 文件存在性检查（3 项：opportunities.js / reports.js / verify-task040.ts）
  2. HTML 结构检查（14 项：opp-list + opp-stats-bar + reminder-section + filter-radar + sort-by + opp-pagination + report-preview + btn-generate-report + export-btn + report-history-list + 脚本引入 + 无"盯一下" + 品牌名）
  3. CSS 检查（8 项：opp-item + reminder-section + filter-bar + report-preview + @media + opp-library-container + reports-container + reminder-urgent）
  4. JS 功能检查（14 项：opportunities.js 的 fetch + /api/reminders + /stats + /star + DELETE + tab-switched + loadOpportunities + refreshReminders；reports.js 的 /generate + /export + /export/list + renderMarkdown + exportReport + loadHistory）
  5. 后端路由检查（10 项：sort_by + sort_order + expiring_soon + batchAutoTransition + store.update + deadline_from + deadline_to + web-ui 路由 + home.js tab-switched）
  6. API 集成检查（23 项：GET / + GET /opportunities.js + GET /reports.js + 入库 + GET /api/opportunities + sort_by + expiring_soon + /stats + /api/reminders + /reports/generate + /reports/export + /export/list）
  7. 回归测试（3 项：verify-task034 + verify-task038 + verify-task039）

---

## 三、如何本地运行

```bash
# 1. 启动开发服务器（端口 3000）
npm run dev

# 2. 打开浏览器
# http://localhost:3000
# 首页输入需求 → 需求确认 → 搜索 → Star 收藏 → 切换到"机会库"Tab
# 机会库自动加载：统计概览 + 截止提醒 + 筛选/排序 + 机会列表
# 切换到"报告"Tab → 选择雷达 + 周期 → 生成报告 → 预览 → 导出
```

---

## 四、如何测试

```bash
# 1. tsc 编译检查
npx tsc --noEmit

# 2. Task 040 验收脚本（75 项检查 + 回归测试）
npm run verify:task040
```

---

## 五、验证结果

### 1. tsc 编译检查
```
npx tsc --noEmit
```
- 结果：exit 0（零错误）

### 2. Task 040 验收脚本（本任务核心）
```
npx tsx scripts/verify-task040.ts
```
- 结果：**75 PASS / 0 FAIL**（exit 0）
- 覆盖：文件存在 + HTML 结构 + CSS + JS 功能 + 后端路由 + API 集成 + 回归

### 3. 回归测试（在 verify-task040 中执行）
- `verify-task034`：通过（开源就绪不破坏）
- `verify-task038`：通过（用户旅程首页 + 需求确认页不破坏）
- `verify-task039`：通过（搜索结果页 + 机会卡片 + 反馈字段不破坏）

---

## 六、关键设计决策

### 1. 状态自动过期接入（F6）
- 在 GET /api/opportunities 路由查询前调用 `batchAutoTransition`
- 全量扫描（page_size: 10000）→ 计算需过期状态 → `ctx.store.update` 回写
- V1.1 简单实现：每次查询都扫描（数据量小，性能可接受）
- 不新增 auto-transition.ts 中间件文件，直接在 opportunities.ts 内接入（任务书 7.2 节方案）

### 2. store.update 而非 updateCard
- 任务书 5.6 示例代码用 `ctx.store.updateCard`，但实际 OpportunityStore 接口是 `update`
- 使用正确的 `ctx.store.update(dedup_key, { status: t.to })` 回写过期状态

### 3. tab-switched 事件派发
- Task 038 的 switchTab 未派发事件，opportunities.js / reports.js 无法监听 Tab 切换
- 在 home.js 的 switchTab 末尾新增 1 行 `window.dispatchEvent(new CustomEvent("tab-switched", ...))`
- 属于 Task 038 文件的微调，不破坏功能

### 4. Markdown 简单渲染（不引入解析库）
- 任务书约束"不引入 Markdown 解析库"
- 用正则做简单转换：标题（#/##/###）→ 加粗（**）→ 链接（[]()）→ 列表（-）→ 段落
- 先 escapeHtml 再替换，避免 XSS

### 5. 报告导出用 Blob 下载
- POST /api/reports/export 返回文件二进制流
- 前端用 `res.blob()` + `URL.createObjectURL` + `<a download>` 触发下载
- 下载完成后刷新历史报告列表

### 6. 提醒分级颜色
- urgent（≤3天）红色 `--error`
- soon（3-7天）橙色 `--warning`
- warning（8-14天）蓝色 `--syntax-deadline`
- expired（已过期）灰色 `--text-muted`

---

## 七、文件清单

### 修改文件（6 个）
1. `web/index.html` — panel-opportunities + panel-reports 替换占位 + 引入 JS
2. `web/home.js` — switchTab 派发 tab-switched 事件
3. `web/styles.css` — 机会库 + 提醒 + 报告样式（+ 响应式）
4. `src/api/routes/opportunities.ts` — 扩展查询参数 + 接入 batchAutoTransition
5. `src/api/routes/web-ui.ts` — 新增 /opportunities.js + /reports.js 路由
6. `package.json` — 新增 verify:task040 脚本

### 新增文件（3 个）
1. `web/opportunities.js` — 机会库 Tab 逻辑（列表 + 筛选 + 排序 + 提醒 + 分页）
2. `web/reports.js` — 报告 Tab 逻辑（生成 + 预览 + 导出 + 历史）
3. `scripts/verify-task040.ts` — 75 项验收脚本

---

## 八、任务约束遵守情况

- ✅ 不引入新 npm 依赖（纯 HTML/CSS/JS + Node.js 内置）
- ✅ 不引入前端框架（无 React/Vue/Svelte）
- ✅ 不引入 Markdown 解析库（用正则做简单转换）
- ✅ 复用现有 CSS 变量（--accent / --success / --warning / --error / --syntax-starred / --syntax-deadline）
- ✅ 不修改 reminder-engine.ts（纯函数，只调用 API）
- ✅ 不修改 reports.ts 生成/导出逻辑（只调用 API）
- ✅ 不修改机会状态机（只调用 batchAutoTransition）
- ✅ 不修改 POST /api/search 逻辑
- ✅ 不修改 POST /api/opportunities 入库逻辑
- ✅ 不修改 Star API 逻辑
- ✅ 不修改 feedback.ts / opportunity-card.ts 类型定义（Task 039 已定稿）
- ✅ 所有 fetch 使用相对路径（`/api/...`）
- ✅ 错误处理：API 失败时显示 toast 提示，不 crash 页面
- ✅ 品牌名使用"盯机会"
- ✅ 移动端响应式布局（<768px 适配）
- ✅ hidden 等级不展示
- ✅ 自动过期扫描限制 10000 条

---

## 九、哪些功能还没做

1. 真实推送（微信/邮件/Webhook）（V1.5）
2. 评分权重校准（V1.4）
3. 复盘仪表盘（V1.5）
4. 机会库批量操作（V1.2）
5. 机会库高级搜索（全文检索）（V1.2）
6. 报告自定义模板（V1.5）
7. 报告定时生成（V1.5）
8. 多雷达报告聚合（V1.2）
9. Task 041 演示脚本

---

## 十、下一步建议

执行 Task 041（演示脚本），V1.1 单雷达最小闭环已全部完成。

---

**结论**：Task 040 机会库 Tab + 报告 Tab + 页面内截止提醒已完成，75 项验收全部通过，回归测试无破坏。V1.1 单雷达最小闭环最后一块拼图完成：输入需求 → 确认 → 搜索 → 收藏 → 管理机会 → 看提醒 → 导出报告。
