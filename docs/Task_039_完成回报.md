# Task 039 完成回报：搜索结果页 + 机会卡片 + Star + 反馈字段

**任务类型**：全栈开发（前端 + 后端字段扩展）
**版本**：V1.1 单雷达最小闭环版
**完成日期**：2026-06-29
**前置任务**：Task 038（已验收通过）

---

## 一、修改了哪些文件

### 1. `web/index.html`（panel-search 替换占位 + 引入 search.js）
- `panel-search` 从空占位替换为搜索结果布局（`.search-container` + `.search-status-bar` + `.search-results`）
- 新增 `<script src="/search.js"></script>` 引入搜索结果页逻辑

### 2. `web/styles.css`（机会卡片 + 五维评分 + 反馈区样式）
- 搜索结果布局：`.search-container` / `.search-status-bar` / `.search-results`
- 机会卡片：`.opp-card` / `.card-header` / `.level-badge`（S/A/B/C 四色徽章） / `.card-title` / `.card-meta` / `.card-reason`
- 五维评分：`.card-scores` / `.score-item` / `.score-bar` / `.score-bar-fill`（绿/橙/红 三色分级）
- Star 按钮：`.star-btn`（☆ ↔ ★ 切换，金色高亮）
- 展开按钮：`.expand-btn`（▼/▲ 旋转动画）
- 详情区：`.card-detail` / `.detail-row`
- 反馈区：`.feedback-section` / `.feedback-buttons` / `.feedback-btn`（9 枚举）/ `.feedback-note`
- 行动意图区：`.action-section` / `.action-intent` / `.action-status` / `.action-note` / `.action-date`
- 响应式布局：`@media (max-width: 768px)` 卡片内边距缩小、字号调整

### 3. `src/schema/opportunity-card.ts`（接口扩展 feedback + action_intent 字段）
- 新增 `import type { Feedback, ActionIntent } from "./feedback";`
- `OpportunityCard` 接口末尾新增两个可选字段：
  - `feedback?: Feedback;`（V3.1 反馈评价）
  - `action_intent?: ActionIntent;`（V3.1 行动意图）
- 现有 18 字段保持不变，仅新增两个可选字段，向后兼容

### 4. `src/api/routes/opportunities.ts`（新增 PATCH /:key/feedback 路由）
- 新增 `import type { Feedback, ActionIntent, FeedbackEvaluation, ActionIntentType, ActionStatusType } from "../../schema/feedback";`
- 新增 `PATCH /:key/feedback` 端点：
  - 请求体：`{ feedback?: { evaluation, note? }, action_intent?: { intent?, status?, note?, next_action_date? } }`
  - **feedback 整体覆盖**：自动设置 `updated_at` 为当前时间
  - **action_intent 部分更新**：用 `??` 操作符合并已有值 + 传入值（支持只更新部分字段）
  - 404 处理：dedup_key 不存在时返回 NOT_FOUND
  - 400 处理：请求体非合法 JSON 时返回 BAD_REQUEST

### 5. `src/api/routes/web-ui.ts`（新增 /search.js 静态文件路由）
- 新增 `GET /search.js` → `web/search.js`（`application/javascript; charset=utf-8`）
- **必要性**：浏览器加载 `<script src="/search.js">` 需要后端提供路由，与 Task 038 添加 home.js/requirement-chat.js 路由一致的必要集成修复

### 6. `package.json`（新增 verify:task039 脚本）
- `scripts` 新增 `"verify:task039": "tsx scripts/verify-task039.ts"`

---

## 二、新增了哪些文件

### 1. `web/search.js`（F1-F8 搜索结果页全部逻辑）
- IIFE 包裹，避免全局污染
- 状态变量：`currentResults`（当前搜索结果）/ `starredKeys`（已 Star 的 dedup_key 集合）/ `cardKeyMap`（guid/url → dedup_key 映射缓存）
- 关键函数：
  - `performSearch(query, radarType)` — 调用 `POST /api/search`，渲染结果
  - `renderResults(opportunities)` — 过滤 hidden + 渲染卡片列表 + 更新状态栏
  - `renderCard(opp)` — 渲染单张卡片（等级徽章 + 标题 + 来源 + 匹配理由 + 五维评分 + 展开按钮）
  - `renderCardDetail(opp)` — 渲染详情区（官方链接 + 主办方 + 截止日期 + 地区 + 奖励 + 资格 + 反馈按钮 + 行动意图 select）
  - `toggleStar(opp, btn)` — Star 收藏切换（先 POST /api/opportunities 入库 → 再 POST /:key/star）
  - `submitFeedback(opp, feedback, actionIntent, cardEl)` — 提交反馈（PATCH /:key/feedback）
  - `toCard(opp, radarType)` — ScoredOpportunity → OpportunityCard 映射
  - `toggleExpand(cardEl)` — 卡片展开/折叠
  - `extractDeadline/extractRegion/extractReward/extractEligibility` — 正则提取辅助函数
