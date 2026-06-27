/**
 * 截止提醒规则引擎（reminder_engine）
 *
 * 来源：Task 016 第 4.1 节。
 *
 * 提供：
 *   - computeDaysUntilDeadline：距今天数计算
 *   - determineReminderLevel：提醒级别判定（urgent/soon/warning/expired/none）
 *   - createReminderItem：生成单条提醒
 *   - generateReminders：批量生成提醒
 *
 * 纯函数，不接 LLM，不编造信息。V0.7 只做规则计算，不做定时任务和推送。
 */

import type { OpportunityCard } from "../schema/opportunity-card";
import type { CardVisibleLevel } from "../schema/scoring-rules";
import type { StoreEntry, RadarType } from "./opportunity-store";

// ============================================================
// 类型定义
// ============================================================

/** 提醒级别 */
export type ReminderLevel = "urgent" | "soon" | "warning" | "expired";

/** 提醒级别（含 none，表示不需提醒） */
export type ReminderLevelOrNone = ReminderLevel | "none";

/** 提醒条目 */
export interface ReminderItem {
  /** 机会库条目 */
  entry: StoreEntry;
  /** 提醒级别 */
  level: ReminderLevel;
  /** 距今天数（负数表示已截止） */
  days_until_deadline: number;
  /** 截止日期 */
  deadline: string;
  /** 提醒标题（取自卡片标题） */
  title: string;
  /** 建议行动 */
  suggested_action: string;
  /** 提醒优先级（数字越小越高） */
  priority: number;
}

/** 提醒查询条件 */
export interface ReminderQuery {
  /** 按雷达类型筛选 */
  radar_type?: RadarType;
  /** 按可见等级筛选 */
  visible_level?: CardVisibleLevel;
  /** 仅看已收藏 */
  starred_only?: boolean;
  /** 自定义提醒阈值（可选，默认 3/7/14） */
  thresholds?: {
    urgent?: number;
    soon?: number;
    warning?: number;
  };
  /** 基准日期（可选，默认当前时间，YYYY-MM-DD） */
  base_date?: string;
}

/** 提醒结果 */
export interface ReminderResult {
  /** 紧急提醒（≤3天） */
  urgent: ReminderItem[];
  /** 即将到期（≤7天） */
  soon: ReminderItem[];
  /** 远期预警（≤14天） */
  warning: ReminderItem[];
  /** 已截止 */
  expired: ReminderItem[];
  /** 不需提醒（>14天或无截止日期） */
  no_reminder: StoreEntry[];
  /** 汇总统计 */
  summary: {
    total: number;
    urgent_count: number;
    soon_count: number;
    warning_count: number;
    expired_count: number;
    no_reminder_count: number;
  };
  /** 基准日期（YYYY-MM-DD） */
  base_date: string;
}

// ============================================================
// 常量
// ============================================================

/** 默认提醒阈值（取自 Task 016 第 3.2 节） */
export const DEFAULT_THRESHOLDS: { urgent: number; soon: number; warning: number } = {
  urgent: 3,
  soon: 7,
  warning: 14,
};

/** 提醒级别优先级（数字越小越高，取自附录 A.2） */
const REMINDER_PRIORITY: Record<ReminderLevel, number> = {
  urgent: 1,
  soon: 2,
  warning: 3,
  expired: 4,
};

/** 提醒级别中文名（取自附录 A.3） */
export const REMINDER_LEVEL_LABELS: Record<ReminderLevel, string> = {
  urgent: "紧急",
  soon: "即将到期",
  warning: "远期预警",
  expired: "已截止",
};

/** 不生成提醒的卡片状态（已归档/已忽略） */
const NON_REMINDER_STATUSES = new Set(["archived", "dismissed"]);

// ============================================================
// 辅助函数
// ============================================================

/**
 * 将日期字符串规范化为 YYYY-MM-DD。
 *
 * @param dateStr 日期字符串（YYYY-MM-DD 或 ISO 字符串）
 * @returns YYYY-MM-DD 或 null（无法解析）
 */
function normalizeDate(dateStr: string): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const datePart = dateStr.split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return datePart;
}

