# Task 019e｜V0.8 验证与收口（整合验证脚本 + package.json 元数据）完成回报

任务编号：Task 019e（Task 019 拆分第 5 份，最后一份）
所属版本：V0.8（搜索层 + LLM）
日期：2026-06-28
执行方：TRAE IDE
验收方：TRAE Work（总控台）

---

## 1. 任务概述

Task 019 拆分为 5 个子任务（019a-019e）顺序执行。本任务是最后一份，负责 V0.8 搜索层的收口验证：

1. **整合验证脚本**：新建 `scripts/verify-task019.ts`，汇总 019a-019d 所有验收项的端到端集成测试（6 个 section，149 项断言）
2. **package.json 元数据更新**：version 升至 0.8.0，description 更新，scripts.verify 指向 verify-task019.ts
3. **V0.8 验收清单汇总**：确认 019a-019d 所有交付物齐全

所有验证命令（10 条）已通过，合计 1285 项断言全部 PASS。

---

## 2. 文件清单

### 2.1 修改了哪些文件

| # | 文件路径 | 修改内容 |
|---|---|---|
| 1 | `package.json` | version 0.7.5 → 0.8.0；description 更新为含"V0.8 搜索层 + LLM 版"；scripts.verify 指向 verify-task019.ts |

### 2.2 新增了哪些文件

| # | 文件路径 | 行数 | 用途 |
|---|---|---|---|
| 1 | `scripts/verify-task019.ts` | 716 | V0.8 整合验证脚本（6 个 section，149 项断言） |

合计：新增 1 个文件，修改 1 个文件。

---

## 3. 整合验证脚本说明（`scripts/verify-task019.ts`）

V0.8 搜索层的端到端集成验证脚本，分 6 个 section：

### Section 1：基础设施验证（复用 019a：T1/T3/T4）
- T1 `validateLink`：HTTPS/userinfo 绕过/私有 IP/localhost/非法格式/批量校验（6 项）
- T3 `normalizeUrl`：移除 utm_source/小写域名/参数排序/移除 fragment/升级 https/批量标准化/空字符串（8 项）
- T4 `parseJsonWithRepair`：标准 JSON/尾逗号/单引号/未引号 key/Markdown 代码块/正则提取/截断补全/文本兜底/空字符串/严格模式（11 项）

### Section 2：LLM + 去重 + 渠道验证（复用 019b：QwenAdapter/T2/T5）
- QwenAdapter Mock 模式：可实例化/Mock 返回 content 非空/Mock parsed 字段/可解析 JSON/无 apiKey 不抛错（5 项）
- T2 `computeDedupKey`：相同 title+url → 相同 key/不同 title → 不同 key/相同 guid → 相同 key（guid 优先）/不同 guid → 不同 key/空 guid 等价于不传 guid（5 项）
- T5 渠道格式：wechat/email/web 三渠道的 channel/max_length/format/emoji_enabled（8 项）
- T5 渠道渲染：wechat/email/web 三渠道渲染非空 + wechat 含品牌名（4 项）

### Section 3：搜索层框架验证（复用 019c：types/registry/serper/jina/cleaner）
- types.ts：SearchResult/CleanedContent 类型定义完整性（2 项）
- ProviderRegistry：单例含 serper/是 SerperProvider/getEnabled/getByRadarType（5 项）
- SerperProvider Mock 搜索：返回数组/4-5 条/含非空 title+url+snippet/URL 全部 HTTPS/通过 T1 校验/无 utm_source/关键词路由/healthCheck（9 项）
- JinaReaderFetcher Mock 抓取：返回 CleanedContent/main_text 非空/fetch_success/word_count（4 项）
- cleanContent HTML 清洗：HTML 标签移除/script 移除/style 移除/保留正文/title 提取/fetch_success/word_count/空字符串不崩溃（8 项）

### Section 4：T10 三层筛选验证（复用 019d：rule/ai/scorer/orchestrator）
- ruleFilter：passed/rejected 是数组/去重唯一/must_exclude rejected/excluded_regions rejected/无关键词策略不拒绝/空数组（8 项）
- aiFilter：Mock 返回/passed/rejected 是数组/AIFilterItem 四字段/AI 赛事类 relevance >= 50/minRelevance=75 过滤更严/空数组（7 项）
- scoreOpportunities：返回 ScoredOpportunity[]/含 chance_score/6 字段/Evidence=75/visible_level/backend_score=total/guid/total 权重验证/空数组（10 项）
- SearchOrchestrator：返回 SearchOrchestratorResult/total_raw > 0/total_rule_passed > 0/duration_ms > 0/errors 是数组/total_raw >= total_rule_passed/total_rule_passed >= total_ai_passed/total_scored === opportunities.length/enableContentFetch=false（10 项）

