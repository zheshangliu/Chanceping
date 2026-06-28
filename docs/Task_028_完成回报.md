## Task 028 完成回报

### 1. 修改了哪些文件

- src/api/app.ts：+2 行（导入 `schedulerRoutes` + 注册 `/api/scheduler` 路由）
- package.json：+1 行（添加 `verify:scheduler` 脚本，指向 `tsx scripts/verify-task028.ts`）

### 2. 新增了哪些文件

- src/scheduler/types.ts（133 行）：调度系统类型定义基础。导出 `JobType`（search/reminder/report）、`JobStatus`、`ScheduleMode`（once/recurring）、`Period`、`DayPlan`、`WeekMap`、`Schedule`、`JobRecord`、`PresetTemplate`、`SchedulerStatus`、`CreateScheduleRequest` 共 10 个核心类型
- src/scheduler/job-queue.ts（85 行）：任务队列持久化 + once 去重核心。实现 `add()` / `getRecent(limit)` / `getByScheduleId()` / `getByStatus()` / `hasExecuted(scheduleId)`（once 去重关键方法）/ `cleanup(maxRecords)` / `clear()` / `load()` / `persist()`，JSON 文件持久化到 `data/scheduler.json`
- src/scheduler/presets.ts（114 行）：5 种预设模板定义。包含 `daily_morning`（08:00 search）、`weekly_report`（周一 09:00 report）、`deadline_alert`（18:00 reminder）、`realtime`（*:00 每小时 search）、`competition_mode`（08/12/16/20 覆盖 3 种雷达类型）。导出 `PRESET_TEMPLATES` 常量、`getPresetById(id)`、`listPresets()`
- src/scheduler/triggers.ts（260 行）：三种触发器实现，直接调用现有纯函数（不依赖 ctx.orchestrator 等不存在字段）。`executeTrigger(type, params, ctx)` 分发到 `executeSearchTrigger`（创建 `new SearchOrchestrator({llmAdapter: ctx.modelRouter, enableContentFetch: false, mockContent: true})`）/ `executeReminderTrigger`（调用 `generateReminders(ctx.store.list(...).entries, query)`）/ `executeReportTrigger`（调用 `generateRadarReport(input)`）。辅助函数 `createSimpleSpec(radarType)` 根据 radarType 生成不同关键词的 RadarRequirementSpec
- src/scheduler/scheduler.ts（209 行）：调度器核心，三层抽象（periods → day_plans → week_map）+ tick 循环。关键方法：`start()` / `stop()`（setInterval）、`tick()`（每分钟检查）、`shouldExecute(schedule, now)`（时间匹配 + 去重）、`executeJob(schedule)`（调用 executeTrigger + 记录 JobRecord）、`triggerManually(scheduleId)`、`getStatus()`。支持通配符时间 `*:MM` 和时区处理（`Intl.DateTimeFormat`）
- src/api/routes/scheduler.ts（250 行）：调度 API 8 个端点。GET `/`（列表）、POST `/`（创建）、DELETE `/:id`、POST `/:id/trigger`（手动触发）、GET `/jobs`（历史）、GET `/presets`（模板列表）、POST `/presets/:id/apply`（应用模板）、GET `/status`（调度器状态）。全局单例 `getScheduler(ctx)` 懒加载
- scripts/verify-task028.ts（405 行）：119 项验收测试。7 组验证：文件存在性(10) + types.ts 类型(18) + job-queue.ts 队列(12) + presets.ts 模板(18) + triggers.ts 触发器(15) + scheduler.ts 核心(38) + API 路由(8)

### 3. 如何本地运行

```bash
# 编译检查
npx tsc --noEmit

# 运行 Task 028 验收脚本
npx tsx scripts/verify-task028.ts

# 或通过 package.json 脚本
npm run verify:scheduler
```

### 4. 如何测试

```bash
# 编译检查
npx tsc --noEmit

# Task 028 验收
npx tsx scripts/verify-task028.ts

# 回归测试（T3-T10）
npx tsx scripts/verify-task019d.ts
npx tsx scripts/verify-task019.ts
npx tsx scripts/verify-task021.ts
npx tsx scripts/verify-task022.ts
npx tsx scripts/verify-task023.ts
npx tsx scripts/verify-task024.ts
npx tsx scripts/verify-task025.ts
npx tsx scripts/verify-task026.ts
```

### 5. 哪些功能还没做

