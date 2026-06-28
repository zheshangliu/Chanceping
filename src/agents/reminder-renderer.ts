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

// ============================================================
// T5: 多渠道渲染（Task 019b 新增，向后兼容）
// ============================================================

/** T5: 推送渠道类型 */
export type ReminderChannel = "wechat" | "email" | "web";

/** T5: 渠道格式指南 */
export interface ChannelFormatGuide {
  /** 渠道标识 */
  channel: ReminderChannel;
  /** 最大字符数（0 表示无限制） */
  max_length: number;
  /** 输出格式 */
  format: "plain" | "markdown" | "html";
  /** 是否启用 emoji */
  emoji_enabled: boolean;
  /** 链接格式 */
  link_format: "inline" | "footnote" | "disabled";
}

/** T5: 微信渠道最大字符数 */
const WECHAT_MAX_LENGTH = 2048;

/** T5: 渠道 → emoji 映射 */
const CHANNEL_LEVEL_EMOJI: Record<ReminderLevel, string> = {
  urgent: "🔴",
  soon: "🟡",
  warning: "🔵",
  expired: "⚪",
};

/** T5: 渠道 → 级别中文名（短标签） */
const CHANNEL_LEVEL_LABEL: Record<ReminderLevel, string> = {
  urgent: "紧急",
  soon: "即将",
  warning: "提醒",
  expired: "过期",
};

/**
 * T5: 获取渠道格式指南。
 *
 * | 渠道 | 格式 | 最大长度 | Emoji | 链接格式 |
 * |---|---|---|---|---|
 * | wechat | plain text | 2048 | 启用 | inline（纯文本 URL） |
 * | email | html | 无限制 | 禁用 | inline（<a> 标签） |
 * | web | markdown | 无限制 | 启用 | inline（Markdown 链接） |
 *
 * @param channel 推送渠道
 * @returns 渠道格式指南
 */
export function getChannelFormatGuide(channel: ReminderChannel): ChannelFormatGuide {
  switch (channel) {
    case "wechat":
      return {
        channel: "wechat",
        max_length: WECHAT_MAX_LENGTH,
        format: "plain",
        emoji_enabled: true,
        link_format: "inline",
      };
    case "email":
      return {
        channel: "email",
        max_length: 0,
        format: "html",
        emoji_enabled: false,
        link_format: "inline",
      };
    case "web":
      return {
        channel: "web",
        max_length: 0,
        format: "markdown",
        emoji_enabled: true,
        link_format: "inline",
      };
  }
}

/**
 * T5: 按渠道渲染提醒。
 *
 * 三个渠道的渲染规则（Task 019b 第 4.3 节）：
 *   - wechat：纯文本，emoji 标记，超 2048 字符截断追加"详见Web"
 *   - email：HTML 格式，table 列表，紧急项红色高亮，无 emoji
 *   - web：Markdown 格式，emoji 标记，复用现有 Markdown 渲染逻辑
 *
 * @param result 提醒结果
 * @param channel 推送渠道
 * @returns 渲染后的字符串
 */
export function renderRemindersForChannel(
  result: ReminderResult,
  channel: ReminderChannel,
): string {
  switch (channel) {
    case "wechat":
      return renderForWechat(result);
    case "email":
      return renderForEmail(result);
    case "web":
      return renderForWeb(result);
  }
}

// ------------------------------------------------------------
// T5: wechat 渠道（纯文本 + emoji）
// ------------------------------------------------------------

/**
 * wechat 渠道渲染。
 *
 * 格式：
 *   【紧急提醒】盯一下 {BRAND.product_name}   ← 有紧急项时
 *   【提醒】盯一下 {BRAND.product_name}       ← 无紧急项时
 *   🔴 [紧急] 机会名称（还有N天）→ URL
 *   🟡 [即将] 机会名称（还有N天）→ URL
 *   🔵 [提醒] 机会名称（还有N天）→ URL
 *   ⚪ [过期] 机会名称（已过期N天）→ URL
 *
 * 超过 2048 字符截断，追加 `...（共N条，详见Web）`
 */
