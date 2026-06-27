# Task 008｜需求确认卡生成器 — 完成回报

任务编号：Task 008
所属版本：V0.2
完成时间：2026-06-27
执行环境：TRAE IDE / Node.js v22.16.0 / TypeScript

---

## 1. 修改了哪些文件

无（本任务为新建模块，未修改任何已有文件）。

## 2. 新增了哪些文件

| 文件路径 | 用途 |
|---|---|
| `src/agents/confirmation-card-generator.ts` | 确认卡生成器核心模块，导出 `generateConfirmationCard` 函数与 `ConfirmationCardResult` 接口。按 02 号文档第 5 节格式生成 10 模块 Markdown 确认卡，支持 V0.1（90-94%）/ V1.0（≥95%）版本差异，<90% 拒绝生成。 |
| `scripts/verify-task008.ts` | 验证脚本，覆盖验收标准 5.1-5.7 + V0.2 验收清单，共 102 个测试用例。 |

## 3. 如何本地运行

### 3.1 TypeScript 编译检查

```bash
npx tsc --noEmit
```

预期输出：无任何输出，exit code 0（表示无类型错误）。

### 3.2 验证脚本运行

```bash
npx tsx scripts/verify-task008.ts
```

预期输出：102 个 PASS / 0 个 FAIL，exit code 0。

## 4. 如何测试（完整运行输出）

### 4.1 `npx tsc --noEmit` 实际输出

```
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping [0:0] > trae-sandbox 'npx.cmd tsc --noEmit'
(TraeAI-7) C:\Users\test\Desktop\chanceping\changeping [0:0] $
```

exit code = 0，无任何 TypeScript 错误输出。

### 4.2 `npx tsx scripts/verify-task008.ts` 完整实际输出

> 注：TRAE IDE 终端为 GBK 编码，UTF-8 中文字符在控制台显示为 mojibake，但测试结果（PASS/FAIL 计数和英文部分）完全正确。以下将 mojibake 还原为正确的 UTF-8 中文。

