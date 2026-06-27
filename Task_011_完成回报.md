# Task 011｜雷达方案校验与导出 — 完成回报

任务编号：Task 011
所属版本：V0.3（雷达方案校验与导出，最后一个 Task）
完成时间：2026-06-27
执行环境：TRAE IDE / Node.js v22.16.0 / TypeScript

---

## 1. 修改了哪些文件

无（本任务为新建模块，未修改任何已有文件）。

## 2. 新增了哪些文件

| 文件路径 | 用途 |
|---|---|
| `src/agents/radar-plan-validator.ts` | 雷达方案校验器，导出 `validateRadarPlan()` 函数。校验雷达方案的 8 章节结构完整性 + 缺失项检测（critical/warning/info 三级）+ 需人工复核项 + 品牌合规，产出校验报告 Markdown。 |
| `src/agents/radar-plan-exporter.ts` | 雷达方案导出器，导出 `exportRadarPlan()` 函数。把雷达方案和校验报告 Markdown 写入 `exports/` 目录，文件名含雷达类型和时间戳。 |
| `scripts/verify-task011.ts` | 验证脚本，覆盖验收标准 5.1-5.7 + V0.3 汇总验收清单，共 74 个测试用例。 |

## 3. 如何本地运行

### 3.1 TypeScript 编译检查

```bash
npx tsc --noEmit
```

预期输出：无任何输出，exit code 0（表示无类型错误）。

### 3.2 验证脚本运行

```bash
npx tsx scripts/verify-task011.ts
```

预期输出：74 个 PASS / 0 个 FAIL，exit code 0。

## 4. 如何测试（完整运行输出）

### 4.1 `npx tsc --noEmit` 实际输出

```
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping [0:2] > trae-sandbox 'npx.cmd tsc --noEmit'
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping [0:0] $
```

exit code = 0，无任何 TypeScript 错误输出。

> 注：初次编译时有 2 个 TypeScript 错误（TS2561: `question_id` 不存在于 `QuestionToConfirm`；TS2345: `boolean | undefined` 不可赋值给 `boolean`），已修复后重新编译通过。修复详情见第 5 节。

### 4.2 `npx tsx scripts/verify-task011.ts` 完整实际输出

> 注：TRAE IDE 终端为 GBK 编码，UTF-8 中文字符在控制台显示为 mojibake，但测试结果（PASS/FAIL 计数和英文部分）完全正确。以下将 mojibake 还原为正确的 UTF-8 中文。

