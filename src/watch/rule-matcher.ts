/**
 * Watch Rules 匹配引擎
 *
 * 来源：Task 021 第 4.3 节。
 *
 * 提供：
 *   - matchEntry：用单条规则匹配单个 StoreEntry
 *   - filterByRules：用规则集筛选 StoreEntry 列表
 *   - matchAndSummarize：批量匹配并生成汇总
 *
 * 纯函数，不接 LLM，不编造信息。
 */

import type { StoreEntry } from "../agents/opportunity-store";
import type { RadarType } from "../agents/opportunity-store";
import type {
  WatchRule,
  WatchRuleSet,
  WatchCondition,
  MatchResult,
  MatchSummary,
} from "./types";

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取条目的可搜索文本（标题 + 类型 + 匹配理由 + 主办方）。
 * 用于 include/exclude 条件的关键词匹配。
 */
function getSearchableText(entry: StoreEntry): string {
  const card = entry.card;
  return [
    card.title,
    card.type,
    card.match_reason,
    card.organizer,
    card.reward_or_value,
  ]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join(" ");
}

/**
 * 计算距今天数（向下取整，负数表示已截止）。
 *
 * @param deadline 截止日期（YYYY-MM-DD 或 ISO 字符串）
 * @param baseDate 基准日期（默认当前时间）
 * @returns 天数差；无法解析返回 NaN
 */
function daysUntilDeadline(deadline: string, baseDate: Date = new Date()): number {
  const dateStr = (deadline ?? "").split("T")[0];
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NaN;
  }
  const target = new Date(`${dateStr}T00:00:00Z`);
  const base = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()),
  );
  const diffMs = target.getTime() - base.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * 匹配单个条件。
 */
function matchCondition(
  entry: StoreEntry,
  condition: WatchCondition,
  baseDate: Date = new Date(),
): { passed: boolean; detail: string } {
  const card = entry.card;
  const searchableText = getSearchableText(entry);

  switch (condition.operator) {
    case "include": {
      const keyword = condition.value as string;
      const passed = searchableText.includes(keyword);
      return {
        passed,
        detail: passed
          ? `含关键词 "${keyword}"`
          : `不含关键词 "${keyword}"`,
      };
    }
    case "exclude": {
      const keyword = condition.value as string;
      const passed = !searchableText.includes(keyword);
      return {
        passed,
        detail: passed
          ? `不含排除词 "${keyword}"`
          : `含排除词 "${keyword}"（应排除）`,
      };
    }
    case "radar": {
      const radarType = condition.value as RadarType;
      const passed = entry.radar_type === radarType;
      return {
        passed,
        detail: passed
          ? `雷达类型匹配 ${radarType}`
          : `雷达类型不匹配（期望 ${radarType}，实际 ${entry.radar_type}）`,
      };
    }
    case "level": {
      const levels = condition.value as string[];
      const passed = levels.includes(card.visible_level);
      return {
        passed,
        detail: passed
          ? `等级匹配 ${card.visible_level}`
          : `等级不匹配（期望 ${levels.join("/")}，实际 ${card.visible_level}）`,
      };
    }
    case "region": {
      const regionKeyword = condition.value as string;
      const passed = card.region.includes(regionKeyword);
      return {
        passed,
        detail: passed
          ? `地区含 "${regionKeyword}"`
          : `地区不含 "${regionKeyword}"（实际：${card.region || "未明确"}）`,
      };
    }
    case "deadline": {
      const maxDays = condition.value as number;
      const days = daysUntilDeadline(card.deadline, baseDate);
      if (Number.isNaN(days)) {
        return {
          passed: false,
          detail: `截止日期无法解析（${card.deadline || "空"}）`,
        };
      }
      const passed = days >= 0 && days <= maxDays;
      return {
        passed,
        detail: passed
          ? `截止日期在 ${maxDays} 天内（剩余 ${days} 天）`
          : `截止日期不在 ${maxDays} 天内（剩余 ${days} 天）`,
      };
    }
    case "starred": {
      const passed = card.status === "saved";
      return {
        passed,
        detail: passed ? "已收藏" : "未收藏",
      };
    }
    default:
      return { passed: false, detail: "未知条件" };
  }
}

// ============================================================
// 核心匹配函数
// ============================================================

/**
 * 用单条规则匹配单个 StoreEntry。
 *
 * 所有条件必须全部通过（AND 逻辑）。
 *
 * @param entry 机会库条目
 * @param rule Watch 规则
 * @param baseDate 基准日期（可选，默认当前时间）
 * @returns 匹配结果
 */
export function matchEntry(
  entry: StoreEntry,
  rule: WatchRule,
  baseDate: Date = new Date(),
): MatchResult {
  const conditionDetails = rule.conditions.map((condition) => ({
    condition,
    ...matchCondition(entry, condition, baseDate),
  }));

  const allPassed = conditionDetails.every((d) => d.passed);
  const failedCount = conditionDetails.filter((d) => !d.passed).length;

  return {
    rule,
    matched: allPassed,
    reason: allPassed
      ? `规则 "${rule.group_name}" 全部 ${rule.conditions.length} 个条件通过`
      : `规则 "${rule.group_name}" 有 ${failedCount}/${rule.conditions.length} 个条件未通过`,
    condition_details: conditionDetails,
  };
}

/**
 * 用规则集筛选 StoreEntry 列表。
 *
 * 一个条目匹配任意一条规则即入选（OR 逻辑）。
 *
 * @param entries 机会库条目列表
 * @param ruleSet 规则集
 * @param baseDate 基准日期（可选）
 * @returns 匹配的条目列表
 */
export function filterByRules(
  entries: StoreEntry[],
  ruleSet: WatchRuleSet,
  baseDate: Date = new Date(),
): StoreEntry[] {
  if (ruleSet.rules.length === 0) return entries;

  return entries.filter((entry) =>
    ruleSet.rules.some((rule) => matchEntry(entry, rule, baseDate).matched),
  );
}

/**
 * 批量匹配并生成汇总。
 *
 * @param entries 机会库条目列表
 * @param ruleSet 规则集
 * @param baseDate 基准日期（可选）
 * @returns 匹配汇总
 */
export function matchAndSummarize(
  entries: StoreEntry[],
  ruleSet: WatchRuleSet,
  baseDate: Date = new Date(),
): MatchSummary {
  const byEntry = entries.map((entry) => {
    const matchedRules = ruleSet.rules.filter(
      (rule) => matchEntry(entry, rule, baseDate).matched,
    );
    return { entry, matched_rules: matchedRules };
  });

  const byRule = ruleSet.rules.map((rule) => ({
    rule,
    matched_count: byEntry.filter((e) =>
      e.matched_rules.some((r) => r === rule),
    ).length,
  }));

  return {
    total_entries: entries.length,
    matched_entries: byEntry.filter((e) => e.matched_rules.length > 0).length,
    by_rule: byRule,
    by_entry: byEntry,
  };
}
