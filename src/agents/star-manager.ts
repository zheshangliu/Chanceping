/**
 * Star 收藏管理（star_manager）
 *
 * 来源：Task 015 第 4.2 节。
 *
 * Star 收藏不新增字段，完全复用 Task 014 的卡片状态机：
 *   - star：new/viewed → saved（收藏）
 *   - star（已收藏）：saved → saved（幂等，不报错）
 *   - unstar：saved → archived（取消收藏，归档保留，默认动作）
 *   - unstar：saved → dismissed（取消收藏，彻底忽略）
 *   - star（终态/已报名）：archived/dismissed/applied → saved（非法，报错）
 *
 * 纯函数 + 依赖 OpportunityStore 接口，不接 LLM，不编造信息。
 */

import type { OpportunityCardStatus } from "../schema/opportunity-card";
import { CARD_STATUS_LABELS } from "../schema/opportunity-card";
import { updateCardStatus } from "./card-factory";
import type {
  OpportunityStore,
  StoreEntry,
  RadarType,
} from "./opportunity-store";

// ============================================================
// 类型定义
// ============================================================

/** Star/Unstar 操作结果 */
export interface StarResult {
  /** 是否成功 */
  success: boolean;
  /** 更新后的条目（success=true 时有值） */
  entry: StoreEntry | null;
  /** 失败原因（success=false 时有值） */
  error: string | null;
}

/** Star 收藏统计 */
export interface StarStats {
  /** 已收藏总数 */
  total: number;
  /** 按雷达类型分组 */
  by_radar_type: Record<RadarType, number>;
}

// ============================================================
// 常量
// ============================================================

/** 雷达类型列表（用于 starStats 初始化） */
const RADAR_TYPES: RadarType[] = ["ai_competition", "opc_policy", "cultural_heritage"];

/** 可收藏的源状态（new/viewed 可转 saved） */
const STARABLE_STATUSES: OpportunityCardStatus[] = ["new", "viewed", "saved"];

// ============================================================
// StarManager 类
// ============================================================

/**
 * Star 收藏管理器（基于卡片状态机）。
 *
 * 通过 store 接口操作卡片，不直接持有卡片副本。
 * V0.8 替换存储后端时，StarManager 业务代码不用改。
 */
export class StarManager {
  constructor(private readonly store: OpportunityStore) {}

  /**
   * 收藏机会（new/viewed → saved）。
   *
   * 规则：
   *   - new/viewed → updateCardStatus(card, "saved") → store.update()
   *   - saved → 已收藏，返回 success=true（幂等）
   *   - applied/archived/dismissed → error（终态或不可直接转 saved）
   *   - 不存在 → error
   *
   * @param dedup_key 卡片去重 key
   * @returns 操作结果
   */
  star(dedup_key: string): StarResult {
    const entry = this.store.get(dedup_key);
    if (!entry) {
      return {
        success: false,
        entry: null,
        error: `未找到 dedup_key=${dedup_key} 对应的机会条目`,
      };
    }

    const currentStatus = entry.card.status;

    // 幂等：已收藏直接返回成功
    if (currentStatus === "saved") {
      return { success: true, entry, error: null };
    }

    // 校验当前状态可否转 saved
    if (!STARABLE_STATUSES.includes(currentStatus)) {
      const fromLabel = CARD_STATUS_LABELS[currentStatus];
      return {
        success: false,
        entry: null,
        error: `当前状态为 ${fromLabel}（${currentStatus}），不可转为 已保存（saved）。仅 新发现/已查看 可收藏。`,
      };
    }

    // 调用 updateCardStatus 校验状态机合法性（防御性，理论上一定通过）
    const statusResult = updateCardStatus(entry.card, "saved");
    if (!statusResult.success || !statusResult.card) {
      return {
        success: false,
        entry: null,
        error: statusResult.error ?? "状态转换失败",
      };
    }

    // 持久化到 store
    const updated = this.store.update(dedup_key, { status: "saved" });
    if (!updated) {
      return {
        success: false,
        entry: null,
        error: "持久化失败：store.update 返回 null",
      };
    }

    return { success: true, entry: updated, error: null };
  }

  /**
   * 取消收藏（saved → archived 或 dismissed）。
   *
   * 规则：
   *   - saved → archived（默认）：归档保留
   *   - saved → dismissed：彻底忽略
   *   - 非.saved 状态 → error（未收藏无法取消）
   *   - 不存在 → error
   *
   * @param dedup_key 卡片去重 key
   * @param action 目标状态，默认 "archived"
   * @returns 操作结果
   */
  unstar(
    dedup_key: string,
    action: "archived" | "dismissed" = "archived",
  ): StarResult {
    const entry = this.store.get(dedup_key);
    if (!entry) {
      return {
        success: false,
        entry: null,
        error: `未找到 dedup_key=${dedup_key} 对应的机会条目`,
      };
    }

    const currentStatus = entry.card.status;

    // 非已收藏状态不可取消
    if (currentStatus !== "saved") {
      const fromLabel = CARD_STATUS_LABELS[currentStatus];
      return {
        success: false,
        entry: null,
        error: `当前状态为 ${fromLabel}（${currentStatus}），未收藏，无法取消收藏。仅 已保存 可取消。`,
      };
    }

    // 调用 updateCardStatus 校验状态机合法性
    const statusResult = updateCardStatus(entry.card, action);
    if (!statusResult.success || !statusResult.card) {
      return {
        success: false,
        entry: null,
        error: statusResult.error ?? "状态转换失败",
      };
    }

    // 持久化到 store
    const updated = this.store.update(dedup_key, { status: action });
    if (!updated) {
      return {
        success: false,
        entry: null,
        error: "持久化失败：store.update 返回 null",
      };
    }

    return { success: true, entry: updated, error: null };
  }

  /**
   * 获取所有已收藏机会（status=saved）。
   *
   * @returns 已收藏条目数组
   */
  getStarred(): StoreEntry[] {
    return this.store.list({ starred_only: true, page_size: 10000 }).entries;
  }

  /**
   * 判断是否已收藏。
   *
   * @param dedup_key 卡片去重 key
   * @returns true 表示 status=saved
   */
  isStarred(dedup_key: string): boolean {
    const entry = this.store.get(dedup_key);
    return entry?.card.status === "saved";
  }

  /**
   * 收藏统计。
   *
   * @returns 统计结果（total + 按雷达类型分组）
   */
  starStats(): StarStats {
    const starred = this.getStarred();
    const byRadarType = {} as Record<RadarType, number>;
    for (const rt of RADAR_TYPES) byRadarType[rt] = 0;
    for (const e of starred) {
      byRadarType[e.radar_type]++;
    }
    return {
      total: starred.length,
      by_radar_type: byRadarType,
    };
  }
}
