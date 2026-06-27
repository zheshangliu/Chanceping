/**
 * 截止提醒渲染器（reminder_renderer）
 *
 * 来源：Task 016 第 4.2 节。
 *
 * 提供：
 *   - renderRemindersMarkdown：渲染为 Markdown（用于报告/导出）
 *   - renderRemindersJson：渲染为 JSON（用于 API/前端）
 *   - renderSingleReminder：渲染单条提醒（用于通知/推送）
 *
 * 纯函数，不接 LLM，不编造信息。空值标「未明确」，空 URL 标「需人工复核」。
 */

import { BRAND } from "../brand/constants";
import { CARD_STATUS_LABELS } from "../schema/opportunity-card";
import type { OpportunityCardStatus } from "../schema/opportunity-card";
import { LEVEL_DEFINITIONS } from "../schema/scoring-rules";
import type { CardVisibleLevel } from "../schema/scoring-rules";
import type { StoreEntry } from "./opportunity-store";
import {
  REMINDER_LEVEL_LABELS,
} from "./reminder-engine";
import type { ReminderItem, ReminderResult, ReminderLevel } from "./reminder-engine";

// ============================================================
// 辅助函数
// ============================================================

/** 空字符串值标「未明确」 */
function formatString(value: string | undefined | null): string {
  if (!value || value === "") return "未明确";
  return value;
}

/** 空 URL 标「需人工复核」 */
function formatUrl(value: string | undefined | null): string {
  if (!value || value === "") return "需人工复核";
  return value;
}

/** 获取可见等级定义说明 */
function getLevelDefinition(level: CardVisibleLevel): string {
  return LEVEL_DEFINITIONS[level] ?? "";
}

/** 获取卡片状态中文名 */
function getStatusLabel(status: OpportunityCardStatus): string {
  return CARD_STATUS_LABELS[status] ?? status;
}

/** 获取提醒级别中文名 */
function getReminderLevelLabel(level: ReminderLevel): string {
  return REMINDER_LEVEL_LABELS[level] ?? level;
}

/**
 * 渲染单个提醒项的 Markdown 卡片块。
 *
 * 格式（urgent/soon/warning）：
 *   ### N. {title}
 *   - 等级：{visible_level}（{level_definition}）
 *   - 截止日期：{deadline}（{days} 天后）
 *   - 建议行动：{suggested_action}
 *   - 官方链接：{official_source_url}
 *   - 状态：{status_label}
 *
 * 格式（expired）：
 *   ### N. {title}
 *   - 等级：{visible_level}
 *   - 截止日期：{deadline}（已过期 {abs(days)} 天）
 *   - 建议行动：{suggested_action}
 *   - 官方链接：{official_source_url}
 *   - 状态：{status_label}
 */
function renderReminderItemMarkdown(item: ReminderItem, index: number): string {
  const card = item.entry.card;
  const lines: string[] = [];
  lines.push(`### ${index + 1}. ${formatString(item.title)}`);
  lines.push(`- 等级：${card.visible_level}（${getLevelDefinition(card.visible_level)}）`);

  if (item.level === "expired") {
    lines.push(`- 截止日期：${formatString(item.deadline)}（已过期 ${Math.abs(item.days_until_deadline)} 天）`);
  } else {
    lines.push(`- 截止日期：${formatString(item.deadline)}（${item.days_until_deadline} 天后）`);
  }

  lines.push(`- 建议行动：${item.suggested_action}`);
  lines.push(`- 官方链接：${formatUrl(card.official_source_url)}`);
  lines.push(`- 状态：${getStatusLabel(card.status)}`);
  return lines.join("\n");
}

/** 渲染一个提醒级别的整节 */
function renderReminderSection(
  level: ReminderLevel,
  items: ReminderItem[],
  sectionTitle: string,
  sectionIntro: string,
  emptyText: string,
): string {
  const lines: string[] = [];
  lines.push(`## ${sectionTitle}（${items.length} 项）`);
  lines.push("");
  lines.push(`> ${sectionIntro}`);
  lines.push("");

  if (items.length === 0) {
    lines.push(`> ${emptyText}`);
  } else {
    lines.push(items.map((item, idx) => renderReminderItemMarkdown(item, idx)).join("\n\n"));
  }
  lines.push("");
  return lines.join("\n");
}

