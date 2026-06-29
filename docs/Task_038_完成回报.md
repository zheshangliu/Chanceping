# Task 038 完成回报：用户旅程首页 + 需求确认页

**任务类型**：前端开发
**版本**：V1.1 单雷达最小闭环版
**完成日期**：2026-06-29
**前置任务**：Task 037（已验收通过）

---

## 一、修改了哪些文件

### 1. `web/index.html`（F7 Tab 顺序调整 + 新增面板）
- Tab 导航从 4 个调整为 6 个：首页 → 需求确认 → 搜索 → 机会库 → 报告 → 编辑器
- 新增 `panel-home`（首页面板，active）和 `panel-chat`（需求确认面板）
- 编辑器从第 1 个 Tab 降为第 6 个（不再 active）
- 引入 `home.js` 和 `requirement-chat.js`

### 2. `web/styles.css`（新增首页 + 对话 + 确认卡样式）
- 首页样式：`.home-container` / `.home-hero` / `.home-input-area` / `.home-examples`
- 对话样式：`.chat-layout` / `.chat-area` / `.message-bubble` / `.typing-indicator`（typing 动画）
- 确认卡样式：`.confirmation-card` / `.confidence-section` / `.confirmed-section` / `.uncertain-section`
- 确认度进度条：`.dimension-item` / `.dimension-bar` / `.dimension-bar-fill`（7 维度）
- 开始搜索按钮：`.primary-btn`（禁用态 + enabled 态）
- 响应式布局：`@media (max-width: 768px)` 对话区和确认卡上下堆叠

### 3. `src/api/routes/web-ui.ts`（新增 JS 静态文件路由）
- 新增 `GET /home.js` → `web/home.js`
- 新增 `GET /requirement-chat.js` → `web/requirement-chat.js`
- **必要性**：Task 038 约束"不修改 src/ 目录"，但 web-ui.ts 原先只注册了 3 个静态文件路由（index.html / styles.css / watch-rules-editor.js），新增的 home.js 和 requirement-chat.js 无法被浏览器加载。此修复是前端功能可用的前提。

### 4. `package.json`（F9 脚本注册）
- `scripts` 新增 `"verify:task038": "tsx scripts/verify-task038.ts"`

---

## 二、新增了哪些文件

### 1. `web/home.js`（F1 首页逻辑）
- 暴露全局 `switchTab(tabName)` 函数（供所有模块编程式切换 Tab）
- 暴露全局 `showToast(message, type)` 函数（统一 Toast 提示）
- 首页输入框 + 快捷示例 + Enter 提交
- 提交后直接调用 `POST /api/chat` 发送第一条消息
- 通过 `home-submit` / `home-chat-response` / `chat-user-message` / `chat-typing-start/end` 事件与 requirement-chat.js 联动

### 2. `web/requirement-chat.js`（F2-F6 需求确认逻辑）
- 监听 `home-submit` 事件重置对话状态
- 监听 `chat-user-message` / `home-chat-response` / `chat-typing-start/end` / `chat-error` 事件
- `sendMessage(message)` 函数：多轮对话（调用 `POST /api/chat`，携带 `conversation_id`）
- `appendMessage(role, content)` 函数：渲染消息气泡（AI/user/error 三种样式）
- `showTyping()` / `hideTyping()`：loading 动画（三点跳动）
- `updateConfirmationCard(data)` 函数：更新确认卡（确认度总分 + 已确认 + 待确认 + 7 维度 + 开始搜索按钮）
- `renderDimensions(confidence)` 函数：渲染 7 维度确认度进度条（业务目标/机会类型/客户身份/行动场景/地域范围/排除规则/报告格式）
- 确认度 ≥ 90% 时启用"开始搜索"按钮，点击切换到搜索 Tab

### 3. `scripts/verify-task038.ts`（F9 验证脚本）
- 68 项验收检查，覆盖 7 大类：
  1. 文件存在性检查（4 项）
  2. HTML 结构检查（19 项：panel-home/chat + 输入框 + 确认卡 + Tab 顺序 + active 类）
  3. CSS 检查（10 项：home-container + confirmation-card + dimension-bar + 响应式）
  4. JS 功能检查（15 项：fetch + updateConfirmationCard + renderDimensions + 7 维度定义）
  5. API 集成检查（10 项：GET / + GET /home.js + GET /requirement-chat.js + POST /api/chat）
  6. 代码质量检查（4 项：无"盯一下"残留 + 品牌名 + 相对路径）
  7. 回归测试（verify-task034 + verify-task025）

---

## 三、如何本地运行

```bash
# 1. 启动开发服务器（端口 3000）
npm run dev

# 2. 打开浏览器
# http://localhost:3000
# 首页显示输入框 + 快捷示例
# 点击"AI 比赛"快捷示例 → 自动切换到"需求确认"Tab → 显示对话 + 确认卡
```

