# Task 019b 完成回报

任务编号：Task 019b（LLM Qwen Adapter + T2 guid 去重 + T5 渠道格式）
所属版本：V0.8（搜索层 + LLM）
日期：2026-06-28
执行方：TRAE IDE
验收方：TRAE Work（总控台）

---

## 1. 任务概要

完成 Task 019b 三条线交付：
1. **LLM Qwen Adapter**：实现通义千问 LLM 适配器，支持 Mock 降级
2. **T2 guid > url 去重优先级**：OpportunityCard 增加 guid 字段，computeDedupKey 升级（向后兼容）
3. **T5 渠道格式指南**：reminder-renderer 新增微信/邮件/Web 三渠道渲染

---

## 2. 修改了哪些文件（3 个 + 1 个回归修复）

### 2.1 `src/schema/opportunity-card.ts`（T2 修改）
- 在 `OpportunityCard` interface 中新增可选字段 `guid?: string`
- 现有 17 个必填字段保持不变，新增 1 个可选字段
- 不修改任何现有常量、函数、locale 感知函数

### 2.2 `src/agents/opportunity-store.ts`（T2 修改）
- 升级 `computeDedupKey(title, official_source_url, guid?)` 函数：
  - 有 guid 时：`sha256(guid).slice(0,16)`（guid 优先）
  - 无 guid 时：`sha256(title|url).slice(0,16)`（现有逻辑，向后兼容）
- `LocalFileStore.add()` 和 `addBatch()` 传递 `card.guid` 给 `computeDedupKey`
- 空字符串 guid 等价于不传 guid（向后兼容）

### 2.3 `src/agents/reminder-renderer.ts`（T5 修改）
- 新增 `ReminderChannel` 类型（wechat/email/web）
- 新增 `ChannelFormatGuide` interface
- 新增 `renderRemindersForChannel(result, channel)` 函数
- 新增 `getChannelFormatGuide(channel)` 函数
- 新增 wechat 渠道渲染（纯文本 + emoji + 2048 字符截断）
- 新增 email 渠道渲染（HTML + table + 红色高亮 + HTML 转义 + 无 emoji）
- 新增 web 渠道渲染（Markdown + emoji + Markdown 链接）
- 现有 `renderRemindersMarkdown` / `renderRemindersJson` / `renderSingleReminder` 保留不变

### 2.4 `scripts/verify-task015.ts`（回归修复 - 日期漂移）
- 修复 `deadline_from` 和 `deadline_to` 测试用例的日期漂移问题
- 原测试用绝对日期 `"2026-07-01"` / `"2026-06-30"` 作为过滤条件，但测试数据用 `daysFromNow(3)` 相对日期
- 当今天日期变化时（如 2026-06-28），`daysFromNow(3)` = 2026-07-01 恰好落在边界上，导致 2 项测试失败
- 修复方案：用 `daysFromNow(4)` 作为过滤边界，使边界始终在 `daysFromNow(3)` 和 `daysFromNow(5)` 之间
- 此修复不影响 Task 019b 的功能代码，仅修复测试脚本的日期漂移

---

## 3. 新增了哪些文件（2 个）

### 3.1 `src/agents/qwen-adapter.ts`（LLM Qwen Adapter）
- 导出 `QwenConfig` interface（apiKey/model/baseUrl/maxTokens/mockMode）
- 导出 `QwenAdapter` class（implements LLMAdapter）
- 构造器：`constructor(config?: Partial<QwenConfig>)`
  - 从 `config.apiKey` 或 `process.env.DASHSCOPE_API_KEY` 读取 API Key
  - 无 API Key 时自动进入 Mock 模式（不抛错）
  - 显式 `mockMode: true` 优先
- Mock 模式：
  - 含"机会"/"评分"/"提取"关键词 → 返回机会提取预设 JSON（AI 游戏/比赛/广州）
  - 含"需求"/"确认"/"理解"关键词 → 返回需求理解预设 JSON（文创/补贴/深圳）
  - 其他 → 通用预设
  - `response_format="json"` 时使用 `parseJsonWithRepair` 解析
  - `response_format="text"` 时返回 summary 字段
- 真实模式：
  - `fetch` 调用 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
  - OpenAI 兼容模式：`Authorization: Bearer ${apiKey}`，`Content-Type: application/json`
  - 请求体：`{ model, messages, temperature, max_tokens, response_format? }`
  - 响应解析：`data.choices[0].message.content`
  - 网络错误重试 1 次，HTTP 4xx/5xx 不重试
  - `response_format="json"` 时使用 T4 `parseJsonWithRepair` 解析
- 不引入新 npm 依赖（用 Node.js 内置 fetch）

### 3.2 `scripts/verify-task019b.ts`（验收脚本）
- 覆盖验收标准 5.1-5.3 + 回归测试
- 108 项断言，全部通过
- 使用 `async function main()` 包装（CommonJS 不支持 top-level await）

---

## 4. 如何本地运行

```bash
# 编译检查
npx tsc --noEmit

# Task 019b 验收
npx tsx scripts/verify-task019b.ts

# 回归测试
npx tsx scripts/verify-task019a.ts
npx tsx scripts/integration-test.ts
npx tsx scripts/verify-task014.ts
npx tsx scripts/verify-task015.ts
npx tsx scripts/verify-task016.ts
npx tsx scripts/verify-task018.ts
```

