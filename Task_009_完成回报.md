# Task 009｜RadarRequirementSpec 编译器 — 完成回报

任务编号：Task 009
所属版本：V0.2（最后一个 Task）
完成时间：2026-06-27
执行环境：TRAE IDE / Node.js v22.16.0 / TypeScript

---

## 1. 修改了哪些文件

无（本任务为新建模块，未修改任何已有文件）。

## 2. 新增了哪些文件

| 文件路径 | 用途 |
|---|---|
| `src/agents/spec-compiler.ts` | Spec 编译器核心模块，导出 `compileSpec` 函数与 `SpecCompileResult` / `SpecCompileInput` 接口。将 `ExtractedRequirementInfo + RequirementConfidence + 对话上下文` 编译为通过 `validateSpec` 校验的 `RadarRequirementSpec` JSON。 |
| `scripts/verify-task009.ts` | 验证脚本，覆盖验收标准 5.1-5.7 + V0.2 验收清单，共 110 个测试用例。 |

## 3. 如何本地运行

### 3.1 TypeScript 编译检查

```bash
npx tsc --noEmit
```

预期输出：无任何输出，exit code 0（表示无类型错误）。

### 3.2 验证脚本运行

```bash
npx tsx scripts/verify-task009.ts
```

预期输出：110 个 PASS / 0 个 FAIL，exit code 0。

## 4. 如何测试（完整运行输出）

### 4.1 `npx tsc --noEmit` 实际输出

```
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping [0:0] > trae-sandbox 'npx.cmd tsc --noEmit'
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping [0:0] $
```

exit code = 0，无任何 TypeScript 错误输出。

### 4.2 `npx tsx scripts/verify-task009.ts` 完整实际输出

> 注：TRAE IDE 终端为 GBK 编码，UTF-8 中文字符在控制台显示为 mojibake，但测试结果（PASS/FAIL 计数和英文部分）完全正确。以下将 mojibake 还原为正确的 UTF-8 中文。

