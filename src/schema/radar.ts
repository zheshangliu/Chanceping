/**
 * Radar wrapper —— 雷达实体外壳
 *
 * V1.3 新增。包裹现有 RadarRequirementSpec，增加身份、状态、隐私等元数据。
 * V1.3 只做类型定义，不做持久化（V1.5 RadarStore）。
 *
 * 设计依据：V1.3 总任务书 + 联合深度调研第 1 批确认结论。
 */

import type { RadarRequirementSpec } from "./radar-requirement-spec";
import { createDefaultSpec } from "./radar-requirement-spec";

// ============================================================
// 枚举类型
// ============================================================

/** 雷达类型（3 固定 + 1 自定义） */
export type RadarKind = "ai_competition" | "opc_policy" | "cultural_heritage" | "custom";

/**
 * 雷达生命周期状态（6 态状态机）。
 *
 * 状态转换规则：
 *   draft → active（用户确认草案后激活）
 *   active → running（手动或定时触发运行）
 *   active → paused（用户暂停）
 *   active → archived（用户归档，软删除）
 *   running → active（运行完成）
 *   running → failed（运行失败，V1.5 扩展）
 *   paused → active（用户恢复）
 *   paused → archived（用户归档）
 *   queued → active（排队等待结束后激活，V2.0 多雷达并行时启用）
 *   archived → （终态，不可转出，3 天后物理删除）
 */
export type RadarStatus = "draft" | "active" | "running" | "paused" | "queued" | "archived";

/** 雷达运行状态（独立于生命周期状态） */
export type RunStatus = "idle" | "running" | "succeeded" | "failed";

// ============================================================
// 隐私配置
// ============================================================

/**
 * 雷达隐私配置。
 *
 * - private：仅创建者可见（默认）
 * - unlisted：有链接的人可看
 * - public：公开，自动脱敏（隐藏个人身份/商业机密，保留关键词/地域/排除规则）
 */
export interface RadarPrivacy {
  /** 可见性 */
  visibility: "private" | "unlisted" | "public";
  /** 是否允许克隆（public 时生效） */
  allowClone: boolean;
  /** 是否允许分享 */
  allowShare: boolean;
  /** 是否自动脱敏（public 时强制 true） */
  redactSensitiveInfo: boolean;
}

// ============================================================
// Radar 主体
// ============================================================

/**
 * Radar 实体。
 *
 * 包装 RadarRequirementSpec，增加身份、状态、隐私等元数据。
 * V1.3 只做类型定义和工厂函数，不做持久化存储。
 */
export interface Radar {
  /** 雷达唯一 ID（UUID v4） */
  id: string;
  /** 雷达名称（用户命名或 LLM 自动命名，≤20 字） */
  name: string;
  /** 雷达类型 */
  kind: RadarKind;
  /** 生命周期状态 */
  status: RadarStatus;
  /** 运行状态 */
  runStatus: RunStatus;
  /** 隐私配置 */
  privacy: RadarPrivacy;
  /** 雷达需求规格（复用现有 RadarRequirementSpec） */
  spec: RadarRequirementSpec;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 更新时间（ISO 8601） */
  updatedAt: string;
  /** 最后运行时间（ISO 8601，可选） */
  lastRunAt?: string;
  /** 软删除时间（ISO 8601，归档后 3 天物理删除） */
  deletedAt?: string;
}

// ============================================================
// 工厂函数
// ============================================================

/** 生成默认隐私配置（private） */
export function createDefaultPrivacy(): RadarPrivacy {
  return {
    visibility: "private",
    allowClone: false,
    allowShare: false,
    redactSensitiveInfo: false,
  };
}

/**
 * 生成默认 Radar 实体。
 *
 * @param name 雷达名称
 * @param kind 雷达类型
 * @param spec 需求规格（可选，不传则用 createDefaultSpec）
 */
export function createDefaultRadar(
  name: string,
  kind: RadarKind,
  spec?: RadarRequirementSpec,
): Radar {
  const now = new Date().toISOString();
  return {
    id: generateRadarId(),
    name,
    kind,
    status: "draft",
    runStatus: "idle",
    privacy: createDefaultPrivacy(),
    spec: spec ?? createDefaultSpec(),
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================
// 辅助函数
// ============================================================

/** 生成雷达 ID（radar_ 前缀 + 时间戳 + 随机串） */
export function generateRadarId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `radar_${ts}${rand}`;
}
