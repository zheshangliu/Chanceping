# Task V1.5-03 完成回报：API 最小闭环

> 日期：2026-06-30 | 版本：V1.0 | 阶段：V1.5a-2

---

## 一、任务概述

提供 REST API 管理雷达的创建/读取/更新/删除/列表/运行/激活，并让现有搜索 API 支持 `radar_id`。这是 V1.5a 的核心后端闭环——前端 UI（Task V1.5-04）和 AI 生成器（Task V1.5-05）都依赖本 Task 的 API。

---

## 二、交付清单

### 新建文件（2 个）

| 文件 | 内容 |
|---|---|
| `src/api/routes/radars.ts` | 7 个雷达管理端点（POST/GET/GET:id/PUT/DELETE/POST:id/run/POST:id/activate）+ kindToRadarType 辅助函数 + errorResponse 辅助函数（约 275 行） |
| `scripts/verify-task-v1.5-03-api.ts` | 验收脚本，19 项 API 断言（48 PASS） |

### 改造文件（5 个）

| 文件 | 改动 |
|---|---|
| `src/api/types.ts` | 新增 `RadarCreateRequest` / `RadarUpdateRequest` / `RadarRunRequest` / `RadarRunResult` 4 个类型；`SearchRequest` 新增 `radar_id?: string` 字段；新增 3 个 `import type` |
| `src/api/routes/search.ts` | 支持 `body.radar_id` 优先级（radar_id > spec > 默认 spec）；搜索结果 opportunities 每条附加 `radarId` |
| `src/api/app.ts` | 注册 `/api/radars` 路由（新增 import + `app.route`） |
| `src/agents/opportunity-store.ts` | `StoreEntry` 新增 `radarId?: string`；`StoreQuery` 新增 `radarId?: string` 过滤；`OpportunityStore.add/addBatch` 接口新增可选第三参数 `radarId`；`LocalFileStore` 实现同步改造 |
| `src/agents/radar-store.ts` | `RadarUpdateInput` 新增 `status` / `currentRunId` / `lastRunStatus` / `lastRunAt` 4 个字段；`JsonRadarStore.update()` 处理新字段（`currentRunId` 用 `in` 操作符支持显式清空） |
| `src/agents/meilisearch-store.ts` | 同步 `OpportunityStore` 接口变更（add/addBatch 新增 radarId 参数；list 新增 radarId 过滤） |

---

## 三、核心设计

### 3.1 雷达 CRUD API（7 端点）

| 方法 | 路径 | 用途 | 关键逻辑 |
|---|---|---|---|
| POST | /api/radars | 创建雷达 | 调用 `registry.createCustomRadar()`，返回 Radar（status=draft） |
| GET | /api/radars | 列出雷达 | 支持 `?status=...&kind=...&includeArchived=true` 过滤 |
| GET | /api/radars/:id | 获取详情 | 不存在返回 404 `RADAR_NOT_FOUND` |
| PUT | /api/radars/:id | 更新雷达 | 内置雷达返回 403 `RADAR_NOT_EDITABLE` |
| DELETE | /api/radars/:id | 归档雷达 | 内置雷达返回 403 `RADAR_NOT_DELETABLE`；软删除（status=archived） |
| POST | /api/radars/:id/activate | 激活雷达 | 仅 draft 状态可激活；内置雷达返回 403 |
| POST | /api/radars/:id/run | 手动运行 | 完整运行流程（见 3.2） |

### 3.2 运行端点流程（POST /api/radars/:id/run）

1. 校验：radar 存在 → status=active（否则 400 `RADAR_NOT_ACTIVE`）→ currentRunId 为空（否则 409 `RADAR_ALREADY_RUNNING`）
2. 创建 `RadarRun`（mode=manual, triggeredBy=user）
3. 更新 `Radar.currentRunId = run.id`
4. 调用 `SearchOrchestrator.search(radar.spec, body.query)` 执行搜索
5. 搜索结果存入 `OpportunityStore.addBatch(cards, radarType, radarId)` 绑定 radarId
6. 更新 `RadarRun`（status=succeeded, finishedAt, totalRaw, totalScored, opportunityKeys）
7. 更新 `Radar`（currentRunId=undefined, lastRunStatus=succeeded, lastRunAt=now）
8. 返回 `{ run, opportunities }`（opportunities 每条附加 radarId）