function renderForWechat(result: ReminderResult): string {
  const lines: string[] = [];
  const totalCount =
    result.summary.urgent_count +
    result.summary.soon_count +
    result.summary.warning_count +
    result.summary.expired_count;

  // 标题行
  const titlePrefix = result.summary.urgent_count > 0 ? "【紧急提醒】" : "【提醒】";
  lines.push(`${titlePrefix}盯一下 ${BRAND.product_name}`);
  lines.push("");

  // 各级别提醒
  appendWechatLevel(lines, "urgent", result.urgent);
  appendWechatLevel(lines, "soon", result.soon);
  appendWechatLevel(lines, "warning", result.warning);
  appendWechatLevel(lines, "expired", result.expired);

  let output = lines.join("\n");

  // 超长截断
  if (output.length > WECHAT_MAX_LENGTH) {
    const suffix = `...（共${totalCount}条，详见Web）`;
    output = output.slice(0, WECHAT_MAX_LENGTH - suffix.length) + suffix;
  }
  return output;
}

/** 追加一个级别的 wechat 提醒行 */
function appendWechatLevel(
  lines: string[],
  level: ReminderLevel,
  items: ReminderItem[],
): void {
  const emoji = CHANNEL_LEVEL_EMOJI[level];
  const label = CHANNEL_LEVEL_LABEL[level];
  for (const item of items) {
    const title = formatString(item.title);
    const url = formatUrl(item.entry.card.official_source_url);
    if (level === "expired") {
      lines.push(`${emoji} [${label}] ${title}（已过期${Math.abs(item.days_until_deadline)}天）→ ${url}`);
    } else {
      lines.push(`${emoji} [${label}] ${title}（还有${item.days_until_deadline}天）→ ${url}`);
    }
  }
}

// ------------------------------------------------------------
// T5: email 渠道（HTML + 无 emoji）
// ------------------------------------------------------------

/**
 * email 渠道渲染。
 *
 * 格式：
 *   <h2>{BRAND.product_name}｜截止提醒</h2>
 *   <p>基准日期：{base_date}｜提醒总数：{total}</p>
 *   <table>
 *     <tr><th>级别</th><th>名称</th><th>截止</th><th>链接</th></tr>
 *     <tr><td><strong style="color:red">紧急</strong></td><td>名称</td><td>截止</td><td><a href="URL">URL</a></td></tr>
 *     ...
 *   </table>
 *
 * 紧急项用 <strong style="color:red"> 高亮，无 emoji。
 */
function renderForEmail(result: ReminderResult): string {
  const lines: string[] = [];
  const totalCount =
    result.summary.urgent_count +
    result.summary.soon_count +
    result.summary.warning_count +
    result.summary.expired_count;

  lines.push(`<h2>${escapeHtml(BRAND.product_name)}｜截止提醒</h2>`);
  lines.push(
    `<p>基准日期：${escapeHtml(result.base_date)}｜提醒总数：${totalCount}</p>`,
  );
  lines.push("<table border=\"1\" cellpadding=\"4\" cellspacing=\"0\">");
  lines.push("<tr><th>级别</th><th>名称</th><th>截止</th><th>链接</th></tr>");

  appendEmailRows(lines, "urgent", result.urgent);
  appendEmailRows(lines, "soon", result.soon);
  appendEmailRows(lines, "warning", result.warning);
  appendEmailRows(lines, "expired", result.expired);

  lines.push("</table>");
  return lines.join("\n");
}

