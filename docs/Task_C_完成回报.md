# Task C 完成回报

## 0. 任务概述

**任务名称**：Task C - 来源透明 + 机会卡片增强
**任务书**：`c:\Users\test\Desktop\chanceping\Task_C_来源透明任务书.md`
**执行日期**：2026-06-29
**所属版本**：V1.3 五轨道架构第三轨

### 核心能力

1. **来源分类**：9 类 SourceType + 8 级 Admiralty Code 可信度等级
2. **字段级证据追溯**：8 个 EvidenceField 正则提取，每个字段可追溯到具体来源
3. **S 级硬规则**：无官方链接 → 强制降级为 A（红线 #8）
4. **多源交叉验证**：computeCredibility 加权平均 + 官方加成 +10 + 多源一致性加成 +5/+10
5. **来源徽章前端展示**：来源列表 + 推荐行动 + 决策徽章

## 1. 修改了哪些文件

### `src/search/orchestrator.ts`（改造）
- 新增 import：`classifySources` / `extractEvidenceBatch` / `mapToCard` + 类型 `SourceCandidate` / `EvidenceItem` / `OpportunityCard`
- `SearchOrchestratorResult` 新增 3 个 optional 字段：`sourceCandidates` / `evidenceItems` / `opportunityCards`
- `search()` 方法末尾新增步骤 6（V1.3 来源透明）：来源分类 + 证据提取 + 卡片映射
- return 对象新增 3 个字段
- 步骤 6 使用 try-catch 错误隔离，失败不影响 `opportunities` 字段

### `src/api/routes/search.ts`（改造）
- `createDefaultSpec` 中 `visible_level_mapping` 新增 `D: "0-39"`
- `level_definitions` 新增 `D: "不推荐"`

### `web/search.js`（改造）
- 新增 3 个状态变量：`currentSourceCandidates` / `currentEvidenceItems` / `currentOpportunityCards`
- `performSearch` 函数新增来源数据解析（使用 `|| []` 兜底）
- `renderResults` 传递原始索引以匹配 `opportunityCards` 数据
- `renderCard` 函数新增来源徽章 + 决策徽章渲染
- `renderCardDetail` 函数新增来源列表区域 + 推荐行动列表

### `src/search/source-classifier.ts`（新建后修复）
- 修复域名匹配 bug：`domain.includes("x.com")` 误匹配 `v2ex.com`
- 新增 `domainMatches()` 精确匹配函数：`hostname === pattern || hostname.endsWith("." + pattern)`
- `determineSourceType` 和 `extractMediaName` 均改用 `domainMatches`

### `package.json`（改造）
- 新增 `verify:taskC` 脚本：`tsx scripts/verify-taskC.ts`

## 2. 新增了哪些文件

1. `src/search/source-classifier.ts` - 来源分类器（SearchResult → SourceCandidate）
   - 9 类 SourceType 分类（government/official/organizer/media_authoritative/media_general/social/forum/user_uploaded/unknown）
   - 8 级 SourceConfidenceGrade（A1/A2/B1/B2/C1/C3/D4/E5）
   - 域名映射表：GOV_DOMAINS / EDU_DOMAINS / AUTHORITATIVE_MEDIA_DOMAINS / SOCIAL_DOMAINS / FORUM_DOMAINS
   - provider reliability 兜底推断

2. `src/search/evidence-extractor.ts` - 证据提取器（CleanedContent → EvidenceItem[]）
   - 7 组正则模式：DEADLINE_PATTERNS / ORGANIZER_PATTERNS / REWARD_PATTERNS / ELIGIBILITY_PATTERNS / REGION_PATTERNS / APPLICATION_URL_PATTERNS / CONTACT_PATTERNS
   - 8 个字段提取：title(0.95) / deadline(0.8) / organizer(0.75) / reward_or_value(0.7) / eligibility(0.7) / region(0.65) / application_url(0.85) / contact_info(0.7)
   - 纯正则提取，不调用 LLM