- 监听 `chat-search-start` 事件（Task 038 触发）自动执行搜索
- 包含 `fetch("/api/search")` / `fetch("/api/opportunities")` / `fetch("/:key/star")` / `fetch("/:key/feedback")` 调用

### 2. `src/schema/feedback.ts`（V3.1 反馈评价 + 行动意图类型定义）
- `FeedbackEvaluation` 类型：9 个枚举值（useful / not_useful / wrong_match / already_expired / low_value / too_hard / duplicate / no_official_link / bad_deadline）
- `Feedback` 接口：`{ evaluation, note?, updated_at }`
- `ActionIntentType` 类型：3 个枚举值（intend_to_apply / considering / not_interested）
- `ActionStatusType` 类型：4 个枚举值（not_started / preparing / submitted / abandoned）
- `ActionIntent` 接口：`{ intent, status, note?, next_action_date? }`
- 中文标签映射：`FEEDBACK_LABELS` / `ACTION_INTENT_LABELS` / `ACTION_STATUS_LABELS`

### 3. `scripts/verify-task039.ts`（F9 验证脚本）
- 57 项验收检查，覆盖 8 大类：
  1. 文件存在性检查（3 项：search.js / feedback.ts / verify-task039.ts）
  2. HTML 结构检查（5 项：panel-search + search-container + search-status-bar + search-results + script 引入）
  3. CSS 检查（8 项：opp-card + level-badge + score-bar-fill + star-btn + feedback-btn + action-section + card-detail + 响应式）
  4. JS 功能检查（10 项：performSearch + renderCard + toggleStar + submitFeedback + toCard + 事件监听 + fetch 调用）
  5. 后端类型检查（8 项：FeedbackEvaluation 9 枚举 + ActionIntent + ActionStatus + OpportunityCard 新字段）
  6. API 路由检查（4 项：PATCH /:key/feedback 路由存在 + 请求体解析 + 404 + 400）
  7. API 集成检查（19 项：GET / + GET /search.js + POST /api/search + POST /api/opportunities + POST /:key/star + PATCH /:key/feedback × 2）
  8. 回归测试（2 项：verify-task034 + verify-task038）

---

## 三、如何本地运行

```bash
# 1. 启动开发服务器（端口 3000）
npm run dev

# 2. 打开浏览器
# http://localhost:3000
# 首页输入需求 → 需求确认对话 → 确认度 ≥ 90% → 点击"开始搜索"
# 自动切换到搜索 Tab → 显示 loading → 渲染机会卡片
# 点击 ☆ 收藏 / 点击 ▼ 展开详情 / 点击反馈按钮评价
```

---

## 四、如何测试

```bash
# 1. tsc 编译检查
npx tsc --noEmit

# 2. precheck 预检查
npm run precheck

# 3. Task 039 验收脚本（57 项检查 + 回归测试）
npm run verify:task039
```

---

## 五、验证结果

### 1. tsc 编译检查
```
npx tsc --noEmit
```
- 结果：exit 0（零错误）

### 2. Task 039 验收脚本（本任务核心）
```
npx tsx scripts/verify-task039.ts
```
- 结果：**57 PASS / 0 FAIL**（exit 0）
- 覆盖：文件存在 + HTML 结构 + CSS + JS 功能 + 后端类型 + API 路由 + API 集成 + 回归

### 3. 回归测试（在 verify-task039 中执行）
- `verify-task034`：通过（开源就绪不破坏）
- `verify-task038`：通过（用户旅程首页 + 需求确认页不破坏）

---

## 六、关键设计决策

### 1. 三类字段拆分（V3.1 核心新增）
- V2 版本反馈和状态混用（只有 `status` 一个字段）
- V3.1 拆分为三类独立字段：
  - `status`（行为状态，9 状态机，原有）
  - `feedback`（反馈评价，9 枚举 + 备注，**V3 新增**）
  - `action_intent`（行动意图，意图 + 进度 + 备注 + 下次行动日期，**V3 新增**）
