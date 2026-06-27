/**
 * 机会卡片工厂（card_factory）
 *
 * 来源：Task 014 第 4.3 节。
 *
 * 提供：
 *   - createOpportunityCard：从部分数据创建标准化卡片（缺失字段填默认值）
 *   - createOpportunityCards：批量创建卡片
 *   - updateCardStatus：更新卡片状态（校验状态转换合法性）
 *   - validateCardCompleteness：校验卡片完整性（critical/optional/link/score）
 *
 * 纯函数，不接 LLM，不编造信息。
 */

import type {
  OpportunityCard,
  OpportunityCardStatus,
  CardSource,
} from "../schema/opportunity-card";
import {
  CARD_CRITICAL_FIELDS,
  CARD_OPTIONAL_FIELDS,
  CARD_STATUS_LABELS,
  isStatusTransitionValid,
} from "../schema/opportunity-card";
import type { CardVisibleLevel } from "../schema/scoring-rules";
import { scoreToLevel } from "../schema/scoring-rules";
import type { VisibleLevel } from "../schema/scoring-rules";

// ============================================================
// 类型定义
// ============================================================

/** 卡片创建输入（工厂函数用，部分字段可选） */
export interface CreateCardInput {
  /** 机会名称（必填） */
  title: string;
  /** 类型（必填） */
  type: string;
  /** 主办方（必填） */
  organizer: string;
  /** 官方来源链接（必填） */
  official_source_url: string;
  /** 截止日期 */
  deadline?: string;
  /** 地区 */
  region?: string;
  /** 奖励 / 补贴 / 价值 */
  reward_or_value?: string;
  /** 适合对象 / 资格要求 */
  eligibility?: string;
  /** 所需材料 */
  materials_required?: string;
  /** 为什么适合你（匹配理由） */
  match_reason?: string;
  /** 下一步行动建议 */
  next_action?: string;
  /** 报名链接 */
  application_url?: string;
  /** 联系方式 */
  contact_info?: string;
  /** 风险提醒 */
  risk_note?: string;
  /** 后台分数 0–100 */
  backend_score?: number;
  /** 前台可见等级（不传则由 backend_score 计算） */
  visible_level?: CardVisibleLevel;
  /** 卡片来源（V0.5 预留，V0.8 搜索层用） */
  source?: CardSource;
}

/** 卡片完整性校验结果 */
export interface CardCompletenessResult {
  /** 是否有效（critical 字段无缺失） */
  valid: boolean;
  /** critical 字段缺失列表 */
  critical_missing: string[];
  /** 可选字段缺失列表 */
  optional_missing: string[];
  /** 官方链接是否存在 */
  link_valid: boolean;
  /** 分数与等级是否不匹配 */
  score_warning: boolean;
}

/** 状态更新结果 */
export interface CardStatusUpdateResult {
  /** 是否成功 */
  success: boolean;
  /** 更新后的卡片（success=true 时有值） */
  card: OpportunityCard | null;
  /** 失败原因（success=false 时有值） */
  error: string | null;
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 从部分数据创建标准化卡片。
 *
 * 规则：
 *   - 必填字段缺失（title/type/organizer/official_source_url）抛错
 *   - 可选字段缺失填默认值
 *   - visible_level 未传则用 scoreToLevel(backend_score) 计算
 *   - status 默认 "new"
 *   - source 默认 "manual"（V0.5 阶段不持久化到卡片，仅用于创建过程）
 *
 * @param input 卡片创建输入
 * @returns 完整的 OpportunityCard
 * @throws Error 当必填字段缺失时
 */
export function createOpportunityCard(input: CreateCardInput): OpportunityCard {
  // 校验必填字段
  const requiredFields: Array<{ key: keyof CreateCardInput; label: string }> = [
    { key: "title", label: "机会名称" },
    { key: "type", label: "类型" },
    { key: "organizer", label: "主办方" },
    { key: "official_source_url", label: "官方来源链接" },
  ];
  for (const { key, label } of requiredFields) {
    const value = input[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`必填字段缺失：${label}（${String(key)}）`);
    }
  }

  // 计算默认 backend_score
  const backendScore = input.backend_score ?? 50;

  // 计算 visible_level
  let visibleLevel: CardVisibleLevel;
  if (input.visible_level) {
    visibleLevel = input.visible_level;
  } else {
    const level = scoreToLevel(backendScore);
    // scoreToLevel 可能返回 "hidden"，但 CardVisibleLevel 不含 hidden
    // 若返回 hidden，降级为 "C"（最低可见等级）
    visibleLevel = (level === "hidden" ? "C" : level) as CardVisibleLevel;
  }

  return {
    title: input.title,
    type: input.type,
    organizer: input.organizer,
    region: input.region ?? "未明确",
    deadline: input.deadline ?? "未明确",
    reward_or_value: input.reward_or_value ?? "未明确",
    eligibility: input.eligibility ?? "未明确",
    materials_required: input.materials_required ?? "未明确",
    match_reason: input.match_reason ?? "未明确",
    next_action: input.next_action ?? "未明确",
    official_source_url: input.official_source_url,
    application_url: input.application_url ?? "",
    contact_info: input.contact_info ?? "未找到公开信息",
    risk_note: input.risk_note ?? "暂无",
    backend_score: backendScore,
    visible_level: visibleLevel,
    status: "new",
  };
}

