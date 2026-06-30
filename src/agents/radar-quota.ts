/**
 * RadarQuotaChecker —— 雷达配额检查器
 *
 * 来源：Task V1.5-07 第 3.2 节。
 *
 * 计算规则：
 *   - 统计 isBuiltin=false + status≠archived 的自定义雷达数
 *   - 内置雷达不计入配额
 *   - 已归档雷达不计入配额（归档释放配额）
 *   - 当前数量 < 配额 → 允许创建
 *   - 当前数量 >= 配额 → 拒绝
 */

import type { RadarStore } from "./radar-store";
import { RADAR_QUOTA, type UserContext } from "./user-context";

/** 配额检查结果 */
export interface QuotaCheckResult {
  /** 是否允许创建 */
  allowed: boolean;
  /** 当前已用配额 */
  current: number;
  /** 总配额 */
  quota: number;
}

/**
 * 雷达配额检查器。
 *
 * 封装 RadarStore.list 的过滤能力（isBuiltin + ownerId + includeArchived），
 * 统计当前用户的自定义雷达数并比对 RADAR_QUOTA。
 */
export class RadarQuotaChecker {
  private readonly store: RadarStore;

  constructor(store: RadarStore) {
    this.store = store;
  }

  /**
   * 检查用户是否可以创建新雷达。
   *
   * @param user 用户上下文
   * @returns { allowed, current, quota }
   */
  check(user: UserContext): QuotaCheckResult {
    // list 默认 includeArchived=false（已排除归档），叠加 isBuiltin=false + ownerId 过滤
    const customRadars = this.store.list({
      isBuiltin: false,
      ownerId: user.userId,
    });
    const current = customRadars.length;
    const quota = RADAR_QUOTA[user.plan];
    return {
      allowed: current < quota,
      current,
      quota,
    };
  }
}
