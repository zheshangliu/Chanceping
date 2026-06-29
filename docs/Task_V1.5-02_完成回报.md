# Task V1.5-02 完成回报：存储与注册表

> 日期：2026-06-30 | 版本：V1.0 | 阶段：V1.5a-1

---

## 一、任务概述

建立雷达持久化层（RadarStore + RadarRunStore）和注册表（RadarRegistry），替代当前 3 个硬编码雷达，同时兼容旧代码。基于 Task V1.5-01 的类型修正，实现存储和注册逻辑。

---

## 二、交付清单

### 新建文件（3 个）

| 文件 | 内容 |
|---|---|
| `src/agents/radar-store.ts` | RadarStore 接口 + JsonRadarStore + RadarRunStore 接口 + JsonRadarRunStore + 相关 Input/Filter 类型（约 300 行） |
| `src/agents/radar-registry.ts` | RadarRegistry 类 + 3 个内置雷达定义 + 幂等初始化 + provider 兼容逻辑（约 180 行） |
| `scripts/verify-task-v1.5-02-store.ts` | 验收脚本，32 项验收检查（52 PASS） |

### 改造文件（2 个）

| 文件 | 改动 |
|---|---|
| `src/search/radar-router.ts` | 新增 `getProviderNamesForRadarId(radarId, registry)` 函数（保留旧 `RADAR_ROUTING` + `getProviderNamesForRadar` 向后兼容） |
| `src/api/context.ts` | AppContext 新增 `radarStore` / `radarRunStore` / `radarRegistry` 3 个字段 + `createAppContext()` 初始化逻辑 |

---

## 三、核心设计

### 3.1 RadarStore

- **持久化路径**：`data/radars.json`
- **文件格式**：`{ "radars": Radar[], "version": "1.0" }`
- **同步 IO**：`readFileSync` / `writeFileSync`（与 watch-store / opportunity-store 一致）
- **幂等创建**：传入 id 已存在时直接返回已有记录
- **软删除**：archive 设 `status=archived` + `deletedAt`
- **内置雷达**：create 时 `isBuiltin=true` 自动设 `status=active`

### 3.2 RadarRunStore

- **持久化路径**：`data/radar-runs.json`
- **文件格式**：`{ "runs": RadarRun[], "version": "1.0" }`
- **排序**：`listByRadarId` 按 `startedAt` 降序，默认 limit=50

### 3.3 RadarRegistry

- **3 个内置雷达**（稳定 ID）：
  - `builtin_ai_competition` → AI 赛事雷达 → primary: ["serper","exa"]
  - `builtin_opc_policy` → OPC 政策雷达 → primary: ["bocha","google_cse"]
  - `builtin_cultural_heritage` → 文创非遗雷达 → primary: ["bocha","serper"]
- **幂等初始化**：先 get 检查 ID 是否已存在，已存在则跳过（不覆盖用户修改）
- **内置保护**：`updateRadar` / `archiveRadar` 对内置雷达抛错
- **provider 兼容**：`getProvidersForRadar` 同时支持 radarId 和旧式 radar_type 字符串

### 3.4 兼容层

- `RADAR_ROUTING` 常量保留（不删除）
- `getProviderNamesForRadar(radarType)` 保留（旧代码不破坏）
- 新增 `getProviderNamesForRadarId(radarId, registry)` 供新代码使用

---

## 四、验证结果

### 4.1 类型检查

```
npx tsc --noEmit → exit 0
```

### 4.2 验收脚本

```
npx tsx scripts/verify-task-v1.5-02-store.ts → 52 PASS / 0 FAIL
```

| 章节 | 检查项 | 结果 |
|---|---|---|
| 6.1 RadarStore CRUD | 1-11（19 项子检查） | 全 PASS |
| 6.2 RadarRunStore CRUD | 12-16（10 项子检查） | 全 PASS |
| 6.3 RadarRegistry | 17-28（16 项子检查） | 全 PASS |
| 6.4 radar-router 兼容 | 29-30（2 项） | 全 PASS |
| 6.5 AppContext 集成 | 31-32（5 项子检查） | 全 PASS |

### 4.3 回归测试

| 脚本 | 结果 |
|---|---|
| `verify-task038.ts` | 68 PASS / 0 FAIL |
| `verify-task039.ts` | 57 PASS / 0 FAIL |
| `verify-e2e-v13.ts` | 43 PASS / 0 FAIL |
| `verify-task-v1.5-01-model.ts` | 56 PASS / 0 FAIL |

---

## 五、注意事项

1. **data 目录**：`JsonRadarStore` / `JsonRadarRunStore` 的 `save()` 方法自动创建 `data/` 目录（`fs.mkdirSync(dir, { recursive: true })`）
2. **幂等性**：内置雷达初始化先 `get(id)` 检查，已存在则跳过，不覆盖用户修改
3. **不删除 RADAR_ROUTING**：保留旧常量向后兼容，新代码用 Registry
4. **JSON 格式**：2 空格缩进，便于人工查看
5. **同步 IO**：与现有 watch-store / opportunity-store 一致
6. **不接 LLM**：Store 和 Registry 纯数据操作，不调 LLM
7. **内置雷达 status**：`createDefaultRadar()` 返回 `draft`，`JsonRadarStore.create()` 中 `isBuiltin=true` 时自动覆盖为 `active`
