/**
 * 统一调度系统 - 类型定义（T13）
 *
 * 来源：Task 028 第 5.1 节。
 *
 * 三层抽象：
 *   1. periods（时间槽）：HH:MM + 周几 + 任务类型 + 参数
 *   2. day_plans（每日计划）：日期 + 当日时段列表
 *   3. week_map（周映射）：周一到周日的每日计划模板 ID
 *
 * 执行模式：
 *   - once：同一 schedule_id 只执行一次
 *   - recurring：周期执行，同一天不重复
 */

/** 任务类型 */
export type JobType = "search" | "reminder" | "report";

/** 任务状态 */
export type JobStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** 执行模式 */
export type ScheduleMode = "once" | "recurring";

/** 时间槽（periods） */
export interface Period {
  /** 唯一 ID */
  id: string;
  /** 触发时间 HH:MM（如 "08:00"）；特殊值 "*:00" 表示每小时整点 */
  time: string;
  /** 周几（0-6，0=周日，null=每天） */
  day_of_week: number | null;
  /** 任务类型 */
  job_type: JobType;
  /** 任务参数（JSON） */
  job_params: Record<string, unknown>;
  /** 是否启用 */
  enabled: boolean;
}

/** 每日计划（day_plans） */
export interface DayPlan {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 当日时段列表 */
  periods: Period[];
  /** 是否启用 */
  enabled: boolean;
}

/** 周映射（week_map） */
export interface WeekMap {
  /** 周一到周日的每日计划模板 ID */
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
}

/** 调度任务 */
export interface Schedule {
  /** 唯一 ID */
  id: string;
  /** 名称 */
  name: string;
  /** 执行模式 */
  mode: ScheduleMode;
  /** 预设模板 ID（如 "daily_morning"） */
  preset?: string;
  /** 时间槽（once 模式为单次时间，recurring 模式为周期） */
  period: Period;
  /** 创建时间 */
  created_at: string;
  /** 最后执行时间 */
  last_run_at?: string;
  /** 下次执行时间 */
  next_run_at?: string;
  /** 是否启用 */
  enabled: boolean;
}

/** 任务执行记录 */
export interface JobRecord {
  /** 唯一 ID */
  id: string;
  /** 关联的 Schedule ID */
  schedule_id: string;
  /** 任务类型 */
  job_type: JobType;
  /** 任务参数 */
  job_params: Record<string, unknown>;
  /** 状态 */
  status: JobStatus;
  /** 开始时间 */
  started_at: string;
  /** 结束时间 */
  finished_at?: string;
  /** 执行结果（JSON） */
  result?: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
}

/** 预设模板 */
export interface PresetTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 生成的 Period 列表 */
  periods: Period[];
}

/** 调度器状态 */
export interface SchedulerStatus {
  /** 是否运行中 */
  running: boolean;
  /** 检查间隔（毫秒） */
  interval_ms: number;
  /** 时区 */
  timezone: string;
  /** 调度任务总数 */
  schedules_count: number;
  /** 启用的任务数 */
  enabled_count: number;
  /** 任务队列记录总数 */
  job_records_count: number;
  /** 最后一次 tick 时间 */
  last_tick_at?: string;
}

/** 创建调度任务请求 */
export interface CreateScheduleRequest {
  /** 名称 */
  name: string;
  /** 执行模式 */
  mode?: ScheduleMode;
  /** 预设模板 ID */
  preset?: string;
  /** 时间槽 */
  period: Period;
  /** 是否启用 */
  enabled?: boolean;
}
