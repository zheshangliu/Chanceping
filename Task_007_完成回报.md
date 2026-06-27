# Task 007｜多轮追问与对话管理 — 完成回报

任务编号：Task 007
所属版本：V0.2
任务类型：核心逻辑 / 对话管理
执行环境：TRAE IDE
完成时间：2026-06-27

---

## 1. 任务概述

实现对话管理模块，维护对话状态，每轮生成"已确认/不确定信息拆分 + 追问问题 + 确认度更新 + 当前状态输出"。通过可注入的 LLM 适配器接口支持真实 LLM 接入（后续版本），验证脚本用 Mock LLM 跑通 3 轮完整对话。

本任务把 Task 002 的 system prompt + Task 002 的状态机 + Task 006 的确认度引擎 + Task 002 的问题库串成一条完整的对话链路。

---

## 2. 交付清单

### 2.1 新建文件（6 个）

| 文件路径 | 作用 | 行数 |
|---|---|---|
| `src/agents/llm-adapter.ts` | LLM 调用的抽象接口（LLMMessage / LLMRequest / LLMResponse / LLMAdapter），使对话管理不绑定特定 LLM SDK | 43 |
| `src/agents/conversation-state.ts` | 对话状态定义（ConversationTurn / ConversationState）+ 工厂函数 createInitialConversationState（注入 system prompt） | 89 |
| `src/agents/conversation-turn-output.ts` | 单轮对话输出类型（ConfirmedItem / UncertainItem / TurnOutput），对应 02 号文档第 2 节"初步理解"格式 | 53 |
| `src/agents/mock-llm-adapter.ts` | MockLLMAdapter 实现 LLMAdapter 接口：responseMap 优先匹配 + 关键词规则回退（4.5 节表）+ 自动生成 summary/confirmed_items/uncertain_items | 309 |
| `src/agents/conversation-manager.ts` | ConversationManager 核心类：13 步 processUserInput 流程 + initialize/getState/getTurns/userConfirm/userRequestRevision/canGenerateCard/canGeneratePlan | 475 |
| `scripts/verify-task007.ts` | 验证脚本：3 场景测试（3 轮对话 / 用户确认 / 用户修改）+ 5.2-5.7 验收 + V0.2 验收清单 | 270 |

### 2.2 不重复定义的已有类型和函数（通过 import 引用）

- `REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT`（Task 002，`src/prompts/requirement-confirmation-system-prompt.ts`）
- `getNextStatus` / `STATE_TRANSITIONS`（Task 002，`src/schema/conversation-state-machine.ts`）
- `getQuestionsForRadarType` / `GENERAL_QUESTIONS` / 三雷达专用问题 / `RadarType`（Task 002，`src/prompts/question-bank.ts`）
- `ExtractedRequirementInfo` / `createEmptyExtractedInfo`（Task 006，`src/schema/extracted-requirement-info.ts`）
- `calculateConfidence` / `getConfidenceBranch` / `calculateConfidenceDelta` / `ConfidenceBranch`（Task 006，`src/agents/confidence-engine.ts`）
- `RequirementConfidence` / `createDefaultConfidence` / `computeConfidenceTotal` / `CONFIDENCE_WEIGHTS`（Task 001，`src/schema/requirement-confidence.ts`）
- `ConfirmationStatus` / `QuestionToConfirm`（Task 001，`src/schema/radar-requirement-spec.ts`）

---

## 3. 核心设计

### 3.1 LLM 适配器接口（4.1 节）

```typescript
export interface LLMAdapter {
  chat(request: LLMRequest): Promise<LLMResponse>;
}
```

- 对话管理模块通过此接口调用 LLM，不直接依赖任何特定 LLM SDK
- 验证脚本用 MockLLMAdapter 实现，生产环境可替换为 QwenAdapter / DeepSeekAdapter 等
- LLMRequest 支持 `response_format: "json" | "text"` 和 `temperature`
- LLMResponse 含 `content`（字符串）和 `parsed`（解析后的 JSON 对象，可选）

### 3.2 对话状态（4.2 节）

