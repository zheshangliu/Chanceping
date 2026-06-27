/**
 * 对话状态机定义（confirmation_status 状态转换规则）
 *
 * 来源：Task 002 第 4.2 节 + 03 号文档第 14 节。
 *
 * 本文件不重新定义 ConfirmationStatus 枚举（已在 Task 001 的
 * radar-requirement-spec.ts 中定义），只定义转换规则与 getNextStatus 函数。
 *
 * 状态机是对话管理的骨架，实际对话运行时由 Task 007 实现。
 */

import type { ConfirmationStatus } from "./radar-requirement-spec";

/** 状态转换条件描述 */
export interface StateTransition {
  /** 起始状态 */
  from: ConfirmationStatus;
  /** 目标状态 */
  to: ConfirmationStatus;
  /** 人类可读的转换条件描述 */
  condition: string;
  /** 触发动作描述（如"确认度计算后 <70"） */
  trigger: string;
}

/**
 * 完整状态转换表（严格按 Task 002 第 4.2 节实现，共 15 条）。
 * ready_for_radar_plan 是终态（本任务范围内）。
 */
export const STATE_TRANSITIONS: StateTransition[] = [
  {
    from: "draft",
    to: "needs_more_info",
    condition: "确认度 <70%",
    trigger: "首次读取用户输入并计算确认度后",
  },
  {
    from: "draft",
    to: "ready_for_confirmation_card",
    condition: "确认度 70–89%",
    trigger: "首次读取用户输入并计算确认度后",
  },
  {
    from: "draft",
    to: "confirmation_card_generated",
    condition: "确认度 ≥90%",
    trigger: "首次读取用户输入并计算确认度后",
  },
  {
    from: "needs_more_info",
    to: "needs_more_info",
    condition: "确认度仍 <70%",
    trigger: "用户补充信息后重新计算",
  },
  {
    from: "needs_more_info",
    to: "ready_for_confirmation_card",
    condition: "确认度升至 70–89%",
    trigger: "用户补充信息后重新计算",
  },
  {
    from: "needs_more_info",
    to: "confirmation_card_generated",
    condition: "确认度升至 ≥90%",
    trigger: "用户补充信息后重新计算",
  },
  {
    from: "ready_for_confirmation_card",
    to: "ready_for_confirmation_card",
    condition: "确认度仍 70–89%",
    trigger: "用户补充信息后重新计算",
  },
  {
    from: "ready_for_confirmation_card",
    to: "confirmation_card_generated",
    condition: "确认度升至 ≥90%",
    trigger: "用户补充信息后重新计算",
  },
  {
    from: "confirmation_card_generated",
    to: "user_revision_requested",
    condition: "用户要求修改",
    trigger: "userAction = requested_revision",
  },
  {
    from: "confirmation_card_generated",
    to: "confirmed",
    condition: "用户确认无误",
    trigger: "userAction = confirmed",
  },
  {
    from: "user_revision_requested",
    to: "needs_more_info",
    condition: "修改后确认度 <70%",
    trigger: "重新计算确认度",
  },
  {
    from: "user_revision_requested",
    to: "ready_for_confirmation_card",
    condition: "修改后确认度 70–89%",
    trigger: "重新计算确认度",
  },
  {
    from: "user_revision_requested",
    to: "confirmation_card_generated",
    condition: "修改后确认度 ≥90%",
    trigger: "重新计算确认度，重新生成确认卡",
  },
  {
    from: "confirmed",
    to: "ready_for_radar_plan",
    condition: "确认度 ≥95%",
    trigger: "确认后检查确认度是否足够进入方案",
  },
  {
    from: "confirmed",
    to: "confirmed",
    condition: "确认度 90–94%",
    trigger: "确认度不足以进入方案，保持已确认状态",
  },
];

/**
 * 根据确认度总分和当前状态，返回下一个状态。
 *
 * 转换规则严格按 STATE_TRANSITIONS 表：
 *   - 确认度区间：<70 / 70–89 / 90–94 / ≥95
 *   - confirmation_card_generated 仅由 userAction 驱动（requested_revision / confirmed）
 *   - confirmed 状态：≥95 → ready_for_radar_plan；90–94 → 保持 confirmed
 *   - ready_for_radar_plan 为终态，保持不变
 *   - 未在表中列出的转换（如 ready_for_confirmation_card 确认度回落到 <70）保持当前状态
 *
 * @param currentStatus 当前确认状态
 * @param confidenceTotal 需求确认度总分（0–100）
 * @param userAction 用户动作（仅在 confirmation_card_generated 状态下生效）
 */
export function getNextStatus(
  currentStatus: ConfirmationStatus,
  confidenceTotal: number,
  userAction?: "confirmed" | "requested_revision",
): ConfirmationStatus {
  switch (currentStatus) {
    case "draft":
    case "needs_more_info":
      // <70 → needs_more_info；70–89 → ready_for_confirmation_card；≥90 → confirmation_card_generated
      if (confidenceTotal < 70) return "needs_more_info";
      if (confidenceTotal < 90) return "ready_for_confirmation_card";
      return "confirmation_card_generated";

    case "ready_for_confirmation_card":
      // ≥90 → confirmation_card_generated；其余（含 70–89 与回落 <70）保持当前状态
      if (confidenceTotal >= 90) return "confirmation_card_generated";
      return "ready_for_confirmation_card";

    case "confirmation_card_generated":
      // 仅由用户动作驱动
      if (userAction === "requested_revision") return "user_revision_requested";
      if (userAction === "confirmed") return "confirmed";
      return "confirmation_card_generated";

    case "user_revision_requested":
      // 修改后重新计算：与 draft/needs_more_info 同样的区间划分
      if (confidenceTotal < 70) return "needs_more_info";
      if (confidenceTotal < 90) return "ready_for_confirmation_card";
      return "confirmation_card_generated";

    case "confirmed":
      // ≥95 → ready_for_radar_plan；90–94 → 保持 confirmed
      if (confidenceTotal >= 95) return "ready_for_radar_plan";
      return "confirmed";

    case "ready_for_radar_plan":
      // 终态
      return "ready_for_radar_plan";

    default:
      return currentStatus;
  }
}
