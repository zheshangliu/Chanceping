/**
 * 调度器核心（Scheduler）- 三层抽象 + tick 循环
 *
 * 来源：Task 028 第 5.2 节。
 *
 * 三层抽象：
 *   1. periods（时间槽）：HH:MM + 周几 + 任务类型
 *   2. day_plans（每日计划）：日期 + 当日时段列表
 *   3. week_map（周映射）：周一到周日的每日计划模板 ID
 *
 * 核心方法：
 *   - start() / stop()：启动/停止调度循环
 *   - tick()：每分钟检查并执行（核心逻辑）
 *   - shouldExecute()：判断是否该执行
 *   - executeJob()：执行任务并记录
 *
 * 去重规则：
 *   - once 模式：last_run_at 存在则不再执行
 *   - recurring 模式：同一天不重复执行
 *
 * 时区支持：用 Intl.DateTimeFormat 处理时区，不引入 cron 库（零依赖）。
 */

import type { Schedule, Period, JobRecord, SchedulerStatus } from "./types";
import { JobQueue } from "./job-queue";
import { executeTrigger } from "./triggers";
import type { AppContext } from "../api/context";
import type { Radar } from "../schema/radar";

export class Scheduler {
  private readonly queue: JobQueue;
  private readonly ctx: AppContext;
  private readonly intervalMs: number;
  private readonly timezone: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly schedules: Map<string, Schedule> = new Map();
  private lastTickAt: string | undefined;

  constructor(ctx: AppContext, options?: { intervalMs?: number; timezone?: string; dataPath?: string }) {
    this.ctx = ctx;
    this.queue = new JobQueue(options?.dataPath);
    this.intervalMs = options?.intervalMs ?? 60000;
    this.timezone = options?.timezone ?? "Asia/Shanghai";
  }