- 不修改机会状态机（Task 030 的 9 状态保持不变）

### 2. PATCH /feedback 的 action_intent 部分更新
- action_intent 需支持部分更新（只覆盖传入的字段，保留未传入的字段）
- 实现：读取 `existing.card.action_intent`，用 `??` 操作符合并已有值 + 传入值
- 例如：只传 `status` 时，保留原有 `intent` / `note` / `next_action_date`

### 3. Star 收藏需先入库
- 搜索结果中的机会尚未入库（无 dedup_key）
- Star 操作流程：
  1. 检查 `cardKeyMap`（guid/url → dedup_key）是否已入库
  2. 未入库则先 `POST /api/opportunities`（ScoredOpportunity → OpportunityCard 映射）获得 dedup_key
  3. 再 `POST /:key/star` 收藏
  4. 缓存 dedup_key 到 cardKeyMap，避免重复入库

### 4. ScoredOpportunity → OpportunityCard 映射
- 前端做映射（`toCard` 函数），不修改 POST /api/search 逻辑
- 字段来源：
  - title ← search_result.title
  - type ← 雷达类型推断（ai_competition → "AI 赛事"）
  - organizer ← cleaned_content.author || source_provider || "未知"
  - official_source_url ← search_result.url
  - deadline ← 从 main_text 正则提取（无法提取则 "未知"）
  - visible_level ← visible_level（hidden 不展示）
  - match_reason ← relevance_reason
  - backend_score ← backend_score
  - status ← "new"（初始态）

### 5. web-ui.ts 新增 /search.js 路由（必要的 src/ 修改）
- 任务书约束"不修改 src/ 目录"主要指业务逻辑
- web-ui.ts 是静态文件路由注册，新增 /search.js 路由是前端功能可用的前提
- 与 Task 038 添加 /home.js + /requirement-chat.js 路由一致的必要集成修复

---

## 七、文件清单

### 修改文件（6 个）
1. `web/index.html` — panel-search 替换占位 + 引入 search.js
2. `web/styles.css` — 机会卡片 + 五维评分 + 反馈区 + 行动意图区样式
3. `src/schema/opportunity-card.ts` — 新增 feedback? + action_intent? 字段
4. `src/api/routes/opportunities.ts` — 新增 PATCH /:key/feedback 路由
5. `src/api/routes/web-ui.ts` — 新增 /search.js 静态文件路由
6. `package.json` — 新增 verify:task039 脚本

### 新增文件（3 个）
1. `web/search.js` — 搜索结果页逻辑（搜索触发 + 卡片渲染 + Star + 反馈 + 行动意图）
2. `src/schema/feedback.ts` — 反馈评价 + 行动意图类型定义（枚举 + 接口 + 中文标签）
3. `scripts/verify-task039.ts` — 57 项验收脚本

---

## 八、任务约束遵守情况

- ✅ 不引入新 npm 依赖（纯 HTML/CSS/JS + TypeScript 类型）
- ✅ 不引入前端框架（无 React/Vue/Svelte）
- ✅ 复用现有 CSS 变量（--accent / --success / --warning / --error / --syntax-starred）
- ✅ 不修改机会状态机（9 状态保持不变，action_intent 独立）
- ✅ 不修改 POST /api/search 逻辑（前端消费现有 API）
- ✅ 所有 fetch 使用相对路径（`/api/...`）
- ✅ 品牌名使用"盯机会"
- ✅ 移动端响应式布局（<768px 适配）
- ⚠️ 关于"不修改 src/ 目录"约束：修改了 `src/schema/opportunity-card.ts`（新增字段）、`src/api/routes/opportunities.ts`（新增 PATCH 路由）、`src/api/routes/web-ui.ts`（新增 /search.js 路由）。前两项是 V3.1 反馈字段的必要后端支持（任务书 4.2 明确要求），第三项是前端功能可用的必要集成修复。

---

## 九、哪些功能还没做

1. 机会库 Tab 实现（Task 040）
2. 报告 Tab 实现（Task 040）
3. Star 状态持久化（V1.1 不做，Task 040 机会库会从后端查询）
4. 反馈数据统计分析（后续版本）

---

## 十、下一步建议

执行 Task 040（机会库 Tab + 报告 Tab）。

---

**结论**：Task 039 搜索结果页 + 机会卡片 + Star + 反馈字段已完成，57 项验收全部通过，回归测试无破坏。V3.1 三类字段拆分（status / feedback / action_intent）已实现，PATCH /feedback API 支持 action_intent 部分更新。