> Windows PowerShell 环境需用 `npx.cmd` 替代 `npx`（执行策略限制）。

---

## 5. 如何测试

### 5.1 LLM Qwen Adapter 测试

```typescript
import { QwenAdapter } from "./src/agents/qwen-adapter";

// Mock 模式（无 DASHSCOPE_API_KEY）
const adapter = new QwenAdapter();
const response = await adapter.chat({
  messages: [{ role: "user", content: "帮我提取机会信息" }],
  response_format: "json",
});
console.log(response.content);  // 预设 JSON
console.log(response.parsed);   // parseJsonWithRepair 解析结果
```

### 5.2 T2 guid 去重测试

```typescript
import { computeDedupKey } from "./src/agents/opportunity-store";

// 无 guid（向后兼容）
const key1 = computeDedupKey("机会A", "https://a.com");

// 有 guid（guid 优先）
const key2 = computeDedupKey("机会A", "https://a.com", "guid-123");

console.log(key1 !== key2);  // true，不碰撞
```

### 5.3 T5 渠道渲染测试

```typescript
import { renderRemindersForChannel, getChannelFormatGuide } from "./src/agents/reminder-renderer";

const wechatOutput = renderRemindersForChannel(result, "wechat");
const emailOutput = renderRemindersForChannel(result, "email");
const webOutput = renderRemindersForChannel(result, "web");

console.log(getChannelFormatGuide("wechat"));  // { format: "plain", max_length: 2048, ... }
```

---

## 6. 验证结果（交付验证红线）

```
npx tsc --noEmit                           → exit 0 ✓
npx tsx scripts/verify-task019b.ts         → PASS: 108 / FAIL: 0 ✓
npx tsx scripts/verify-task019a.ts         → PASS: 47 / FAIL: 0 ✓
npx tsx scripts/integration-test.ts        → PASS: 91 / FAIL: 0 ✓
npx tsx scripts/verify-task014.ts          → PASS: 143 / FAIL: 0 ✓
npx tsx scripts/verify-task015.ts          → PASS: 177 / FAIL: 0 ✓
npx tsx scripts/verify-task016.ts          → PASS: 157 / FAIL: 0 ✓
npx tsx scripts/verify-task018.ts          → PASS: 139 / FAIL: 0 ✓
```

**总断言数：862 项，全部通过。**

---

## 7. 哪些功能还没做

| 不做 | 何时做 |
|---|---|
| 调用 QwenAdapter 的搜索层模块（ai-filter） | Task 019d |
| ConversationManager 实际注入 QwenAdapter | V0.9（Web UI 接入时） |
| 博查/Exa provider 实现 | Task 019c |
| T10 三层筛选 | Task 019d |
| 真实 Qwen API 调用测试（需 DASHSCOPE_API_KEY） | V0.9 生产部署时 |

---

## 8. 下一步建议

1. **Task 019c**：博查/Exa provider 实现（搜索数据源）
2. **Task 019d**：ai-filter 搜索层模块（调用 QwenAdapter + T10 三层筛选）
3. **Task 019e**：搜索层集成测试

---

## 9. 约束遵守情况

| 约束 | 遵守情况 |
|---|---|
| 向后兼容（T2 新增可选参数，T5 只新增不修改现有函数） | ✅ |
| 不引入新 npm 依赖（HTTP 用 Node.js 内置 fetch） | ✅ |
| 不调用真实 API（验证脚本全部走 Mock 模式） | ✅ |
| 不修改 llm-adapter.ts、mock-llm-adapter.ts、conversation-manager.ts | ✅ |
| i18n 兼容（Mock 预设文本仅用于 LLM 内部） | ✅ |
| OpportunityCard 向后兼容（guid 为可选字段） | ✅ |
| GPL-3.0 合规（T4 JSON 修复手写，不引入 jsonrepair 库） | ✅ |

---

## 10. 验收清单自检

| 验收项 | 自检结果 |
|---|---|
| QwenAdapter 存在且实现 LLMAdapter 接口 | ✅ |
| QwenAdapter Mock 模式可测试 | ✅ |
| QwenAdapter 导入 T4 parseJsonWithRepair | ✅ |
| T2 OpportunityCard 增加 guid?: string | ✅ |
| T2 computeDedupKey 向后兼容 | ✅ |
| T2 computeDedupKey guid 优先 | ✅ |
| T2 LocalFileStore.add 传递 card.guid | ✅ |
| T2 LocalFileStore.addBatch 传递 card.guid | ✅ |
| T5 ReminderChannel 类型定义 | ✅ |
| T5 ChannelFormatGuide 接口定义 | ✅ |
| T5 renderRemindersForChannel 函数 | ✅ |
| T5 getChannelFormatGuide 函数 | ✅ |
| T5 wechat 渠道纯文本 + emoji | ✅ |
| T5 email 渠道 HTML + 无 emoji | ✅ |
| T5 web 渠道 Markdown + emoji | ✅ |
| T5 现有 3 个渲染函数保留不变 | ✅ |
| tsc exit 0 | ✅ |
| verify-task019b 全 PASS | ✅ |
| 回归测试全 PASS（014/015/016/018/019a/integration） | ✅ |
| 不引入新依赖 | ✅ |