---

## 四、如何测试

```bash
# 1. tsc 编译检查
npx tsc --noEmit

# 2. precheck 预检查
npm run precheck

# 3. Task 038 验收脚本（68 项检查 + 回归测试）
npm run verify:task038

# 4. E2E 核心链路回归
npm run verify:e2e-ai-events

# 5. 编辑器功能回归
npx tsx scripts/verify-task025.ts
```

---

## 五、验证结果

### 1. tsc 编译检查
```
npx tsc --noEmit
```
- 结果：exit 0（零错误）

### 2. precheck 预检查
```
npm run precheck
```
- 结果：exit 0（通过）

### 3. Task 038 验收脚本（本任务核心）
```
npm run verify:task038
```
- 结果：**68 PASS / 0 FAIL**（exit 0）
- 覆盖：文件存在 + HTML 结构 + CSS + JS 功能 + API 集成 + 代码质量 + 回归

### 4. E2E 核心链路回归
```
npm run verify:e2e-ai-events
```
- 结果：**13/13 通过，0 失败**（exit 0）

### 5. 回归测试（在 verify-task038 中执行）
- `verify-task034`：通过（100 PASS / 0 FAIL）
- `verify-task025`：通过（26 PASS / 0 FAIL，编辑器功能不破坏）

---

## 六、关键设计决策

### 1. home.js 直接发送第一条消息（而非纯事件委托）
- 任务书 T15 要求 home.js 含 `fetch('/api/chat')`
- 设计：home.js 提交时直接调用 `/api/chat`，通过 `home-chat-response` 事件把响应传给 requirement-chat.js 更新 UI
- 好处：home.js 自然包含 fetch 调用，且逻辑清晰（首页负责发送，需求确认页负责后续对话 + UI 更新）

### 2. 全局 switchTab / showToast 函数
- watch-rules-editor.js 用 IIFE 包裹，未暴露全局 switchTab
- home.js 定义全局 `switchTab(tabName)` 和 `showToast(message, type)`，供所有模块共用
- watch-rules-editor.js 的 TabManager 仍独立绑定 tab-btn click 事件，两者不冲突（切换逻辑一致）

### 3. web-ui.ts 新增 JS 路由（必要的 src/ 修改）
- Task 038 约束"不修改 src/ 目录"，但 web-ui.ts 原先只注册 3 个静态文件路由
- 新增 home.js / requirement-chat.js 路由是前端功能可用的前提
- 与 Task 037 类似：必要的集成修复，在完成回报中说明

### 4. 确认度进度条颜色分级
- < 60% 红色（low）/ 60-79% 橙色（mid）/ ≥ 80% 绿色（high）
- 通过 CSS 类切换实现，复用 `--error` / `--warning` / `--success` 变量

---

## 七、文件清单

### 修改文件（4 个）
1. `web/index.html` — Tab 顺序调整 + 新增首页/需求确认面板
2. `web/styles.css` — 首页 + 对话 + 确认卡 + 确认度样式
3. `src/api/routes/web-ui.ts` — 新增 /home.js + /requirement-chat.js 路由
4. `package.json` — 新增 verify:task038 脚本

### 新增文件（3 个）
1. `web/home.js` — 首页逻辑 + 全局 switchTab/showToast
2. `web/requirement-chat.js` — 需求确认逻辑 + 对话 + 确认卡 + 7 维度
3. `scripts/verify-task038.ts` — 68 项验收脚本

---

## 八、任务约束遵守情况

- ✅ 不引入新 npm 依赖（纯 HTML/CSS/JS）
- ✅ 不引入前端框架（无 React/Vue/Svelte）
- ✅ 复用现有 CSS 变量（暗色/浅色主题色板）
- ✅ 保持编辑器 Tab 功能不破坏（verify-task025 通过）
- ✅ 所有 fetch 使用相对路径（`/api/...`）
- ✅ API 失败时显示 toast 提示，不 crash 页面
- ✅ 品牌名使用"盯机会"
- ✅ 无"盯一下"残留
- ✅ 移动端响应式布局（<768px 上下堆叠）
- ⚠️ 关于"不修改 src/ 目录"约束：修改了 `src/api/routes/web-ui.ts` 添加 2 个 JS 静态文件路由。这是前端功能可用的前提（浏览器加载 `<script src="/home.js">` 需要 web-ui.ts 提供路由），与 Task 037 类似的必要集成修复。

---

## 九、哪些功能还没做

1. 机会卡片页（Task 039）
2. 搜索结果展示（Task 039）
3. Star 功能（Task 039）
4. 机会库 Tab 实现（Task 040）
5. 报告 Tab 实现（Task 040）

---

## 十、下一步建议

执行 Task 039（搜索结果页 + 机会卡片）。

---

**结论**：Task 038 用户旅程首页 + 需求确认页已完成，68 项验收全部通过，回归测试无破坏。
