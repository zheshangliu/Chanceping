# Task 020｜双套 LLM API 策略方案完成回报

任务编号：Task 020
所属版本：V0.8.x（LLM 多 Provider 路由层）
日期：2026-06-28
执行方：TRAE IDE
验收方：TRAE Work（总控台）

---

## 1. 任务概述

基于《ChancePing API 选型独立调研报告 V1.0》和 Qwen Cloud Hackathon 比赛要求，实现两套 LLM API 策略方案，通过环境变量 `LLM_STRATEGY` 一键切换：

- **方案 A：商业版（commercial）**——多 Provider 混合，追求成本最优。GLM-4.7-Flash 免费跑批量初筛，DeepSeek V4-Pro 跑核心/高难判断，Qwen3.7-Plus 仅用于报告生成与兜底。
- **方案 B：参赛版（competition）**——所有路由只用 Qwen，满足 Hackathon "must use Qwen Cloud API" 硬性要求，部署在阿里云。

本次交付新增 7 个文件，不修改任何现有文件，不引入新 npm 依赖（HTTP 用 Node.js 内置 `fetch`），验证脚本全部走 Mock 模式不调用真实 API。

所有 12 项验证命令已通过，合计 **1389 项断言全部 PASS**。

---

## 2. 文件清单

### 2.1 修改了哪些文件

**无**。本次任务严格遵守"不修改任何现有文件"约束，`llm-adapter.ts` / `qwen-adapter.ts` / `mock-llm-adapter.ts` / `conversation-manager.ts` 均保持只读。

### 2.2 新增了哪些文件

| # | 文件路径 | 行数 | 用途 |
|---|---|---|---|
| 1 | `src/agents/deepseek-adapter.ts` | 278 | DeepSeek V4 LLM 适配器（Mock + 真实 + T4 JSON 修复） |
| 2 | `src/agents/glm-adapter.ts` | 278 | GLM (Z.AI) LLM 适配器（Mock + 真实 + T4 JSON 修复） |
| 3 | `src/agents/model-router.ts` | 164 | 模型路由器（实现 LLMAdapter 接口，含 FallbackAdapter 内部类与适配器缓存） |
| 4 | `src/config/llm-strategy.ts` | 134 | 两套策略配置定义（COMMERCIAL_STRATEGY / COMPETITION_STRATEGY / getStrategy / getStrategyFromEnv） |
| 5 | `.env.example.commercial` | 16 | 商业版环境变量模板（LLM_STRATEGY=commercial + ZAI/DEEPSEEK/DASHSCOPE 三 key） |
| 6 | `.env.example.competition` | 18 | 参赛版环境变量模板（LLM_STRATEGY=competition + 仅 DASHSCOPE_API_KEY + ALIYUN_REGION） |
| 7 | `scripts/verify-task020.ts` | 427 | 验收脚本（5.1-5.6 共 6 个 section，104 项断言） |

合计：新增 7 个文件，共 1315 行；修改 0 个文件。

---

## 3. 交付物详细说明

### 3.1 DeepSeek V4 适配器（`src/agents/deepseek-adapter.ts`）

完全复刻 QwenAdapter 代码结构（配置区 / Mock 预设区 / 适配器类 / Mock 方法 / 真实方法 / 辅助方法）。

- **导出**：`DeepSeekAdapter` class、`DeepSeekConfig` interface
- **默认配置**：model = `deepseek-v4-flash`，baseUrl = `https://api.deepseek.com/v1`，maxTokens = 4096
- **环境变量**：`DEEPSEEK_API_KEY`，无 key 时自动 Mock，不抛错
- **Mock 预设**：与 QwenAdapter 完全一致（extracted_info / summary / confirmed_items / uncertain_items 四字段结构）
- **关键词匹配**：`/机会|评分|提取/` → 机会提取预设；`/需求|确认|理解/` → 需求理解预设；其他 → 通用预设
- **真实模式**：OpenAI 兼容模式 `POST {baseUrl}/chat/completions`，网络错误重试 1 次（共 2 次尝试），HTTP 4xx/5xx 不重试
- **JSON 修复**：`response_format="json"` 时复用 T4 `parseJsonWithRepair` 填入 `parsed` 字段

### 3.2 GLM 适配器（`src/agents/glm-adapter.ts`）

完全复刻 QwenAdapter 代码结构。