/** 追加一个级别的 email 表格行 */
function appendEmailRows(
  lines: string[],
  level: ReminderLevel,
  items: ReminderItem[],
): void {
  const label = CHANNEL_LEVEL_LABEL[level];
  // 紧急项用红色高亮
  const levelCell =
    level === "urgent"
      ? `<strong style="color:red">${escapeHtml(label)}</strong>`
      : escapeHtml(label);

  for (const item of items) {
    const title = escapeHtml(formatString(item.title));
    const url = item.entry.card.official_source_url ?? "";
    const urlCell =
      url && url !== ""
        ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`
        : "需人工复核";
    let deadlineCell: string;
    if (level === "expired") {
      deadlineCell = escapeHtml(
        `${formatString(item.deadline)}（已过期${Math.abs(item.days_until_deadline)}天）`,
      );
    } else {
      deadlineCell = escapeHtml(
        `${formatString(item.deadline)}（还有${item.days_until_deadline}天）`,
      );
    }
    lines.push(
      `<tr><td>${levelCell}</td><td>${title}</td><td>${deadlineCell}</td><td>${urlCell}</td></tr>`,
    );
  }
}

/** HTML 转义（防止 XSS） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ------------------------------------------------------------
// T5: web 渠道（Markdown + emoji）
// ------------------------------------------------------------

/**
 * web 渠道渲染。
 *
 * 复用现有 renderRemindersMarkdown 的结构，在每个级别标题和提醒项前增加 emoji 标记。
 * 链接用 Markdown `[文本](URL)` 格式。
 */
function renderForWeb(result: ReminderResult): string {
  const lines: string[] = [];

  // 标题
  lines.push(`# ${BRAND.product_name}｜截止提醒`);
  lines.push("");
  lines.push(`基准日期：${result.base_date}`);
  lines.push(
    `提醒总数：${result.summary.total}（🔴 紧急 ${result.summary.urgent_count} / 🟡 即将到期 ${result.summary.soon_count} / 🔵 远期预警 ${result.summary.warning_count} / ⚪ 已截止 ${result.summary.expired_count}）`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // 紧急提醒
  lines.push(
    renderWebSection(
      "urgent",
      result.urgent,
      "🔴 紧急提醒",
      "截止日期在 3 天内，需立即行动。",
      "暂无紧急提醒",
    ),
  );
  lines.push("---");
  lines.push("");

  // 即将到期
  lines.push(
    renderWebSection(
      "soon",
      result.soon,
      "🟡 即将到期",
      "截止日期在 7 天内，建议本周处理。",
      "暂无即将到期提醒",
    ),
  );
  lines.push("---");
  lines.push("");

  // 远期预警
  lines.push(
    renderWebSection(
      "warning",
      result.warning,
      "🔵 远期预警",
      "截止日期在 14 天内，可开始准备。",
      "暂无远期预警",
    ),
  );
  lines.push("---");
  lines.push("");

  // 已截止
  lines.push(
    renderWebSection(
      "expired",
      result.expired,
      "⚪ 已截止",
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

/** 渲染 web 渠道的一个级别节（Markdown + emoji） */
function renderWebSection(
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
    lines.push(items.map((item, idx) => renderWebItemMarkdown(item, idx)).join("\n\n"));
  }
  lines.push("");
  return lines.join("\n");
}

/** 渲染 web 渠道的单个提醒项（Markdown + emoji + Markdown 链接） */
function renderWebItemMarkdown(item: ReminderItem, index: number): string {
  const card = item.entry.card;
  const emoji = CHANNEL_LEVEL_EMOJI[item.level];
  const lines: string[] = [];
  lines.push(`### ${index + 1}. ${emoji} ${formatString(item.title)}`);
  lines.push(`- 等级：${card.visible_level}（${getLevelDefinition(card.visible_level)}）`);

  if (item.level === "expired") {
    lines.push(`- 截止日期：${formatString(item.deadline)}（已过期 ${Math.abs(item.days_until_deadline)} 天）`);
  } else {
    lines.push(`- 截止日期：${formatString(item.deadline)}（${item.days_until_deadline} 天后）`);
  }

  lines.push(`- 建议行动：${item.suggested_action}`);
  // web 渠道用 Markdown 链接格式
  const url = card.official_source_url ?? "";
  if (url && url !== "") {
    lines.push(`- 官方链接：[${url}](${url})`);
  } else {
    lines.push(`- 官方链接：需人工复核`);
  }
  lines.push(`- 状态：${getStatusLabel(card.status)}`);
  return lines.join("\n");
}