```
=== Task 008 验收检查 ===

[验收 5.1] 拒绝生成逻辑

  PASS  确认度 0 → success=false
  PASS  确认度 0 → error 含 '90%'
  PASS  确认度 0 → markdown=null
  PASS  确认度 0 → version=null
  PASS  确认度 50 → success=false
  PASS  确认度 50 → error 含 '90%'
  PASS  确认度 69.9 → success=false
  PASS  确认度 89.9 → success=false
  PASS  确认度 90 → success=true（边界）

[验收 5.2] V0.1 确认卡生成（90-94%）

  PASS  确认度 90 → success=true
  PASS  确认度 90 → version='V0.1'
  PASS  确认度 93 → success=true
  PASS  确认度 93 → version='V0.1'
  PASS  确认度 94.9 → success=true
  PASS  确认度 94.9 → version='V0.1'
  PASS  V0.1 标题含 '需求确认卡 V0.1'
  PASS  V0.1 末尾含 '第一版'
  PASS  V0.1 含 BRAND.product_name
  PASS  V0.1 markdown 非空

[验收 5.3] V1.0 确认卡生成（≥95%）

  PASS  确认度 95 → success=true
  PASS  确认度 95 → version='V1.0'
  PASS  确认度 100 → success=true
  PASS  确认度 100 → version='V1.0'
  PASS  V1.0 标题含 '需求确认卡'
  PASS  V1.0 标题不含 'V0.1'
  PASS  V1.0 末尾含 '95%'
  PASS  V1.0 含 BRAND.product_name

[验收 5.4] 10 模块完整性

  PASS  模块 1 标题存在（## 1. 我理解你的身份）
  PASS  模块 2 标题存在（## 2. 我理解你的核心目标）
  PASS  模块 3 标题存在（## 3. 我理解你需要盯的机会类型）
  PASS  模块 4 标题存在（## 4. 我建议优先追踪的信号）
  PASS  模块 5 标题存在（## 5. 我建议优先排除的信息）
  PASS  模块 6 标题存在（## 6. 我建议的雷达方向）
  PASS  模块 7 标题存在（## 7. 我建议的机会分级方式）
  PASS  模块 8 标题存在（## 8. 我建议的报告结构）
  PASS  模块 9 标题存在（## 9. 当前需求确认度）
  PASS  模块 10 标题存在（## 10. 请你确认）
  PASS  模块 6 含 '### 子雷达 1'
  PASS  模块 8 含 9 项编号（1. ~ 9.）

[验收 5.5] 内容正确性（Turn 3 后状态）

  PASS  Turn 3 后 confidence ≈ 93.0
  PASS  success=true（confidence 93 ≥ 90）
  PASS  version='V0.1'（93 在 90-94 范围）
  PASS  模块 1 含 client_type='个人'
  PASS  模块 1 含 industry='AI 游戏'
  PASS  模块 2 含 primary_goal='找 AI 游戏比赛'
  PASS  模块 3 含 primary_types='AI 游戏比赛'
  PASS  模块 5 含 must_exclude='K12 赛事'
  PASS  模块 5 含 excluded_types='政府采购'
  PASS  模块 7 含 'S 级'
  PASS  模块 7 含 'A 级'
  PASS  模块 7 含 'B 级'
  PASS  模块 7 含 'C 级'
  PASS  模块 7 含 LEVEL_DEFINITIONS.S
  PASS  模块 7 含 LEVEL_DEFINITIONS.A
  PASS  模块 8 含 '本周一句话判断'
  PASS  模块 8 含 '本周 S 级机会'
  PASS  模块 8 含 '本周 A 级机会'
  PASS  模块 8 含 '本周 B 级机会'
  PASS  模块 8 含 '即将截止机会'
  PASS  模块 8 含 '机会详情卡片'
  PASS  模块 8 含 '本周建议行动'
  PASS  模块 8 含 '不建议投入的机会'
  PASS  模块 8 含 '下周继续追踪'
  PASS  模块 9 含 total + '%'
  PASS  模块 9 含 '排除条件清晰度'（score<90 维度）
  PASS  模块 10 含 '是否准确'
  PASS  模块 10 含 '删除或补充'
  PASS  模块 10 含 '雷达方案'

[验收 5.6] 缺失字段处理

  PASS  部分填充 + confidence 90 → success=true
  PASS  version='V0.1'
  PASS  markdown 含 '未明确'（缺失字段处理）
  PASS  模块 3 缺失时含 '请在确认时补充'
  PASS  模块 4 缺失时含 '(AI 建议)'
  PASS  模块 5 缺失时含 '暂无排除条件'
  PASS  模块 6 缺失时含 '未明确机会类型'
  PASS  不会因缺失字段崩溃

[验收 5.7] 编译与引用

  PASS  BRAND.product_name 已引用
  PASS  MUST_INCLUDE_SECTIONS 含 9 项
  PASS  LEVEL_DEFINITIONS.S 已引用
  PASS  LEVEL_DEFINITIONS.A 已引用
  PASS  LEVEL_DEFINITIONS.B 已引用
  PASS  LEVEL_DEFINITIONS.C 已引用
  PASS  确认卡含 BRAND.product_name（引用生效）
  PASS  确认卡含 LEVEL_DEFINITIONS.S（引用生效）
  PASS  确认卡含 MUST_INCLUDE_SECTIONS[0]（引用生效）
  PASS  ExtractedRequirementInfo 通过 import 引用
  PASS  RequirementConfidence 通过 import 引用
  PASS  BRAND 通过 import 引用
  PASS  MUST_INCLUDE_SECTIONS 通过 import 引用
  PASS  LEVEL_DEFINITIONS 通过 import 引用
  PASS  calculateConfidence 从 Task 006 引用（不重复实现）
  PASS  src/agents/confirmation-card-generator.ts 已创建
  PASS  scripts/verify-task008.ts 已创建

=== V0.2 验收清单（逐项自检） ===

  PASS  [✓] 确认卡生成器按 02 号文档格式输出 10 个模块
  PASS  [✓] 仅在确认度 ≥90% 时生成
  PASS  [✓] 90-94% 生成 V0.1（含第一版提示）
  PASS  [✓] ≥95% 生成 V1.0（含 95% 提示）
  PASS  [✓] 含 '请你确认' 3 问
  PASS  [✓] 缺失字段显示 '未明确'
  PASS  [✓] 报告结构使用 MUST_INCLUDE_SECTIONS（9 项）
  PASS  [✓] 品牌名、分级、报告结构从常量引用
  PASS  [✓] 验证脚本运行无异常

========================================
总计：PASS 102 / FAIL 0
========================================
```

exit code = 0。

## 5. 哪些功能还没做

- **Spec 编译器（Task 009）**：本任务输出的确认卡是 Task 009 的输入，但 Spec 编译器本身不在本任务范围内。
- **雷达方案生成（Task 010）**：本任务 V1.0 确认卡末尾提示"确认后即可生成正式雷达方案 V1.0"，但方案生成逻辑属于 Task 010。
- **LLM 调用**：确认卡内容从 `ExtractedRequirementInfo` 规则映射，不接入 LLM（Task 007 已实现 LLM 适配器，可在 Task 009+ 串联调用）。
- **前端 UI**：本任务只产出 Markdown 字符串，不渲染 UI。