`ConversationState` 完整维护对话过程中的所有状态：
- `conversation_id` / `radar_type` / `current_status` / `extracted_info` / `confidence` / `branch`
- `message_history: LLMMessage[]`（发给 LLM 的完整消息列表，含 system prompt）
- `turns: ConversationTurn[]`（对话轮次记录，每轮含 snapshot）
- `asked_questions: string[]`（已问过的问题，避免重复追问）
- `turn_count`（对话轮数计数）

`createInitialConversationState` 工厂函数在创建时即注入 `REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT` 作为 message_history 的第一条 system 消息。

### 3.3 processUserInput 13 步流程（4.4 节）

```
1. 将 userInput 加入 message_history（role=user）
2. 调用 LLM（system prompt + message_history），要求返回 JSON：
   { extracted_info, summary, confirmed_items, uncertain_items }
3. 将 LLM 返回的 extracted_info 合并到 state.extracted_info（字段级合并，新值覆盖旧值）
4. 调用 calculateConfidence(state.extracted_info) 计算新确认度
5. 调用 calculateConfidenceDelta(previous, current) 计算变化
6. 调用 getConfidenceBranch(new_confidence.total) 获取分支
7. 如果 branch = needs_more_info 或 continue_confirming：
   a. 从 question-bank 获取问题列表（通用 + 雷达专用）
   b. 过滤掉已问过的问题（state.asked_questions）
   c. 按 priority 排序（high > medium > low）
   d. 取前 5 个作为本轮追问
   e. 把追问问题加入 asked_questions
8. 调用 getNextStatus(state.current_status, new_confidence.total) 更新状态
9. 生成 current_status_text：
   - needs_more_info / continue_confirming → "继续确认需求"
   - can_generate_card_v01 → "可以生成需求确认卡"
   - can_generate_plan → "可以进入雷达方案生成"
10. 构建 TurnOutput 返回
11. 将 AI 回复（summary + 追问）加入 message_history（role=assistant）
12. 记录本轮 ConversationTurn
13. turn_count++
```

### 3.4 mergeExtractedInfo 浅合并函数

```typescript
function mergeExtractedInfo(base, delta): ExtractedRequirementInfo {
  return {
    client_identity: { ...base.client_identity, ...(delta.client_identity ?? {}) },
    business_goal: { ...base.business_goal, ...(delta.business_goal ?? {}) },
    opportunity_type: { ...base.opportunity_type, ...(delta.opportunity_type ?? {}) },
    region_scope: { ...base.region_scope, ...(delta.region_scope ?? {}) },
    exclusion_rules: {
      ...base.exclusion_rules,
      ...(delta.exclusion_rules ?? {}),
      count: delta.exclusion_rules?.count ?? base.exclusion_rules.count,
    },
    action_scenario: { ...base.action_scenario, ...(delta.action_scenario ?? {}) },
    report_format: { ...base.report_format, ...(delta.report_format ?? {}) },
  };
}
```

- 每个维度内部字段级合并，新值覆盖旧值
- `exclusion_rules.count` 字段：如果 delta 显式给了 count，用 delta；否则保留 base

### 3.5 问题选择逻辑

```typescript
// 当 branch = can_generate_card_v01 或 can_generate_plan 时，questions = []
// 否则：getQuestionsForRadarType → 过滤已问过的 → 按 priority 排序 → 取前 5
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
unasked.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
questions = unasked.slice(0, 5);
```

### 3.6 userConfirm / userRequestRevision

- `userConfirm()`：仅在 `confirmation_card_generated` 状态下生效。状态转换链：
  1. `confirmation_card_generated → confirmed`（userAction="confirmed"）
  2. 如果 confidence >= 95：`confirmed → ready_for_radar_plan`（chained 转换）
- `userRequestRevision()`：仅在 `confirmation_card_generated` 状态下生效。状态转换：
  - `confirmation_card_generated → user_revision_requested`

### 3.7 canGenerateCard / canGeneratePlan

- `canGenerateCard()`：`confidence.total >= 90`
- `canGeneratePlan()`：`confidence.total >= 95 && (status === "confirmed" || status === "ready_for_radar_plan")`

### 3.8 MockLLMAdapter 工作流程

1. 提取 message_history 中最后一条 user 消息
2. 优先匹配构造器传入的 responseMap（用 `includes()` 匹配 key）
3. 无匹配则使用关键词规则（4.5 节表）从用户输入中提取信息
4. 自动生成 summary / confirmed_items / uncertain_items
5. 返回 JSON 字符串

