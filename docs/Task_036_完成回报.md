# Task 036 完成回报：Demo 数据模式与 LLM Mock 定义

**任务类型**：数据基础设施
**版本**：V1.1 单雷达最小闭环版
**完成日期**：2026-06-29
**前置任务**：Task 035（已验收通过）

---

## 一、修改了哪些文件

### 1. `src/search/orchestrator.ts`（F6 数据模式集成）
- 新增 import：`DataMode` 类型 + `loadDemoSearchResults` 加载器
- `SearchOrchestratorConfig` 新增 `dataMode?: DataMode` 配置项（默认 "live"，保护现有测试）
- `SearchOrchestrator` 类新增 `private readonly dataMode: DataMode` 成员
- `search()` 方法重构：根据 `dataMode` 选择数据源
  - `mock`/`recorded`：调用 `loadDemoSearchResults()` 加载 Demo 数据，跳过真实搜索 Provider
  - `live`（默认）：保持原有逻辑，调用真实搜索 Provider
- 三层筛选（ruleFilter → aiFilter → scoreOpportunities）逻辑不变，Demo 数据也走完整三层筛选

### 2. `src/agents/model-router.ts`（F7 LLM 模式集成）
- 新增 import：`getLlmMode` + `MockLlmAdapter`
- 新增 `createAdapter()` 工厂函数（文件末尾）
  - `LLM_MODE=mock`（默认）：返回 `MockLlmAdapter` 实例
  - `LLM_MODE=live`：返回 `ModelRouter` 实例（现有真实路由器）
- 不修改现有 `ModelRouter` 类，保持向后兼容

### 3. `.env.example`（环境变量模板）
- 顶部新增 `DATA_MODE=mock` + `LLM_MODE=mock` 配置项
- 含详细注释说明三种数据模式（mock/recorded/live）和两种 LLM 模式（mock/live）

### 4. `package.json`（脚本注册）
- `scripts` 新增 `"verify:task036": "tsx scripts/verify-task036.ts"`

---

## 二、新增了哪些文件

### 1. `src/demo/data-mode.ts`（F1 模式切换逻辑）
- `DataMode` 类型：`"mock" | "recorded" | "live"`
- `LlmMode` 类型：`"mock" | "live"`
- `getDataMode()` / `getLlmMode()`：从环境变量读取模式，默认 mock
- `isMockData()` / `isRecordedData()` / `isLiveData()`：数据模式判断
- `isMockLlm()` / `isLiveLlm()`：LLM 模式判断

### 2. `src/demo/ai-events.mock.json`（F3 Mock 数据）
- 5 条预设 AI 赛事机会，覆盖 S/A/B/C 四个等级
- 含 `deadline_status` 字段：4 条 `confirmed` + 1 条 `rolling`
- 每条含 title/url/snippet/page_content/deadline/reward/organizer/eligibility/expected_level

### 3. `src/demo/ai-events.recorded.json`（F4 Recorded 数据）
- 5 条真实搜索结果录制（V1.1 阶段用 Mock 数据填充，标注 `mode: "recorded"`）
- 每条含来源字段：`recorded_at` / `query` / `provider` / `original_url` / `snapshot_note` / `verified_by` / `verification_status`

### 4. `src/demo/llm-responses.mock.json`（F5 Mock LLM 响应）
- `requirement_confirmation.confirmation_card`：7 维度置信度
  - client_identity / business_goal / opportunity_type / region_scope / exclusion_rules / action_scenario / report_format
  - `total_confidence: 95`
- `ai_filter.results`：5 条精筛结果（3 relevant + 2 not relevant）

### 5. `src/demo/index.ts`（F5 Demo 数据加载器）
- `DemoOpportunity` 接口：Mock/Recorded 通用格式 + Recorded 额外字段
- `loadDemoData(radarType, mode)`：加载 Demo 数据文件
- `loadMockLlmResponses()`：加载 Mock LLM 响应
- `toSearchResult(opp)`：DemoOpportunity → SearchResult 转换
- `loadDemoSearchResults(radarType, mode)`：加载并转换为 SearchResult[]（供 SearchOrchestrator 使用）
- `loadDemoOpportunities(radarType, mode)`：加载完整机会列表