## 6. 下一步建议

基于本次产出，建议下一步：

1. **Task 009 — Spec 编译器**：将 V1.0 确认卡（≥95% 且用户确认）编译为完整的 `RadarRequirementSpec`，填充所有缺失字段（keyword_strategy、source_strategy、scoring_rules、confirmation_status 等），并使用 `radarRequirementSpecSchema` 进行 JSON Schema 校验。
2. **Task 010 — 雷达方案生成**：基于 Spec 生成首版雷达方案 Markdown 报告（S/A/B/C 机会卡片 + 行动建议）。
3. **集成测试**：将 Task 007（对话管理）+ Task 008（确认卡生成器）+ Task 009（Spec 编译器）串联，端到端跑通"3 轮对话 → 93 分确认卡 V0.1 → 用户确认 → 95 分 V1.0 → Spec 编译"完整流程。

## 7. V0.2 验收清单（逐项自检结果）

| 验收项 | 结果 |
|---|---|
| 确认卡生成器按 02 号文档格式输出 10 个模块 | ✅ PASS |
| 仅在确认度 ≥90% 时生成 | ✅ PASS |
| 90-94% 生成 V0.1（含第一版提示） | ✅ PASS |
| ≥95% 生成 V1.0（含 95% 提示） | ✅ PASS |
| 含"请你确认"3 问 | ✅ PASS |
| 缺失字段显示"未明确" | ✅ PASS |
| 报告结构使用 MUST_INCLUDE_SECTIONS（9 项） | ✅ PASS |
| 品牌名、分级、报告结构从常量引用 | ✅ PASS |
| 验证脚本全部通过 | ✅ PASS（102/0） |

## 8. 核心设计说明

### 8.1 拒绝生成逻辑

```typescript
if (total < 90) {
  return {
    success: false,
    markdown: null,
    error: `需求确认度仅 ${total}%，低于 90% 阈值，暂不生成确认卡。请继续补充需求信息。`,
    version: null,
  };
}
```

确认度 < 90% 时返回 `success=false`，error 包含 "90%"，不降级输出。

### 8.2 版本差异

- **V0.1（90 ≤ total < 95）**：标题含 "V0.1"，末尾追加 "这是第一版确认卡，请仔细核对以上信息。确认无误后我们将生成正式雷达方案。"
- **V1.0（total ≥ 95）**：标题不含 "V0.1"，末尾追加 "需求确认度已达 95% 以上，确认后即可生成正式雷达方案 V1.0。"

### 8.3 10 模块内容来源（不编造）

| 模块 | 数据来源 | 缺失处理 |
|---|---|---|
| 1. 身份 | client_identity.{client_type, industry, products_or_projects, regions} | 写"未明确" |
| 2. 核心目标 | business_goal.{primary_goal, secondary_goals, success_definition} | 写"未明确" |
| 3. 机会类型 | opportunity_type.primary_types + secondary_types | 写"未明确，请在确认时补充" |
| 4. 优先追踪信号 | opportunity_type.must_have_conditions | 基于 primary_types 推导，标注"(AI 建议)"，至少 3 条 |
| 5. 优先排除信息 | exclusion_rules.must_exclude + opportunity_type.excluded_types 合并去重 | 写"暂无排除条件，请在确认时补充" |
| 6. 雷达方向 | 基于 primary_types 推导子雷达（1-3 个） | 写"（未明确机会类型，请在确认时补充）" |
| 7. 分级方式 | `LEVEL_DEFINITIONS`（S/A/B/C） | 引用常量，不硬编码 |
| 8. 报告结构 | `MUST_INCLUDE_SECTIONS`（9 项） | 引用常量，不以 system prompt 7 项为准 |
| 9. 确认度 | confidence.total + "%" + score<90 的维度中文名 + reason | 全 ≥90 时写"暂无不确定项" |
| 10. 请你确认 | 固定 3 问（02 号文档原文） | 无 |

### 8.4 引用的常量（不硬编码）

- `BRAND.product_name`（来自 `src/brand/constants.ts`）
- `MUST_INCLUDE_SECTIONS`（来自 `src/schema/radar-requirement-spec.ts`，9 项）
- `LEVEL_DEFINITIONS`（来自 `src/schema/scoring-rules.ts`，S/A/B/C）
- `CONFIDENCE_DIMENSIONS` + `CONFIDENCE_DIMENSION_LABELS`（来自 `src/schema/requirement-confidence.ts`，7 维度）
- `calculateConfidence`（来自 `src/agents/confidence-engine.ts`，Task 006 产出，不重复实现）

---

Task 008 已全部完成，所有验收标准 5.1-5.7 + V0.2 验收清单全部通过。