3. `src/search/opportunity-card-mapper.ts` - 卡片映射器 + S 级硬规则 + 多源交叉验证
   - `mapToCard`：ScoredOpportunity + SourceCandidate[] + EvidenceItem[] → OpportunityCard
   - `applySLevelGuard`：S 级 + 无官方来源 → 降级为 A，backend_score ≤ 84
   - `computeCredibility`：多源加权平均（官方权重 3x）+ 官方加成 +10 + 多源一致性加成（2源+5/3源+10）
   - `buildSourceBadges`：政府/官方/A1/B1/C1/多源验证 徽章
   - `mapVisibleLevel`：SearchVisibleLevel "hidden" → CardVisibleLevel "D"
   - `determineDecision`：S/A(≥80)→attack / B/C→hold / D→archive

4. `scripts/verify-taskC.ts` - 验收脚本（134 项检查）
   - 8 个验证模块：文件存在性 / SourceClassifier / EvidenceExtractor / OpportunityCardMapper / SearchOrchestrator / 兼容性 / 安全红线 / 回归测试
   - 使用 `spawnSync` 同步执行回归测试，避免 libuv async handle 崩溃

5. `docs/Task_C_完成回报.md` - 本完成回报

## 3. 如何本地运行

```bash
cd c:\Users\test\Desktop\chanceping\changeping
npm run typecheck
npm run dev
```

## 4. 如何测试

### 4.1 类型检查

```bash
npx tsc --noEmit
# exit 0
```

### 4.2 Task C 完整验收

```bash
npx tsx scripts/verify-taskC.ts
# 134 PASS / 0 FAIL
```

### 4.3 跳过回归测试的快速验收

```bash
# PowerShell
$env:SKIP_REGRESSION=1; npx tsx scripts/verify-taskC.ts
# 127 PASS / 0 FAIL
```

### 4.4 回归测试

```bash
npx tsx scripts/verify-e2e-ai-events.ts   # 14 PASS
npx tsx scripts/verify-task038.ts          # 68 PASS
npx tsx scripts/verify-task039.ts          # 57 PASS
npx tsx scripts/verify-task040.ts          # 75 PASS
npx tsx scripts/verify-task041.ts          # 38 PASS
npx tsx scripts/verify-task042.ts          # 31 PASS
npx tsx scripts/verify-task043.ts          # 23 PASS
```

## 5. 验收结果

### 5.1 编译与类型检查

| 项目 | 结果 |
|------|------|
| `npx tsc --noEmit` | ✅ exit 0 |
| 无新增 TypeScript 错误 | ✅ |

### 5.2 Task C 验收脚本

| 模块 | PASS | FAIL |
|------|------|------|
| 1. 文件存在性检查 | 9 | 0 |
| 2. SourceClassifier 单元测试 | 18 | 0 |
| 3. EvidenceExtractor 单元测试 | 17 | 0 |
| 4. OpportunityCardMapper 单元测试 | 22 | 0 |
| 5. SearchOrchestrator 集成测试 | 15 | 0 |
| 6. 兼容性验证 | 17 | 0 |
| 7. 安全红线 | 29 | 0 |
| 8. 回归测试 | 7 | 0 |
| **总计** | **134** | **0** |

### 5.3 回归测试明细

| 回归脚本 | 期望 PASS | 实际 PASS | 结果 |
|----------|-----------|-----------|------|
| verify-e2e-ai-events | 13 | 14 | ✅ |
| verify-task038 | 30 | 68 | ✅ |
| verify-task039 | 57 | 57 | ✅ |
| verify-task040 | 75 | 75 | ✅ |
| verify-task041 | 38 | 38 | ✅ |
| verify-task042 | 30 | 31 | ✅ |
| verify-task043 | 23 | 23 | ✅ |

### 5.4 安全红线

