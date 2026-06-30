# Task V1.6-06 完成回报：WatchRules 接入运行链路

## 1. 任务概述

将已实现但未接入主搜索链路的 Watch Rules DSL（`src/watch/` 模块）正式接入运行链路，实现雷达级规则过滤。用户可在雷达上配置 Watch Rules（`+/!/@/#/$/%/*` 前缀语法），搜索编排器在三层筛选（关键词/精筛/证据）之后、入库之前执行规则过滤，被过滤掉的机会不会进入机会库，也不会出现在前端列表中。

## 2. 交付清单

### 2.1 新建文件（1 个）

| 文件 | 说明 |
|---|---|
| `scripts/verify-task-v1.6-06-watch-rules.ts` | 验收脚本，33 项断言（11 静态检查 + 13 功能测试 + 9 端到端 API 测试） |

### 2.2 修改文件（7 个）

| 文件 | 变更要点 |
|---|---|
| `src/schema/radar.ts` | `Radar` 接口新增 `watchRules?: string[]` 字段（雷达级配置，按行存储） |
| `src/agents/radar-store.ts` | `RadarUpdateInput` 新增 `watchRules?: string[]`；`update()` 用 `"watchRules" in patch` 检查以支持显式清空（传 `undefined`/`null` 表示清空） |
| `src/api/types.ts` | `RadarUpdateRequest` 新增 `watchRules?: string[]` |
| `src/search/orchestrator.ts` | `search()` 新增第 4 个参数 `watchRules?: string[]`；新增步骤 7：调用 `parseWatchRules(watchRules.join("\n"))` 解析 + `filterByWatchRules(opportunities, ruleSet, radarType)` 过滤；同步按 url 对齐过滤 `opportunityCards` 和 `sourceCandidates`；`SearchOrchestratorResult` 新增 `watch_rules_before?`、`watch_rules_after?`、`watch_rules_filtered_out?` 三个可选字段 |
| `src/api/routes/radars.ts` | `PUT /:id` 端点添加 `"watchRules" in body` patch 处理（支持显式清空）；`POST /:id/run` 端点传入 `radar.watchRules` 作为第 4 参数 |
| `src/scheduler/triggers.ts` | `executeScheduledRadarSearch` 参数类型添加 `watchRules?: string[]`；调用 `orchestrator.search()` 传入 `radar.watchRules`；返回结果添加 `watch_rules_before/after/filtered_out` 字段 |
| `package.json` | 新增 `"verify:v16:watch-rules": "tsx scripts/verify-task-v1.6-06-watch-rules.ts"` 脚本 |

## 3. 关键设计决策

### 3.1 接入点选择：三层筛选之后、入库之前

Watch Rules 过滤发生在搜索编排器的**步骤 7**，即：
- 步骤 1-3：搜索聚合
- 步骤 4：关键词粗筛
- 步骤 5：LLM 精筛
- 步骤 6：证据追踪
- **步骤 7：Watch Rules 过滤（新增）**
- 步骤 8：入库

这样设计的原因：
1. Watch Rules 是用户级"我要不要看到这条"的最终偏好过滤，应在所有自动筛选之后执行
2. 被过滤掉的机会不入库，避免污染机会库
3. `evidenceItems` 保留全部（证据用于审计），仅 `opportunities`、`opportunityCards`、`sourceCandidates` 被同步过滤

### 3.2 数据结构对齐：按 url 同步过滤

`filterByWatchRules` 只返回过滤后的 `ScoredOpportunity[]`，但搜索结果还包含 `opportunityCards` 和 `sourceCandidates` 两类伴生数据。为保持三者一致，使用 `filteredUrls = new Set(filtered.map(o => o.search_result.url))` 按 url 对齐过滤另外两个数组。

### 3.3 显式清空语义：`in` 检查 vs 真值检查

`update()` 方法使用 `"watchRules" in patch` 而非 `patch.watchRules !== undefined` 检查，目的是支持显式清空：
- 不传 `watchRules` 字段 → 不修改（保持原值）
- 传 `watchRules: null` 或 `watchRules: undefined` → 显式清空
- 传 `watchRules: ["+AI"]` → 更新为新值