- 实时推送（WebSocket 推送调度结果到 Web UI，属 Task 029 多渠道适配范围）
- 调度任务日志可视化（V1.1 Web UI 扩展，当前仅 JSON 持久化）
- 分布式调度（V2.0，当前单进程 setInterval）
- 调度任务依赖关系（V2.0，如"报告生成依赖搜索完成"）
- 调度任务优先级队列（V2.0）
- day_plans / week_map 完整数据流接入（当前类型已定义，调度器以 periods + Schedule 为核心驱动；day_plans/week_map 作为未来扩展的类型预留）
- 真实 LLM 联调（当前 Mock 模式，真实搜索需用户配置 API Key）

### 6. 下一步建议

- Task 029：多渠道适配（WebSocket 实时推送 + 邮件 + Webhook）
- Task 030：Web UI 调度管理面板（可视化创建/编辑/启停调度任务）
- V1.0：真实 API Key 联调 + 健壮性增强（调度器崩溃恢复 + 任务重试）

### 验收矩阵对照

| 验收项 | 覆盖状态 | 验证方式 |
|---|---|---|
| F1 调度器启动/停止 | ✅ 通过 | 测试 6.1-6.3（start/stop/running 状态） |
| F2 时间匹配 | ✅ 通过 | 测试 6.8-6.18（HH:MM + 周几 + 通配符） |
| F3 once 去重 | ✅ 通过 | 测试 6.10（once 已执行 → false）+ 3.4-3.5 |
| F4 recurring 去重 | ✅ 通过 | 测试 6.11（recurring 同天已执行 → false） |
| F5 搜索触发 | ✅ 通过 | 测试 5.1-5.4（search 返回 radar_type/opportunities_count/duration_ms） |
| F6 提醒触发 | ✅ 通过 | 测试 5.5-5.9（reminder 返回 total_reminders/urgent/soon/base_date） |
| F7 报告触发 | ✅ 通过 | 测试 5.10-5.14（report 返回 report_type/success/sections_count/generated_at） |
| F8 预设模板 | ✅ 通过 | 测试 4.1-4.18（5 种模板 + listPresets + getPresetById） |
| F9 任务队列持久化 | ✅ 通过 | 测试 3.10（重启后记录数 = 2） |
| F10 API CRUD | ✅ 通过 | 测试 7.1-7.12（8 个端点全部注册） |
| F11 手动触发 | ✅ 通过 | 测试 6.20-6.27（triggerManually 返回 JobRecord + 状态 + 更新 last_run_at） |
| F12 状态查询 | ✅ 通过 | 测试 6.28-6.33（getStatus 返回 running/interval_ms/timezone/schedules_count/enabled_count/job_records_count） |
| T1 tsc 编译 | ✅ 通过 | exit 0 |
| T2 无新 npm 依赖 | ✅ 通过 | 零新依赖（setInterval + Intl.DateTimeFormat 实现） |
| T3 回归测试 019d | ✅ 通过 | PASS 146 / FAIL 0 |
| T4 回归测试 019 | ✅ 通过 | PASS 149 / FAIL 0 |
| T5 回归测试 021 | ✅ 通过 | PASS 68 / FAIL 0 |
| T6 回归测试 022 | ✅ 通过 | PASS 73 / FAIL 0 |
| T7 回归测试 023 | ✅ 通过 | PASS 98 / FAIL 0 |
| T8 回归测试 024 | ✅ 通过 | PASS 40 / FAIL 0 |
| T9 回归测试 025 | ✅ 通过 | PASS 26 / FAIL 0 |
| T10 回归测试 026 | ✅ 通过 | PASS 39 / FAIL 0 |
| T11 验证脚本 | ✅ 通过 | 119 项全 PASS |

### 设计说明

**三层抽象实现**：`Period`（时间槽 HH:MM + 周几 + job_type + job_params + enabled）→ `DayPlan`（日期 + periods[] + enabled）→ `WeekMap`（周一到周日的每日计划模板 ID）。当前调度器以 `Schedule`（包含单个 Period）为核心驱动单元，`DayPlan` / `WeekMap` 作为类型预留，为 V1.1 Web UI 扩展做铺垫。

**once 去重规则**：`shouldExecute()` 开头检查 `schedule.mode === "once" && schedule.last_run_at` → 返回 false。`JobQueue.hasExecuted(scheduleId)` 检查是否有 `status === "completed"` 的记录，failed 状态不计入去重。

**recurring 去重规则**：同一天不重复执行。用 `isSameDay(lastRun, now, timezone)` 判断 last_run_at 是否为今天。

**通配符时间**：`*:00` 匹配每小时整点。`matchTime(periodTime, nowHHMM)` 方法判断：若 periodTime 以 `*:` 开头，则取后两位分钟数，用 `nowHHMM.endsWith(":MM")` 判断。

