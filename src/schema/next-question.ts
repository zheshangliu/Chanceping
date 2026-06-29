/**
 * NextQuestion —— 下一问类型
 *
 * V1.3 新增。支持"一次一问"需求确认模式，每轮只问 1 个问题。
 * 替代旧模式中 questions 数组（≤5 个问题）。
 *
 * 设计依据：NN/g Staged Disclosure 原则 + GPT 调研的 QuestionPlanner 模块化设计。
 */

import type { ConfidenceDimensionKey } from "./requirement-confidence";

// ============================================================
// 问题类型
// ============================================================

/**
 * 问题呈现类型。
 *
 * - open_text：解答题（用户自由输入）
 * - single_choice：单选题（按钮组）
 * - multi_choice：多选题（多选按钮组）
 * - yes_no：是非题（是/否按钮）
 *
 * 题型由 QuestionPlanner 根据维度和已有信息动态选择。
 */
export type QuestionType = "open_text" | "single_choice" | "multi_choice" | "yes_no";

// ============================================================
// NextQuestion 主体
// ============================================================

/**
 * 下一问。一次一问模式下，每轮返回 ≤1 个 NextQuestion。
 *
 * 如果返回 null，表示无需继续追问（确认度已达阈值或所有维度已覆盖）。
 */
export interface NextQuestion {
  /** 问题文本（自然语言，面向用户） */
  question: string;
  /** 问题类型 */
  questionType: QuestionType;
  /** 选项列表（仅 single_choice / multi_choice 时存在） */
  options?: string[];
  /** 为什么问这个问题（面向用户解释，提升配合度） */
  whyItMatters: string;
  /** 关联的 Spec 字段路径（如 "client_profile.client_type"） */
  relatedField: string;
  /** 目标确认度维度（7 维度之一） */
  targetDimension: ConfidenceDimensionKey;
  /** 预估确认度提升（0-100，用于排序） */
  estimatedConfidenceGain: number;
}

// ============================================================
// 辅助类型
// ============================================================

/**
 * 问题模式标识。
 *
 * - single：一次一问（V1.3 新模式，每轮 ≤1 个问题）
 * - multi：一次多问（旧模式，每轮 ≤5 个问题，保留为 fallback）
 */
export type QuestionMode = "single" | "multi";

/**
 * 草案生成决策。
 *
 * QuestionPlanner.shouldGenerateDraft() 的返回类型。
 */
export interface DraftGenerationDecision {
  /** 是否应该生成草案 */
  should: boolean;
  /** 是否为低置信度草案 */
  isLowConfidence: boolean;
}