关键词规则（取自 4.5 节表）：

| 用户输入关键词 | 填充字段 |
|---|---|
| 个人/团队/公司/机构 | client_identity.client_type |
| AI 游戏/文创/政策/电商 | client_identity.industry |
| Unity/设计/开发 | client_identity.core_capabilities |
| 广州/深圳/杭州/北京 | client_identity.regions |
| 报名/申请/BD/收藏 | action_scenario.action_intent |
| 每周/每天 | report_format.frequency |
| 比赛/补贴/征集 | opportunity_type.primary_types |
| 大陆/海外/全球 | region_scope.primary_regions |
| 不要/排除 + 内容 | exclusion_rules.must_exclude + count++ |
| 奖金/Demo/曝光 | business_goal.priority_order |

---

## 4. 验证场景设计

### 4.1 场景 1：AI 赛事雷达，3 轮对话

通过 responseMap 精确控制每轮提取的字段，驱动确认度从 30.25 → 41.75 → 93.0：

**Turn 1**：用户说"我想找 AI 游戏比赛"
- responseMap["我想找"] → industry + primary_goal + primary_types（3 维度各 1 字段 → 55）
- confidence = 55×0.15 + 55×0.20 + 55×0.20 = 8.25 + 11 + 11 = **30.25**
- branch = needs_more_info，status: draft → needs_more_info

**Turn 2**：用户补充"我是个人开发者，在广州，用 Unity 做 AI 游戏"
- responseMap["我是个人"] → client_type + industry + core_capabilities + products_or_projects + region_scope.primary_regions
- 合并后：client_identity 4 字段 → 95，business_goal 1 字段 → 55，opportunity_type 1 字段 → 55，region_scope 1 字段 → 55
- confidence = 95×0.15 + 55×0.20 + 55×0.20 + 55×0.10 = 14.25 + 11 + 11 + 5.5 = **41.75**
- delta = 41.75 - 30.25 = 11.5 > 0
- improved_dimensions = [client_identity, region_scope]

**Turn 3**：用户补充"想报名比赛拿奖金，每周看一次报告，不要 K12 的"
- responseMap["想报名"] → success_definition + priority_order + excluded_types + secondary_types + excluded_regions + secondary_regions + must_exclude + count + action_intent + action_priority_order + frequency + format + must_include_sections
- 合并后：
  - client_identity: 4 字段 → 95
  - business_goal: 3 字段 → 95
  - opportunity_type: 3 字段 → 95
  - region_scope: 3 字段 → 95
  - exclusion_rules: count=2 → 75
  - action_scenario: 2 字段 → 95
  - report_format: 3 字段 → 95
- confidence = 95×0.15 + 95×0.20 + 95×0.20 + 95×0.10 + 75×0.10 + 95×0.15 + 95×0.10
- = 14.25 + 19 + 19 + 9.5 + 7.5 + 14.25 + 9.5 = **93.0**
- branch = can_generate_card_v01，status: needs_more_info → confirmation_card_generated
- questions = []（不追问）

### 4.2 场景 2：用户确认流程

在场景 1 Turn 3 后调用 `userConfirm()`：
- status: confirmation_card_generated → confirmed
- canGenerateCard() = true（confidence 93 ≥ 90）
- canGeneratePlan() = false（confidence 93 < 95）

### 4.3 场景 3：用户修改流程

重新构建场景 1 到 Turn 3，然后调用 `userRequestRevision()`：
- status: confirmation_card_generated → user_revision_requested
- 用户补充新信息后，重新计算确认度
- status 通过 getNextStatus 计算（不硬编码）

---

## 5. 验证结果

### 5.1 TypeScript 编译验证

命令：`npx tsc --noEmit`

```
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping > npx.cmd tsc --noEmit
（无输出，exit code = 0）
```

结果：**通过**（exit code 0，无 TypeScript 错误）

### 5.2 验证脚本运行结果

命令：`npx tsx scripts/verify-task007.ts`