/** 渲染无需提醒节 */
function renderNoReminderSection(entries: StoreEntry[]): string {
  const lines: string[] = [];
  lines.push(`## 无需提醒（${entries.length} 项）`);
  lines.push("");
  lines.push("> 截止日期在 14 天后或无截止日期，暂不提醒。");
  lines.push("");

  if (entries.length === 0) {
    lines.push("> 暂无需提醒项");
  } else {
    for (const entry of entries) {
      const deadline = entry.card.deadline && entry.card.deadline !== ""
        ? entry.card.deadline
        : "未明确";
      lines.push(`- ${formatString(entry.card.title)}（截止：${deadline}）`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ============================================================
// 核心渲染函数
// ============================================================

/**
 * 渲染提醒为 Markdown（用于报告/导出）。
 *
 * 结构（Task 016 第 4.2 节）：
 *   # {BRAND.product_name}｜截止提醒
 *   基准日期 / 提醒总数
 *   ---
 *   ## 紧急提醒（N 项）
 *   ## 即将到期（N 项）
 *   ## 远期预警（N 项）
 *   ## 已截止（N 项）
 *   ## 无需提醒（N 项）
 */
export function renderRemindersMarkdown(result: ReminderResult): string {
  const lines: string[] = [];

  // 标题
  lines.push(`# ${BRAND.product_name}｜截止提醒`);
  lines.push("");
  lines.push(`基准日期：${result.base_date}`);
  lines.push(
    `提醒总数：${result.summary.total}（紧急 ${result.summary.urgent_count} / 即将到期 ${result.summary.soon_count} / 远期预警 ${result.summary.warning_count} / 已截止 ${result.summary.expired_count}）`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // 紧急提醒
  lines.push(
    renderReminderSection(
      "urgent",
      result.urgent,
      "紧急提醒",
      "截止日期在 3 天内，需立即行动。",
      "暂无紧急提醒",
    ),
  );
  lines.push("---");
  lines.push("");

  // 即将到期
  lines.push(
    renderReminderSection(
      "soon",
      result.soon,
      "即将到期",
      "截止日期在 7 天内，建议本周处理。",
      "暂无即将到期提醒",
    ),
  );
  lines.push("---");
  lines.push("");

  // 远期预警
  lines.push(
    renderReminderSection(
      "warning",
      result.warning,
      "远期预警",
      "截止日期在 14 天内，可开始准备。",
      "暂无远期预警",
    ),
  );
  lines.push("---");
  lines.push("");

  // 已截止
  lines.push(
    renderReminderSection(
      "expired",
      result.expired,
      "已截止",
      "以下机会已过期，建议归档或移除。",
      "暂无已截止项",
    ),
  );
  lines.push("---");
  lines.push("");

  // 无需提醒
  lines.push(renderNoReminderSection(result.no_reminder));

  return lines.join("\n");
}

/**
 * 渲染提醒为 JSON（用于 API/前端）。
 *
 * 输出结构：包含 base_date / summary / 4 个级别数组 / no_reminder 条目数组。
 */
export function renderRemindersJson(result: ReminderResult): string {
  const payload = {
    base_date: result.base_date,
    summary: result.summary,
    urgent: result.urgent,
    soon: result.soon,
    warning: result.warning,
    expired: result.expired,
    no_reminder: result.no_reminder.map((entry) => ({
      title: entry.card.title,
      deadline: entry.card.deadline,
      radar_type: entry.radar_type,
      dedup_key: entry.dedup_key,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 渲染单条提醒（用于通知/推送）。
 *
 * 格式（Task 016 第 4.2 节）：
 *   [{level_label}] {title}
 *   截止：{deadline}（{days} 天后）  ← expired 用「已过期 N 天」
 *   {suggested_action}
 *   官方链接：{url}
 */
export function renderSingleReminder(item: ReminderItem): string {
  const levelLabel = getReminderLevelLabel(item.level);
  const lines: string[] = [];

  lines.push(`[${levelLabel}] ${formatString(item.title)}`);

  if (item.level === "expired") {
    lines.push(`截止：${formatString(item.deadline)}（已过期 ${Math.abs(item.days_until_deadline)} 天）`);
  } else {
    lines.push(`截止：${formatString(item.deadline)}（${item.days_until_deadline} 天后）`);
  }

  lines.push(item.suggested_action);
  lines.push(`官方链接：${formatUrl(item.entry.card.official_source_url)}`);

  return lines.join("\n");
}