  /** 启动调度器 */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error("[Scheduler] tick 异常:", err);
      });
    }, this.intervalMs);
    console.log(`[Scheduler] 启动，间隔 ${this.intervalMs}ms，时区 ${this.timezone}`);
  }

  /** 停止调度器 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[Scheduler] 已停止");
    }
  }

  /** 添加调度任务 */
  addSchedule(schedule: Schedule): void {
    this.schedules.set(schedule.id, schedule);
    this.updateNextRun(schedule);
  }

  /** 移除调度任务 */
  removeSchedule(id: string): boolean {
    return this.schedules.delete(id);
  }

  /** 获取调度任务 */
  getSchedule(id: string): Schedule | undefined {
    return this.schedules.get(id);
  }

  /** 获取所有调度任务 */
  listSchedules(): Schedule[] {
    return Array.from(this.schedules.values());
  }

  /** 手动触发任务 */
  async triggerManually(scheduleId: string): Promise<JobRecord> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) throw new Error(`调度任务不存在: ${scheduleId}`);
    return this.executeJob(schedule);
  }

  /** 获取任务队列 */
  getQueue(): JobQueue {
    return this.queue;
  }

  /** 获取调度器状态 */
  getStatus(): SchedulerStatus {
    return {
      running: this.timer !== null,
      interval_ms: this.intervalMs,
      timezone: this.timezone,
      schedules_count: this.schedules.size,
      enabled_count: Array.from(this.schedules.values()).filter((s) => s.enabled).length,
      job_records_count: this.queue.count(),
      last_tick_at: this.lastTickAt,
    };
  }

  /** 核心：每分钟检查并执行 */
  async tick(): Promise<void> {
    this.lastTickAt = new Date().toISOString();
    const now = new Date();
    // 1. 现有 JobRecord 检查（不变）
    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled) continue;
      if (this.shouldExecute(schedule, now)) {
        await this.executeJob(schedule);
        this.updateNextRun(schedule);
      }
    }
    // 2. V1.6-02 新增：Radar schedule 检查（RadarStore 里的 Radar.schedule）
    await this.checkRadarSchedules(now);
  }

  /**
   * V1.6-02 新增：检查所有 Radar 的 schedule，到期则执行 executeTrigger("search", { radar_id })。
   *
   * 错误隔离：单个雷达执行失败不影响其他雷达。
   */
  private async checkRadarSchedules(now: Date): Promise<void> {
    if (!this.ctx.radarStore) return;
    const radars = this.ctx.radarStore.list({ includeArchived: false });
    for (const radar of radars) {
      // V1.6a 自检修复:三重守卫
      // 1. schedule 未启用或无 nextRunAt → 跳过
      if (!radar.schedule?.enabled || !radar.schedule.nextRunAt) continue;
      // 2. radar 非 active 状态(暂停/草稿/归档)→ 跳过,避免暂停雷达仍被定时触发
      if (radar.status !== "active") continue;
      // 3. radar 已有正在运行的 currentRunId → 跳过,避免并发执行
      if (radar.currentRunId) continue;
      const nextRun = new Date(radar.schedule.nextRunAt);
      if (nextRun <= now) {
        try {
          await this.executeRadarSchedule(radar);
        } catch (err) {
          console.error(`[Scheduler] 雷达 ${radar.id} 执行失败:`, err);
        }
      }
    }
  }

  /**
   * V1.6-02 新增：执行单个 Radar 的定时任务。
   *
   * 复用 executeTrigger("search", { radar_id }) 路径，与 V1.5-06 的
   * executeScheduledRadarSearch 等价（executeTrigger 内部会调用它）。
   */
  private async executeRadarSchedule(radar: Radar): Promise<void> {
    await executeTrigger("search", { radar_id: radar.id, max_results: 20 }, this.ctx);
  }

  /** 判断是否该执行 */
  shouldExecute(schedule: Schedule, now: Date): boolean {
    if (!schedule.enabled) return false;
    const period = schedule.period;
    if (!period.enabled) return false;

    // once 模式：已执行过则跳过
    if (schedule.mode === "once") {
      if (schedule.last_run_at) return false;
    }

    // 时间匹配 HH:MM
    const nowHHMM = this.formatHHMM(now, this.timezone);
    if (!this.matchTime(period.time, nowHHMM)) return false;

    // 周几匹配
    if (period.day_of_week !== null) {
      const nowDOW = this.getDayOfWeek(now, this.timezone);
      if (period.day_of_week !== nowDOW) return false;
    }

    // recurring 模式：今天已执行过则跳过
    if (schedule.mode === "recurring" && schedule.last_run_at) {
      const lastRun = new Date(schedule.last_run_at);
      if (this.isSameDay(lastRun, now, this.timezone)) return false;
    }

    return true;
  }

  /** 执行任务 */
  private async executeJob(schedule: Schedule): Promise<JobRecord> {
    const record: JobRecord = {
      id: generateId(),
      schedule_id: schedule.id,
      job_type: schedule.period.job_type,
      job_params: schedule.period.job_params,
      status: "running",
      started_at: new Date().toISOString(),
    };

    try {
      const result = await executeTrigger(schedule.period.job_type, schedule.period.job_params, this.ctx);
      record.status = "completed";
      record.result = result;
    } catch (err) {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
    }

    record.finished_at = new Date().toISOString();
    this.queue.add(record);
    schedule.last_run_at = record.started_at;

    return record;
  }

  /** 格式化当前时间为 HH:MM（带时区） */
  private formatHHMM(date: Date, timezone: string): string {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    });
    return fmt.format(date);
  }

  /** 获取周几（0=周日，1=周一...6=周六） */
  private getDayOfWeek(date: Date, timezone: string): number {
    const fmt = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: timezone,
    });
    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return dayMap[fmt.format(date)] ?? 0;
  }

  /** 判断两个日期是否同一天（带时区） */
  private isSameDay(a: Date, b: Date, timezone: string): boolean {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    });
    return fmt.format(a) === fmt.format(b);
  }

  /**
   * 匹配时间。
   *
   * @param periodTime 时间槽时间（HH:MM 或 "*:MM"）
   * @param nowHHMM 当前时间 HH:MM
   */
  private matchTime(periodTime: string, nowHHMM: string): boolean {
    // 精确匹配
    if (periodTime === nowHHMM) return true;
    // 通配符匹配 "*:MM" → 每小时整点
    if (periodTime.startsWith("*:")) {
      const minute = periodTime.slice(2);
      return nowHHMM.endsWith(`:${minute}`);
    }
    return false;
  }

  /** 更新下次执行时间（简易估算） */
  private updateNextRun(schedule: Schedule): void {
    // 简易实现：下次执行时间为明天同一时刻
    if (schedule.mode === "once" && schedule.last_run_at) {
      schedule.next_run_at = undefined;
      return;
    }
    const next = new Date();
    next.setDate(next.getDate() + 1);
    schedule.next_run_at = next.toISOString();
  }
}

/** 生成唯一 ID（不用 crypto.randomUUID 以兼容旧环境） */
function generateId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
