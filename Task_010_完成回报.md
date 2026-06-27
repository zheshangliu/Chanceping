# Task 010｜雷达方案 V1.0 生成器 — 完成回报

任务编号：Task 010
所属版本：V0.3（雷达方案生成器，第一个 Task）
完成时间：2026-06-27
执行环境：TRAE IDE / Node.js v22.16.0 / TypeScript

---

## 1. 修改了哪些文件

无（本任务为新建模块，未修改任何已有文件）。

## 2. 新增了哪些文件

| 文件路径 | 用途 |
|---|---|
| `src/agents/radar-plan-generator.ts` | 雷达方案 V1.0 生成器核心模块，导出 `generateRadarPlan()` 函数与 `RadarPlanInput` / `RadarPlanResult` 接口。将 `RadarRequirementSpec` 转为符合 8 章节结构的雷达方案 Markdown 文档。 |
| `scripts/verify-task010.ts` | 验证脚本，覆盖验收标准 5.1-5.7 + V0.3 验收清单，共 81 个测试用例。 |

## 3. 如何本地运行

### 3.1 TypeScript 编译检查

```bash
npx tsc --noEmit
```

预期输出：无任何输出，exit code 0（表示无类型错误）。

### 3.2 验证脚本运行

```bash
npx tsx scripts/verify-task010.ts
```

预期输出：81 个 PASS / 0 个 FAIL，exit code 0。

## 4. 如何测试（完整运行输出）

### 4.1 `npx tsc --noEmit` 实际输出

```
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping [0:0] > trae-sandbox 'npx.cmd tsc --noEmit'
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping [0:0] $
```

exit code = 0，无任何 TypeScript 错误输出。

### 4.2 `npx tsx scripts/verify-task010.ts` 完整实际输出

> 注：TRAE IDE 终端为 GBK 编码，UTF-8 中文字符在控制台显示为 mojibake，但测试结果（PASS/FAIL 计数和英文部分）完全正确。以下将 mojibake 还原为正确的 UTF-8 中文。

```
=== Task 010 验收检查 ===

[验收 5.1] 拒绝生成逻辑

  PASS  确认度 50 + confirmed → success=false
  PASS  确认度 50 → error 含 '95%'
  PASS  确认度 50 → markdown=null
  PASS  确认度 50 → version=null
  PASS  确认度 94 + confirmed → success=false
  PASS  确认度 94 → error 含 '95%'
  PASS  确认度 95 + draft → success=false
  PASS  确认度 95 + draft → error 含 '确认'
  PASS  确认度 95 + needs_more_info → success=false
  PASS  确认度 95 + confirmation_card_generated → success=false

[验收 5.2] 成功生成逻辑

  PASS  确认度 95 + confirmed → success=true
  PASS  确认度 100 + ready_for_radar_plan → success=true
  PASS  成功生成 → markdown 非空
  PASS  成功生成 → error=null
  PASS  成功生成 → version='V1.0'
  PASS  成功生成 → sections_count=8
  PASS  成功生成 → generated_at 非空

[验收 5.3] Markdown 结构校验

  PASS  标题含 BRAND.product_name
  PASS  ai_competition 标题含 'AI 赛事雷达'
  PASS  标题含 'V1.0'
  PASS  含章节标题 '## 1.'
  PASS  含章节标题 '## 2.'
  PASS  含章节标题 '## 3.'
  PASS  含章节标题 '## 4.'
  PASS  含章节标题 '## 5.'
  PASS  含章节标题 '## 6.'
  PASS  含章节标题 '## 7.'
  PASS  含章节标题 '## 8.'
  PASS  含 '## 确认信息'
  PASS  含 '## 待确认问题'
  PASS  含 '生成时间：'
  PASS  含 '需求确认度：'

[验收 5.4] 字段映射正确性（sample-spec.json）

  PASS  用户画像含 client_type 值
  PASS  用户画像含 core_capabilities 数组项
  PASS  核心目标含 primary_goal 值
  PASS  核心目标含 action_intent 数组项
  PASS  机会范围含 primary_opportunity_types 数组项
  PASS  机会范围含 excluded_opportunity_types 数组项
  PASS  地域范围含 primary_regions 数组项
  PASS  关键词含 core_keywords_zh 数组项
  PASS  关键词含 negative_keywords 数组项
  PASS  筛选规则含 must_exclude 数组项
  PASS  评分含 match_score=30
  PASS  评分含 business_value=25
  PASS  评分含 '强烈推荐，优先行动'（S 级定义）
  PASS  报告含 report_frequency 值
  PASS  报告含 MUST_INCLUDE_SECTIONS 全部 9 项
  PASS  报告含 OPPORTUNITY_CARD_REQUIRED_FIELDS 全部 14 项
  PASS  数据源含来源透明展示文案

[验收 5.5] 空值处理

  PASS  空 Spec → success=true（confidence 95 + confirmed）
  PASS  空字符串字段标注 '未明确'
  PASS  空数组字段标注 '暂无'
  PASS  空待确认问题标注 '暂无'（questions_to_confirm）
  PASS  空用户补充源标注 '暂无'
  PASS  空值下章节 1 仍完整
  PASS  空值下章节 2 仍完整
  PASS  空值下章节 3 仍完整
  PASS  空值下章节 4 仍完整
  PASS  空值下章节 5 仍完整
  PASS  空值下章节 6 仍完整
  PASS  空值下章节 7 仍完整
  PASS  空值下章节 8 仍完整

[验收 5.6] 雷达类型映射

  PASS  ai_competition → 标题含 'AI 赛事雷达'
  PASS  opc_policy → 标题含 'OPC 政策雷达'
  PASS  cultural_heritage → 标题含 '文创非遗雷达'

[验收 5.7] 编译与引用

  PASS  BRAND.product_name 已引用
  PASS  MUST_INCLUDE_SECTIONS 已引用（9 项）
  PASS  OPPORTUNITY_CARD_REQUIRED_FIELDS 已引用（14 项）
  PASS  RadarRequirementSpec 类型通过 import 引用
  PASS  createDefaultSpec 通过 import 引用
  PASS  markdown 含 BRAND.product_name（引用生效）
  PASS  markdown 含 MUST_INCLUDE_SECTIONS 全部 9 项（引用生效）
  PASS  markdown 含 OPPORTUNITY_CARD_REQUIRED_FIELDS 全部 14 项（引用生效）
  PASS  src/agents/radar-plan-generator.ts 已创建
  PASS  scripts/verify-task010.ts 已创建

=== V0.3 验收清单（逐项自检） ===

  PASS  [✓] 雷达方案 8 项齐全
  PASS  [✓] 仅在确认度 ≥95% 时生成正式方案
  PASS  [✓] 导出 Markdown 含品牌标题前缀
  PASS  [✓] version = 'V1.0'
  PASS  [✓] sections_count = 8
  PASS  [✓] 验证脚本运行无异常

========================================
总计：PASS 81 / FAIL 0
========================================
```