| 红线编号 | 描述 | 结果 |
|----------|------|------|
| #1 | SourceCandidate 只来自真实 SearchResult | ✅ |
| #2 | LLM 不生成 URL | ✅ |
| #3 | official_source_url 来自 SourceCandidate.url | ✅ |
| #4 | EvidenceItem.sourceId 指向已存在 SourceCandidate | ✅ |
| #6 | 无 sourceId 的字段 needsReview = true | ✅ |
| #8 | 无官方链接不进 S 级 | ✅ |
| #10 | 新增字段全部 optional | ✅ |
| 约束 | 未引入新 npm 依赖 | ✅ (dependencies=6, devDependencies=3) |

## 6. 关键设计决策

### 6.1 域名匹配 bug 修复

**问题**：原代码使用 `domain.includes(d)` 进行域名匹配，导致 `"v2ex.com".includes("x.com")` 返回 true，v2ex 被误分类为 social。

**修复**：新增 `domainMatches(hostname, pattern)` 函数，使用精确匹配：
```typescript
function domainMatches(hostname: string, pattern: string): boolean {
  return hostname === pattern || hostname.endsWith("." + pattern);
}
```

### 6.2 SearchVisibleLevel → CardVisibleLevel 映射

**问题**：`SearchVisibleLevel` 包含 "hidden"，但 `CardVisibleLevel` 不包含 "hidden"（含 "D"）。

**修复**：`mapVisibleLevel` 函数将 "hidden" 映射为 "D"：
```typescript
function mapVisibleLevel(level: SearchVisibleLevel): CardVisibleLevel {
  if (level === "hidden") return "D";
  return level as CardVisibleLevel;
}
```

### 6.3 applySLevelGuard 签名扩展

**问题**：任务书代码 `applySLevelGuard(card)` 只接收 card 参数，但需要判断是否有官方来源。

**修复**：扩展签名为 `applySLevelGuard(card, sources?)`，优先使用 sources 数组判断，回退到 sourceBadges。

### 6.4 回归测试执行方式

**问题**：使用 `exec` 异步执行回归测试时，子进程 libuv async handle 崩溃会影响父进程，导致回调不执行。

**修复**：改用 `spawnSync` 同步执行，子进程崩溃不影响父进程，且能正确捕获退出码和信号。

## 7. 文件清单

### 新建文件（5 个）

1. `src/search/source-classifier.ts` - 来源分类器（243 行）
2. `src/search/evidence-extractor.ts` - 证据提取器（189 行）
3. `src/search/opportunity-card-mapper.ts` - 卡片映射器（272 行）
4. `scripts/verify-taskC.ts` - 验收脚本（738 行）
5. `docs/Task_C_完成回报.md` - 本完成回报

### 修改文件（4 个）

1. `src/search/orchestrator.ts` - 新增步骤 6 + 3 个 optional 字段
2. `src/api/routes/search.ts` - createDefaultSpec 补充 D 级映射
3. `web/search.js` - 来源徽章 + 来源列表 + 推荐行动
4. `package.json` - 新增 verify:taskC 脚本

## 8. 对应版本验收清单

本 Task 对应 V1.3 总任务书第十三章"版本验收清单"中的以下条目：

### 13.1 编译与类型检查
- [x] `npx tsc --noEmit` exit 0

### 13.4 来源透明
- [x] SourceCandidate 9 类来源分类
- [x] EvidenceItem 8 个字段级证据提取
- [x] S 级硬规则（无官方链接降级 A）
- [x] computeCredibility 多源交叉验证
- [x] 来源徽章前端展示

### 13.5 兼容性
- [x] ScoredOpportunity 接口未修改
- [x] SearchOrchestratorResult 新增字段全部 optional

### 13.6 安全红线
- [x] SourceCandidate 只来自真实 SearchResult（红线 #1）
- [x] LLM 不生成 URL（红线 #2）
- [x] official_source_url 来自 SourceCandidate.url（红线 #3）
- [x] EvidenceItem.sourceId 指向已存在 SourceCandidate（红线 #4）
- [x] 无 sourceId 的字段 needsReview = true（红线 #6）
- [x] 无官方链接不进 S 级（红线 #8）
- [x] 新增字段全部 optional（红线 #10）

---

**Task C 已完成，可提交 Git。**