/**
 * 批量创建卡片。
 *
 * @param inputs 卡片创建输入数组
 * @returns 完整的 OpportunityCard 数组
 * @throws Error 当任一输入的必填字段缺失时
 */
export function createOpportunityCards(inputs: CreateCardInput[]): OpportunityCard[] {
  return inputs.map(createOpportunityCard);
}

// ============================================================
// 状态更新
// ============================================================

/**
 * 更新卡片状态（校验状态转换合法性）。
 *
 * 规则：
 *   - 使用 isStatusTransitionValid() 校验转换合法性
 *   - 非法转换返回 success=false + error
 *   - 合法转换返回 success=true + 新卡片（不可变，返回副本）
 *
 * @param card 原卡片
 * @param new_status 目标状态
 * @returns 状态更新结果
 */
export function updateCardStatus(
  card: OpportunityCard,
  new_status: OpportunityCardStatus,
): CardStatusUpdateResult {
  const fromStatus = card.status;

  // 校验转换合法性
  if (!isStatusTransitionValid(fromStatus, new_status)) {
    const fromLabel = CARD_STATUS_LABELS[fromStatus];
    const toLabel = CARD_STATUS_LABELS[new_status];
    return {
      success: false,
      card: null,
      error: `状态转换非法：${fromLabel}（${fromStatus}）→ ${toLabel}（${new_status}）。当前状态为终态或转换路径不存在。`,
    };
  }

  // 返回新卡片（不可变模式）
  return {
    success: true,
    card: { ...card, status: new_status },
    error: null,
  };
}

// ============================================================
// 完整性校验
// ============================================================

/**
 * 校验卡片完整性。
 *
 * 校验维度：
 *   1. critical 字段（6 个）：title, type, organizer, official_source_url, deadline, visible_level
 *      - 字符串字段空或"未明确"视为缺失
 *      - visible_level 空视为缺失
 *   2. optional 字段（10 个）：其余字段
 *      - 字符串字段空或"未明确"视为缺失
 *      - application_url 空字符串视为缺失（需人工复核）
 *   3. link_valid：official_source_url 非空且非"未明确"
 *   4. score_warning：backend_score 与 visible_level 不匹配
 *      - 用 scoreToLevel(backend_score) 计算，与 card.visible_level 比较
 *      - 若 scoreToLevel 返回 "hidden"，则任何 CardVisibleLevel 都不匹配
 *
 * @param card 待校验的卡片
 * @returns 完整性校验结果
 */
export function validateCardCompleteness(card: OpportunityCard): CardCompletenessResult {
  const criticalMissing: string[] = [];
  const optionalMissing: string[] = [];

  // 辅助函数：判断字符串字段是否缺失
  const isStringMissing = (value: string): boolean =>
    value === undefined || value === null || value === "" || value === "未明确";

  // 检查 critical 字段
  // title
  if (isStringMissing(card.title)) criticalMissing.push("title");
  // type
  if (isStringMissing(card.type)) criticalMissing.push("type");
  // organizer
  if (isStringMissing(card.organizer)) criticalMissing.push("organizer");
  // official_source_url
  if (isStringMissing(card.official_source_url)) criticalMissing.push("official_source_url");
  // deadline
  if (isStringMissing(card.deadline)) criticalMissing.push("deadline");
  // visible_level（CardVisibleLevel 不可能为空字符串，但防御性检查）
  if (!card.visible_level) criticalMissing.push("visible_level");

  // 检查 optional 字段
  if (isStringMissing(card.region)) optionalMissing.push("region");
  if (isStringMissing(card.reward_or_value)) optionalMissing.push("reward_or_value");
  if (isStringMissing(card.eligibility)) optionalMissing.push("eligibility");
  if (isStringMissing(card.match_reason)) optionalMissing.push("match_reason");
  if (isStringMissing(card.next_action)) optionalMissing.push("next_action");
  // application_url 空字符串视为缺失
  if (card.application_url === undefined || card.application_url === null || card.application_url === "") {
    optionalMissing.push("application_url");
  }
  if (isStringMissing(card.contact_info) || card.contact_info === "未找到公开信息") {
    optionalMissing.push("contact_info");
  }
  if (isStringMissing(card.risk_note) || card.risk_note === "暂无") {
    optionalMissing.push("risk_note");
  }
  if (isStringMissing(card.materials_required)) optionalMissing.push("materials_required");
  // backend_score 是数字，0 也是有效值，只检查是否为 NaN
  if (typeof card.backend_score !== "number" || Number.isNaN(card.backend_score)) {
    optionalMissing.push("backend_score");
  }

  // 检查 link_valid
  const linkValid = !isStringMissing(card.official_source_url);

  // 检查 score_warning（backend_score 与 visible_level 一致性）
  const expectedLevel = scoreToLevel(card.backend_score);
  let scoreWarning: boolean;
  if (expectedLevel === "hidden") {
    // scoreToLevel 返回 hidden 表示分数 < 50，但 CardVisibleLevel 不含 hidden
    // 任何 CardVisibleLevel 都与 hidden 不匹配
    scoreWarning = true;
  } else {
    scoreWarning = expectedLevel !== (card.visible_level as VisibleLevel);
  }

  return {
    valid: criticalMissing.length === 0,
    critical_missing: criticalMissing,
    optional_missing: optionalMissing,
    link_valid: linkValid,
    score_warning: scoreWarning,
  };
}
