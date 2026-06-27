/**
 * 单轮对话输出类型
 *
 * 来源：Task 007 第 4.3 节。
 *
 * 对应 02 号文档第 2 节"初步理解"格式——每轮对话结束时 AI 输出给用户的内容结构。
 */

import type { RequirementConfidence } from "../schema/requirement-confidence";
import type { ConfirmationStatus, QuestionToConfirm } from "../schema/radar-requirement-spec";

/** 已确认信息项 */
export interface ConfirmedItem {
  /** 字段路径，如 "client_profile.client_type" */
  field: string;
  /** 中文标签，如"客户类型" */
  label: string;
  /** 确认的值 */
  value: string;
}

/** 不确定信息项 */
export interface UncertainItem {
  /** 字段路径 */
  field: string;
  /** 中文标签 */
  label: string;
  /** 为什么不确定 + 需要用户补充什么 */
  hint: string;
}

/** 单轮对话输出（02 号文档第 2 节格式） */
export interface TurnOutput {
  /** 初步理解（1-2 句话概括当前对用户需求的理解） */
  summary: string;
  /** 已确认信息列表 */
  confirmed_items: ConfirmedItem[];
  /** 不确定信息列表 */
  uncertain_items: UncertainItem[];
  /** 本轮追问问题（≤5 个） */
  questions: QuestionToConfirm[];
  /** 当前确认度 */
  confidence: RequirementConfidence;
  /** 确认度与上轮的变化（首轮为 null） */
  confidence_delta: {
    total_delta: number;
    improved_dimensions: string[];
  } | null;
  /** 当前状态输出（02 号文档第 7 节） */
  current_status_text: string;
  /** 当前确认状态 */
  status: ConfirmationStatus;
}
