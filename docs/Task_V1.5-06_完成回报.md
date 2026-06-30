# Task V1.5-06 完成回报：定时运行雷达

> 版本：V1.0 | 日期：2026-06-30 | 阶段：V1.5b-1
> 前置依赖：Task V1.5-03（API 最小闭环）已验收通过

---

## 一、任务概述

用户可设置雷达定时运行（如每天 8:00 / 每周一），接入现有 scheduler。定时触发时自动执行搜索，生成 RadarRun 记录，结果存入 OpportunityStore 并绑定 radarId。核心链路：

```
PUT /api/radars/:id/schedule（cron + timezone）
→ 校验 cron 5 字段格式 + 计算 nextRunAt
→ Radar.schedule 持久化
→ Scheduler 到时触发 executeTrigger("search", { radar_id }, ctx)
→ executeSearchTrigger 走 radar_id 优先路径
→ 创建 RadarRun(mode=scheduled) + 搜索 + 机会绑定 radarId
→ 更新 Radar（lastRunAt / schedule.lastRunAt / nextRunAt）
```

兼容旧逻辑：`params.radar_type` 仍走 createSimpleSpec，不破坏现有 5 个预设模板。

---

## 二、交付清单

### 2.1 新建文件（1 个）

| 文件 | 内容 |
|---|---|
| [scripts/verify-task-v1.5-06-schedule.ts](file:///c:/Users/test/Desktop/chanceping/changeping/scripts/verify-task-v1.5-06-schedule.ts) | 验收脚本：16 项断言（6.1 定时配置 / 6.2 scheduler 兼容 / 6.3 定时触发 / 6.4 回归） |

### 2.2 改造文件（5 个）

| 文件 | 改动 |
|---|---|
| [src/schema/radar.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/schema/radar.ts) | 新增 RadarSchedule 接口（cron / timezone / enabled / lastRunAt? / nextRunAt?）+ Radar.schedule? 字段 |
| [src/agents/radar-store.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/agents/radar-store.ts) | RadarUpdateInput 新增 schedule?；update 方法用 `"schedule" in patch` 检查支持传 undefined 显式清空 |
| [src/api/routes/radars.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/api/routes/radars.ts) | 新增导出函数 validateCron / computeNextRunAt + 内部 validateCronField / matchCronField；新增 PUT /:id/schedule + DELETE /:id/schedule 端点 |
| [src/scheduler/triggers.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/scheduler/triggers.ts) | executeSearchTrigger 改造：radar_id 优先（executeScheduledRadarSearch）+ radar_type fallback 旧逻辑 |
| [src/scheduler/presets.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/scheduler/presets.ts) | 新增第 6 个预设模板 radar_custom_daily（job_params 用 radar_id） |

---

## 三、关键设计点

### 3.1 cron 校验零依赖实现

项目硬约束禁止引入新 npm 依赖（不能用 cron-parser）。采用正则 + Date 逐分钟遍历：

- `validateCron`：5 字段格式校验（分 时 日 月 周），每字段支持 `*` / 数字 / 步进 n / `a-b` / `a,b` 组合
- `computeNextRunAt`：从 from 的下一分钟开始，逐分钟遍历未来 7 天，找到第一个匹配 cron 5 字段的时刻
- `matchCronField`：匹配单个字段值（含周日 0/7 兼容）

### 3.2 executeSearchTrigger 兼容层

```
radar_id 存在 + RadarStore 能找到 → executeScheduledRadarSearch（新路径）
radar_id 不存在或找不到 → fallback 到 radar_type + createSimpleSpec（旧逻辑，不变）
```

新路径流程：创建 RadarRun → 更新 currentRunId → 搜索 → 机会绑定 radarId → 更新 run（succeeded + totalRaw + opportunityKeys）→ 更新 radar（currentRunId 清空 + lastRunStatus + lastRunAt + schedule.lastRunAt/nextRunAt）。

### 3.3 schedule 字段更新语义

RadarUpdateInput.schedule 用 `"schedule" in patch` 检查 key 是否存在（而非 `!== undefined`），这样传 `undefined` 表示显式清空定时，不传则保持不变。与 currentRunId 清空逻辑一致。

### 3.4 JSDoc 注释 `*/` 序列陷阱

`*/n`（cron 步进语法）在 JSDoc 块注释中会提前终止注释（`*/` 是块注释结束符，反引号不能保护）。修复方式：改写为不含 `*/` 序列的描述（`* / n` 或"步进 n"）。

---

## 四、验收结果

| 验收项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出码 0 |
| `npx tsx scripts/verify-task-v1.5-06-schedule.ts` | 15 PASS / 0 FAIL |
| `npx tsx scripts/verify-e2e-v13.ts`（回归） | 43 PASS / 0 FAIL |
| `npx tsx scripts/verify-task-v1.5-03-api.ts`（回归） | 48 PASS / 0 FAIL |

验收脚本 16 项断言明细：
- 6.1 定时配置（1-5）：PUT schedule / nextRunAt 非空 / 无效 cron 400 / DELETE / 内置雷达可设置
- 6.2 scheduler 兼容（6-8）：radar_id 优先 / radar_type 旧逻辑 / radar_id 不存在 fallback
- 6.3 定时触发（9-12）：executeTrigger / RadarRun 记录 / lastRunAt 更新 / radarId 绑定
- 6.4 回归（13-16）：presets 6 个 / validateCron valid / validateCron invalid / tsc（外部）

---

## 五、Git 提交

- 提交信息：`Task V1.5-06 定时运行雷达`
- 文件：6 个（5 改造 + 1 新建验收脚本）+ 完成回报
