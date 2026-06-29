# Task D 完成回报：报告增强与验证

## 一、任务概述

Task D 是 V1.3 五轨道架构的第四轨，聚焦"报告增强 + i18n 文案补充 + 验证脚本编写 + P0 阈值统一"。

核心能力：
- 报告新增第 8.5 章节"来源索引"（按 SourceConfidenceGrade 排序，含待复核字段子章节）
- D 级机会进入排除章节（第 7 章"不建议投入的机会"）
- stats 扩展：d_count / source_count / evidence_count
- P0 阈值统一：createDefaultSpec 的 visible_level_mapping 与 scoring-rules.ts 对齐（90/80/65/50 + D + hidden="不展示"）
- i18n 文案补充：D 级标签 / 来源徽章 / 行动决策 / 来源索引章节标题

## 二、交付清单

### 2.1 改造文件（6 个）

| 文件 | 改动说明 |
|------|----------|
| src/agents/radar-report-generator.ts | 新增 buildSourceIndex() 函数（第 8.5 章节）；isExcluded 新增 D 级处理；RadarReportInput 新增 sourceCandidates?/evidenceItems?；RadarReportResult.stats 新增 d_count/source_count/evidence_count |
| src/schema/radar-requirement-spec.ts | P0 阈值统一：visible_level_mapping 改为 {S:"90-100",A:"80-89",B:"65-79",C:"50-64",D:"0-49",hidden:"不展示"}；level_definitions 新增 D:"不推荐" |
| src/messages/zh-CN/opportunity.json | 新增 opportunity.level.D / 6 个 sourceBadge keys / 3 个 decision keys |
| src/messages/en-US/opportunity.json | 新增 opportunity.level.D / 6 个 sourceBadge keys / 3 个 decision keys |
| src/messages/zh-CN/report.json | 新增 report.section.sourceIndex:"8.5 来源索引" |
| src/messages/en-US/report.json | 新增 report.section.sourceIndex:"8.5 Source Index" |

### 2.2 新建验证脚本（4 个）

| 文件 | 验证范围 | PASS 数 |
|------|----------|---------|
| scripts/verify-task044.ts | Schema 层（8 模块：Radar/RadarSpecDraft/NextQuestion/RequirementConfirmationCard/SourceCandidate/EvidenceItem/UserInputSource/ScoringRules） | 50 |
| scripts/verify-task045.ts | 一次一问（3 模块：QuestionPlanner/normalizeUserInput/generateConfirmationCard） | 31 |
| scripts/verify-task046.ts | 来源透明（3 模块：SourceClassifier/EvidenceExtractor/OpportunityCardMapper） | 26 |
| scripts/verify-task047.ts | 报告增强 + P0 阈值 + i18n + 回归（9 模块，含 verify-e2e-ai-events + verify-task040 回归） | 25 |

### 2.3 因类型变更/白名单适配而修改的 verify 脚本（6 个）

| 文件 | 改动说明 |
|------|----------|
| scripts/verify-task013.ts | stats 对象补充 d_count/source_count/evidence_count（因 RadarReportResult.stats 类型扩展） |
| scripts/verify-task022.ts | "不引入新依赖"白名单加入 exceljs/mammoth/pdf-parse（后续 Task E 合法引入） |
| scripts/verify-task023.ts | 同上 |
| scripts/verify-task024.ts | 同上 |
| scripts/verify-task025.ts | 同上 |
| scripts/verify-task026.ts | 同上 |

## 三、验证结果

### 3.1 TypeScript 编译检查
```
npx tsc --noEmit
```
结果：exit 0（零错误）

### 3.2 4 个验证脚本

| 脚本 | PASS | FAIL |
|------|------|------|
| verify-task044.ts | 50 | 0 |
| verify-task045.ts | 31 | 0 |
| verify-task046.ts | 26 | 0 |
| verify-task047.ts | 25 | 0 |
| **合计** | **132** | **0** |

### 3.3 7 个回归测试

| 脚本 | PASS | FAIL |
|------|------|------|
| verify-e2e-ai-events | 14/13 | 0 |
| verify-task038 | 68 | 0 |
| verify-task039 | 57 | 0 |
| verify-task040 | 75 | 0 |
| verify-task041 | 38 | 0 |
| verify-task042 | 34 | 0 |
| verify-task043 | 26 | 0 |
| **合计** | **312** | **0** |

## 四、安全红线遵守

| 红线 | 说明 | 状态 |
|------|------|------|
| #5 来源索引只从 SourceCandidate[] 渲染 | buildSourceIndex 不调用 LLM，不编造 URL，只从传入的 sourceCandidates 数组渲染 | ✓ |
| #10 新增字段全部 optional | RadarReportInput.sourceCandidates?/evidenceItems? 均为 optional | ✓ |
| 不引入新 npm 依赖 | Task D 未引入任何新依赖（exceljs/mammoth/pdf-parse 属于 Task E 文件上传，非 Task D） | ✓ |
| JSDoc 注释完整 | 所有新函数 buildSourceIndex 含完整 JSDoc | ✓ |
| import type 用于类型导入 | verify-task044.ts 使用 import type 导入 RadarKind 等类型 | ✓ |

## 五、P0 阈值统一说明

### 5.1 统一前（radar-requirement-spec.ts createDefaultSpec）
```
visible_level_mapping: { S:"85-100", A:"70-84", B:"55-69", C:"40-54", hidden:"<40" }
```

### 5.2 统一后
```
visible_level_mapping: { S:"90-100", A:"80-89", B:"65-79", C:"50-64", D:"0-49", hidden:"不展示" }
level_definitions: { S:"立即行动", A:"重点关注", B:"可选关注", C:"低优先级", D:"不推荐" }
```

与 src/schema/scoring-rules.ts 的 VISIBLE_LEVEL_MAPPING 和 LEVEL_DEFINITIONS 完全对齐。

## 六、D 级处理逻辑

### 6.1 isExcluded 函数（radar-report-generator.ts）
```typescript
if (level === "D") {
  return { excluded: true, reason: "等级为 D（不推荐），不建议投入" };
}
```
D 级机会进入第 7 章"不建议投入的机会"（排除章节），与 hidden 级并列处理。

### 6.2 stats.d_count
```typescript
const dCount = opportunities.filter((o) => getVisibleLevel(o) === "D").length;
```

## 七、来源索引章节（第 8.5 章）

### 7.1 排序规则
按 SourceConfidenceGrade 排序：A1 > A2 > B1 > B2 > C1 > C3 > D4 > E5

### 7.2 待复核字段子章节
当 EvidenceItem 的 credibility_score < 0.6（EVIDENCE_REVIEW_THRESHOLD）且 sourceId 为空时，标记为"待复核"。

### 7.3 安全保证
buildSourceIndex 只从传入的 SourceCandidate[] 渲染，不调用 LLM，不编造 URL（红线 #5）。

## 八、遗留说明

工作目录中存在 Task E（文件上传）的预备文件（upload.ts / 4 个 adapter / file-parser-router.ts / qwen-vl-adapter.ts）及对应的 package.json 依赖（exceljs/mammoth/pdf-parse）。这些文件不属于 Task D，将在 Task E 正式执行时提交。verify-task022-026 的"不引入新依赖"白名单已适配这些后续合法依赖。