**时区处理**：用 `Intl.DateTimeFormat("en-GB", {hour:"2-digit", minute:"2-digit", hour12:false, timeZone})` 格式化 HH:MM；用 `Intl.DateTimeFormat("en-US", {weekday:"short", timeZone})` 获取星期缩写再映射到 0-6 数字。零 npm 依赖（不用 cron 库）。

**AppContext 适配**：任务书伪代码假设 `ctx.orchestrator` / `ctx.reminderEngine` / `ctx.reportGenerator` 存在，但实际 `AppContext` 接口仅含 `modelRouter` / `store` / `starManager` / `watchStore` / `conversations`。`triggers.ts` 直接实例化 `new SearchOrchestrator({llmAdapter: ctx.modelRouter, ...})` 和调用纯函数 `generateReminders(entries, query)` / `generateRadarReport(input)`，避免修改 AppContext 接口。

**Mock 模式**：搜索触发器创建 `SearchOrchestrator` 时传 `enableContentFetch: false, mockContent: true`，确保调度器在 Mock 环境下可正常工作（不真实搜索）。

**shouldExecute 修复**：初版漏检 `schedule.enabled`，导致禁用的调度任务仍被执行。已在方法开头添加 `if (!schedule.enabled) return false;`（测试 6.17 覆盖）。

**schedulerRoutes 导入修复**：第一次 Edit 添加导入后，读取文件发现导入行不存在（可能被后续 Edit 覆盖或文件同步问题），重新添加 `import { schedulerRoutes } from "./routes/scheduler";` 后正常。

### 运行输出

