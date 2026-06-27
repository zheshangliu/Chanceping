/**
 * 机会卡片标准化模板（card_template）
 *
 * 来源：Task 014 第 4.2 节。
 *
 * 提供 3 种渲染模式：
 *   - compact：紧凑列表项（用于报告中的列表展示）
 *   - standard：标准卡片（用于报告中的机会详情卡片）
 *   - detail：详情页（用于前端 UI 或独立卡片页面）
 *
 * 纯函数，不接 LLM，不编造信息。
 * 空值处理：空字符串标「未明确」，空 URL 标「需人工复核」。
 */

import type { OpportunityCard } from "../schema/opportunity-card";
import {
  CARD_STATUS_LABELS,
  CARD_SOURCE_LABELS,
} from "../schema/opportunity-card";
import type { CardVisibleLevel } from "../schema/scoring-rules";
import { LEVEL_DEFINITIONS } from "../schema/scoring-rules";
import type { VisibleLevel } from "../schema/scoring-rules";

// ============================================================
// 辅助函数：空值处理
// ============================================================

/** 字符串空值处理：空字符串或"未明确"标「未明确」 */
function formatString(value: string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "未明确";
  return value;
}

/** URL 空值处理：空字符串标「需人工复核」 */
function formatUrl(value: string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "需人工复核";
  return value;
}

/** 等级定义（处理 hidden 不在 CardVisibleLevel 中的情况） */
function getLevelDefinition(level: CardVisibleLevel): string {
  return LEVEL_DEFINITIONS[level as VisibleLevel] ?? "";
}

/** 计算距今天数（向下取整，负数表示已截止） */
function daysUntilDeadline(deadline: string, baseDate: Date = new Date()): number {
  // 取 YYYY-MM-DD 部分
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

// ============================================================
// 渲染函数：compact（紧凑列表）
// ============================================================

/**
 * 渲染紧凑列表项（用于报告中的列表展示）。
 *
 * 格式：
 *   - [{visible_level}] {title}（截止：{deadline}）— {match_reason}
 *
 * @param card 机会卡片
 * @returns 单行 Markdown 字符串
 */
export function renderCardCompact(card: OpportunityCard): string {
  const level = card.visible_level;
  const title = formatString(card.title);
  const deadline = formatString(card.deadline);
  const matchReason = formatString(card.match_reason);
  return `- [${level}] ${title}（截止：${deadline}）— ${matchReason}`;
}

// ============================================================
// 渲染函数：standard（标准卡片）
// ============================================================

/**
 * 渲染标准卡片（用于报告中的机会详情卡片）。
 *
 * 格式：三级标题 + 14 个字段列表（与 OPPORTUNITY_CARD_REQUIRED_FIELDS 对应）
 *
 * @param card 机会卡片
 * @returns 多行 Markdown 字符串
 */
export function renderCardStandard(card: OpportunityCard): string {
  const lines: string[] = [];
  lines.push(`### ${formatString(card.title)}`);
  lines.push("");
  lines.push(`- 推荐等级：${card.visible_level}`);
  lines.push(`- 机会类型：${formatString(card.type)}`);
  lines.push(`- 主办方 / 发布方：${formatString(card.organizer)}`);
  lines.push(`- 地区：${formatString(card.region)}`);
  lines.push(`- 截止日期：${formatString(card.deadline)}`);
  lines.push(`- 奖励 / 补贴 / 价值：${formatString(card.reward_or_value)}`);
  lines.push(`- 适合对象：${formatString(card.eligibility)}`);
  lines.push(`- 为什么适合你：${formatString(card.match_reason)}`);
  lines.push(`- 下一步行动建议：${formatString(card.next_action)}`);
  lines.push(`- 官方来源链接：${formatUrl(card.official_source_url)}`);
  lines.push(`- 报名链接：${formatUrl(card.application_url)}`);
  lines.push(`- 联系方式：${formatString(card.contact_info)}`);
  lines.push(`- 风险提醒：${formatString(card.risk_note)}`);
  return lines.join("\n");
}

// ============================================================
// 渲染函数：detail（详情页）
// ============================================================

/**
 * 渲染详情页（用于前端 UI 或独立卡片页面）。
 *
 * 格式：一级标题 + 4 个二级章节（基本信息/价值与资格/匹配分析/链接与联系）+ 后台分数
 *
 * @param card 机会卡片
 * @returns 多行 Markdown 字符串
 */
export function renderCardDetail(card: OpportunityCard): string {
  const lines: string[] = [];
  const levelDef = getLevelDefinition(card.visible_level);
  const statusLabel = CARD_STATUS_LABELS[card.status];
  // V0.5 阶段 OpportunityCard 无 source 字段，默认显示"手动录入"
  const sourceLabel = CARD_SOURCE_LABELS.manual;
  const days = daysUntilDeadline(card.deadline);
  const daysText = Number.isNaN(days) ? "未明确" : `${days} 天`;

  lines.push(`# ${formatString(card.title)}`);
  lines.push("");
  lines.push("## 基本信息");
  lines.push(`- 推荐等级：${card.visible_level}（${levelDef}）`);
  lines.push(`- 机会类型：${formatString(card.type)}`);
  lines.push(`- 状态：${statusLabel}`);
  lines.push(`- 来源：${sourceLabel}`);
  lines.push(`- 主办方 / 发布方：${formatString(card.organizer)}`);
  lines.push(`- 地区：${formatString(card.region)}`);
  lines.push(`- 截止日期：${formatString(card.deadline)}（距今天数：${daysText}）`);
  lines.push("");
  lines.push("## 价值与资格");
  lines.push(`- 奖励 / 补贴 / 价值：${formatString(card.reward_or_value)}`);
  lines.push(`- 适合对象 / 资格要求：${formatString(card.eligibility)}`);
  lines.push(`- 所需材料：${formatString(card.materials_required)}`);
  lines.push("");
  lines.push("## 匹配分析");
  lines.push(`- 为什么适合你：${formatString(card.match_reason)}`);
  lines.push(`- 下一步行动建议：${formatString(card.next_action)}`);
  lines.push(`- 风险提醒：${formatString(card.risk_note)}`);
  lines.push("");
  lines.push("## 链接与联系");
  lines.push(`- 官方来源链接：${formatUrl(card.official_source_url)}`);
  lines.push(`- 报名链接：${formatUrl(card.application_url)}`);
  lines.push(`- 联系方式：${formatString(card.contact_info)}`);
  lines.push("");
  lines.push("---");
  lines.push(`后台分数：${card.backend_score}（前台不展示）`);
  return lines.join("\n");
}