```
=== Task 011 验收检查 ===

[验收 5.1] 校验功能 - 结构完整性

  PASS  完整方案 → sections_complete=true
  PASS  完整方案 → missing_sections=[]
  PASS  完整方案 → sections_count=8
  PASS  完整方案 → sections_expected=8
  PASS  空方案 → valid=false
  PASS  空方案 → sections_complete=false
  PASS  空方案 → sections_count=0
  PASS  空方案 → missing_sections 非空

[验收 5.2] 校验功能 - 缺失项检测

  PASS  完整 Spec → critical_count=0
  PASS  空 Spec → critical_count>0
  PASS  client_type 缺失 → critical 项含 'client_type'
  PASS  primary_goal 缺失 → critical 项含 'primary_goal'
  PASS  primary_opportunity_types 缺失 → critical 项
  PASS  primary_regions 缺失 → critical 项
  PASS  core_keywords_zh 缺失 → critical 项
  PASS  industry 缺失 → warning 项
  PASS  success_definition 缺失 → warning 项
  PASS  notes 缺失 → info 项

[验收 5.3] 校验功能 - 需人工复核项

  PASS  filter_rules 复核项 → manual_review_items 含对应项
  PASS  filter_rules 复核项 → source 含 'filter_rules'
  PASS  questions_to_confirm 复核项 → manual_review_items 含对应项
  PASS  questions_to_confirm 复核项 → source 含 'questions_to_confirm'
  PASS  source_strategy 空值 → manual_review_items 含提示项
  PASS  无 filter_rules + questions_to_confirm 复核项 → 非 source_strategy 项为 0

[验收 5.4] 校验功能 - 品牌合规

  PASS  标题含品牌名 → has_product_name=true
  PASS  标题含版本号 → has_version=true
  PASS  标题含雷达名称 → has_radar_name=true
  PASS  ai_competition → has_radar_name=true
  PASS  opc_policy → has_radar_name=true
  PASS  cultural_heritage → has_radar_name=true

[验收 5.5] 校验报告 Markdown 结构

  PASS  标题含 BRAND.product_name
  PASS  含 '校验结果：'
  PASS  含 '## 1. 结构完整性'
  PASS  含 '## 2. 缺失项检测'
  PASS  含 '### 严重缺失'
  PASS  含 '### 警告缺失'
  PASS  含 '### 提示缺失'
  PASS  含 '## 3. 需人工复核项'
  PASS  含 '## 4. 品牌合规'
  PASS  含 '## 5. 汇总'
  PASS  含 '校验结论：'

[验收 5.6] 导出功能

  PASS  导出成功 → success=true
  PASS  导出成功 → plan_file_path 非空
  PASS  导出成功 → report_file_path 非空
  PASS  方案文件存在 → fs.existsSync=true
  PASS  报告文件存在 → fs.existsSync=true
  PASS  方案文件含 BRAND.product_name
  PASS  方案文件名含 'ai-competition'
  PASS  报告文件名含 'ai-competition'
  PASS  方案文件名含时间戳 '20260627-223000'
  PASS  报告文件名含时间戳 '20260627-223000'
  PASS  方案文件名前缀 'radar-plan-'
  PASS  报告文件名前缀 'validation-report-'
  PASS  导出目录自动创建 → success=true
  PASS  导出目录自动创建 → 目录存在
  PASS  空内容拒绝 → success=false
  PASS  空内容拒绝 → error 非空
  PASS  空报告内容拒绝 → success=false

[验收 5.7] 编译与引用

  PASS  BRAND.product_name 已引用
  PASS  MUST_INCLUDE_SECTIONS 已引用（9 项）
  PASS  OPPORTUNITY_CARD_REQUIRED_FIELDS 已引用（14 项）
  PASS  RadarPlanResult 类型通过 import 引用
  PASS  RadarRequirementSpec 类型通过 import 引用
  PASS  createDefaultSpec 通过 import 引用
  PASS  validateRadarPlan 不重复实现 validateSpec
  PASS  src/agents/radar-plan-validator.ts 已创建
  PASS  src/agents/radar-plan-exporter.ts 已创建
  PASS  scripts/verify-task011.ts 已创建

=== V0.3 汇总验收清单（逐项自检） ===

  PASS  [✓] 雷达方案 8 项齐全，内容均来自 Spec 对应字段
  PASS  [✓] 仅在确认度 ≥95% 时生成正式方案
  PASS  [✓] 导出 Markdown 含品牌标题前缀
  PASS  [✓] 校验报告能标注缺失项（critical/warning/info）
  PASS  [✓] 校验报告能标注需人工复核项
  PASS  [✓] V0.3 验收清单 5 项全部通过

========================================
总计：PASS 74 / FAIL 0
========================================
```

exit code = 0。

## 5. TypeScript 错误修复说明

初次 `npx tsc --noEmit` 报 2 个错误，已修复：

### 错误 1：TS2561 - `question_id` 不存在于 `QuestionToConfirm`

**原因**：验证脚本中构造 `questions_to_confirm` 测试数据时，使用了错误的字段名 `question_id` 和 `field_path`。

**修复**：查 `QuestionToConfirm` 接口定义（`src/schema/radar-requirement-spec.ts` 第 201-206 行），正确字段为 `question` / `why_it_matters` / `related_field` / `priority`。修正测试数据：

```typescript
// 修复前
spec2.questions_to_confirm = [
  { question_id: "q1", question: "是否接受海外机会？", priority: "high", field_path: "region_scope.overseas_allowed" },
];

// 修复后
spec2.questions_to_confirm = [
  { question: "是否接受海外机会？", why_it_matters: "影响地域筛选范围", related_field: "region_scope.overseas_allowed", priority: "high" },
];
```