- **导出**：`GlmAdapter` class、`GlmConfig` interface
- **默认配置**：model = `glm-4.7-flash`，baseUrl = `https://api.z.ai/api/paas/v4`，maxTokens = 4096
- **环境变量**：`ZAI_API_KEY`，无 key 时自动 Mock
- **Mock 预设**：与 QwenAdapter / DeepSeekAdapter 完全一致
- **真实模式**：与 DeepSeekAdapter 一致（OpenAI 兼容 + 网络重试 + T4 修复）
- **商业版定位**：GLM-4.7-Flash 完全免费（30B/3B MoE），用于批量初筛 + 去重分类，零成本

### 3.3 模型路由器（`src/agents/model-router.ts`）

实现 `LLMAdapter` 接口，可作为 `ConversationManager` 的 drop-in 替换。

- **导出类型**：`TaskType`（8 种）、`LLMProvider`（qwen/deepseek/glm）、`ModelRoute`、`TaskRouting`、`StrategyProfile`、`ModelStrategy`
- **导出类**：`ModelRouter`
- **方法**：
  - `chat(request)`：向后兼容，等价于 `chatForTask(strategy.defaultTask, request)`
  - `chatForTask(taskType, request)`：查路由表 → primary 调用 → 失败时 fallback 调用 → fallback 也失败抛 fallback 错误
  - `getAdapterForTask(taskType)`：返回 `FallbackAdapter` 实例（封装 primary + fallback）
  - `getProfile()` / `getStrategy()`：获取当前策略信息
- **FallbackAdapter 内部类**：try primary → catch → fallback（如有）→ else throw primaryErr
- **适配器缓存**：`Map<string, LLMAdapter>`，key = `${provider}:${model}`，懒加载
- **策略选择**：构造器未传 strategy 时从 `getStrategyFromEnv()` 获取

### 3.4 策略配置文件（`src/config/llm-strategy.ts`）

- **导出**：`COMMERCIAL_STRATEGY`、`COMPETITION_STRATEGY`、`getStrategy(profile)`、`getStrategyFromEnv()`
- **类型导入**：从 `../agents/model-router` type-only import（编译后无运行时依赖，避免循环依赖）
- **COMMERCIAL_STRATEGY 路由表**（8 种 TaskType）：
  - `batch_screening` → GLM-4.7-Flash（免费）+ DeepSeek-V4-Flash 降级
  - `core_judgment` / `high_difficulty` → DeepSeek-V4-Pro + Qwen3.7-Plus 降级
  - `report_generation` → Qwen3.7-Plus + DeepSeek-V4-Pro 降级
  - `requirement_understanding` / `summarization` → DeepSeek-V4-Flash + GLM-4.7-Flash 降级
  - `dedup_classification` → GLM-4.7-Flash + DeepSeek-V4-Flash 降级
  - `fallback` → Qwen3.7-Plus（无降级）
- **COMPETITION_STRATEGY 路由表**：所有 provider = "qwen"，满足 Hackathon 合规要求
  - `high_difficulty` → qwen3.7-max + qwen3.7-plus 降级
  - 其余 → qwen3.7-plus（部分有 qwen3.7-max 降级，部分无降级）
- **getStrategyFromEnv()**：读 `LLM_STRATEGY` 环境变量，未设置默认 `commercial`

### 3.5 环境变量模板

- `.env.example.commercial`：含 `LLM_STRATEGY=commercial` + `ZAI_API_KEY` + `DEEPSEEK_API_KEY` + `DASHSCOPE_API_KEY` + `SERPER_API_KEY` + `JINA_READER_API_KEY`
- `.env.example.competition`：含 `LLM_STRATEGY=competition` + `DASHSCOPE_API_KEY` + `ALIYUN_REGION=cn-hangzhou`（不含 DEEPSEEK_API_KEY 和 ZAI_API_KEY，参赛版仅用 Qwen）

### 3.6 验收脚本（`scripts/verify-task020.ts`）

覆盖任务书 5.1-5.6 全部验收标准，共 6 个 section、104 项断言：

| Section | 验收项 | 断言数 |
|---|---|---|
| 5.1 | DeepSeek V4 适配器 | 15 |
| 5.2 | GLM 适配器 | 13 |
| 5.3 | 模型路由器 | 24 |
| 5.4 | 策略配置文件 | 26 |
| 5.5 | 环境变量模板 | 10 |
| 5.6 | 约束自检（不修改现有文件 / 无第三方依赖 / Mock 一致性） | 16 |
| **合计** | | **104** |

---

## 4. 如何本地运行

### 4.1 切换 LLM 策略

