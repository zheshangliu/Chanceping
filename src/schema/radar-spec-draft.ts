/**
 * RadarSpecDraft —— 雷达需求规格草案
 *
 * V1.3 新增。从需求确认卡生成，是"确认→草案→预览"子闭环的核心中间态。
 *
 * 设计依据：GPT 调研的关键优势——草案中间态让 V1.3 能独立跑通子闭环，
 * 不需要等到 V1.5 雷达持久化才能演示。
 */

import type { RadarRequirementSpec } from "./radar-requirement-spec";

// ============================================================
// 草案状态
// ============================================================

/**
 * 草案状态（5 态）。
 *
 * 状态转换：
 *   generating → ready（LLM 生成完成）
 *   generating → low_confidence（6 轮未达 90% 但 ≥70%，低置信度逃逸）
 *   ready → confirmed（用户确认草案）
 *   ready → rejected（用户拒绝草案，重新追问）
 *   low_confidence → confirmed（用户确认低置信度草案）
 *   low_confidence → rejected（用户拒绝，继续追问）
 *   confirmed → （终态，进入 Radar 创建）
 *   rejected → （终态，回到需求确认流程）
 */
export type DraftStatus = "generating" | "ready" | "confirmed" | "rejected" | "low_confidence";

// ============================================================
// 草案主体
// ============================================================

/**
 * RadarSpecDraft 雷达需求规格草案。
 *
 * 由需求确认卡生成，包含 LLM 生成的 RadarRequirementSpec 和建议名称。
 * 用户确认后可创建正式 Radar（V1.5）。
 */
export interface RadarSpecDraft {
  /** 草案唯一 ID（draft_ 前缀） */
  draftId: string;
  /** 草案状态 */
  status: DraftStatus;
  /** 关联的需求确认卡 ID */
  confirmationCardId: string;
  /** LLM 生成的需求规格 */
  generatedSpec: RadarRequirementSpec;
  /** LLM 建议的雷达名称（≤20 字，用户可修改） */
  suggestedName: string;
  /** 生成草案时的确认度总分（0-100） */
  confidenceAtGeneration: number;
  /** 是否为低置信度草案（6 轮未达 90% 但 ≥70%） */
  isLowConfidence: boolean;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 低置信度警告文案（仅 isLowConfidence=true 时存在） */
  warning?: string;
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 生成草案 ID（draft_ 前缀 + 时间戳 + 随机串）
 */
export function generateDraftId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `draft_${ts}${rand}`;
}
