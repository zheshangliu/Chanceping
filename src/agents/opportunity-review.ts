/**
 * 机会复盘（T16）
 *
 * 来源：Task 030 第 5.3 节。
 *
 * 设计要点：
 *   - 统计已截止机会的命中率（applied / total）
 *   - 按等级（S/A/B/C）分组统计
 *   - 按雷达类型分组统计
 *   - 错过原因分析（未查看/未跟踪/未报名）
 *   - 改进建议生成（规则化，不用 LLM）
 */

import type { StoreEntry } from "./opportunity-store";
import type { CardVisibleLevel } from "../schema/scoring-rules";
import type { OpportunityCardStatus } from "../schema/opportunity-card";

/** 复盘统计 */
export interface ReviewSummary {
  /** 统计时间范围 */
  period_start: string;
  period_end: string;
  /** 总机会数 */
  total_opportunities: number;
  /** 已报名数 */
  applied_count: number;
  /** 错过数（missed + expired 且未报名） */
  missed_count: number;
  /** 命中率 = applied / total */
  hit_rate: number;
  /** 错过率 = missed / total */
  miss_rate: number;
  /** 按等级分组统计 */
  by_level: Record<CardVisibleLevel, LevelStats>;
  /** 按雷达类型分组统计 */
  by_radar_type: Record<string, LevelStats>;
  /** 错过原因分析 */
  miss_reasons: MissReason[];
  /** 改进建议 */
  suggestions: string[];
}

/** 等级统计 */
export interface LevelStats {
  total: number;
  applied: number;
  missed: number;
  hit_rate: number;
}

/** 错过原因 */
export interface MissReason {
  reason: string;
  count: number;
  percentage: number;
}

/** 未报名状态列表（可计入错过） */
const NON_APPLIED_STATUSES: OpportunityCardStatus[] = ["new", "viewed", "tracking", "saved"];

/**
 * 生成机会复盘报告。
 *
 * @param entries 机会库条目
 * @param periodDays 复盘时间范围（天数，默认 30）
 * @returns 复盘统计
 */
export function generateReview(
  entries: StoreEntry[],
  periodDays: number = 30,
): ReviewSummary {
  const now = new Date();
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

  // 筛选时间范围内的已截止机会
  const closed = entries.filter((e) => {
    if (!e.card.deadline) return false;
    const deadline = new Date(e.card.deadline);
    return deadline >= periodStart && deadline <= now;
  });

  const total = closed.length;
  const applied = closed.filter((e) => e.card.status === "applied").length;
  const missed = closed.filter((e) =>
    ["missed", "expired"].includes(e.card.status) ||
    (NON_APPLIED_STATUSES.includes(e.card.status) &&
      new Date(e.card.deadline) < now),
  ).length;

  // 按等级分组
  const levels: CardVisibleLevel[] = ["S", "A", "B", "C"];
  const byLevel: Record<string, LevelStats> = {};
  for (const level of levels) {
    const levelEntries = closed.filter((e) => e.card.visible_level === level);
    byLevel[level] = computeLevelStats(levelEntries);
  }

  // 按雷达类型分组
  const radarTypes = [...new Set(closed.map((e) => e.radar_type))];
  const byRadarType: Record<string, LevelStats> = {};
  for (const rt of radarTypes) {
    const rtEntries = closed.filter((e) => e.radar_type === rt);
    byRadarType[rt] = computeLevelStats(rtEntries);
  }

  // 错过原因分析
  const missReasons = analyzeMissReasons(closed, now);

  // 改进建议
  const suggestions = generateSuggestions(total, applied, missed, byLevel);

  return {
    period_start: periodStart.toISOString(),
    period_end: now.toISOString(),
    total_opportunities: total,
    applied_count: applied,
    missed_count: missed,
    hit_rate: total > 0 ? applied / total : 0,
    miss_rate: total > 0 ? missed / total : 0,
    by_level: byLevel as Record<CardVisibleLevel, LevelStats>,
    by_radar_type: byRadarType,
    miss_reasons: missReasons,
    suggestions,
  };
}

/**
 * 计算一组条目的等级统计。
 */
function computeLevelStats(entries: StoreEntry[]): LevelStats {
  const total = entries.length;
  const applied = entries.filter((e) => e.card.status === "applied").length;
  const missed = entries.filter((e) =>
    ["missed", "expired"].includes(e.card.status),
  ).length;
  return {
    total,
    applied,
    missed,
    hit_rate: total > 0 ? applied / total : 0,
  };
}

/**
 * 分析错过原因。
 *
 * 分类：
 *   - 未查看就过期（status = new）
 *   - 查看后未跟踪（status = viewed）
 *   - 跟踪后未报名（status = tracking）
 *   - 保存后未报名（status = saved）
 */
function analyzeMissReasons(entries: StoreEntry[], now: Date): MissReason[] {
  const reasons: Record<string, number> = {
    "未查看就过期": 0,
    "查看后未跟踪": 0,
    "跟踪后未报名": 0,
    "保存后未报名": 0,
  };

  for (const e of entries) {
    if (e.card.status === "applied") continue;
    if (new Date(e.card.deadline) >= now) continue;

    switch (e.card.status) {
      case "new": reasons["未查看就过期"]++; break;
      case "viewed": reasons["查看后未跟踪"]++; break;
      case "tracking": reasons["跟踪后未报名"]++; break;
      case "saved": reasons["保存后未报名"]++; break;
    }
  }

  const total = Object.values(reasons).reduce((a, b) => a + b, 0);
  return Object.entries(reasons)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 生成改进建议。
 *
 * 规则：
 *   - 命中率 < 30% → 建议增加搜索频率
 *   - 错过数 > 报名数 → 建议设置截止提醒
 *   - S/A 级命中率 < 50% → 建议优先关注高价值机会
 *   - 无问题时 → 保持当前策略
 */
function generateSuggestions(
  total: number,
  applied: number,
  missed: number,
  byLevel: Record<string, LevelStats>,
): string[] {
  const suggestions: string[] = [];
  const hitRate = total > 0 ? applied / total : 0;

  if (hitRate < 0.3) {
    suggestions.push("整体命中率偏低，建议增加搜索频率和覆盖范围");
  }
  if (missed > applied) {
    suggestions.push("错过数大于报名数，建议设置截止提醒（Task 028 调度器）");
  }

  // S/A 级命中率
  const saLevel = byLevel["S"] ?? byLevel["A"];
  if (saLevel && saLevel.total > 0 && saLevel.hit_rate < 0.5) {
    suggestions.push("高价值机会（S/A 级）命中率偏低，建议优先关注");
  }

  if (suggestions.length === 0) {
    suggestions.push("机会转化情况良好，保持当前策略");
  }

  return suggestions;
}