### Section 5：端到端管道集成验证（019e 独有）
- 构造 Mock RadarRequirementSpec（AI 赛事雷达）
- 调用 `SearchOrchestrator.search(spec)` 执行完整搜索
- 验证 `total_raw > 0` / `total_rule_passed <= total_raw` / `total_ai_passed <= total_rule_passed` / `total_scored === opportunities.length` / `duration_ms > 0` / `errors` 为空数组
- 验证每条 opportunity 含完整 `chance_score`（6 字段）和 `visible_level`（S/A/B/C/hidden）
- 验证每项含完整字段（search_result/cleaned_content/guid/relevance/backend_score）
- 验证 Mock 模式下 Evidence = 75（serper B 级）
- 验证 backend_score = chance_score.total
- 第二次调用验证稳定性（13 项）

### Section 6：V0.8 交付物完整性检查（019e 独有）
- 019a 的 3 个文件存在（link-validator/url-normalizer/json-repair）
- 019b 的 qwen-adapter.ts 存在 + 3 个修改文件导出正确（guid/computeDedupKey/renderRemindersForChannel）
- 019c 的 5 个文件存在（types/provider-registry/serper/jina-reader/content-cleaner）
- 019d 的 4 个文件存在（rule-filter/ai-filter/opportunity-scorer/orchestrator）
- 019e 的 verify-task019.ts 存在
- package.json version=0.8.0 / description 含 V0.8 / scripts.verify 指向 verify-task019.ts
- 依赖不变（ajv/ajv-formats/i18next + tsx/typescript）（25 项）

---

## 4. package.json 元数据更新

| 字段 | 旧值 | 新值 |
|---|---|---|
| `version` | "0.7.5" | "0.8.0" |
| `description` | "盯一下 ChancePing - AI 机会情报系统（V0.7.5 集成验证版）" | "盯一下 ChancePing - AI 机会情报系统（V0.8 搜索层 + LLM 版）" |
| `scripts.verify` | "tsx scripts/verify-acceptance.ts" | "tsx scripts/verify-task019.ts" |
| 其他字段 | - | 不变（dependencies/devDependencies/private/scripts 其他项） |

---

## 5. V0.8 全部交付物是否齐全（019a-019e）

| 模块 | 子任务 | 文件 | 自检结果 |
|---|---|---|---|
| T1 域名安全校验 | 019a | `src/utils/link-validator.ts` | ✅ |
| T3 URL 标准化 | 019a | `src/utils/url-normalizer.ts` | ✅ |
| T4 JSON 三重修复 | 019a | `src/utils/json-repair.ts` | ✅ |
| LLM Qwen Adapter | 019b | `src/agents/qwen-adapter.ts` | ✅ |
| T2 guid 去重 | 019b | `src/schema/opportunity-card.ts`（修改） | ✅ |
| T2 去重升级 | 019b | `src/agents/opportunity-store.ts`（修改） | ✅ |
| T5 渠道格式 | 019b | `src/agents/reminder-renderer.ts`（修改） | ✅ |
| 搜索层类型 | 019c | `src/search/types.ts` | ✅ |
| T6 机会源注册表 | 019c | `src/search/provider-registry.ts` | ✅ |
| Serper Provider | 019c | `src/search/providers/serper.ts` | ✅ |
| Jina Reader 抓取 | 019c | `src/search/content/jina-reader.ts` | ✅ |
| 内容清洗 | 019c | `src/search/content/content-cleaner.ts` | ✅ |
| T10 规则粗筛 | 019d | `src/search/rule-filter.ts` | ✅ |
| T10 AI 精筛 | 019d | `src/search/ai-filter.ts` | ✅ |
| T10 机会评分 | 019d | `src/search/opportunity-scorer.ts` | ✅ |
| T10 搜索编排器 | 019d | `src/search/orchestrator.ts` | ✅ |
| V0.8 整合验证 | 019e | `scripts/verify-task019.ts` | ✅ |
| package.json 元数据 | 019e | `package.json`（修改） | ✅ |