```
=== 场景 1：AI 赛事雷达，3 轮对话 ===

--- Turn 1：'我想找 AI 游戏比赛' ---
  PASS  Turn 1 status = needs_more_info
  PASS  Turn 1 confidence ≈ 30.25
  PASS  Turn 1 current_status_text = '继续确认需求'
  PASS  Turn 1 confidence_delta = null（首轮）
  PASS  Turn 1 questions ≤ 5
  PASS  Turn 1 questions > 0（需要追问）
  PASS  Turn 1 包含 high priority 问题
  PASS  Turn 1 summary 非空
  PASS  Turn 1 confirmed_items 包含 industry
  PASS  Turn 1 confirmed_items 包含 primary_goal
  PASS  Turn 1 confirmed_items 包含 primary_types
  PASS  Turn 1 uncertain_items 非空（confidence < 95）
  PASS  Turn 1 turn_count = 1

--- Turn 2：'我是个人开发者，在广州，用 Unity 做 AI 游戏' ---
  PASS  Turn 2 status = needs_more_info（confidence 41.75 < 70）
  PASS  Turn 2 confidence ≈ 41.75
  PASS  Turn 2 confidence_delta.total_delta > 0
  PASS  Turn 2 confidence_delta.improved_dimensions 非空
  PASS  Turn 2 improved_dimensions 包含 client_identity
  PASS  Turn 2 improved_dimensions 包含 region_scope
  PASS  Turn 2 questions ≤ 5
  PASS  Turn 2 questions > 0
  PASS  Turn 2 questions 不与 Turn 1 重复
  PASS  Turn 2 confirmed_items 包含 client_type
  PASS  Turn 2 confirmed_items 包含 core_capabilities
  PASS  Turn 2 confirmed_items 包含 region_scope.primary_regions
  PASS  Turn 2 turn_count = 2

--- Turn 3：'想报名比赛拿奖金，每周看一次报告，不要 K12 的' ---
  PASS  Turn 3 confidence ≥ 90
  PASS  Turn 3 confidence = 93.0
  PASS  Turn 3 current_status_text = '可以生成需求确认卡'
  PASS  Turn 3 status = confirmation_card_generated
  PASS  Turn 3 questions = []（branch = can_generate_card_v01，不追问）
  PASS  Turn 3 confirmed_items 包含 action_intent
  PASS  Turn 3 confirmed_items 包含 frequency
  PASS  Turn 3 confirmed_items 包含 must_exclude
  PASS  Turn 3 confirmed_items 包含 success_definition
  PASS  Turn 3 confirmed_items 包含 excluded_types
  PASS  Turn 3 turn_count = 3

=== 场景 2：用户确认流程（在场景 1 Turn 3 后） ===
  PASS  userConfirm 后 status = confirmed
  PASS  userConfirm 后 questions = []
  PASS  userConfirm 后 canGenerateCard = true（confidence 93 ≥ 90）
  PASS  userConfirm 后 canGeneratePlan = false（confidence 93 < 95）

=== 场景 3：用户修改流程（重新构建场景 1 到 Turn 3，然后修改） ===
  PASS  场景 3 准备：Turn 3 后 status = confirmation_card_generated
  PASS  userRequestRevision 后 status = user_revision_requested
  PASS  userRequestRevision 后 questions = []

--- 场景 3 续：用户补充新信息 '我修改了：不再排除 K12 赛事' ---
  PASS  修改后 status 通过 getNextStatus 计算（不硬编码）

=== 5.2 已确认/不确定信息拆分 ===
  PASS  Turn 2 confirmed_items 非空（从轮次 2 开始）
  PASS  Turn 2 confirmed_items 每项含 field/label/value
  PASS  Turn 2 uncertain_items 非空（confidence < 95）
  PASS  Turn 2 uncertain_items 每项含 field/label/hint
  PASS  Turn 3 uncertain_items 非空（confidence 93 < 95）
  PASS  Turn 1/2/3 summary 均非空

=== 5.3 追问问题规则 ===
  PASS  Turn 1 questions ≤ 5
  PASS  Turn 2 questions ≤ 5
  PASS  Turn 3 questions = []（branch = can_generate_card_v01）
  PASS  Turn 1 high priority 在 medium 之前
  PASS  Turn 1 medium 在 low 之前
  PASS  asked_questions 累积了 Turn 1 + Turn 2 的问题

=== 5.4 确认度变化 ===
  PASS  Turn 1 confidence_delta = null（首轮）
  PASS  Turn 2 confidence_delta.total_delta > 0（比 Turn 1 提升）
  PASS  Turn 2 confidence_delta.improved_dimensions 非空（至少 1 个维度提升）
  PASS  Turn 2 confidence_delta.total_delta ≈ 11.5（41.75 - 30.25）

=== 5.5 状态机正确性 ===
  PASS  Turn 1 后 status = needs_more_info（confidence 30.25 < 70）
  PASS  Turn 2 后 status = needs_more_info（confidence 41.75 < 70）
  PASS  Turn 3 后 status = confirmation_card_generated（confidence 93 ≥ 90）
  PASS  userConfirm 后 status = confirmed
  PASS  userRequestRevision 后 status = user_revision_requested
  PASS  Turn 1 status 与 getNextStatus('draft', 30.25) 一致
  PASS  Turn 3 status 与 getNextStatus('needs_more_info', 93) 一致

=== 5.6 LLM 适配器接口 ===
  PASS  MockLLMAdapter 实现 LLMAdapter 接口（chat 方法存在）
  PASS  MockLLMAdapter 是 LLMAdapter 类型
  PASS  ConversationManager 通过 LLMAdapter 调用 LLM（不直接 import LLM SDK）
  PASS  验证脚本只使用 MockLLMAdapter，不依赖网络

=== 5.7 编译与引用 ===
  PASS  src/agents/llm-adapter.ts 已创建
  PASS  src/agents/conversation-state.ts 已创建
  PASS  src/agents/conversation-turn-output.ts 已创建
  PASS  src/agents/conversation-manager.ts 已创建
  PASS  src/agents/mock-llm-adapter.ts 已创建
  PASS  scripts/verify-task007.ts 已创建
  PASS  不重复定义 computeConfidenceTotal / calculateConfidence / getNextStatus / getQuestionsForRadarType（通过 import 引用）
  PASS  getQuestionsForRadarType 可调用且返回 15 条（ai_competition）
  PASS  CONFIDENCE_WEIGHTS 总和 = 100

=== V0.2 验收清单（逐项自检） ===
  PASS  [✓] 能跑通 2–3 轮确认
  PASS  [✓] 每轮 ≤5 个问题
  PASS  [✓] 正确区分已确认 / 不确定信息
  PASS  [✓] 每轮结束输出当前状态（继续确认 / 可出卡 / 可进方案）
  PASS  [✓] 追问问题不与之前轮次重复
  PASS  [✓] 确认度每轮更新，delta 正确
  PASS  [✓] 状态机通过 getNextStatus 驱动，不硬编码
  PASS  [✓] LLM 适配器接口可注入，不绑定

========================================
总计：PASS 89 / FAIL 0
========================================
```