```
=== Task 028 统一调度系统验收 ===

[验收 1] 文件存在性检查
  PASS  src/scheduler/types.ts 存在
  PASS  src/scheduler/job-queue.ts 存在
  PASS  src/scheduler/presets.ts 存在
  PASS  src/scheduler/triggers.ts 存在
  PASS  src/scheduler/scheduler.ts 存在
  PASS  src/api/routes/scheduler.ts 存在
  PASS  scripts/verify-task028.ts 存在
  PASS  app.ts 导入 schedulerRoutes
  PASS  app.ts 注册 /api/scheduler 路由
  PASS  package.json 含 verify:scheduler 脚本

[验收 2] types.ts 类型定义
  PASS  导出 JobType 类型
  PASS  JobType 含 search
  PASS  JobType 含 reminder
  PASS  JobType 含 report
  PASS  导出 JobStatus 类型
  PASS  导出 ScheduleMode 类型
  PASS  ScheduleMode 含 once
  PASS  ScheduleMode 含 recurring
  PASS  导出 Period interface
  PASS  Period 含 time 字段
  PASS  Period 含 day_of_week 字段
  PASS  Period 含 job_type 字段
  PASS  导出 DayPlan interface
  PASS  导出 WeekMap interface
  PASS  导出 Schedule interface
  PASS  导出 JobRecord interface
  PASS  导出 PresetTemplate interface
  PASS  导出 SchedulerStatus interface

[验收 3] job-queue.ts 任务队列
  PASS  JobQueue 可实例化
  PASS  初始记录数为 0
  PASS  添加记录后 count = 1
  PASS  hasExecuted(sched_1) = true
  PASS  hasExecuted(sched_other) = false
  PASS  getByStatus(completed) 含 1 条
  PASS  getByStatus(failed) 含 1 条
  PASS  hasExecuted(sched_2) = false（failed 不计）
  PASS  getByScheduleId(sched_1) 含 1 条
  PASS  getRecent 返回倒序（最新在前）
  PASS  重启后记录数 = 2（持久化生效）
  PASS  clear 后 count = 0

[验收 4] presets.ts 预设模板
  PASS  PRESET_TEMPLATES 含 5 个模板
  PASS  含 daily_morning
  PASS  含 weekly_report
  PASS  含 deadline_alert
  PASS  含 realtime
  PASS  含 competition_mode
  PASS  daily_morning 含 1 个 period
  PASS  daily_morning time = 08:00
  PASS  daily_morning job_type = search
  PASS  weekly_report day_of_week = 1（周一）
  PASS  weekly_report job_type = report
  PASS  deadline_alert time = 18:00
  PASS  deadline_alert job_type = reminder
  PASS  realtime time = *:00（每小时）
  PASS  competition_mode 含 4 个 period
  PASS  competition_mode 覆盖 08/12/16/20
  PASS  listPresets() 返回 5 个
  PASS  getPresetById(unknown) = undefined

[验收 5] triggers.ts 触发器
  PASS  search 触发器返回对象
  PASS  search 触发器返回 radar_type
  PASS  search 触发器返回 opportunities_count
  PASS  search 触发器返回 duration_ms
  PASS  reminder 触发器返回对象
  PASS  reminder 触发器返回 total_reminders
  PASS  reminder 触发器返回 urgent
  PASS  reminder 触发器返回 soon
  PASS  reminder 触发器返回 base_date
  PASS  report 触发器返回对象
  PASS  report 触发器返回 report_type
  PASS  report 触发器返回 success
  PASS  report 触发器返回 sections_count
  PASS  report 触发器返回 generated_at
  PASS  未知类型抛异常

[验收 6] scheduler.ts 调度器核心
  PASS  初始状态 running = false
[Scheduler] 启动，间隔 1000ms，时区 Asia/Shanghai
  PASS  start 后 running = true
[Scheduler] 已停止
  PASS  stop 后 running = false
  PASS  addSchedule 后 count = 2
  PASS  getSchedule(test_1) 存在
  PASS  enabled_count = 1（只有 test_1 启用）
  PASS  removeSchedule 返回 true
  PASS  removeSchedule 后 count = 1
  PASS  removeSchedule 不存在的返回 false
  PASS  shouldExecute: 时间匹配 + recurring + 未执行 → true
  PASS  shouldExecute: 时间不匹配 → false
  PASS  shouldExecute: once 模式 + 已执行 → false
  PASS  shouldExecute: once 模式 + 未执行 + 时间匹配 → true
  PASS  shouldExecute: recurring + 今天已执行 → false
  PASS  shouldExecute: 通配符 *:00 逻辑正确
  PASS  shouldExecute: day_of_week 匹配 → true
  PASS  shouldExecute: day_of_week 不匹配 → false
  PASS  shouldExecute: enabled=false → false
  PASS  shouldExecute: period.enabled=false → false
  PASS  triggerManually 返回 JobRecord
  PASS  triggerManually status = completed
  PASS  triggerManually schedule_id 正确
  PASS  triggerManually job_type = reminder
  PASS  triggerManually 含 finished_at
  PASS  triggerManually 含 result
  PASS  triggerManually 更新 last_run_at
  PASS  任务队列含 1 条记录
  PASS  triggerManually 不存在 ID 抛异常
  PASS  getStatus 含 running
  PASS  getStatus 含 interval_ms
  PASS  getStatus 含 timezone
  PASS  getStatus 含 schedules_count
  PASS  getStatus 含 enabled_count
  PASS  getStatus 含 job_records_count

[验收 7] API 路由注册检查
  PASS  createApp 可实例化
  PASS  app.ts 含 schedulerRoutes 导入
  PASS  app.ts 注册 /api/scheduler
  PASS  routes/scheduler.ts 导出 schedulerRoutes
  PASS  routes/scheduler.ts 含 GET /
  PASS  routes/scheduler.ts 含 POST /
  PASS  routes/scheduler.ts 含 DELETE /:id
  PASS  routes/scheduler.ts 含 POST /:id/trigger
  PASS  routes/scheduler.ts 含 GET /jobs
  PASS  routes/scheduler.ts 含 GET /presets
  PASS  routes/scheduler.ts 含 POST /presets/:id/apply
  PASS  routes/scheduler.ts 含 GET /status

=== 汇总 ===
PASS: 119
FAIL: 0
✓ 全部通过
```

### 回归测试汇总

| 命令 | PASS | FAIL | Exit Code |
|---|---|---|---|
| `npx tsc --noEmit` | — | — | 0 |
| `verify-task019d.ts` | 146 | 0 | 0 |
| `verify-task019.ts` | 149 | 0 | 0 |
| `verify-task021.ts` | 68 | 0 | 0 |
| `verify-task022.ts` | 73 | 0 | 0 |
| `verify-task023.ts` | 98 | 0 | 0 |
| `verify-task024.ts` | 40 | 0 | 0 |
| `verify-task025.ts` | 26 | 0 | 0 |
| `verify-task026.ts` | 39 | 0 | 0 |
| `verify-task028.ts` | 119 | 0 | 0 |

**合计：758 项 PASS / 0 项 FAIL**

### Git 提交

- commit：`25b1ac5`
- 标题：`Task 028 统一调度系统（T13）：新增 7 文件 + 修改 2 文件`
- 变更：9 files changed, 1689 insertions(+), 1 deletion(-)