**合计：新增 17 个文件，修改 4 个文件，不引入新 npm 依赖。全部齐全。**

---

## 6. 约束遵守情况

| 约束 | 遵守情况 |
|---|---|
| 不新增功能代码 | ✅ 只新增验证脚本 + 修改 package.json |
| 不修改 019a-019d 的交付文件 | ✅ 未修改任何 019a-019d 交付的功能代码 |
| 不引入新 npm 依赖 | ✅ dependencies/devDependencies 不变 |
| 不调用真实 API | ✅ 验证脚本全部走 Mock 模式（QwenAdapter Mock + SerperProvider Mock + JinaReader Mock） |

---

## 7. 如何本地运行

```bash
# 编译检查
npx tsc --noEmit

# 运行 V0.8 整合验证脚本
npx tsx scripts/verify-task019.ts

# 运行全部回归验证
npx tsx scripts/verify-task019a.ts
npx tsx scripts/verify-task019b.ts
npx tsx scripts/verify-task019c.ts
npx tsx scripts/verify-task019d.ts
npx tsx scripts/integration-test.ts
npx tsx scripts/verify-task014.ts
npx tsx scripts/verify-task015.ts
npx tsx scripts/verify-task016.ts
npx tsx scripts/verify-task018.ts

# 或使用 npm scripts
npm run typecheck   # tsc --noEmit
npm run verify      # tsx scripts/verify-task019.ts
npm run integration-test
```

---

## 8. 如何测试

验证脚本 `scripts/verify-task019.ts` 覆盖 6 个 section，共 **149 项断言**：

- Section 1 基础设施（T1/T3/T4）：25 项
- Section 2 LLM+去重+渠道（QwenAdapter/T2/T5）：22 项
- Section 3 搜索层框架（types/registry/serper/jina/cleaner）：28 项
- Section 4 T10 三层筛选（rule/ai/scorer/orchestrator）：35 项
- Section 5 端到端管道集成（019e 独有）：13 项
- Section 6 V0.8 交付物完整性（019e 独有）：26 项

---

## 9. 哪些功能还没做

| 不做 | 何时做 |
|---|---|
| 搜索结果入库 LocalFileStore | V0.9 |
| Watch Rules DSL | Task 020 |
| API 层（Hono REST 端点） | Task 021 |
| Web UI | V0.9 |
| 博查/Exa provider 实现 | V0.9+ |
| ConversationManager 注入 QwenAdapter | V0.9 |
| MeilisearchStore | V0.9+ |

---

## 10. 下一步建议

1. **Task 020（双套 LLM API 策略方案）**：实现双套 LLM API 策略，支持 Qwen + 备用 LLM 的自动切换
2. **Task 021（API 层）**：基于 Hono 实现 REST 端点，暴露搜索/机会库/提醒等能力
3. **V0.9**：搜索结果入库 LocalFileStore、Web UI、博查/Exa provider 实现、ConversationManager 注入 QwenAdapter

---

## 11. 交付验证红线（实际运行输出）

以下 10 条命令均已实际运行通过：

### 11.1 `npx tsc --noEmit`

```
===TSC_EXIT:0===
```

### 11.2 `npx tsx scripts/verify-task019.ts`

```
=== Task 019 整合验证（V0.8 收口）===

[Section 1] 基础设施验证（T1 域名安全 + T3 URL 标准化 + T4 JSON 修复）
  ...（25 项 PASS）

[Section 2] LLM + 去重 + 渠道验证（QwenAdapter + T2 guid + T5 渠道）
  ...（22 项 PASS）

[Section 3] 搜索层框架验证（types + registry + serper + jina + cleaner）
  ...（28 项 PASS）

[Section 4] T10 三层筛选验证（rule-filter + ai-filter + scorer + orchestrator）
  ...（35 项 PASS）

[Section 5] 端到端管道集成验证（019e 独有）
  ...（13 项 PASS）

[Section 6] V0.8 交付物完整性检查（019e 独有）
  ...（26 项 PASS）

=== 汇总 ===
PASS: 149
FAIL: 0

✅ 全部通过
===EXIT:0===
```