/**
 * 计算两个 YYYY-MM-DD 日期之间的天数差（deadline - base，向下取整）。
 *
 * @param deadline 截止日期（YYYY-MM-DD）
 * @param baseDate 基准日期（YYYY-MM-DD）
 * @returns 天数差；无法解析返回 NaN
 */
function diffDays(deadline: string, baseDate: string): number {
  const dl = normalizeDate(deadline);
  const bl = normalizeDate(baseDate);
  if (!dl || !bl) return NaN;
  const dTime = new Date(`${dl}T00:00:00Z`).getTime();
  const bTime = new Date(`${bl}T00:00:00Z`).getTime();
  return Math.floor((dTime - bTime) / (24 * 60 * 60 * 1000));
}

/**
 * 获取当前日期的 YYYY-MM-DD 表示（UTC）。
 */
function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 计算距今天数（deadline - base_date，向下取整）。
 *
 * 规则（Task 016 第 5.1 节）：
 *   - deadline 为空或"未明确" → 返回 NaN
 *   - base_date 默认当前日期（UTC）
 *   - 返回值为负表示已截止
 *
 * @param deadline 截止日期（YYYY-MM-DD 或 ISO 字符串）
 * @param base_date 基准日期（可选，默认当前日期，YYYY-MM-DD）
 * @returns 天数差；无法解析返回 NaN
 */
export function computeDaysUntilDeadline(deadline: string, base_date?: string): number {
  if (!deadline || deadline === "未明确") return NaN;
  const base = base_date ?? todayUtc();
  return diffDays(deadline, base);
}

/**
 * 判定提醒级别。
 *
 * 规则（Task 016 第 3.2 节 + 附录 A.1）：
 *   - days <= -1 → expired（已截止）
 *   - 0 <= days <= urgent(3) → urgent（紧急）
 *   - urgent(3) < days <= soon(7) → soon（即将到期）
 *   - soon(7) < days <= warning(14) → warning（远期预警）
 *   - days > warning(14) → none（不需提醒）
 *
 * @param days 距今天数（computeDaysUntilDeadline 的返回值）
 * @param thresholds 自定义阈值（可选）
 * @returns 提醒级别；不需提醒返回 "none"
 */
export function determineReminderLevel(
  days: number,
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>,
): ReminderLevelOrNone {
  // NaN 视为不需提醒
  if (Number.isNaN(days)) return "none";

  const urgentMax = thresholds?.urgent ?? DEFAULT_THRESHOLDS.urgent;
  const soonMax = thresholds?.soon ?? DEFAULT_THRESHOLDS.soon;
  const warningMax = thresholds?.warning ?? DEFAULT_THRESHOLDS.warning;

  // 已截止
  if (days < 0) return "expired";
  // 紧急：0 ~ urgent
  if (days <= urgentMax) return "urgent";
  // 即将到期：urgent+1 ~ soon
  if (days <= soonMax) return "soon";
  // 远期预警：soon+1 ~ warning
  if (days <= warningMax) return "warning";
  // 不需提醒
  return "none";
}

/**
 * 生成建议行动文案。
 *
 * 规则（Task 016 第 3.3 节）：
 *   - urgent: 立即处理：{title} 将在 {days} 天后截止，请今天完成报名/申请。官方链接：{url}
 *   - soon:   本周处理：{title} 将在 {days} 天后截止，建议本周内完成。官方链接：{url}
 *   - warning: 开始准备：{title} 将在 {days} 天后截止，可开始准备材料。官方链接：{url}
 *   - expired: 已截止：{title} 已过期 {abs(days)} 天，建议归档或移除
 *
 * @param level 提醒级别
 * @param title 机会名称
 * @param days 距今天数
 * @param url 官方链接
 */
function buildSuggestedAction(
  level: ReminderLevel,
  title: string,
  days: number,
  url: string,
): string {
  switch (level) {
    case "urgent":
      return `立即处理：${title} 将在 ${days} 天后截止，请今天完成报名/申请。官方链接：${url}`;
    case "soon":
      return `本周处理：${title} 将在 ${days} 天后截止，建议本周内完成。官方链接：${url}`;
    case "warning":
      return `开始准备：${title} 将在 ${days} 天后截止，可开始准备材料。官方链接：${url}`;
    case "expired":
      return `已截止：${title} 已过期 ${Math.abs(days)} 天，建议归档或移除`;
    default:
      return "";
  }
}