### 6. `src/demo/mock-llm-adapter.ts`（F5 Mock LLM 适配器）
- `MockLlmAdapter` 类实现 `LLMAdapter` 接口
- `chat(request)` 方法根据消息内容匹配预设响应：
  - 含"确认"/"confirmation" → 返回确认卡 JSON
  - 含"精筛"/"filter"/"相关" → 返回精筛结果 JSON
  - 默认 → 返回通用 Mock 响应

### 7. `scripts/verify-task036.ts`（F8 验证脚本）
- 18 项验收（T1-T18）
- 覆盖文件存在性、模式切换逻辑、数据质量、回归测试

---

## 三、如何本地运行

### 3.1 默认 Mock 模式（最稳定）

```bash
# 不设置环境变量，默认 DATA_MODE=mock + LLM_MODE=mock
npm run dev
```

### 3.2 Recorded 模式（固定真实数据回放）

```bash
# Windows PowerShell
$env:DATA_MODE="recorded"; $env:LLM_MODE="mock"; npm run dev
```

### 3.3 Live 模式（真实搜索，V1.4 启用）

```bash
$env:DATA_MODE="live"; $env:LLM_MODE="live"; npm run dev
```

---

## 四、如何测试

### 4.1 预检查（tsc + 硬编码检查）

```bash
npm run precheck
```

### 4.2 Task 036 验收脚本（18 项 T1-T18）

```bash
npm run verify:task036
```

### 4.3 Task 034 回归测试

```bash
npm run verify:task034
```

---

## 五、哪些功能还没做

1. **Live Mode 真实搜索**：仅预留接口，V1.4 实现
2. **E2E 核心脚本**：Task 037 实现
3. **Web UI 开发**：Task 038 实现
4. **OPC 政策 / 文创非遗雷达数据**：V1.2 实现
5. **评分逻辑修改 / 评分校准**：V1.4 实现
6. **行为状态/反馈评价字段**：Task 039 实现
7. **Recorded 真实录制**：V1.1 阶段用 Mock 数据填充，V1.4 替换为真实录制

---

## 六、下一步建议

1. **Task 037：E2E 核心脚本** - 在 Mock 数据 + Mock LLM 稳定数据上验证端到端闭环
2. **Task 038：Web UI 开发** - 基于 Demo 数据展示机会列表
3. 提交 Task 036 代码到 Git 保留

---

## 七、运行输出

### 7.1 precheck（tsc + check:no-hardcode）

```
$ npx.cmd tsx scripts/precheck.ts
============================================================
precheck：tsc + 硬编码复检
============================================================
[T1] tsc --noEmit ... OK
[T2] check:no-hardcode ... OK
============================================================
precheck 全部通过
============================================================
exit 0
```

### 7.2 verify:task036（18 项验收）