### 11.3 `npx tsx scripts/verify-task019a.ts`

```
=== Task 019a 验收检查 ===
...（47 项 PASS）
=== 汇总 ===
Task 019a 验收结果：PASS 47 / FAIL 0
===019a_EXIT:0===
```

### 11.4 `npx tsx scripts/verify-task019b.ts`

```
=== Task 019b 验收检查 ===
...（108 项 PASS）
=== 汇总 ===
PASS: 108
FAIL: 0

✅ 全部通过
===019b_EXIT:0===
```

### 11.5 `npx tsx scripts/verify-task019c.ts`

```
=== Task 019c 验收检查 ===
...（128 项 PASS）
=== 汇总 ===
PASS: 128
FAIL: 0

✅ 全部通过
===019c_EXIT:0===
```

### 11.6 `npx tsx scripts/verify-task019d.ts`

```
=== Task 019d 验收检查 ===
...（146 项 PASS）
=== 汇总 ===
PASS: 146
FAIL: 0

✅ 全部通过
===019d_EXIT:0===
```

### 11.7 `npx tsx scripts/integration-test.ts`

```
================================
Task 017 - V0.7.5 端到端集成测试
================================
基准日期（UTC）：2026-06-28
...
================================
PASS: 91 / FAIL: 0
================================
全部 5 阶段 15 步骤端到端集成测试通过。
===INTEG_EXIT:0===
```

### 11.8 `npx tsx scripts/verify-task014.ts`

```
=== Task 014 验收检查 ===
...（143 项 PASS）
=== 验收汇总 ===
PASS: 143
FAIL: 0
===014_EXIT:0===
```

### 11.9 `npx tsx scripts/verify-task015.ts`

```
=== Task 015 验收检查 ===
...（177 项 PASS）
=== 验收汇总 ===
PASS: 177
FAIL: 0
===015_EXIT:0===
```

### 11.10 `npx tsx scripts/verify-task016.ts`

```
=== Task 016 验收检查 ===
...（157 项 PASS）
=== 验收汇总 ===
PASS: 157
FAIL: 0
===016_EXIT:0===
```

### 11.11 `npx tsx scripts/verify-task018.ts`

```
=== 5.1 i18n 核心模块 ===
...（139 项 PASS）
============================================================
Task 018 验收结果：PASS 139 / FAIL 0
============================================================
===018_EXIT:0===
```

---

## 12. 验证汇总

| # | 命令 | 断言数 | 结果 |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | - | exit 0 |
| 2 | `npx tsx scripts/verify-task019.ts` | 149 | PASS |
| 3 | `npx tsx scripts/verify-task019a.ts` | 47 | PASS |
| 4 | `npx tsx scripts/verify-task019b.ts` | 108 | PASS |
| 5 | `npx tsx scripts/verify-task019c.ts` | 128 | PASS |
| 6 | `npx tsx scripts/verify-task019d.ts` | 146 | PASS |
| 7 | `npx tsx scripts/integration-test.ts` | 91 | PASS |
| 8 | `npx tsx scripts/verify-task014.ts` | 143 | PASS |
| 9 | `npx tsx scripts/verify-task015.ts` | 177 | PASS |
| 10 | `npx tsx scripts/verify-task016.ts` | 157 | PASS |
| 11 | `npx tsx scripts/verify-task018.ts` | 139 | PASS |
| | **合计** | **1285** | **全部 PASS** |

---

## 附录：Task 019 拆分总览

```
Task 019（V0.8 搜索层 + LLM + T1-T6）
├── 019a：基础设施三件套（T1 + T3 + T4）          ← 3 新增，0 修改
├── 019b：LLM Qwen Adapter + T2 + T5              ← 2 新增，3 修改
├── 019c：搜索层框架（T6 + Serper + Jina + 清洗）   ← 6 新增，0 修改
├── 019d：T10 三层筛选（规则 + AI + 评分 + 编排）    ← 5 新增，0 修改
└── 019e：验证与收口（整合验证 + package.json）     ← 1 新增，1 修改
                                                 ─────────────
                                                 17 新增，4 修改
```

**执行顺序**：019a → 019b → 019c → 019d → 019e（严格顺序，不可并行）

**V0.8 全部交付物齐全，1285 项断言全部 PASS，V0.8 收口完成。**