### 3.4 parseWatchRules 接受多行文本

`filterByWatchRules` 接受 `WatchRuleSet`（已解析）而非 `string[]`，因此需先用 `parseWatchRules(watchRules.join("\n"))` 将 `string[]` 合并为多行文本再解析。这与 Watch Rules DSL 的全局规则存储格式（`LocalWatchStore` 存储为多行文本）保持一致。

## 4. 验证结果

### 4.1 TypeScript 编译
```
npx tsc --noEmit
```
**结果：exit 0（无错误）**

### 4.2 V1.6-06 验收脚本
```
npx tsx scripts/verify-task-v1.6-06-watch-rules.ts
```
**结果：33 PASS / 0 FAIL**

- A. 静态检查（11 项）：全部 PASS
  - A1-A11：验证 7 个源文件含 watchRules 接入点（字段定义、参数、调用、patch 处理）
- B. 功能测试（13 项）：全部 PASS
  - B1-B2：不传 watchRules 基线行为不变
  - B3-B5：`+不存在的关键词XYZ123` 过滤掉所有结果
  - B6-B8：`+黑客松` 保留含"黑客松"的结果（mock 数据中只有 1 条），验证 after < before
  - B9-B10：`!AI` 排除含 AI 的结果
  - B11-B12：`@ai_competition` 保留匹配 radar_type 的结果
  - B13：空数组 watchRules 行为不变
- C. 端到端 API 测试（9 项）：全部 PASS
  - C1-C4：创建雷达 → PUT 更新 watchRules → GET 验证持久化
  - C5：PUT 传 `watchRules=null` 显式清空
  - C6-C9：激活雷达 → POST /run → 验证返回的 opportunityCards 均含 AI（watchRules 生效）

### 4.3 回归测试

#### verify:v15（241 PASS / 0 FAIL）
```
npm run verify:v15
```
- V1.5-01 模型：56 PASS
- V1.5-02 存储：52 PASS
- V1.5-03 API：48 PASS
- V1.5-04 UI：23 PASS
- V1.5-05 生成器：17 PASS
- V1.5-06 定时：15 PASS
- V1.5-07 配额：14 PASS
- V1.5-08 报告：16 PASS

#### verify:v15:e2e（326 PASS / 0 FAIL）
```
npm run verify:v15:e2e
```
- verify-v1.5-e2e.ts：29 PASS
- verify-e2e-v13.ts：43 PASS
- verify-task038.ts：68 PASS
- verify-task022.ts：73 PASS
- verify-task028.ts：119 PASS

## 5. Git 提交

```
commit a08e916
Task V1.6-06 WatchRules DSL 接入运行链路
8 files changed, 715 insertions(+), 3 deletions(-)
```

工作区干净，当前 HEAD 距 origin/main 7 个提交。

## 6. 工作流总结

```
用户配置 watchRules（PUT /api/radars/:id）
    ↓
存储到 Radar.watchRules: string[]
    ↓
POST /api/radars/:id/run 或 定时触发
    ↓
orchestrator.search(spec, query, providerRouting, radar.watchRules)
    ↓
步骤 1-6：搜索 + 关键词粗筛 + LLM 精筛 + 证据追踪
    ↓
步骤 7（新增）：parseWatchRules + filterByWatchRules 过滤
    ├─ 过滤 opportunities（ScoredOpportunity[]）
    ├─ 同步过滤 opportunityCards（按 url 对齐）
    └─ 同步过滤 sourceCandidates（按 url 对齐）
    ↓
步骤 8：入库（仅过滤后的机会进入机会库）
    ↓
返回 watch_rules_before/after/filtered_out 统计字段
```

## 7. 后续衔接

V1.6-06 完成，V1.6b 阶段进度：
- ✅ V1.6-05 定时设置前端 UI（commit e6d6909）
- ✅ V1.6-06 WatchRules 接入（commit a08e916）
- ⏳ V1.6-07 增量标签接入（pending）
- ⏳ V1.6-08 providerRouting fallback（pending）
- ⏳ V1.6-09 生成失败前端降级（pending）
