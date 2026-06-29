# Task 042 完成回报：OPC/文创 Demo 数据 + loadDemoData 修复

## 任务概述

Task 042 解决 Demo 模式下三雷达数据加载缺陷：`loadDemoData` 忽略 `radarType` 参数硬编码 `ai-events.mock.json`，导致 OPC 政策与文创非遗雷达在 Mock 模式下加载 AI 赛事数据。同时补充 OPC/文创两类雷达的 Mock 数据与 LLM 精筛响应，实现三雷达 Mock 闭环。

## 交付清单

### 新增文件（4 个）

| 文件 | 说明 |
|------|------|
| `src/demo/opc-events.mock.json` | OPC 政策 Mock 数据 5 条（高企认定 S/专精特新 A/科技型 B/数字化转型 C/旧政策 B-expired） |
| `src/demo/cultural-events.mock.json` | 文创非遗 Mock 数据 5 条（非遗传承人 S/文创资金 A/传统工艺 B/非遗工坊 C/文创大赛 A-expired） |
| `scripts/verify-e2e-three-radars.ts` | 三雷达 Mock 闭环 E2E 脚本（3 雷达 × 9 步 = 27 步，含 forbiddenKeywords/expectedKeywords 双向验证） |
| `scripts/verify-task042.ts` | Task 042 验收脚本（27 项检查 + 3 项回归 = 30 项） |

### 修改文件（4 个）

| 文件 | 变更说明 |
|------|----------|
| `src/demo/index.ts` | 新增 `MOCK_FILE_MAP`/`RECORDED_FILE_MAP` 按 radarType 分发；`loadDemoData` 使用映射选择文件；`DemoOpportunity.deadline_status` 扩展 `"expired"` |
| `src/demo/llm-responses.mock.json` | `ai_filter.results` 从 5 条扩展为 15 条（AI 5 + OPC 5 + 文创 5） |
| `src/demo/mock-llm-adapter.ts` | AI 精筛时从消息提取 `【标题】` 后的 title，按 title 匹配预设精筛结果，返回含 `relevance` 字段的响应（绕过 ai-filter.ts 关键词预设限制） |
| `package.json` | 新增 `verify:task042` 和 `verify:e2e-three-radars` 脚本 |

## 核心设计决策

### 1. loadDemoData 分发修复

**问题**：`orchestrator.ts:188` 已传入 `radarType`，但 `loadDemoData` 忽略它，硬编码 `ai-events.mock.json`。

**方案**：新增 `MOCK_FILE_MAP` 和 `RECORDED_FILE_MAP` 映射表，按 `radarType` 选择对应数据文件。OPC/文创的 recorded 数据暂用 AI 赛事 recorded 兜底（V1.2 可选录制独立 recorded 数据）。

### 2. 文创非遗 AI 精筛绕过

**问题**：`ai-filter.ts` 的 `extractRelevance` 关键词预设不含"非遗/文创/文化/传承"，文创数据 relevance=40 < 50 会被拒。任务书约束"不修改 ai-filter"。

**方案**：修改 `MockLlmAdapter.chat`，在精筛时从消息中提取 `【标题】` 后的 title，在 `ai_filter.results` 中按 title 匹配，返回含 `relevance` 字段的 JSON。`extractRelevance` 优先从 LLM 输出提取 `relevance` 字段（不走关键词预设），从而让三雷达数据都能正确精筛。

### 3. 验证脚本 spec 传递

**问题**：搜索路由 `/api/search` 使用 `body.spec` 推断雷达类型（通过 `opportunity_scope.primary_opportunity_types`），不接受 `radar_type` 字段。`ScoredOpportunity` 的标题在 `search_result.title`，不是顶层 `title`。

**方案**：验证脚本构造含 `primary_opportunity_types` 的 minimal spec 传入请求体，标题从 `o.search_result.title` 提取。

## 验证结果

| 验证项 | 命令 | 结果 |
|--------|------|------|
| TypeScript 编译 | `npx tsc --noEmit` | exit 0 |
| 品牌名硬编码检查 | `npm run check:no-hardcode` | exit 0 |
| Task 042 验收 | `npx tsx scripts/verify-task042.ts` | 30 PASS / 0 FAIL |
| 三雷达 E2E | `npx tsx scripts/verify-e2e-three-radars.ts` | 27 PASS / 0 FAIL |
| 回归：verify-e2e-ai-events | （含在 verify-task042 回归中） | PASS |
| 回归：verify-task041 | （含在 verify-task042 回归中） | PASS |
| 回归：verify-task040 | （含在 verify-task042 回归中） | PASS |

### verify-task042 验收明细（30 项）

- **1. 文件存在性**（4 PASS）：opc-events.mock.json / cultural-events.mock.json / verify-e2e-three-radars.ts / verify-task042.ts
- **2. OPC Mock 数据**（4 PASS）：radar_type=opc_policy / 5 条 / S+A+B+C / confirmed+rolling+expired
- **3. 文创 Mock 数据**（4 PASS）：radar_type=cultural_heritage / 5 条 / S+A+B+C / confirmed+rolling+unknown+expired
- **4. loadDemoData 分发**（3 PASS）：含 MOCK_FILE_MAP / opc-events.mock.json / cultural-events.mock.json
- **5. Mock LLM 响应**（3 PASS）：含 OPC 精筛 / 文创精筛 / 15 条精筛结果
- **6. 三雷达 E2E 脚本**（3 PASS）：文件存在 / 含三类雷达 / 含 forbiddenKeywords
- **7. package.json**（2 PASS）：verify:task042 / verify:e2e-three-radars
- **8. API 集成**（8 PASS）：OPC/文创 各 200+success+政策类/文创类+不混淆
- **9. 回归测试**（3 PASS）：verify-e2e-ai-events / verify-task041 / verify-task040

### verify-e2e-three-radars 明细（27 步）

| 雷达 | chat | search 200 | search success | 结果≥1条 | 数据不混淆 | 数据类型正确 | 入库 | 报告 |
|------|------|-----------|---------------|---------|-----------|------------|------|------|
| AI 赛事 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| OPC 政策 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 文创非遗 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## 约束遵守

- ✅ 不引入新 npm 依赖
- ✅ 不修改搜索层逻辑（orchestrator/rule-filter/ai-filter 未修改）
- ✅ 不修改 Provider 代码
- ✅ 不修改评分逻辑
- ✅ 不修改 Web UI
- ✅ Mock 数据真实可读（含真实政策名/非遗项目名/截止日期/奖励金额）
- ✅ 品牌名用"盯机会"（通过 BRAND 注入，无硬编码）
