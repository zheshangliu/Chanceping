/**
 * 反馈评价 + 行动意图类型定义
 * 来源：Task 039，V3.1 规划第十九章
 *
 * 三类字段拆分：
 *   - status（行为状态）：原有 9 状态状态机，不修改
 *   - feedback（反馈评价）：V3 新增，用户对机会质量的评价
 *   - action_intent（行动意图）：V3 新增，用户对这个机会的行动计划
 */

// ============================================================
// 反馈评价（feedback）
// ============================================================

/** 反馈评价枚举（9 值） */
export type FeedbackEvaluation =
  | "useful"
  | "not_useful"
  | "wrong_match"
  | "already_expired"
  | "low_value"
  | "too_hard"
  | "duplicate"
  | "no_official_link"
  | "bad_deadline";

/** 反馈评价中文标签 */
export const FEEDBACK_LABELS: Record<FeedbackEvaluation, string> = {
  useful: "有用",
  not_useful: "没用",
  wrong_match: "匹配错误",
  already_expired: "已过期",
  low_value: "价值低",
  too_hard: "太难",
  duplicate: "重复",
  no_official_link: "无链接",
  bad_deadline: "截止问题",
};

/** 反馈结构 */
export interface Feedback {
  /** 评价枚举（9 值之一） */
  evaluation: FeedbackEvaluation;
  /** 反馈备注（可选） */
  note?: string;
  /** 更新时间（ISO 时间戳） */
  updated_at: string;
}

// ============================================================
// 行动意图（action_intent）
// ============================================================

/** 行动意图枚举 */
export type ActionIntentType = "intend_to_apply" | "considering" | "not_interested";

/** 行动意图中文标签 */
export const ACTION_INTENT_LABELS: Record<ActionIntentType, string> = {
  intend_to_apply: "打算报名",
  considering: "考虑中",
  not_interested: "不感兴趣",
};

/** 行动进度枚举 */
export type ActionStatusType = "not_started" | "preparing" | "submitted" | "abandoned";

/** 行动进度中文标签 */
export const ACTION_STATUS_LABELS: Record<ActionStatusType, string> = {
  not_started: "未开始",
  preparing: "准备中",
  submitted: "已提交",
  abandoned: "放弃",
};

/** 行动意图结构 */
export interface ActionIntent {
  /** 行动意向 */
  intent: ActionIntentType;
  /** 行动进度 */
  status: ActionStatusType;
  /** 行动备注（可选） */
  note?: string;
  /** 下次行动日期（YYYY-MM-DD，可选） */
  next_action_date?: string;
}