```
=== Task 009 验收检查 ===

[验收 5.1] 拒绝编译逻辑

  PASS  确认度 50 + confirmed → success=false
  PASS  确认度 50 → error 含 '90%'
  PASS  确认度 50 → spec=null
  PASS  确认度 89.9 + confirmed → success=false
  PASS  确认度 95 + draft → success=false
  PASS  确认度 95 + draft → error 含 '确认'
  PASS  确认度 95 + needs_more_info → success=false
  PASS  确认度 95 + confirmation_card_generated → success=false
  PASS  confirmation_card_generated → error 含 '确认'

[验收 5.2] 成功编译逻辑

  PASS  确认度 90 + confirmed → success=true
  PASS  确认度 95 + ready_for_radar_plan → success=true
  PASS  确认度 100 + confirmed → success=true
  PASS  成功编译 → spec 非空
  PASS  成功编译 → error=null

[验收 5.3] 编译产物校验

  PASS  编译成功（confidence 93 + confirmed）
  PASS  validateSpec 通过
  PASS  validateSpec errors 为空数组
  PASS  product_name = BRAND.product_name
  PASS  product_category = BRAND.product_category
  PASS  report_title_prefix = REPORT_TITLE_PREFIX
  PASS  must_include_sections = MUST_INCLUDE_SECTIONS（9 项一致）
  PASS  must_include_sections 长度 = 9
  PASS  scoring_rules.weights 一致
  PASS  scoring_rules.level_definitions 一致
  PASS  scoring_rules.visible_level_mapping 一致
  PASS  requirement_confidence.total 一致
  PASS  requirement_confidence.client_identity.score 一致
  PASS  confirmation_status.status = 'confirmed'
  PASS  confirmation_status.user_confirmed = true
  PASS  confirmation_status.confirmed_at 非空
  PASS  confirmation_status.revision_count = 0
  PASS  source_strategy 存在
  PASS  source_strategy.official_sites = []
  PASS  source_strategy.source_transparency_enabled = true
  PASS  source_strategy 字段齐全（10 个）

[验收 5.4] 字段映射正确性

  PASS  client_profile.client_type = info.client_identity.client_type
  PASS  client_profile.industry = info.client_identity.industry
  PASS  client_profile.regions = arrOrEmpty(info.client_identity.regions)
  PASS  client_profile.core_capabilities = info.client_identity.core_capabilities
  PASS  client_profile.client_name = ''（V0.2 不提取）
  PASS  client_profile.target_users = []（V0.2 不提取）
  PASS  core_goals.primary_goal = info.business_goal.primary_goal
  PASS  core_goals.action_intent 映射到 ACTION_INTENTS
  PASS  core_goals.action_intent 含 '报名比赛'（输入 '报名比赛'）
  PASS  opportunity_scope.primary_opportunity_types = info.opportunity_type.primary_types
  PASS  opportunity_scope.excluded_opportunity_types = info.opportunity_type.excluded_types
  PASS  region_scope.primary_regions = info.region_scope.primary_regions
  PASS  region_scope.global_allowed = false（默认）
  PASS  filter_rules.must_exclude = info.exclusion_rules.must_exclude
  PASS  filter_rules.must_include = info.opportunity_type.must_have_conditions
  PASS  keyword_strategy.core_keywords_zh 非空
  PASS  keyword_strategy.core_keywords_zh 含 primary_types 值
  PASS  keyword_strategy.negative_keywords 含 excluded_types 值
  PASS  keyword_strategy.negative_keywords 含 must_exclude 值
  PASS  report_requirements.report_frequency = info.report_format.frequency
  PASS  report_requirements.report_format = 'markdown'
  PASS  report_requirements.max_items_per_report = 10
  PASS  report_requirements.min_items_per_report = 5
  PASS  report_requirements.opportunity_card_required_fields = OPPORTUNITY_CARD_REQUIRED_FIELDS

[验收 5.5] 关键词推导

  PASS  ai_competition → core_keywords_zh 含 'AI 比赛'
  PASS  ai_competition → core_keywords_zh 含 'AI 黑客松'
  PASS  ai_competition → core_keywords_en 非空
  PASS  ai_competition → core_keywords_en 含 'AI competition'
  PASS  opc_policy → core_keywords_zh 含 '创业补贴'
  PASS  opc_policy → core_keywords_zh 含 '科技项目申报'
  PASS  opc_policy → core_keywords_en 非空
  PASS  cultural_heritage → core_keywords_zh 含 '文创比赛'
  PASS  cultural_heritage → core_keywords_zh 含 '非遗创新'
  PASS  cultural_heritage → core_keywords_en 非空
  PASS  negative_keywords 含 excluded_types（K12 赛事、政府采购）
  PASS  negative_keywords 含 must_exclude（学生类赛事）
  PASS  negative_keywords 去重（K12 赛事 只出现一次）
  PASS  expanded_keywords_zh 含 secondary_types（品牌合作）
  PASS  expanded_keywords_zh 含 core_capabilities（Unity）

[验收 5.6] action_intent 映射

  PASS  报名比赛 → [报名比赛]
  PASS  申请补贴 → [申请补贴]
  PASS  BD 找客户 → [寻找客户]
  PASS  保存收藏 → [保存观察]
  PASS  转发给团队 → [转发团队]
  PASS  空 → []
  PASS  非法值 → []
  PASS  复合意图 → [报名比赛, 准备材料, 发布内容]

[验收 5.7] 编译与引用

  PASS  BRAND.product_name 已引用
  PASS  REPORT_TITLE_PREFIX 已引用
  PASS  MUST_INCLUDE_SECTIONS 含 9 项
  PASS  OPPORTUNITY_CARD_REQUIRED_FIELDS 含 14 项
  PASS  ACTION_INTENTS 含 10 项
  PASS  createDefaultScoringRules().weights.match_score = 30
  PASS  createDefaultScoringRules().level_definitions.S = '强烈推荐，优先行动'
  PASS  spec.product_name = BRAND.product_name（引用生效）
  PASS  spec.report_requirements.report_title_prefix = REPORT_TITLE_PREFIX（引用生效）
  PASS  spec.report_requirements.must_include_sections = MUST_INCLUDE_SECTIONS（引用生效）
  PASS  spec.scoring_rules = createDefaultScoringRules()（引用生效）
  PASS  RadarRequirementSpec 通过 import 引用
  PASS  validateSpec 通过 import 引用
  PASS  calculateConfidence 从 Task 006 引用（不重复实现）
  PASS  createDefaultSpec 通过 import 引用（用作骨架）
  PASS  createDefaultScoringRules 通过 import 引用
  PASS  src/agents/spec-compiler.ts 已创建
  PASS  scripts/verify-task009.ts 已创建

=== V0.2 验收清单（逐项自检） ===

  PASS  [✓] Spec 编译器输出通过 validateSpec
  PASS  [✓] 含全部 13 个顶层字段
  PASS  [✓] confirmation_status 为 confirmed 或 ready_for_radar_plan
  PASS  [✓] 确认度 < 90% 拒绝编译
  PASS  [✓] 未确认拒绝编译
  PASS  [✓] 品牌名、报告前缀、报告结构从常量引用
  PASS  [✓] 关键词推导正确（三雷达各有内置关键词）
  PASS  [✓] action_intent 映射到 ACTION_INTENTS 枚举
  PASS  [✓] source_strategy 已初始化（预留字段）
  PASS  [✓] 验证脚本运行无异常

========================================
总计：PASS 110 / FAIL 0
========================================
```