exit code = 0。

## 5. 哪些功能还没做

- **雷达方案校验与导出（Task 011）**：本任务产出的 Markdown 雷达方案是 Task 011 的输入，但方案校验（标注缺失项与需人工复核项）和导出（PDF/Word）不在本任务范围内。
- **雷达报告生成（V0.4）**：含 S/A/B/C 机会卡片 + 行动建议的周报不在本任务范围内。
- **机会卡片生成（V0.4）**：本任务不产出任何 OpportunityCard。
- **搜索 API 接入（V0.8）**：本任务的 `source_strategy` 如实展示空值，不接入实际搜索源。
- **Spec 持久化存储（V1.0+）**：本任务只产出内存中的 Markdown 字符串。
- **前端 UI 渲染（V0.9）**：本任务不渲染 UI。
- **LLM 调用**：本任务是纯规则映射，不接入 LLM。

## 6. 下一步建议

基于本次产出，建议下一步：

1. **Task 011 — 雷达方案校验与导出**：对 Task 010 产出的雷达方案 Markdown 进行校验（标注缺失项与需人工复核项），并支持导出为文件（Markdown / PDF / Word）。Task 011 完成后 V0.3 验收清单 5 项全部通过。
2. **端到端集成测试**：将 Task 007（对话管理）→ Task 008（确认卡生成）→ Task 009（Spec 编译）→ Task 010（雷达方案生成）串联，跑通"3 轮对话 → 93 分确认卡 V0.1 → 用户确认 → 95 分 V1.0 → Spec 编译 → validateSpec 通过 → 雷达方案 V1.0 生成"完整流程。
3. **V0.4 雷达报告生成器**：基于 Task 010 的雷达方案，生成首版雷达报告（含 S/A/B/C 机会卡片 + 行动建议），复用 Task 003-005 的样板报告格式。

## 7. V0.3 验收清单（逐项自检结果）

| 验收项 | 本任务覆盖 | 结果 |
|---|---|---|
| 雷达方案 8 项齐全，内容均来自 Spec 对应字段 | ✅ | PASS（8 章节标题齐全，每章节字段从 Spec 映射） |
| 仅在确认度 ≥95% 时生成正式方案 | ✅ | PASS（<95% 拒绝，≥95% 生成 V1.0） |
| 导出 Markdown 含品牌标题前缀 | ✅ | PASS（标题含 `BRAND.product_name`） |
| 校验报告能标注缺失项与需人工复核项 | ❌ Task 011 | — |
| V0.3 验收清单 5 项全部通过 | ❌ Task 011 汇总 | — |