```
$ npx.cmd tsx scripts/verify-task036.ts
====================================
Task 036 验收脚本
Demo 数据模式与 LLM Mock 定义
====================================

[验收 1] T3-T7: 文件存在性检查
  PASS  T3: src/demo/data-mode.ts 存在
  PASS  T3: data-mode.ts 含 DataMode 类型
  PASS  T3: data-mode.ts 含 LlmMode 类型
  PASS  T3: data-mode.ts 含 getDataMode 函数
  PASS  T3: data-mode.ts 含 getLlmMode 函数
  PASS  T4: src/demo/ai-events.mock.json 存在
  PASS  T4: Mock 数据含 5 条机会
  PASS  T5: src/demo/ai-events.recorded.json 存在
  PASS  T5: Recorded 数据含 5 条机会
  PASS  T6: src/demo/llm-responses.mock.json 存在
  PASS  T6: 含 requirement_confirmation
  PASS  T6: 含 ai_filter
  PASS  T7: src/demo/mock-llm-adapter.ts 存在
  PASS  T7: 含 MockLlmAdapter 类
  PASS  T7: 实现 LLMAdapter 接口

[验收 2] T8-T10: 模式切换逻辑
  PASS  T8: DATA_MODE=mock 时 getDataMode() === 'mock'
  PASS  T8: DATA_MODE=mock 时 isMockData() === true
  PASS  T8: loadDemoOpportunities(mode=mock) 返回 5 条
  PASS  T8: Mock 数据首条标题正确
  PASS  T9: DATA_MODE=recorded 时 getDataMode() === 'recorded'
  PASS  T9: DATA_MODE=recorded 时 isRecordedData() === true
  PASS  T9: loadDemoOpportunities(mode=recorded) 返回 5 条
  PASS  T9: Recorded 数据首条标题含'录制'标记
  PASS  T10: LLM_MODE=mock 时 getLlmMode() === 'mock'
  PASS  T10: LLM_MODE=mock 时 isMockLlm() === true
  PASS  T10: createAdapter() 返回 MockLlmAdapter 实例

[验收 3] T11-T13: Mock 数据质量
  PASS  T11: 每条机会含 title/url/snippet/deadline_status
  PASS  T12: 含 S 级
  PASS  T12: 含 A 级
  PASS  T12: 含 B 级
  PASS  T12: 含 C 级
  PASS  T12: 覆盖 S/A/B/C 四个等级（实际 4 个）
  PASS  T13: 含 confirmed 状态
  PASS  T13: 含 rolling 状态
  PASS  T13: 至少含 confirmed + rolling（实际 2 个）

[验收 4] T14: Recorded 数据来源字段
  PASS  T14: 每条 Recorded 数据含 recorded_at/query/provider/verification_status

[验收 5] T15: Mock LLM 响应完整性
  PASS  T15: 确认卡含 dimensions 字段
  PASS  T15: 确认卡含 7 维度置信度（client_identity 等）
  PASS  T15: 精筛含 5 条结果
  PASS  T15: 精筛含 relevant(3) + not relevant(2)
  PASS  T15: MockLlmAdapter 实例含 chat 方法

[验收 6] T16: package.json 脚本（verify:task036）
  PASS  T16: package.json 含 verify:task036 脚本
  PASS  T16: verify:task036 指向 verify-task036.ts
  PASS  T16: scripts/verify-task036.ts 文件存在

[验收 7] T1: tsc 编译（npx tsc --noEmit）
  运行中... (可能需要 10-30 秒)
  PASS  T1: npx tsc --noEmit exit 0

[验收 8] T2/T18: precheck（npm run precheck）
  运行中... (可能需要 20-60 秒)
  PASS  T2: npm run precheck exit 0
  PASS  T18: precheck exit 0（与 T2 合并）

[验收 9] T17: verify-task034 回归（100 PASS / 0 FAIL）
  运行中... (可能需要 60-120 秒)
  PASS  T17: verify-task034 exit 0
  PASS  T17: verify-task034 PASS >= 100
  PASS  T17: verify-task034 FAIL === 0

====================================
验收汇总
====================================
  PASS:  49
  FAIL:  0
====================================
exit 0
```

### 7.3 完成标志核对

- [x] `npm run precheck` exit 0
- [x] `npm run verify:task036` 全部 PASS（49 PASS / 0 FAIL）
- [x] `npm run verify:task034` 100 PASS / 0 FAIL（回归）
- [x] `DATA_MODE=mock + LLM_MODE=mock` 时加载 Mock 数据 + Mock LLM
- [x] `DATA_MODE=recorded + LLM_MODE=mock` 时加载 Recorded 数据 + Mock LLM
- [x] Mock 数据覆盖 S/A/B/C 不同等级
- [x] Mock 数据覆盖 deadline_status（confirmed + rolling）
- [x] Recorded 数据含来源字段（recorded_at/query/provider/verification_status）
- [x] Mock LLM 响应含 7 维度确认卡 + 5 条精筛结果

---

## 八、文件结构

```
src/demo/
├── data-mode.ts                  # 数据模式 + LLM 模式切换逻辑（F1）
├── index.ts                      # Demo 数据加载器（F5）
├── mock-llm-adapter.ts           # Mock LLM 适配器（F5）
├── ai-events.mock.json           # AI 赛事 Mock 数据（F3）
├── ai-events.recorded.json       # AI 赛事 Recorded 数据（F4）
└── llm-responses.mock.json       # Mock LLM 响应（F5）

src/search/
└── orchestrator.ts               # 搜索编排器（F6 修改）

src/agents/
└── model-router.ts               # 模型路由器（F7 修改，新增 createAdapter()）

scripts/
└── verify-task036.ts             # 验证脚本（F8）
```