exit code = 0。

## 5. 哪些功能还没做

- **雷达方案生成（Task 010）**：本任务产出的 `RadarRequirementSpec` 是 Task 010 的输入，但方案生成逻辑不在本任务范围内。
- **雷达方案校验与导出（Task 011）**：不在本任务范围内。
- **Spec 持久化存储**：本任务只产出内存中的 Spec 对象，不涉及数据库/文件持久化（后续版本）。
- **前端 UI**：本任务只产出 Spec JSON，不渲染 UI。
- **LLM 调用**：编译是纯规则映射，不接入 LLM。

## 6. 下一步建议

基于本次产出，建议下一步：

1. **Task 010 — 雷达方案生成器**：基于 Task 009 产出的 `RadarRequirementSpec`，生成首版雷达方案 Markdown 报告（S/A/B/C 机会卡片 + 行动建议 + 下周追踪），复用 Task 003-005 的样板报告格式。
2. **端到端集成测试**：将 Task 007（对话管理）→ Task 008（确认卡生成）→ Task 009（Spec 编译）串联，跑通"3 轮对话 → 93 分确认卡 V0.1 → 用户确认 → 95 分 V1.0 → Spec 编译 → validateSpec 通过"完整流程。
3. **V0.4+ 数据源接入**：本任务 `source_strategy` 已初始化为空值，V0.4 起消费此字段填充实际数据源。

## 7. V0.2 验收清单（逐项自检结果）

| 验收项 | 结果 |
|---|---|
| Spec 编译器输出通过 validateSpec | ✅ PASS |
| 含 client_profile / core_goals / opportunity_scope / region_scope / keyword_strategy / filter_rules / scoring_rules / report_requirements / requirement_confidence / questions_to_confirm / confirmation_status | ✅ PASS（13 个顶层字段齐全） |
| confirmation_status 为 confirmed 或 ready_for_radar_plan | ✅ PASS |
| 确认度 < 90% 拒绝编译 | ✅ PASS |
| 未确认拒绝编译 | ✅ PASS |
| 品牌名、报告前缀、报告结构从常量引用 | ✅ PASS |
| 关键词推导正确（三雷达各有内置关键词） | ✅ PASS |
| action_intent 映射到 ACTION_INTENTS 枚举 | ✅ PASS |
| source_strategy 已初始化（预留字段） | ✅ PASS |
| 验证脚本全部通过 | ✅ PASS（110/0） |

## 8. 核心设计说明

### 8.1 拒绝编译逻辑（双重门槛）

```typescript
// 门槛 1：确认度 ≥ 90%
if (confidence.total < 90) {
  return { success: false, spec: null, error: `需求确认度仅 ${confidence.total}%，低于 90% 阈值，拒绝编译 Spec。` };
}

// 门槛 2：用户已确认（confirmation_status = confirmed 或 ready_for_radar_plan）
if (confirmation_status !== "confirmed" && confirmation_status !== "ready_for_radar_plan") {
  return { success: false, spec: null, error: `确认状态为 "${confirmation_status}"，用户尚未确认，拒绝编译 Spec。` };
}
```

两个条件同时满足才编译，否则拒绝。

### 8.2 字段映射策略

以 `createDefaultSpec()` 为骨架，逐字段覆盖：

