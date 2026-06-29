/**
 * RequirementCardGenerator —— 需求确认卡生成器
 *
 * V1.3 新增。当确认度 ≥90%（或 6 轮后 ≥70%）时，生成需求确认卡。
 *
 * 设计依据：V1.3 总任务书——确认卡是"确认→草案→预览"子闭环的起点。
 */

import type { RequirementConfidence } from "../schema/requirement-confidence";
import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { RequirementConfirmationCard } from "../schema/requirement-confirmation-card";
import { generateCardId } from "../schema/requirement-confirmation-card";

// ============================================================
// 常量
// ============================================================

/** 正常确认度阈值 */
const CONFIRM_THRESHOLD = 90;

/** 低置信度逃逸阈值 */
const LOW_CONFIDENCE_THRESHOLD = 70;

/** 最大轮次 */
const MAX_TURNS = 6;

// ============================================================
// 核心函数
// ============================================================

/**
 * 生成需求确认卡。
 *
 * @param conversationId 对话 ID
 * @param confidence 当前确认度
 * @param extractedInfo 已提取的结构化需求信息
 * @param turnCount 当前轮次
 * @returns 确认卡（正式或低置信度）
 */
export function generateConfirmationCard(
  conversationId: string,
  confidence: RequirementConfidence,
  extractedInfo: ExtractedRequirementInfo,
  turnCount: number,
): RequirementConfirmationCard {
  const total = confidence.total;
  const isLowConfidence =
    total < CONFIRM_THRESHOLD &&
    turnCount >= MAX_TURNS &&
    total >= LOW_CONFIDENCE_THRESHOLD;

  const summary = buildSummary(extractedInfo, confidence);

  return {
    cardId: generateCardId(),
    conversationId,
    confidence,
    extractedInfo,
    summary,
    createdAt: new Date().toISOString(),
    isLowConfidence,
  };
}

/**
 * 构建确认卡的自然语言摘要。
 *
 * 格式：≤200 字，包含用户身份、核心目标、机会类型、地域范围。
 */
function buildSummary(
  info: ExtractedRequirementInfo,
  confidence: RequirementConfidence,
): string {
  const parts: string[] = [];

  // 身份
  const ci = info.client_identity;
  if (ci.client_type || ci.industry) {
    parts.push(`你是一位${ci.client_type ?? "用户"}${ci.industry ? `，从事${ci.industry}行业` : ""}`);
  }

  // 目标
  const bg = info.business_goal;
  if (bg.primary_goal) {
    parts.push(`核心目标是${bg.primary_goal}`);
  }

  // 机会类型
  const ot = info.opportunity_type;
  if (ot.primary_types && ot.primary_types.length > 0) {
    parts.push(`主要关注${ot.primary_types.join("、")}`);
  }

  // 地域
  const rs = info.region_scope;
  if (rs.primary_regions && rs.primary_regions.length > 0) {
    parts.push(`地域范围：${rs.primary_regions.join("、")}`);
  }

  // 确认度
  parts.push(`当前需求确认度 ${confidence.total}%`);

  let summary = parts.join("。");
  if (summary.length > 200) {
    summary = summary.substring(0, 197) + "...";
  }

  return summary;
}

// ============================================================
// 调试辅助：导出常量（供 verify 脚本和单元测试使用）
// ============================================================

export { CONFIRM_THRESHOLD, LOW_CONFIDENCE_THRESHOLD, MAX_TURNS };