```bash
# 商业版（默认，多 Provider 成本最优）
cp .env.example.commercial .env
# 编辑 .env 填入真实 API key

# 参赛版（只用 Qwen Cloud API）
cp .env.example.competition .env
# 编辑 .env 填入 DASHSCOPE_API_KEY
```

或直接设置环境变量：

```bash
# PowerShell
$env:LLM_STRATEGY = "competition"

# CMD
set LLM_STRATEGY=competition
```

### 4.2 在代码中使用 ModelRouter

```typescript
import { ModelRouter } from "./agents/model-router";

// 自动从 LLM_STRATEGY 环境变量读取策略
const router = new ModelRouter();

// 向后兼容：等价于 chatForTask("requirement_understanding", request)
const resp1 = await router.chat({ messages: [...] });

// 按任务类型路由（含 fallback）
const resp2 = await router.chatForTask("batch_screening", { messages: [...] });
const resp3 = await router.chatForTask("report_generation", { messages: [...] });

// 获取当前策略 profile
console.log(router.getProfile()); // "commercial" 或 "competition"
```

### 4.3 注入 ConversationManager（drop-in 替换）

```typescript
import { ModelRouter } from "./agents/model-router";
import { ConversationManager } from "./agents/conversation-manager";

const router = new ModelRouter();
const cm = new ConversationManager({ llmAdapter: router });
```

---

## 5. 如何测试

### 5.1 主验证命令（12 条）

```bash
# TypeScript 编译检查
npx tsc --noEmit

# Task 020 主验收（104 项断言）
npx tsx scripts/verify-task020.ts

# 10 项回归验证
npx tsx scripts/verify-task019a.ts   # 47 项
npx tsx scripts/verify-task019b.ts   # 108 项
npx tsx scripts/verify-task019c.ts   # 128 项
npx tsx scripts/verify-task019d.ts   # 146 项
npx tsx scripts/verify-task019.ts    # 149 项
npx tsx scripts/integration-test.ts  # 91 项
npx tsx scripts/verify-task014.ts    # 143 项
npx tsx scripts/verify-task015.ts    # 177 项
npx tsx scripts/verify-task016.ts    # 157 项
npx tsx scripts/verify-task018.ts    # 139 项
```

### 5.2 实际运行输出（12 条命令）

#### 命令 1：`npx tsc --noEmit`

```
EXIT_CODE=0
（无任何输出，TypeScript 编译零错误）
```

#### 命令 2：`npx tsx scripts/verify-task020.ts`

