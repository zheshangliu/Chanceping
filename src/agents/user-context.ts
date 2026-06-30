/**
 * 用户上下文（V1.5b 假用户，不引入真实登录）
 *
 * 来源：Task V1.5-07 第 3.1 节。
 *
 * V1.5b 阶段用固定 demo_user + free 计划，不引入登录系统。
 * 预留 4 个付费等级常量，V1.5b 只用 free。
 */

/** 付费等级 */
export type UserPlan = "free" | "basic" | "pro" | "enterprise";

/** 用户上下文 */
export interface UserContext {
  /** 用户 ID（固定 demo_user） */
  userId: string;
  /** 付费等级 */
  plan: UserPlan;
}

/** 各等级的雷达配额（自定义雷达上限，内置雷达不计入） */
export const RADAR_QUOTA: Record<UserPlan, number> = {
  free: 1, // 免费用户 1 个自定义雷达
  basic: 3, // 基础版 3 个
  pro: 10, // 专业版 10 个
  enterprise: 50, // 企业版 50 个
};

/**
 * 获取当前用户上下文（V1.5b 固定返回 demo_user + free）。
 *
 * V1.5b 不引入真实登录，永远返回 { userId: "demo_user", plan: "free" }。
 * 未来接入登录系统后，此处改为从请求上下文/token 解析。
 *
 * @returns 用户上下文
 */
export function getCurrentUser(): UserContext {
  return {
    userId: "demo_user",
    plan: "free",
  };
}