结果：**通过**（exit code 0，PASS 89 / FAIL 0）

> 注：终端中文显示为 GBK 编码下的 UTF-8 字节（mojibake），但测试结果（PASS/FAIL 计数与英文部分）完全正确。上述输出已还原为正确的 UTF-8 中文。

---

## 6. 验收标准逐项对照

### 6.1 多轮对话跑通（5.1）

| 验收项 | 结果 |
|---|---|
| 场景 1：AI 赛事雷达 3 轮对话 | ✅ Turn 1→30.25, Turn 2→41.75, Turn 3→93.0 |
| Turn 1: confidence < 70, branch = needs_more_info | ✅ 30.25, needs_more_info |
| Turn 1: 追问 ≤5 个，包含 high priority | ✅ 5 个 high priority |
| Turn 1: status 从 draft 变为 needs_more_info | ✅ |
| Turn 2: confidence 提升，delta > 0 | ✅ 41.75, delta=11.5 |
| Turn 2: 追问问题不与 Turn 1 重复 | ✅ |
| Turn 3: confidence ≥ 90, branch = can_generate_card_v01 | ✅ 93.0 |
| Turn 3: status 变为 confirmation_card_generated | ✅ |
| Turn 3: current_status_text = "可以生成需求确认卡" | ✅ |
| 场景 2: userConfirm() → status = confirmed | ✅ |
| 场景 2: confidence 90-94 → canGeneratePlan() = false | ✅ |
| 场景 3: userRequestRevision() → status = user_revision_requested | ✅ |
| 场景 3: 用户补充新信息后重新计算确认度 | ✅ |

