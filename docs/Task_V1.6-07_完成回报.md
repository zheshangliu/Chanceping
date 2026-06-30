# Task V1.6-07 增量标签接入 完成回报

## 1. 任务概述

**任务书**：V1.6-07增量标签接入任务书.md
**Git Commit**：`0e46972`（含 V1.6-07 主体 + V1.6a 五维自检修复）
**提交时间**：2026-06-30
**状态**：✅ 全部完成，所有验收通过

## 2. 目标

接入 `IncrementalTagger`（SHA-256 hash + change_ratio）到搜索运行链路，实现：
- 机会入库时计算 contentHash / changeRatio / incremental 三字段
- 搜索时复用 store 中已有 card.ai_analysis（命中则跳过 AI 精筛），降低 LLM 调用成本
- dedupKey 计算与 mapToCard 入库路径保持一致（guid=url 兼容）

## 3. 交付清单

### 3.1 新建文件（2 个）
| 文件 | 说明 |
|------|------|
| `scripts/verify-task-v1.6-07-incremental.ts` | 48 项断言验收脚本（14 静态 + 17 功能 + 9 搜索复用 + 9 端到端 API） |
| `docs/Task_V1.6-07_完成回报.md` | 本完成回报 |

### 3.2 修改文件（6 个，V1.6-07 主体）
| 文件 | 改动 |
|------|------|
| `src/schema/opportunity-card.ts` | OpportunityCard 新增 `ai_analysis?: string` 字段 |
| `src/agents/opportunity-store.ts` | StoreEntry 新增 contentHash/changeRatio/incremental；OpportunityStore 接口新增 `getByDedupKey`；LocalFileStore.add/addBatch 接入 `computeIncrementalTag` |
| `src/search/orchestrator.ts` | SearchOrchestratorConfig 新增 opportunityStore；步骤4 拆分 cached/fresh（命中 ai_analysis 跳过 AI 精筛）；步骤6.3 写入 card.ai_analysis；返回 ai_filter_skipped/ai_filter_executed |
| `src/api/routes/radars.ts` | SearchOrchestrator 构造传入 `opportunityStore: ctx.store` |
| `src/scheduler/triggers.ts` | 两处 SearchOrchestrator 构造传入 `opportunityStore: ctx.store` |
| `package.json` | 新增 `verify:v16:incremental` 脚本 |

### 3.3 随带提交的 V1.6a 自检修复（5 个文件）
| 文件 | 改动 |
|------|------|
| `src/agents/radar-store.ts` | normalizeLegacySchedule 迁移后补算 nextRunAt（避免旧定时静默失效） |
| `src/api/routes/web-ui.ts` | 注册 radars.js/radar-detail.js 静态路由（原 404） |
| `src/api/server.ts` | 增加 isTicking 守卫（避免 tick 重叠执行） |
| `src/scheduler/scheduler.ts` | 三重守卫（schedule enabled + status active + 无 currentRunId） |
| `src/agents/meilisearch-store.ts` | radarIds 多雷达归属去重追加 + getByDedupKey 实现 |

## 4. 核心设计

### 4.1 增量标签计算（入库时）
```
contentHash = SHA-256(title + match_reason + official_source_url)
if existing.contentHash == newContentHash:
    changeRatio = 0, incremental = true
else:
    changeRatio = computeChangeRatio(old, new)  // 0-1
    incremental = changeRatio < 0.1
```

### 4.2 搜索复用逻辑（步骤 4）
```
for each result in ruleResult.passed:
    dedupKey = computeDedupKey(result.title, result.url, result.url)  // 兼容 mapToCard 的 guid=url
    existing = store.getByDedupKey(dedupKey)
    if existing && existing.card.ai_analysis:
        → cached（跳过 AI 精筛，复用 reason）
    else:
        → fresh（执行 AI 精筛）
aiPassed = [...cached, ...freshPassed]
```

### 4.3 关键决策
- **复用条件用 `card.ai_analysis` 非空**（而非 `incremental === true`）：因为 incremental 在首次入库时为 false，第二次运行时 store 中的状态仍是首次入库的 false，会导致永远无法复用。
- **dedupKey 计算传 `result.url` 作为第三参数 guid**：mapToCard 设置 `guid: scored.guid ?? url`，搜索结果无 guid 时 card.guid=url，computeDedupKey 优先用 guid，故 dedupKey=sha256(url).slice(0,16)。orchestrator 检查时必须传 `result.url` 作为 guid 以保持一致。

## 5. 验证结果

| 验证项 | 结果 |
|--------|------|
| `npx tsc --noEmit` | ✅ exit 0 |
| `verify-task-v1.6-07-incremental.ts` | ✅ 48 PASS / 0 FAIL |
| `npm run verify:v15`（回归） | ✅ 241 PASS / 0 FAIL |
| `npm run verify:v15:e2e`（回归） | ✅ 326 PASS / 0 FAIL |

### 验收脚本分组（48 项）
- A. 静态检查 14 项：字段存在性 + 接口签名 + 类型定义
- B. 功能测试 17 项：StoreEntry 增量标签计算（首次入库/二次相同/内容变化/跨 store 隔离）
- C. 搜索复用测试 9 项：首次全量精筛 → 第二次跳过缓存（ai_filter_skipped > 0）
- D. 端到端 API 测试 9 项：POST /api/radars/:id/run 两次运行验证

## 6. 工作量统计

- 文件变更：13 个（2 新建 + 11 修改）
- 代码增量：+1108 行 / -13 行
- Git 提交：`0e46972`（main 分支，领先 origin/main 8 个提交）

## 7. 后续依赖

V1.6-07 完成后，V1.6b 阶段剩余：
- V1.6-08 providerRouting fallback（primary 失败自动切换 fallback）
- V1.6-09 生成失败前端降级（AI 生成失败时前端降级提示）