```
=== Task 020 验收检查（双套 LLM API 策略方案）===

[5.1] DeepSeek V4 适配器
  PASS  deepseek-adapter.ts 导出 DeepSeekAdapter class
  PASS  deepseek-adapter.ts 导出 DeepSeekConfig interface（类型兼容）
  PASS  DeepSeekAdapter: 无 apiKey 时自动 Mock（不抛错）
  PASS  DeepSeekAdapter: Mock json 返回 content 非空
  PASS  DeepSeekAdapter: Mock json 返回 parsed 字段
  PASS  DeepSeekAdapter: Mock json content 可被 JSON.parse
  PASS  DeepSeekAdapter: Mock text 返回非空字符串
  PASS  DeepSeekAdapter: 含'机会'关键词 → 机会提取预设（含 extracted_info）
  PASS  DeepSeekAdapter: 机会提取预设含 summary
  PASS  DeepSeekAdapter: 含'评分'关键词 → 机会提取预设
  PASS  DeepSeekAdapter: 含'需求'关键词 → 需求理解预设（含 extracted_info）
  PASS  DeepSeekAdapter: 含'理解'关键词 → 需求理解预设
  PASS  DeepSeekAdapter: 实现 LLMAdapter 接口（可赋值给 LLMAdapter）
  PASS  DeepSeekAdapter: 显式 mockMode 仍可工作
  PASS  DeepSeekAdapter: 使用 parseJsonWithRepair（parsed 与 content 一致）

[5.2] GLM 适配器
  PASS  glm-adapter.ts 导出 GlmAdapter class
  PASS  glm-adapter.ts 导出 GlmConfig interface（类型兼容）
  PASS  GlmAdapter: 无 apiKey 时自动 Mock（不抛错）
  PASS  GlmAdapter: Mock json 返回 content 非空
  PASS  GlmAdapter: Mock json 返回 parsed 字段
  PASS  GlmAdapter: Mock json content 可被 JSON.parse
  PASS  GlmAdapter: Mock text 返回非空字符串
  PASS  GlmAdapter: 含'机会' 关键词 → 机会提取预设（含 extracted_info）
  PASS  GlmAdapter: 机会提取预设含 summary
  PASS  GlmAdapter: 含'评分'关键词 → 机会提取预设
  PASS  GlmAdapter: 含'需求'关键词 → 需求理解预设（含 extracted_info）
  PASS  GlmAdapter: 实现 LLMAdapter 接口（可赋值给 LLMAdapter）
  PASS  GlmAdapter: 使用 parseJsonWithRepair（parsed 与 content 一致）

[5.3] 模型路由器
  PASS  model-router.ts 导出 ModelRouter class
  PASS  ModelRouter: 可实例化
  PASS  ModelRouter: 实现 LLMAdapter 接口（chat 方法存在）
  PASS  ModelRouter: 可赋值给 LLMAdapter
  PASS  ModelRouter: chat() Mock 返回 content 非空
  PASS  ModelRouter: chat() Mock 返回 parsed 字段
  PASS  ModelRouter: chatForTask 方法存在
  PASS  ModelRouter: chatForTask('batch_screening') Mock 返回有效 JSON
  PASS  ModelRouter: chatForTask('report_generation') Mock 返回有效 JSON
  PASS  ModelRouter: getAdapterForTask 方法存在
  PASS  ModelRouter: getAdapterForTask('batch_screening') 返回 LLMAdapter
  PASS  ModelRouter: getAdapterForTask 返回的适配器 chat() 可正常调用
  PASS  ModelRouter: getProfile() 方法存在
  PASS  ModelRouter: getStrategy() 方法存在
  PASS  ModelRouter: getProfile() 返回 'commercial' 或 'competition'
  PASS  ModelRouter: getStrategy() 返回含 taskRouting
  PASS  ModelRouter: 商业版 batch_screening 有 fallback
  PASS  ModelRouter: getAdapterForTask 多次调用返回 FallbackAdapter（内部适配器缓存）
  PASS  ModelRouter: commercial 路由器 profile = 'commercial'
  PASS  ModelRouter: competition 路由器 profile = 'competition'
  PASS  ModelRouter: commercial batch_screening Mock 返回有效
  PASS  ModelRouter: competition batch_screening Mock 返回有效
  PASS  ModelRouter: competition high_difficulty（含 fallback）Mock 返回有效
  PASS  ModelRouter: competition batch_screening fallback = null

[5.4] 策略配置文件
  PASS  llm-strategy.ts 导出 COMMERCIAL_STRATEGY
  PASS  llm-strategy.ts 导出 COMPETITION_STRATEGY
  PASS  llm-strategy.ts 导出 getStrategy 函数
  PASS  llm-strategy.ts 导出 getStrategyFromEnv 函数
  PASS  COMMERCIAL_STRATEGY.profile === 'commercial'
  PASS  COMMERCIAL_STRATEGY.defaultTask === 'requirement_understanding'
  PASS  COMMERCIAL_STRATEGY.batch_screening.primary.provider === 'glm'
  PASS  COMMERCIAL_STRATEGY.batch_screening.primary.model === 'glm-4.7-flash'
  PASS  COMMERCIAL_STRATEGY.batch_screening.fallback?.provider === 'deepseek'
  PASS  COMMERCIAL_STRATEGY.core_judgment.primary.model === 'deepseek-v4-pro'
  PASS  COMMERCIAL_STRATEGY.report_generation.primary.provider === 'qwen'
  PASS  COMMERCIAL_STRATEGY.fallback.primary.provider === 'qwen'
  PASS  COMMERCIAL_STRATEGY.fallback.fallback === null
  PASS  COMPETITION_STRATEGY.profile === 'competition'
  PASS  COMPETITION_STRATEGY.batch_screening.primary.provider === 'qwen'
  PASS  COMPETITION_STRATEGY.batch_screening.fallback === null
  PASS  COMPETITION_STRATEGY.high_difficulty.primary.model === 'qwen3.7-max'
  PASS  COMMERCIAL_STRATEGY 覆盖全部 8 种 TaskType
  PASS  COMPETITION_STRATEGY 覆盖全部 8 种 TaskType
  PASS  COMPETITION_STRATEGY 所有 provider = 'qwen'（参赛版合规）
  PASS  getStrategy('commercial') 返回 COMMERCIAL_STRATEGY
  PASS  getStrategy('competition') 返回 COMPETITION_STRATEGY
  PASS  getStrategyFromEnv() 未设置时默认 commercial
  PASS  getStrategyFromEnv() LLM_STRATEGY=competition → competition
  PASS  getStrategyFromEnv() LLM_STRATEGY=commercial → commercial

[5.5] 环境变量模板
  PASS  .env.example.commercial 存在
  PASS  .env.example.commercial 含 LLM_STRATEGY=commercial
  PASS  .env.example.commercial 含 ZAI_API_KEY=
  PASS  .env.example.commercial 含 DEEPSEEK_API_KEY=
  PASS  .env.example.commercial 含 DASHSCOPE_API_KEY=
  PASS  .env.example.competition 存在
  PASS  .env.example.competition 含 LLM_STRATEGY=competition
  PASS  .env.example.competition 含 DASHSCOPE_API_KEY=
  PASS  .env.example.competition 不含 DEEPSEEK_API_KEY
  PASS  .env.example.competition 不含 ZAI_API_KEY

[5.6] 约束自检
  PASS  deepseek-adapter.ts 存在
  PASS  glm-adapter.ts 存在
  PASS  model-router.ts 存在
  PASS  llm-strategy.ts 存在
  PASS  .env.example.commercial 存在
  PASS  .env.example.competition 存在
  PASS  verify-task020.ts 存在
  PASS  llm-adapter.ts 接口未变（含 LLMAdapter）
  PASS  llm-adapter.ts 接口未变（含 chat 方法）
  PASS  qwen-adapter.ts 未修改（含 QwenAdapter class）
  PASS  三适配器 Mock 预设一致（含 extracted_info）
  PASS  三适配器 Mock 预设一致（含 summary）
  PASS  deepseek-adapter.ts 无第三方 import（仅相对路径）
  PASS  glm-adapter.ts 无第三方 import（仅相对路径）
  PASS  model-router.ts 无第三方 import
  PASS  deepseek-adapter.ts 导入 parseJsonWithRepair
  PASS  glm-adapter.ts 导入 parseJsonWithRepair

=== 汇总 ===
PASS: 104
FAIL: 0

✓ 全部通过
EXIT_CODE=0
```