### 错误 2：TS2345 - `boolean | undefined` 不可赋值给 `boolean`

**原因**：`planResult.markdown?.split("\n")[0].includes(BRAND.product_name)` 中，`?.` 可选链使整个表达式返回 `boolean | undefined`，而 `check()` 函数的 `cond` 参数要求 `boolean`。

**修复**：用 `?? ""` 提供默认空字符串，消除 `undefined`：

```typescript
// 修复前
check("[✓] 导出 Markdown 含品牌标题前缀",
  planResult.markdown?.split("\n")[0].includes(BRAND.product_name));

// 修复后
check("[✓] 导出 Markdown 含品牌标题前缀",
  (planResult.markdown ?? "").split("\n")[0].includes(BRAND.product_name));
```

修复后重新编译，exit code = 0，无错误。

## 6. 哪些功能还没做

- **雷达报告生成（V0.4）**：含 S/A/B/C 机会卡片 + 行动建议的周报不在本任务范围内。
- **机会卡片生成（V0.4）**：本任务不产出任何 OpportunityCard。
- **搜索 API 接入（V0.8）**：本任务的 `source_strategy` 空值仅标注为提示项，不实际接入搜索源。
- **Spec 持久化存储（V1.0+）**：本任务只导出 Markdown 文件，不涉及数据库存储。
- **前端 UI 渲染（V0.9）**：本任务不渲染 UI。
- **PDF/Word 导出（V1.0+）**：MVP 仅做 Markdown 导出。
- **LLM 调用**：本任务是纯规则校验，不接入 LLM。

## 7. 下一步建议

基于本次产出，V0.3 验收清单 5 项已全部通过。建议下一步：

1. **V0.3 端到端集成测试**：将 Task 007（对话管理）→ Task 008（确认卡生成）→ Task 009（Spec 编译）→ Task 010（雷达方案生成）→ Task 011（校验与导出）串联，跑通完整链路："3 轮对话 → 93 分确认卡 V0.1 → 用户确认 → 95 分 V1.0 → Spec 编译 → validateSpec 通过 → 雷达方案 V1.0 生成 → 校验报告 → 导出 Markdown 文件"。
2. **V0.4 雷达报告生成器**：基于 Task 010 的雷达方案，生成首版雷达报告（含 S/A/B/C 机会卡片 + 行动建议），复用 Task 003-005 的样板报告格式。
3. **V0.8 搜索层接入**：填充 `source_strategy` 的实际数据源（官方站点、平台、搜索引擎、社交媒体、RSS 源），让雷达方案中的数据源策略章节有实际内容。

## 8. V0.3 验收清单（逐项自检结果）

| 验收项 | 覆盖任务 | 结果 |
|---|---|---|
| 雷达方案 8 项齐全，内容均来自 Spec 对应字段 | Task 010 ✅ | PASS |
| 仅在确认度 ≥95% 时生成正式方案 | Task 010 ✅ | PASS |
| 导出 Markdown 含品牌标题前缀 | Task 010 ✅ + Task 011 ✅ | PASS |
| 校验报告能标注缺失项与需人工复核项 | Task 011 ✅ | PASS |
| V0.3 验收清单 5 项全部通过 | Task 011 汇总 ✅ | PASS |

**V0.3 雷达方案生成器 MVP 至此全部完成**（Task 010-011）。

## 9. 核心设计说明

### 9.1 校验器与已有校验的区别

| 校验工具 | 校验对象 | 位置 | 本任务 |
|---|---|---|---|
| `validateSpec` | Spec JSON 结构合法性 | `src/utils/validators.ts` | ❌ 不重复实现 |
| `validateConfidence` | 确认度 7 维度计算正确性 | `src/utils/validators.ts` | ❌ 不重复实现 |
| `validateOpportunityCard` | 机会卡片字段完整性 | `src/utils/validators.ts` | ❌ 不重复实现 |
| **`validateRadarPlan`** | **雷达方案 Markdown 完整性 + 缺失项 + 复核项** | **本任务新建** | **✅** |

