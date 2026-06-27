/**
 * 机会卡片字段定义（opportunity_card）
 *
 * 来源：01 号文档第 10.2 节"通用机会卡片字段" + Task 001 第 4.5 节。
 * 每条机会必须有官方链接；没有链接不能作为高等级机会。
 *
 * Task 014（V0.5）扩展：新增状态机常量、卡片优先级、卡片来源标记。
 * 现有 OpportunityCard 接口的 16 个字段保持不变，仅新增类型与常量。
 */

import type { CardVisibleLevel } from "./scoring-rules";

/** 机会卡片状态 */
export type OpportunityCardStatus =
  | "new"
  | "viewed"
  | "saved"
  | "applied"
  | "archived"
  | "dismissed";

/**
 * 通用机会卡片字段。
 * 字段与 01 号文档第 10.2 节一致，前台展示用 visible_level（S/A/B/C），
 * 不直接展示 backend_score。
 */
export interface OpportunityCard {
  /** 机会名称 */
  title: string;
  /** 类型（如 AI 赛事 / 政策补贴 / 文创比赛） */
  type: string;
  /** 主办方 / 发布方 */
  organizer: string;
  /** 地区 */
  region: string;
  /** 截止日期 */
  deadline: string;
  /** 奖励 / 补贴 / 价值 */
  reward_or_value: string;
  /** 适合对象 / 资格要求 */
  eligibility: string;
  /** 所需材料 */
  materials_required: string;
  /** 为什么适合你（匹配理由） */
  match_reason: string;
  /** 下一步行动建议 */
  next_action: string;
  /** 官方来源链接（必填） */
  official_source_url: string;
  /** 报名链接 */
  application_url: string;
  /** 联系方式（如有） */
  contact_info: string;
  /** 风险提醒 */
  risk_note: string;
  /** 后台分数 0–100（前台不展示） */
  backend_score: number;
  /** 前台可见等级 S/A/B/C（hidden 不进卡片） */
  visible_level: CardVisibleLevel;
  /** 卡片状态 */
  status: OpportunityCardStatus;
}

// ============================================================
// Task 014（V0.5）新增类型
// ============================================================

/** 卡片渲染模式 */
export type CardRenderMode = "compact" | "standard" | "detail";

/** 卡片优先级（用于排序，数字越小优先级越高） */
export type CardPriority = "urgent" | "high" | "medium" | "low";

/** 卡片来源标记（V0.8 搜索层用，V0.5 预留） */
export type CardSource = "manual" | "search" | "user_supplied" | "rss";

// ============================================================
// Task 014（V0.5）新增常量
// ============================================================

/**
 * 卡片状态合法转换表。
 *
 * 规则（Task 014 附录 A.1）：
 *   new → viewed, saved, archived, dismissed
 *   viewed → saved, applied, archived, dismissed
 *   saved → applied, archived, dismissed
 *   applied → archived, dismissed
 *   archived → （终态，不可转出）
 *   dismissed → （终态，不可转出）
 */
export const CARD_STATUS_TRANSITIONS: Record<OpportunityCardStatus, OpportunityCardStatus[]> = {
  new: ["viewed", "saved", "archived", "dismissed"],
  viewed: ["saved", "applied", "archived", "dismissed"],
  saved: ["applied", "archived", "dismissed"],
  applied: ["archived", "dismissed"],
  archived: [],
  dismissed: [],
};

/** 卡片状态中文名 */
export const CARD_STATUS_LABELS: Record<OpportunityCardStatus, string> = {
  new: "新发现",
  viewed: "已查看",
  saved: "已保存",
  applied: "已报名",
  archived: "已归档",
  dismissed: "已忽略",
};

/** 卡片优先级中文名 */
export const CARD_PRIORITY_LABELS: Record<CardPriority, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

/** 卡片来源中文名 */
export const CARD_SOURCE_LABELS: Record<CardSource, string> = {
  manual: "手动录入",
  search: "搜索",
  user_supplied: "用户提供",
  rss: "RSS 订阅",
};

/**
 * 卡片必填字段（critical）。
 * 缺失任一字段则卡片不可用。
 */
export const CARD_CRITICAL_FIELDS: string[] = [
  "title",
  "type",
  "organizer",
  "official_source_url",
  "deadline",
  "visible_level",
];

/**
 * 卡片可选字段（optional）。
 * 缺失则卡片可用但质量降低。
 */
export const CARD_OPTIONAL_FIELDS: string[] = [
  "region",
  "reward_or_value",
  "eligibility",
  "match_reason",
  "next_action",
  "application_url",
  "contact_info",
  "risk_note",
  "materials_required",
  "backend_score",
];

/**
 * 判断卡片状态转换是否合法。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 合法返回 true，非法返回 false
 */
export function isStatusTransitionValid(
  from: OpportunityCardStatus,
  to: OpportunityCardStatus,
): boolean {
  // 自转不合法
  if (from === to) return false;
  // 查转换表
  const allowed = CARD_STATUS_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}