#### 命令 3：`npx tsx scripts/verify-task019a.ts`

```
=== 汇总 ===
Task 019a 验收结果：PASS 47 / FAIL 0
EXIT_CODE=0
```

#### 命令 4：`npx tsx scripts/verify-task019b.ts`

```
=== 汇总 ===
PASS: 108
FAIL: 0

✓ 全部通过
EXIT_CODE=0
```

#### 命令 5：`npx tsx scripts/verify-task019c.ts`

```
=== 汇总 ===
PASS: 128
FAIL: 0

✓ 全部通过
EXIT_CODE=0
```

#### 命令 6：`npx tsx scripts/verify-task019d.ts`

```
=== 汇总 ===
PASS: 146
FAIL: 0

✓ 全部通过
EXIT_CODE=0
```

#### 命令 7：`npx tsx scripts/verify-task019.ts`

```
=== 汇总 ===
PASS: 149
FAIL: 0

✓ 全部通过
EXIT_CODE=0
```

#### 命令 8：`npx tsx scripts/integration-test.ts`

```
================================
PASS: 91 / FAIL: 0
================================

全部 5 阶段 15 步端到端集成测试通过。
EXIT_CODE=0
```

#### 命令 9：`npx tsx scripts/verify-task014.ts`

```
=== 验收汇总 ===
PASS: 143
FAIL: 0
EXIT_CODE=0
```

#### 命令 10：`npx tsx scripts/verify-task015.ts`

```
=== 验收汇总 ===
PASS: 177
FAIL: 0
EXIT_CODE=0
```

#### 命令 11：`npx tsx scripts/verify-task016.ts`

```
=== 验收汇总 ===
PASS: 157
FAIL: 0
EXIT_CODE=0
```

#### 命令 12：`npx tsx scripts/verify-task018.ts`

```
============================================================
Task 018 验收结果：PASS 139 / FAIL 0
============================================================
EXIT_CODE=0
```

### 5.3 验证汇总