**错误处理**：搜索失败时更新 RadarRun 为 failed，Radar.currentRunId 清空，lastRunStatus=failed。

### 3.3 /api/search 支持 radar_id

优先级：`body.radar_id` > `body.spec` > 默认 spec

- `body.radar_id` 存在 → 从 `registry.getRadarById(radar_id)` 取 spec
- 雷达不存在 → 404 `RADAR_NOT_FOUND`
- 有 radar_id 时，返回结果 opportunities 每条附加 `radarId`
- 旧逻辑（body.spec）不破坏

### 3.4 OpportunityStore 绑定 radarId

- `StoreEntry` 新增 `radarId?: string`（可选，向后兼容）
- `StoreQuery` 新增 `radarId?: string` 过滤
- `add` / `addBatch` 新增可选第三参数 `radarId`
- `LocalFileStore` 和 `MeilisearchStore` 同步改造

### 3.5 RadarUpdateInput 新增字段

```typescript
export interface RadarUpdateInput {
  name?: string;
  spec?: RadarRequirementSpec;
  privacy?: RadarPrivacy;
  providerRouting?: ProviderRouting;
  status?: RadarStatus;        // V1.5-03 新增
  currentRunId?: string;       // V1.5-03 新增（undefined 表示显式清空）
  lastRunStatus?: LastRunStatus; // V1.5-03 新增
  lastRunAt?: string;          // V1.5-03 新增
}
```

**关键设计**：`JsonRadarStore.update()` 中 `currentRunId` 使用 `"currentRunId" in patch` 检查 key 是否存在，传 `undefined` 表示显式清空（避免与"未传该字段"混淆）。

### 3.6 错误码体系

| 错误码 | HTTP | 说明 |
|---|---|---|
| RADAR_NOT_FOUND | 404 | 雷达不存在 |
| RADAR_NOT_EDITABLE | 403 | 内置雷达不可编辑 |
| RADAR_NOT_DELETABLE | 403 | 内置雷达不可删除 |
| RADAR_NOT_ACTIVE | 400 | 雷达未激活，不能运行 |
| RADAR_ALREADY_RUNNING | 409 | 雷达正在运行中 |

---

## 四、验证结果

### 4.1 类型检查

```
npx tsc --noEmit → exit 0
```

### 4.2 验收脚本

```
npx tsx scripts/verify-task-v1.5-03-api.ts → 48 PASS / 0 FAIL
```

| 章节 | 检查项 | 结果 |
|---|---|---|
| 6.1 雷达 CRUD | 1-10（19 项子检查） | 全 PASS |
| 6.2 激活与运行 | 11-16（13 项子检查） | 全 PASS |
| 6.3 /api/search 支持 radar_id | 17-19（6 项子检查） | 全 PASS |

### 4.3 回归测试

| 脚本 | 结果 |
|---|---|
| `verify-task038.ts` | 68 PASS / 0 FAIL |
| `verify-e2e-v13.ts` | 43 PASS / 0 FAIL |
| `verify-task-v1.5-01-model.ts` | 56 PASS / 0 FAIL |
| `verify-task-v1.5-02-store.ts` | 52 PASS / 0 FAIL |

---

## 五、注意事项

1. **同步运行**：V1.5a 的手动运行是同步等待结果（不做异步队列），搜索完成后直接返回
2. **Mock 模式**：`DATA_MODE=mock + LLM_MODE=mock` 时搜索返回预设机会，运行仍走完整流程
3. **radar_id 优先级**：`body.radar_id > body.spec > 默认 spec`，三者只取一个
4. **不接 LLM**：本 Task 纯 API 层，不调 LLM（AI 生成器在 Task V1.5-05）
5. **Orchestrator 复用**：直接调用现有 `SearchOrchestrator`，不重写搜索逻辑
6. **currentRunId 清空**：`JsonRadarStore.update()` 用 `in` 操作符区分"未传字段"和"显式清空"
7. **测试隔离**：验收脚本使用临时文件 `data/radars-v1.5.03-test.json` 等，测试后自动清理
8. **opportunityId 绑定**：opportunities 通过运行时 spread 附加 `radarId` 属性（ScoredOpportunity 类型本身无此字段）
9. **kindToRadarType**：`RadarKind`（4 值含 custom）→ `RadarType`（3 值）转换，custom 默认 `ai_competition`