### 6.2 已确认/不确定信息拆分（5.2）

| 验收项 | 结果 |
|---|---|
| confirmed_items 非空数组（从轮次 2 开始） | ✅ |
| confirmed_items 每项含 field/label/value | ✅ |
| uncertain_items 非空数组（confidence < 95 时） | ✅ Turn 1/2/3 均非空 |
| uncertain_items 每项含 field/label/hint | ✅ |
| summary 非空字符串 | ✅ Turn 1/2/3 均非空 |

### 6.3 追问问题规则（5.3）

| 验收项 | 结果 |
|---|---|
| 每轮追问 ≤5 个问题 | ✅ |
| 追问问题不与之前轮次重复 | ✅ |
| 追问按 priority 排序（high 在前） | ✅ |
| branch = can_generate_card_v01 时不追问 | ✅ Turn 3 questions = [] |

### 6.4 确认度变化（5.4）

| 验收项 | 结果 |
|---|---|
| Turn 2 confidence_delta.total_delta > 0 | ✅ 11.5 |
| confidence_delta.improved_dimensions 非空 | ✅ [client_identity, region_scope] |
| 首轮 confidence_delta = null | ✅ |

### 6.5 状态机正确性（5.5）

| 验收项 | 结果 |
|---|---|
| Turn 1 后 status = needs_more_info | ✅ |
| 每轮 status 通过 getNextStatus 计算，不硬编码 | ✅ 与独立调用 getNextStatus 结果一致 |
| userConfirm() 后 status = confirmed | ✅ |
| userRequestRevision() 后 status = user_revision_requested | ✅ |

### 6.6 LLM 适配器接口（5.6）

| 验收项 | 结果 |
|---|---|
| ConversationManager 通过 LLMAdapter 接口调用 LLM | ✅ |
| MockLLMAdapter 实现了 LLMAdapter 接口 | ✅ |
| 验证脚本只使用 MockLLMAdapter，不依赖网络 | ✅ |

### 6.7 编译与引用（5.7）

| 验收项 | 结果 |
|---|---|
| npx tsc --noEmit 无错误 | ✅ exit code 0 |
| 不重复定义 Task 001 / 002 / 006 的类型和函数 | ✅ 全部通过 import 引用 |
| 不重复定义 computeConfidenceTotal / calculateConfidence / getNextStatus / getQuestionsForRadarType | ✅ |

---

## 7. V0.2 验收清单（逐项自检）

| 验收项 | 结果 |
|---|---|
| 能跑通 2–3 轮确认 | ✅ 3 轮 |
| 每轮 ≤5 个问题 | ✅ |
| 正确区分已确认 / 不确定信息 | ✅ |
| 每轮结束输出当前状态（继续确认 / 可出卡 / 可进方案） | ✅ |
| 追问问题不与之前轮次重复 | ✅ |
| 确认度每轮更新，delta 正确 | ✅ |
| 状态机通过 getNextStatus 驱动，不硬编码 | ✅ |
| LLM 适配器接口可注入，不绑定 | ✅ |

---

## 8. 约束遵守

- ✅ **不接入真实 LLM API**——使用 MockLLMAdapter 验证对话流程
- ✅ 不实现确认卡 Markdown 生成（Task 008）
- ✅ 不实现 Spec 编译器（Task 009）
- ✅ 不创建 UI / 前端页面
- ✅ 每轮追问 ≤5 个（02 号文档第 1.3 节）
- ✅ 不重复定义已有类型和函数

---

## 9. 完成标志

- ✅ `src/agents/llm-adapter.ts` 已创建
- ✅ `src/agents/conversation-state.ts` 已创建
- ✅ `src/agents/conversation-turn-output.ts` 已创建
- ✅ `src/agents/conversation-manager.ts` 已创建，ConversationManager 类可用
- ✅ `src/agents/mock-llm-adapter.ts` 已创建
- ✅ `scripts/verify-task007.ts` 已创建，全部测试通过（PASS 89 / FAIL 0）
- ✅ TypeScript 编译无错误（exit code 0）
- ✅ 验证脚本输出已附在完成回报中

---

## 10. 下一步

Task 007 完成。后续任务：
- **Task 008**：确认卡 Markdown 生成
- **Task 009**：Spec 编译器
- **Task 010**：雷达方案生成