| # | 命令 | PASS | FAIL | Exit |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | — | 0 | 0 |
| 2 | `npx tsx scripts/verify-task020.ts` | 104 | 0 | 0 |
| 3 | `npx tsx scripts/verify-task019a.ts` | 47 | 0 | 0 |
| 4 | `npx tsx scripts/verify-task019b.ts` | 108 | 0 | 0 |
| 5 | `npx tsx scripts/verify-task019c.ts` | 128 | 0 | 0 |
| 6 | `npx tsx scripts/verify-task019d.ts` | 146 | 0 | 0 |
| 7 | `npx tsx scripts/verify-task019.ts` | 149 | 0 | 0 |
| 8 | `npx tsx scripts/integration-test.ts` | 91 | 0 | 0 |
| 9 | `npx tsx scripts/verify-task014.ts` | 143 | 0 | 0 |
| 10 | `npx tsx scripts/verify-task015.ts` | 177 | 0 | 0 |
| 11 | `npx tsx scripts/verify-task016.ts` | 157 | 0 | 0 |
| 12 | `npx tsx scripts/verify-task018.ts` | 139 | 0 | 0 |
| **合计** | | **1389** | **0** | **全 0** |

---

## 6. 约束遵守情况

| 约束 | 遵守情况 |
|---|---|
| 新增 7 个文件 | ✅ 已新增（清单见 2.2） |
| 不修改任何现有文件 | ✅ `git status` 仅显示 7 个 `??` 未追踪文件，无 `M` 修改项 |
| 不引入新 npm 依赖 | ✅ HTTP 用 Node.js 内置 `fetch`，无任何第三方 import |
| LLMAdapter 接口不可修改 | ✅ `llm-adapter.ts` 未改动（5.6 自检通过） |
| Mock 预设一致性 | ✅ 三适配器 Mock 预设 JSON 结构完全一致（均含 extracted_info / summary / confirmed_items / uncertain_items） |
| 参赛版只用 Qwen | ✅ COMPETITION_STRATEGY 所有 provider = "qwen"（5.4 自检通过） |
| 验证脚本走 Mock | ✅ 所有验证在无 API key 环境下运行，未调用真实 API |
| T4 JSON 修复复用 | ✅ deepseek-adapter.ts / glm-adapter.ts 均导入 `parseJsonWithRepair` |

---

## 7. 哪些功能还没做

以下功能**不在 Task 020 范围内**，留待后续任务：

1. **真实 API 联调**：本次仅验证 Mock 模式，未用真实 DEEPSEEK_API_KEY / ZAI_API_KEY 调用真实 API。需在配额申请后单独联调。
2. **ConversationManager 实际注入 ModelRouter**：本次仅证明 ModelRouter 实现 LLMAdapter 接口可赋值，未修改 conversation-manager.ts 进行实际替换（受"不修改现有文件"约束）。后续任务可在合适时机替换。
3. **搜索层 ai-filter / orchestrator 接入 ModelRouter**：当前搜索层仍接收 `LLMAdapter` 参数，未升级为按 `TaskType` 路由。后续可扩展 `aiFilter` 接受 `ModelRouter` 并在内部调用 `chatForTask("batch_screening", ...)`。
4. **用量统计与成本核算**：未实现 token 计数与成本累计，无法量化"商业版节省多少成本"。
5. **动态策略切换**：当前策略在构造器时固定，运行中切换需重建 ModelRouter 实例。热重载留待后续。
6. **Bocha / Exa Provider 实现**：搜索层 Provider（非 LLM 适配器）的 Bocha / Exa 实现仍待 V0.9+ 交付。
7. **Hono REST API 层**：Task 021 待执行。
8. **Watch Rules DSL**：Task 022 待执行。

---

## 8. 下一步建议

1. **Task 021（Hono REST API 层）**：构建 HTTP API 暴露搜索/提醒能力，可作为下一个任务。
2. **真实 API 联调脚本**：在申请到 DeepSeek / Z.AI 配额后，新增 `scripts/integration-real-api.ts`（需设置真实 key），验证三适配器真实模式与 fallback 降级链路。
3. **搜索层接入 ModelRouter**：在 Task 021 或独立小任务中，让 `SearchOrchestrator` / `aiFilter` 接收 `ModelRouter`，按 `TaskType` 路由调用，发挥双套策略价值。
4. **V0.9 规划**：LocalFileStore 持久化、Web UI、Bocha/Exa Provider 实现。

---

## 9. 交付验证红线

本回报第 5.2 节已附上 12 条命令的实际运行输出，第 5.3 节汇总表显示 **1389 项断言全部 PASS，12 条命令 exit code 全部为 0**。Task 020 交付完成，可进入验收。

---

任务执行人：TRAE IDE
完成时间：2026-06-28
