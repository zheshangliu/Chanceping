/**
 * Task 028 验收脚本 - 统一调度系统（T13）
 *
 * 运行：npx tsx scripts/verify-task028.ts
 *
 * 验证项（7 组）：
 *   1. 文件存在性检查（7 个新增 + 2 个修改）
 *   2. types.ts 类型定义完整性
 *   3. job-queue.ts 任务队列（once 去重 + 持久化）
 *   4. presets.ts 5 种预设模板
 *   5. triggers.ts 三种触发器
 *   6. scheduler.ts 调度器核心（start/stop/tick/shouldExecute）
 *   7. API 路由注册检查
 */

import fs from "fs";
import path from "path";
import type { Schedule, Period } from "../src/scheduler/types";
import { JobQueue } from "../src/scheduler/job-queue";
import { PRESET_TEMPLATES, getPresetById, listPresets } from "../src/scheduler/presets";
import { executeTrigger } from "../src/scheduler/triggers";
import { Scheduler } from "../src/scheduler/scheduler";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { createAppContext } from "../src/api/context";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

// ============================================================
// 测试辅助
// ============================================================

/** 创建测试用 Period */
function makePeriod(overrides: Partial<Period> = {}): Period {
  return {
    id: `period_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: "08:00",
    day_of_week: null,
    job_type: "search",
    job_params: { radar_type: "ai_competition", max_results: 5 },
    enabled: true,
    ...overrides,
  };
}

/** 创建测试用 Schedule */
function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: "测试调度",
    mode: "recurring",
    period: makePeriod(),
    created_at: new Date().toISOString(),
    enabled: true,
    ...overrides,
  };
}

/** 创建临时文件路径 */
function tempPath(name: string): string {
  return path.resolve(process.cwd(), "data", `test-scheduler-${name}.json`);
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 028 统一调度系统验收 ===\n");

  // ============================================================
  // 1. 文件存在性检查
  // ============================================================
  console.log("[验收 1] 文件存在性检查\n");
  check("src/scheduler/types.ts 存在", fs.existsSync("src/scheduler/types.ts"));
  check("src/scheduler/job-queue.ts 存在", fs.existsSync("src/scheduler/job-queue.ts"));
  check("src/scheduler/presets.ts 存在", fs.existsSync("src/scheduler/presets.ts"));
  check("src/scheduler/triggers.ts 存在", fs.existsSync("src/scheduler/triggers.ts"));
  check("src/scheduler/scheduler.ts 存在", fs.existsSync("src/scheduler/scheduler.ts"));
  check("src/api/routes/scheduler.ts 存在", fs.existsSync("src/api/routes/scheduler.ts"));
  check("scripts/verify-task028.ts 存在", fs.existsSync("scripts/verify-task028.ts"));

  // 修改文件检查
  {
    const appContent = fs.readFileSync("src/api/app.ts", "utf-8");
    check("app.ts 导入 schedulerRoutes", appContent.includes("schedulerRoutes"));
    check("app.ts 注册 /api/scheduler 路由", appContent.includes('"/api/scheduler"'));

    const pkgContent = fs.readFileSync("package.json", "utf-8");
    const pkg = JSON.parse(pkgContent);
    check("package.json 含 verify:scheduler 脚本", "verify:scheduler" in (pkg.scripts ?? {}));
  }

  // ============================================================
  // 2. types.ts 类型定义完整性
  // ============================================================
  console.log("\n[验收 2] types.ts 类型定义\n");
  {
    const content = fs.readFileSync("src/scheduler/types.ts", "utf-8");
    check("导出 JobType 类型", content.includes('export type JobType'));
    check("JobType 含 search", content.includes('"search"'));
    check("JobType 含 reminder", content.includes('"reminder"'));
    check("JobType 含 report", content.includes('"report"'));
    check("导出 JobStatus 类型", content.includes('export type JobStatus'));
    check("导出 ScheduleMode 类型", content.includes('export type ScheduleMode'));
    check("ScheduleMode 含 once", content.includes('"once"'));
    check("ScheduleMode 含 recurring", content.includes('"recurring"'));
    check("导出 Period interface", content.includes('export interface Period'));
    check("Period 含 time 字段", content.includes('time: string'));
    check("Period 含 day_of_week 字段", content.includes('day_of_week: number | null'));
    check("Period 含 job_type 字段", content.includes('job_type: JobType'));
    check("导出 DayPlan interface", content.includes('export interface DayPlan'));
    check("导出 WeekMap interface", content.includes('export interface WeekMap'));
    check("导出 Schedule interface", content.includes('export interface Schedule'));
    check("导出 JobRecord interface", content.includes('export interface JobRecord'));
    check("导出 PresetTemplate interface", content.includes('export interface PresetTemplate'));
    check("导出 SchedulerStatus interface", content.includes('export interface SchedulerStatus'));
  }

  // ============================================================
  // 3. job-queue.ts 任务队列
  // ============================================================
  console.log("\n[验收 3] job-queue.ts 任务队列\n");
  {
    const testFile = tempPath("queue");
    // 清理旧文件
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    const queue = new JobQueue(testFile);
    check("JobQueue 可实例化", queue instanceof JobQueue);
    check("初始记录数为 0", queue.count() === 0);

    // 添加记录
    const record1 = {
      id: "job_1",
      schedule_id: "sched_1",
      job_type: "search" as const,
      job_params: {},
      status: "completed" as const,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      result: { total: 5 },
    };
    queue.add(record1);
    check("添加记录后 count = 1", queue.count() === 1);

    // once 去重
    check("hasExecuted(sched_1) = true", queue.hasExecuted("sched_1") === true);
    check("hasExecuted(sched_other) = false", queue.hasExecuted("sched_other") === false);

    // 按状态查询
    const failedRecord = {
      id: "job_2",
      schedule_id: "sched_2",
      job_type: "reminder" as const,
      job_params: {},
      status: "failed" as const,
      started_at: new Date().toISOString(),
    };
    queue.add(failedRecord);
    check("getByStatus(completed) 含 1 条", queue.getByStatus("completed").length === 1);
    check("getByStatus(failed) 含 1 条", queue.getByStatus("failed").length === 1);
    check("hasExecuted(sched_2) = false（failed 不计）", queue.hasExecuted("sched_2") === false);

    // 按 schedule_id 查询
    check("getByScheduleId(sched_1) 含 1 条", queue.getByScheduleId("sched_1").length === 1);

    // getRecent
    const recent = queue.getRecent(10);
    check("getRecent 返回倒序（最新在前）", recent.length === 2 && recent[0].id === "job_2");

    // 持久化测试
    const queue2 = new JobQueue(testFile);
    check("重启后记录数 = 2（持久化生效）", queue2.count() === 2);

    // 清理
    queue2.clear();
    check("clear 后 count = 0", queue2.count() === 0);
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  }

  // ============================================================
  // 4. presets.ts 5 种预设模板
  // ============================================================
  console.log("\n[验收 4] presets.ts 预设模板\n");
  {
    check("PRESET_TEMPLATES 含 5 个模板", PRESET_TEMPLATES.length === 5);
    check("含 daily_morning", getPresetById("daily_morning") !== undefined);
    check("含 weekly_report", getPresetById("weekly_report") !== undefined);
    check("含 deadline_alert", getPresetById("deadline_alert") !== undefined);
    check("含 realtime", getPresetById("realtime") !== undefined);
    check("含 competition_mode", getPresetById("competition_mode") !== undefined);

    // daily_morning 详情
    const dm = getPresetById("daily_morning");
    check("daily_morning 含 1 个 period", dm?.periods.length === 1);
    check("daily_morning time = 08:00", dm?.periods[0].time === "08:00");
    check("daily_morning job_type = search", dm?.periods[0].job_type === "search");

    // weekly_report 详情
    const wr = getPresetById("weekly_report");
    check("weekly_report day_of_week = 1（周一）", wr?.periods[0].day_of_week === 1);
    check("weekly_report job_type = report", wr?.periods[0].job_type === "report");

    // deadline_alert 详情
    const da = getPresetById("deadline_alert");
    check("deadline_alert time = 18:00", da?.periods[0].time === "18:00");
    check("deadline_alert job_type = reminder", da?.periods[0].job_type === "reminder");

    // realtime 详情
    const rt = getPresetById("realtime");
    check("realtime time = *:00（每小时）", rt?.periods[0].time === "*:00");

    // competition_mode 详情
    const cm = getPresetById("competition_mode");
    check("competition_mode 含 4 个 period", cm?.periods.length === 4);
    check("competition_mode 覆盖 08/12/16/20",
      cm?.periods.map((p) => p.time).join(",") === "08:00,12:00,16:00,20:00");

    // listPresets
    check("listPresets() 返回 5 个", listPresets().length === 5);

    // 不存在的 ID
    check("getPresetById(unknown) = undefined", getPresetById("unknown") === undefined);
  }

  // ============================================================
  // 5. triggers.ts 三种触发器
  // ============================================================
  console.log("\n[验收 5] triggers.ts 触发器\n");
  {
    const ctx: AppContext = createAppContext();

    // 搜索触发器
    try {
      const result = await executeTrigger("search", { radar_type: "ai_competition", max_results: 5 }, ctx);
      check("search 触发器返回对象", typeof result === "object" && result !== null);
      check("search 触发器返回 radar_type", result.radar_type === "ai_competition");
      check("search 触发器返回 opportunities_count", typeof result.opportunities_count === "number");
      check("search 触发器返回 duration_ms", typeof result.duration_ms === "number");
    } catch (err) {
      check("search 触发器不抛异常", false, String(err));
    }

    // 提醒触发器
    try {
      const result = await executeTrigger("reminder", {}, ctx);
      check("reminder 触发器返回对象", typeof result === "object" && result !== null);
      check("reminder 触发器返回 total_reminders", typeof result.total_reminders === "number");
      check("reminder 触发器返回 urgent", typeof result.urgent === "number");
      check("reminder 触发器返回 soon", typeof result.soon === "number");
      check("reminder 触发器返回 base_date", typeof result.base_date === "string");
    } catch (err) {
      check("reminder 触发器不抛异常", false, String(err));
    }

    // 报告触发器
    try {
      const result = await executeTrigger("report", { report_type: "weekly" }, ctx);
      check("report 触发器返回对象", typeof result === "object" && result !== null);
      check("report 触发器返回 report_type", result.report_type === "weekly");
      check("report 触发器返回 success", typeof result.success === "boolean");
      check("report 触发器返回 sections_count", typeof result.sections_count === "number");
      check("report 触发器返回 generated_at", typeof result.generated_at === "string");
    } catch (err) {
      check("report 触发器不抛异常", false, String(err));
    }

    // 未知类型
    try {
      await executeTrigger("unknown" as never, {}, ctx);
      check("未知类型抛异常", false);
    } catch (err) {
      check("未知类型抛异常", err instanceof Error);
    }
  }

  // ============================================================
  // 6. scheduler.ts 调度器核心
  // ============================================================
  console.log("\n[验收 6] scheduler.ts 调度器核心\n");
  {
    const testFile = tempPath("scheduler");
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    const ctx: AppContext = createAppContext();
    const scheduler = new Scheduler(ctx, { intervalMs: 1000, dataPath: testFile });

    // start / stop
    check("初始状态 running = false", scheduler.getStatus().running === false);
    scheduler.start();
    check("start 后 running = true", scheduler.getStatus().running === true);
    scheduler.stop();
    check("stop 后 running = false", scheduler.getStatus().running === false);

    // addSchedule / listSchedules / removeSchedule
    const sched1 = makeSchedule({ id: "test_1", name: "测试1" });
    const sched2 = makeSchedule({ id: "test_2", name: "测试2", enabled: false });
    scheduler.addSchedule(sched1);
    scheduler.addSchedule(sched2);
    check("addSchedule 后 count = 2", scheduler.listSchedules().length === 2);
    check("getSchedule(test_1) 存在", scheduler.getSchedule("test_1") !== undefined);
    check("enabled_count = 1（只有 test_1 启用）", scheduler.getStatus().enabled_count === 1);

    // removeSchedule
    const removed = scheduler.removeSchedule("test_2");
    check("removeSchedule 返回 true", removed === true);
    check("removeSchedule 后 count = 1", scheduler.listSchedules().length === 1);
    check("removeSchedule 不存在的返回 false", scheduler.removeSchedule("nonexistent") === false);

    // shouldExecute - 时间匹配
    {
      // 当前时间的 HH:MM
      const now = new Date();
      const fmt = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
      });
      const nowHHMM = fmt.format(now);

      // 匹配当前时间
      const matchNow = makeSchedule({
        period: makePeriod({ time: nowHHMM }),
        mode: "recurring",
      });
      check("shouldExecute: 时间匹配 + recurring + 未执行 → true",
        scheduler.shouldExecute(matchNow, now) === true);

      // 不匹配时间
      const wrongTime = makePeriod({ time: "99:99" });
      const mismatch = makeSchedule({ period: wrongTime });
      check("shouldExecute: 时间不匹配 → false",
        scheduler.shouldExecute(mismatch, now) === false);

      // once 模式 + 已执行
      const onceExecuted = makeSchedule({
        mode: "once",
        last_run_at: now.toISOString(),
        period: makePeriod({ time: nowHHMM }),
      });
      check("shouldExecute: once 模式 + 已执行 → false",
        scheduler.shouldExecute(onceExecuted, now) === false);

      // once 模式 + 未执行 + 时间匹配
      const onceNotRun = makeSchedule({
        mode: "once",
        period: makePeriod({ time: nowHHMM }),
      });
      check("shouldExecute: once 模式 + 未执行 + 时间匹配 → true",
        scheduler.shouldExecute(onceNotRun, now) === true);

      // recurring + 今天已执行
      const recurringToday = makeSchedule({
        mode: "recurring",
        last_run_at: now.toISOString(),
        period: makePeriod({ time: nowHHMM }),
      });
      check("shouldExecute: recurring + 今天已执行 → false",
        scheduler.shouldExecute(recurringToday, now) === false);

      // 通配符 *:00
      const wildcardPeriod = makePeriod({ time: "*:00" });
      const wildcardSched = makeSchedule({ period: wildcardPeriod });
      // 只有当前分钟为 00 时匹配
      const expectedWildcard = nowHHMM.endsWith(":00");
      check("shouldExecute: 通配符 *:00 逻辑正确",
        scheduler.shouldExecute(wildcardSched, now) === expectedWildcard);

      // day_of_week 匹配
      const dowFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Shanghai" });
      const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const nowDow = dowMap[dowFmt.format(now)] ?? 0;
      const matchDow = makeSchedule({
        period: makePeriod({ time: nowHHMM, day_of_week: nowDow }),
      });
      check("shouldExecute: day_of_week 匹配 → true",
        scheduler.shouldExecute(matchDow, now) === true);

      const mismatchDow = makeSchedule({
        period: makePeriod({ time: nowHHMM, day_of_week: (nowDow + 1) % 7 }),
      });
      check("shouldExecute: day_of_week 不匹配 → false",
        scheduler.shouldExecute(mismatchDow, now) === false);

      // disabled schedule
      const disabled = makeSchedule({ enabled: false, period: makePeriod({ time: nowHHMM }) });
      check("shouldExecute: enabled=false → false",
        scheduler.shouldExecute(disabled, now) === false);

      // disabled period
      const disabledPeriod = makeSchedule({
        period: makePeriod({ time: nowHHMM, enabled: false }),
      });
      check("shouldExecute: period.enabled=false → false",
        scheduler.shouldExecute(disabledPeriod, now) === false);
    }

    // triggerManually
    {
      const triggerSched = makeSchedule({
        id: "trigger_test",
        period: makePeriod({ job_type: "reminder", job_params: {} }),
      });
      scheduler.addSchedule(triggerSched);
      const record = await scheduler.triggerManually("trigger_test");
      check("triggerManually 返回 JobRecord", typeof record === "object" && record !== null);
      check("triggerManually status = completed", record.status === "completed");
      check("triggerManually schedule_id 正确", record.schedule_id === "trigger_test");
      check("triggerManually job_type = reminder", record.job_type === "reminder");
      check("triggerManually 含 finished_at", typeof record.finished_at === "string");
      check("triggerManually 含 result", record.result !== undefined);

      // last_run_at 更新
      const updated = scheduler.getSchedule("trigger_test");
      check("triggerManually 更新 last_run_at", typeof updated?.last_run_at === "string");

      // 任务队列记录
      const jobs = scheduler.getQueue().getByScheduleId("trigger_test");
      check("任务队列含 1 条记录", jobs.length === 1);
    }

    // 不存在的 schedule
    try {
      await scheduler.triggerManually("nonexistent");
      check("triggerManually 不存在 ID 抛异常", false);
    } catch (err) {
      check("triggerManually 不存在 ID 抛异常", err instanceof Error);
    }

    // getStatus
    {
      const status = scheduler.getStatus();
      check("getStatus 含 running", typeof status.running === "boolean");
      check("getStatus 含 interval_ms", typeof status.interval_ms === "number");
      check("getStatus 含 timezone", typeof status.timezone === "string");
      check("getStatus 含 schedules_count", typeof status.schedules_count === "number");
      check("getStatus 含 enabled_count", typeof status.enabled_count === "number");
      check("getStatus 含 job_records_count", typeof status.job_records_count === "number");
    }

    // 清理
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  }

  // ============================================================
  // 7. API 路由注册检查
  // ============================================================
  console.log("\n[验收 7] API 路由注册检查\n");
  {
    const app = createApp();
    check("createApp 可实例化", app !== undefined && app !== null);

    // 检查 app.ts 注册了 /api/scheduler
    const appContent = fs.readFileSync("src/api/app.ts", "utf-8");
    check("app.ts 含 schedulerRoutes 导入", appContent.includes("import { schedulerRoutes }"));
    check("app.ts 注册 /api/scheduler", appContent.includes('app.route("/api/scheduler"'));

    // 检查路由文件导出
    const routeContent = fs.readFileSync("src/api/routes/scheduler.ts", "utf-8");
    check("routes/scheduler.ts 导出 schedulerRoutes", routeContent.includes("export function schedulerRoutes"));
    check("routes/scheduler.ts 含 GET /", routeContent.includes('app.get("/"'));
    check("routes/scheduler.ts 含 POST /", routeContent.includes('app.post("/"'));
    check("routes/scheduler.ts 含 DELETE /:id", routeContent.includes('app.delete("/:id"'));
    check("routes/scheduler.ts 含 POST /:id/trigger", routeContent.includes('app.post("/:id/trigger"'));
    check("routes/scheduler.ts 含 GET /jobs", routeContent.includes('app.get("/jobs"'));
    check("routes/scheduler.ts 含 GET /presets", routeContent.includes('app.get("/presets"'));
    check("routes/scheduler.ts 含 POST /presets/:id/apply", routeContent.includes('app.post("/presets/:id/apply"'));
    check("routes/scheduler.ts 含 GET /status", routeContent.includes('app.get("/status"'));
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log(`\n=== 汇总 ===`);
  console.log(`PASS: ${passed}`);
  console.log(`FAIL: ${failed}`);
  console.log(failed === 0 ? "✓ 全部通过" : "✗ 存在失败项");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("验证脚本异常:", err);
  process.exit(1);
});