`validateRadarPlan` 不重新校验 Spec 结构（那是 `validateSpec` 的职责），而是校验雷达方案的**可执行性**——哪些关键字段缺失会影响雷达运行，哪些项需要人工复核。

### 9.2 缺失项分级标准

| 级别 | 定义 | 字段示例 | 影响 |
|---|---|---|---|
| critical | 雷达核心字段缺失，无法有效执行 | client_type, primary_goal, primary_opportunity_types, primary_regions, core_keywords_zh | 雷达无法启动 |
| warning | 影响执行质量但不致命 | industry, business_type, success_definition, action_intent, must_include, must_exclude | 执行质量下降 |
| info | 可选字段，缺失不影响执行 | notes, secondary_opportunity_types, nice_to_have_conditions, current_assets, target_users | 完善度不足 |

### 9.3 需人工复核项来源

| 来源 | Spec 字段 | 处理方式 |
|---|---|---|
| 筛选规则 | `filter_rules.requires_manual_review` | 每项作为一个 manual_review_item，source="filter_rules" |
| 待确认问题 | `questions_to_confirm` | 每项作为一个 manual_review_item，source="questions_to_confirm" |
| 数据源策略 | `source_strategy.official_sites` 等为空 | 生成 1 个提示项，source="source_strategy"，标注「数据源未配置，V0.4+ 消费」 |

### 9.4 校验结果判定

| 结果 | 条件 | 含义 |
|---|---|---|
| PASS（通过） | valid=true，critical=0，warning=0 | 方案完整可执行 |
| WARN（有警告） | valid=true，critical=0，warning>0 | 方案可执行但有字段缺失 |
| FAIL（不通过） | valid=false，critical>0 或结构不完整 | 方案有严重缺失，需补充 |

### 9.5 导出文件名规范

```
exports/
  ├── radar-plan-ai-competition-20260627-223000.md
  ├── validation-report-ai-competition-20260627-223000.md
  ├── radar-plan-opc-policy-20260627-223000.md
  └── validation-report-opc-policy-20260627-223000.md
```

- 文件名格式：`{type}-{radar_type}-{YYYYMMDD-HHmmss}.md`
- radar_type 用下划线转连字符：`ai_competition` → `ai-competition`
- 时间戳从 `generated_at`（ISO 字符串）提取（UTC 时间）

### 9.6 引用的常量与类型（不硬编码、不重复实现）

| 引用项 | 来源 |
|---|---|
| `BRAND.product_name` | `src/brand/constants.ts` |
| `RadarPlanResult` 类型 | `src/agents/radar-plan-generator.ts`（通过 import type 引用） |
| `RadarRequirementSpec` 类型 | `src/schema/radar-requirement-spec.ts`（通过 import type 引用） |
| `createDefaultSpec()` | `src/schema/radar-requirement-spec.ts`（验证脚本引用，构造空 Spec） |
| `MUST_INCLUDE_SECTIONS` / `OPPORTUNITY_CARD_REQUIRED_FIELDS` | `src/schema/radar-requirement-spec.ts`（验证脚本引用） |
| `generateRadarPlan()` | `src/agents/radar-plan-generator.ts`（验证脚本引用，生成测试方案） |

### 9.7 V0.0–V0.3 完整链路

```
用户输入
  ↓
多轮追问（Task 007）
  ↓
确认度计算（Task 006）
  ↓
确认卡生成（Task 008，≥90%）
  ↓
用户确认
  ↓
Spec 编译（Task 009，≥90% + confirmed）
  ↓
雷达方案生成（Task 010，≥95% + confirmed）
  ↓
雷达方案校验（Task 011）── 标注缺失项 + 复核项
  ↓
导出 Markdown 文件（Task 011）
  ↓
─── V0.3 完成 ───
  ↓
雷达报告生成（V0.4，含 S/A/B/C 机会卡片）
```

---

Task 011 已全部完成，所有验收标准 5.1-5.7 + V0.3 汇总验收清单全部通过。

**V0.3 雷达方案生成器 MVP 至此全部完成**（Task 010-011）。V0.3 验收清单 5 项全部通过。下一步可进入 V0.4（雷达报告生成器）。
