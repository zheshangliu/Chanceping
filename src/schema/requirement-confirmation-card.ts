/**
 * RequirementConfirmationCard —— 需求确认卡
 *
 * V1.3 新增。当需求确认度达到 90%+ 时生成，是"确认→草案→预览"子闭环的起点。
 *
 * 设计依据：现有 requirement-confirmation-system-prompt.ts 第 5 节的确认卡格式，
 * 将其结构化为独立类型，便于 API 传递和前端渲染。
 */

import type { RequirementConfidence } from "./requirement-confidence";
import type { ExtractedRequirementInfo } from "./extracted-requirement-info";

// ============================================================
// 确认卡主体
// ============================================================

/**
 * 需求确认卡。
 *
 * 当需求确认度 ≥90% 时生成，包含确认度快照和已提取的结构化需求信息。
 * 用户确认后，系统基于此生成 RadarSpecDraft。
 */
export interface RequirementConfirmationCard {
  /** 确认卡唯一 ID（card_ 前缀） */
  cardId: string;
  /** 关联的对话 ID */
  conversationId: string;
  /** 确认度快照（7 维度 + 总分） */
  confidence: RequirementConfidence;
  /** 已提取的结构化需求信息 */
  extractedInfo: ExtractedRequirementInfo;
  /** 自然语言摘要（面向用户，≤200 字） */
  summary: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 是否为低置信度确认卡（6 轮未达 90% 但 ≥70% 时生成） */
  isLowConfidence: boolean;
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 生成确认卡 ID（card_ 前缀 + 时间戳 + 随机串）
 */
export function generateCardId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `card_${ts}${rand}`;
}