/**
 * 生成单条提醒。
 *
 * 规则（Task 016 第 5.3 节）：
 *   - archived/dismissed 状态 → 返回 null
 *   - 空截止日期 → 返回 null
 *   - 不需提醒（>14天）→ 返回 null
 *   - 其余按级别生成 ReminderItem
 *
 * @param entry 机会库条目
 * @param base_date 基准日期（可选）
 * @param thresholds 自定义阈值（可选）
 * @returns 提醒条目；不需提醒返回 null
 */
export function createReminderItem(
  entry: StoreEntry,
  base_date?: string,
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>,
): ReminderItem | null {
  // 已归档/已忽略不提醒
  if (NON_REMINDER_STATUSES.has(entry.card.status)) return null;

  // 计算距今天数
  const base = base_date ?? todayUtc();
  const days = computeDaysUntilDeadline(entry.card.deadline, base);

  // 空截止日期 → null
  if (Number.isNaN(days)) return null;

  // 判定级别
  const level = determineReminderLevel(days, thresholds);

  // 不需提醒 → null
  if (level === "none") return null;

  return {
    entry,
    level,
    days_until_deadline: days,
    deadline: entry.card.deadline,
    title: entry.card.title,
    suggested_action: buildSuggestedAction(
      level,
      entry.card.title,
      days,
      entry.card.official_source_url,
    ),
    priority: REMINDER_PRIORITY[level],
  };
}

/**
 * 批量生成提醒。
 *
 * 流程（Task 016 第 4.1 节 generateReminders 流程）：
 *   1. 过滤 archived/dismissed
 *   2. 可选筛选 radar_type / visible_level / starred_only
 *   3. 逐条 createReminderItem
 *   4. null 的进 no_reminder
 *   5. 非 null 的按 level 分组
 *   6. 组内按 days 升序（最近截止在前）
 *   7. 返回 ReminderResult
 *
 * @param store_entries 机会库全部条目
 * @param query 查询条件（可选）
 * @returns 提醒结果
 */
export function generateReminders(
  store_entries: StoreEntry[],
  query?: ReminderQuery,
): ReminderResult {
  const base = query?.base_date ?? todayUtc();
  const thresholds = query?.thresholds;

  // 1. 过滤 archived/dismissed
  let candidates = store_entries.filter(
    (e) => !NON_REMINDER_STATUSES.has(e.card.status),
  );

  // 2. 可选筛选
  if (query?.radar_type) {
    candidates = candidates.filter((e) => e.radar_type === query.radar_type);
  }
  if (query?.visible_level) {
    candidates = candidates.filter((e) => e.card.visible_level === query.visible_level);
  }
  if (query?.starred_only) {
    candidates = candidates.filter((e) => e.card.status === "saved");
  }

  // 3. 逐条生成提醒
  const urgent: ReminderItem[] = [];
  const soon: ReminderItem[] = [];
  const warning: ReminderItem[] = [];
  const expired: ReminderItem[] = [];
  const noReminder: StoreEntry[] = [];

  for (const entry of candidates) {
    const item = createReminderItem(entry, base, thresholds);
    if (item === null) {
      noReminder.push(entry);
    } else {
      switch (item.level) {
        case "urgent":
          urgent.push(item);
          break;
        case "soon":
          soon.push(item);
          break;
        case "warning":
          warning.push(item);
          break;
        case "expired":
          expired.push(item);
          break;
        default:
          noReminder.push(entry);
          break;
      }
    }
  }

  // 4. 组内按 days 升序（最近截止在前）
  const sortByDaysAsc = (a: ReminderItem, b: ReminderItem) =>
    a.days_until_deadline - b.days_until_deadline;
  urgent.sort(sortByDaysAsc);
  soon.sort(sortByDaysAsc);
  warning.sort(sortByDaysAsc);
  expired.sort(sortByDaysAsc);

  return {
    urgent,
    soon,
    warning,
    expired,
    no_reminder: noReminder,
    summary: {
      total: urgent.length + soon.length + warning.length + expired.length,
      urgent_count: urgent.length,
      soon_count: soon.length,
      warning_count: warning.length,
      expired_count: expired.length,
      no_reminder_count: noReminder.length,
    },
    base_date: base,
  };
}