| Spec 子结构 | 映射来源 |
|---|---|
| product_name / product_category | `BRAND` 常量 |
| client_profile | `info.client_identity`（V0.2 不提取 client_name / target_users / current_assets） |
| core_goals | `info.business_goal` + `info.action_scenario.action_intent`（映射到 ACTION_INTENTS 枚举） |
| opportunity_scope | `info.opportunity_type`（nice_to_have_conditions 留空） |
| region_scope | `info.region_scope`（global_allowed / overseas_allowed 默认 false） |
| keyword_strategy | `info` + `radar_type` 推导（见下方关键词表） |
| filter_rules | `info.opportunity_type.must_have_conditions` + `info.exclusion_rules` |
| scoring_rules | `createDefaultScoringRules()`（不修改） |
| report_requirements | 常量 + `info.report_format.frequency ?? "每周"` |
| requirement_confidence | `input.confidence`（直接透传） |
| questions_to_confirm | `input.questions_to_confirm ?? []` |
| confirmation_status | `input.confirmation_status` + `user_confirmed=true` + `confirmed_at` |
| source_strategy | 初始化为空值（V0.4/V0.8 消费） |

### 8.3 关键词推导（三雷达内置关键词表）

| radar_type | core_keywords_zh | core_keywords_en |
|---|---|---|
| ai_competition | AI 比赛、AI 竞赛、AI 黑客松、AI 游戏 Jam、AI 应用大赛 | AI competition、AI hackathon、AI game jam、AI app contest |
| opc_policy | 创业补贴、社保补贴、人才补贴、科技项目申报、小微企业政策 | startup subsidy、social security subsidy、policy application |
| cultural_heritage | 文创比赛、非遗创新、城市礼物征集、文创设计大赛、非遗文创 | cultural creative competition、intangible heritage、city gift design |

- `core_keywords_zh` = primary_types + 雷达内置中文关键词（去重）
- `core_keywords_en` = 雷达内置英文关键词
- `expanded_keywords_zh` = secondary_types + core_capabilities（去重）
- `expanded_keywords_en` = 从 primary_types 翻译推导（如"比赛"→"competition"）
- `negative_keywords` = excluded_types + must_exclude（去重）

### 8.4 action_intent 映射规则

基于关键词匹配，映射到 `ACTION_INTENTS` 枚举：

| 输入关键词 | 映射到 ACTION_INTENTS |
|---|---|
| "报名" | 报名比赛 |
| "申请" | 申请补贴 |
| "申报" | 申报项目 |
| "BD"/"客户" | 寻找客户 |
| "合作" | 寻找合作 |
| "招聘"/"招人" | 寻找招聘线索 |
| "收藏"/"保存" | 保存观察 |
| "转发" | 转发团队 |
| "准备材料"/"准备" | 准备材料 |
| "发布"/"内容" | 发布内容 |

非法值不映射，返回空数组。复合意图可映射多个值（如"报名比赛、准备材料、发布内容"→[报名比赛, 准备材料, 发布内容]）。

### 8.5 编译产物校验

编译完成后调用 `validateSpec(spec)` 进行 JSON Schema 校验：
- 校验通过：返回 `success=true, spec`
- 校验失败：返回 `success=false, error`（包含具体校验错误）

这确保编译器不会产出不合法的 Spec。

### 8.6 引用的常量与函数（不硬编码、不重复实现）

| 引用项 | 来源 |
|---|---|
| `BRAND.product_name` / `BRAND.product_category` | `src/brand/constants.ts` |
| `REPORT_TITLE_PREFIX` | `src/brand/constants.ts` |
| `MUST_INCLUDE_SECTIONS`（9 项） | `src/schema/radar-requirement-spec.ts` |
| `OPPORTUNITY_CARD_REQUIRED_FIELDS`（14 项） | `src/schema/radar-requirement-spec.ts` |
| `ACTION_INTENTS`（10 项） | `src/schema/radar-requirement-spec.ts` |
| `createDefaultSpec()` | `src/schema/radar-requirement-spec.ts`（用作骨架） |
| `createDefaultScoringRules()` | `src/schema/scoring-rules.ts` |
| `validateSpec()` | `src/utils/validators.ts` |
| `calculateConfidence()` | `src/agents/confidence-engine.ts`（Task 006，验证脚本引用） |

---

Task 009 已全部完成，所有验收标准 5.1-5.7 + V0.2 验收清单全部通过。

**V0.2 互动式需求确认 MVP 至此全部完成**（Task 001-009）。下一步可进入 Task 010（雷达方案生成器）。
