/**
 * 机会状态机引擎（T17）
 *
 * 来源：Task 030 第 5.2 节。
 *
 * 设计要点：
 *   - transition(card, targetStatus)：执行状态转换，返回新卡片
 *   - autoExpire(card, now)：自动过期检查（截止日期已过 + 未报名 → expired）
 *   - autoMiss(card, now)：自动错过检查（截止日期 7 天以上 + 未报名 → missed）
 *   - getValidTransitions(status)：获取可转换的状态列表
 *   - batchAutoTransition(entries, now)：批量自动过期/错过检查
 *
 * 纯函数，不依赖存储。
 */

import type { OpportunityCard, OpportunityCardStatus } from "../schema/opportunity-card";
import { isStatusTransitionValid, CARD_STATUS_TRANSITIONS } from "../schema/opportunity-card";

/** 状态转换结果 */
export interface TransitionResult {
  /** 是否成功 */
  success: boolean;
  /** 转换后的卡片（失败时为原卡片） */
  card: OpportunityCard;
  /** 错误信息（失败时） */
  error?: string;
}

/** 批量自动转换结果项 */
export interface AutoTransitionResult {
  dedup_key: string;
  from: OpportunityCardStatus;
  to: OpportunityCardStatus;
  card: OpportunityCard;
}

/** 未报名状态列表（可自动过期/错过） */
const NON_APPLIED_STATUSES: OpportunityCardStatus[] = ["new", "viewed", "tracking", "saved"];

/**
 * 执行状态转换。
 *
 * @param card 当前卡片
 * @param targetStatus 目标状态
 * @returns 转换结果
 */
export function transition(
  card: OpportunityCard,
  targetStatus: OpportunityCardStatus,
): TransitionResult {
  if (!isStatusTransitionValid(card.status, targetStatus)) {
    return {
      success: false,
      card,
      error: `非法状态转换: ${card.status} → ${targetStatus}`,
    };
  }

  return {
    success: true,
    card: { ...card, status: targetStatus },
  };
}

/**
 * 自动过期检查。
 *
 * 规则：
 *   - 截止日期已过
 *   - 状态为 new/viewed/tracking/saved（未报名）
 *   - 自动转为 expired
 *
 * @param card 卡片
 * @param now 当前时间
 * @returns 转换结果（无需转换时 success=true, card 不变）
 */
export function autoExpire(card: OpportunityCard, now: Date = new Date()): TransitionResult {
  if (!card.deadline) return { success: true, card };

  const deadline = new Date(card.deadline);
  if (deadline > now) return { success: true, card };

  if (!NON_APPLIED_STATUSES.includes(card.status)) return { success: true, card };

  return transition(card, "expired");
}

/**
 * 自动错过检查。
 *
 * 规则：
 *   - 截止日期已过 7 天以上
 *   - 状态为 new/viewed/tracking/saved（未报名）
 *   - 自动转为 missed
 *
 * @param card 卡片
 * @param now 当前时间
 * @returns 转换结果
 */
export function autoMiss(card: OpportunityCard, now: Date = new Date()): TransitionResult {
  if (!card.deadline) return { success: true, card };

  const deadline = new Date(card.deadline);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (deadline.getTime() + sevenDaysMs > now.getTime()) return { success: true, card };

  if (!NON_APPLIED_STATUSES.includes(card.status)) return { success: true, card };

  return transition(card, "missed");
}

/**
 * 获取可转换的状态列表。
 *
 * @param status 当前状态
 * @returns 可转换的状态数组
 */
export function getValidTransitions(status: OpportunityCardStatus): OpportunityCardStatus[] {
  return CARD_STATUS_TRANSITIONS[status] ?? [];
}

/**
 * 批量自动过期/错过检查。
 *
 * 优先级：先检查 missed（截止 7 天以上），再检查 expired（截止已过）。
 *
 * @param entries 卡片条目列表（含 dedup_key + card）
 * @param now 当前时间
 * @returns 需要更新的卡片列表（含原状态 + 新状态）
 */
export function batchAutoTransition(
  entries: Array<{ dedup_key: string; card: OpportunityCard }>,
  now: Date = new Date(),
): AutoTransitionResult[] {
  const results: AutoTransitionResult[] = [];

  for (const entry of entries) {
    // 先检查 missed（截止 7 天以上）
    const missResult = autoMiss(entry.card, now);
    if (missResult.success && missResult.card.status !== entry.card.status) {
      results.push({
        dedup_key: entry.dedup_key,
        from: entry.card.status,
        to: "missed",
        card: missResult.card,
      });
      continue;
    }

    // 再检查 expired（截止已过）
    const expireResult = autoExpire(entry.card, now);
    if (expireResult.success && expireResult.card.status !== entry.card.status) {
      results.push({
        dedup_key: entry.dedup_key,
        from: entry.card.status,
        to: "expired",
        card: expireResult.card,
      });
    }
  }

  return results;
}
