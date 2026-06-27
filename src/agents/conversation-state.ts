/**
 * 对话状态
 *
 * 来源：Task 007 第 4.2 节。
 *
 * 定义对话过程中需要维护的完整状态，包括已提取信息、确认度、消息历史、轮次记录等。
 */

import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { RequirementConfidence } from "../schema/requirement-confidence";
import type { ConfirmationStatus } from "../schema/radar-requirement-spec";
import type { RadarType } from "../prompts/question-bank";
import type { LLMMessage } from "./llm-adapter";
import type { ConfidenceBranch } from "./confidence-engine";
import { createEmptyExtractedInfo } from "../schema/extracted-requirement-info";
import { createDefaultConfidence } from "../schema/requirement-confidence";
import { getConfidenceBranch } from "./confidence-engine";
import { REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT } from "../prompts/requirement-confirmation-system-prompt";

/** 对话轮次记录 */
export interface ConversationTurn {
  /** 轮次序号，从 1 开始 */
  turn_number: number;
  /** 用户输入 */
  user_input: string;
  /** AI 回复 */
  ai_response: string;
  /** 本轮提取的信息 */
  extracted_info_snapshot: ExtractedRequirementInfo;
  /** 本轮确认度 */
  confidence_snapshot: RequirementConfidence;
  /** 本轮确认度分支 */
  branch: ConfidenceBranch;
  /** 本轮结束时的状态 */
  status: ConfirmationStatus;
  /** 本轮追问的问题 */
  questions_asked: string[];
}

/** 完整对话状态 */
export interface ConversationState {
  /** 对话 ID */
  conversation_id: string;
  /** 雷达类型 */
  radar_type: RadarType;
  /** 当前确认状态 */
  current_status: ConfirmationStatus;
  /** 当前已提取的信息（累积） */
  extracted_info: ExtractedRequirementInfo;
  /** 当前确认度 */
  confidence: RequirementConfidence;
  /** 当前分支 */
  branch: ConfidenceBranch;
  /** 消息历史（发给 LLM 的完整消息列表） */
  message_history: LLMMessage[];
  /** 对话轮次记录 */
  turns: ConversationTurn[];
  /** 已问过的问题（避免重复追问） */
  asked_questions: string[];
  /** 对话轮数计数 */
  turn_count: number;
}

/**
 * 创建初始对话状态。
 * 包含 system prompt（作为 message_history 的第一条消息）。
 */
export function createInitialConversationState(
  conversationId: string,
  radarType: RadarType,
): ConversationState {
  return {
    conversation_id: conversationId,
    radar_type: radarType,
    current_status: "draft",
    extracted_info: createEmptyExtractedInfo(),
    confidence: createDefaultConfidence(),
    branch: getConfidenceBranch(0),
    message_history: [
      {
        role: "system",
        content: REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT,
      },
    ],
    turns: [],
    asked_questions: [],
    turn_count: 0,
  };
}