## 8. 核心设计说明

### 8.1 拒绝门槛（≥95%，三个模块中最严格）

| 模块 | 门槛 | 理由 |
|---|---|---|
| 确认卡生成器（Task 008） | ≥90% | 让用户尽早看到需求理解 |
| Spec 编译器（Task 009） | ≥90% + confirmed | 生成可校验的结构化数据 |
| **雷达方案生成器（Task 010）** | **≥95% + confirmed** | **正式输出，需要最高确认度** |

```typescript
// 门槛 1：确认度 ≥ 95%
if (spec.requirement_confidence.total < 95) {
  return { success: false, error: `需求确认度仅 ${total}%，低于 95% 阈值...` };
}

// 门槛 2：确认状态为 confirmed / ready_for_radar_plan
if (status !== "confirmed" && status !== "ready_for_radar_plan") {
  return { success: false, error: `确认状态为 "${status}"，用户尚未确认...` };
}
```

### 8.2 雷达类型映射表（内置常量，非品牌文案）

| radar_type | 标题中的雷达名称 |
|---|---|
| `ai_competition` | AI 赛事雷达 |
| `opc_policy` | OPC 政策雷达 |
| `cultural_heritage` | 文创非遗雷达 |

此映射表内置在生成器中，不硬编码到品牌常量（因为雷达名称是业务概念，不是品牌文案）。

### 8.3 8 章节结构与 Spec 字段映射

| 方案章节 | Spec 字段来源 |
|---|---|
| 1. 雷达概述 | client_profile + core_goals |
| 2. 机会追踪范围 | opportunity_scope |
| 3. 地域范围 | region_scope |
| 4. 关键词策略 | keyword_strategy |
| 5. 筛选与排除规则 | filter_rules |
| 6. 评分与分级规则 | scoring_rules |
| 7. 报告规格 | report_requirements |
| 8. 数据源策略 | source_strategy |
| — 确认信息 | requirement_confidence + confirmation_status |
| — 待确认问题 | questions_to_confirm |

### 8.4 字段格式化规则

| 字段类型 | 格式化方式 | 空值处理 |
|---|---|---|
| 字符串 | 直接输出 | 标注「未明确」 |
| 字符串数组 | 用「、」连接 | 标注「暂无」 |
| 空数组 `[]` | 标注「暂无」 | — |
| 布尔值 | `true`→「是」/「开启」/「启用」，`false`→「否」/「关闭」/「禁用」 | — |
| 数字 | 直接输出 | — |
| `questions_to_confirm` | 编号列出 question + priority | 空数组标注「暂无」 |
| `user_supplied_sources` | 列出 source_name + source_url | 空数组标注「暂无」 |

### 8.5 引用的常量与类型（不硬编码、不重复实现）

| 引用项 | 来源 |
|---|---|
| `BRAND.product_name` | `src/brand/constants.ts` |
| `RadarRequirementSpec` 类型 | `src/schema/radar-requirement-spec.ts`（通过 import type 引用） |
| `MUST_INCLUDE_SECTIONS`（9 项） | `src/schema/radar-requirement-spec.ts`（验证脚本引用） |
| `OPPORTUNITY_CARD_REQUIRED_FIELDS`（14 项） | `src/schema/radar-requirement-spec.ts`（验证脚本引用） |
| `createDefaultSpec()` | `src/schema/radar-requirement-spec.ts`（验证脚本引用，构造空 Spec） |

### 8.6 雷达方案 vs 需求确认卡 vs 雷达报告

| 概念 | 版本 | 定义 | 门槛 |
|---|---|---|---|
| 需求确认卡 | V0.2 (Task 008) | 用户确认需求时看的卡片，10 个模块 | ≥90% |
| **雷达方案** | **V0.3 (Task 010)** | **Spec 确认后生成的可执行配置计划，8 个章节** | **≥95%** |
| 雷达报告 | V0.4 | 含 S/A/B/C 机会卡片 + 行动建议的周报 | — |

雷达方案 ≠ 雷达报告。雷达方案是「这份雷达会怎么帮你盯」的配置说明书，不含具体机会；雷达报告是每周产出的含机会卡片的报告。

---

Task 010 已全部完成，所有验收标准 5.1-5.7 + V0.3 验收清单（本任务覆盖部分）全部通过。

下一步进入 Task 011（雷达方案校验与导出），完成后 V0.3 验收清单 5 项全部通过。
