/**
 * Radar wrapper —— 雷达实体外壳
 *
 * V1.3 新增。包裹现有 RadarRequirementSpec，增加身份、状态、隐私等元数据。
 * V1.5-01 修正：状态职责分离 + RadarRun + builtin 保护字段 + providerRouting。
 *
 * 设计原则（V1.5-01 确立）：
 *   - Radar.status 管雷达生命周期（draft/active/paused/archived）
 *   - Radar.currentRunId 管当前是否有运行（运行中才有值）
 *   - RadarRun.status 管每次运行结果（queued/running/succeeded/failed/cancelled/skipped）
 *   - providerRouting 放在 Radar 外壳，不塞进 RadarRequirementSpec
 */

import type { RadarRequirementSpec } from "./radar-requirement-spec";
import { createDefaultSpec } from "./radar-requirement-spec";

// ============================================================
// 枚举类型
// ============================================================

/** 雷达类型（3 固定 + 1 自定义） */
export type RadarKind = "ai_competition" | "opc_policy" | "cultural_heritage" | "custom";

/**
 * 雷达生命周期状态（4 态，V1.5-01 修正）。
 *
 * V1.3 原设计含 running/queued，与 RunStatus 职责冲突。V1.5-01 分离：
 *   - RadarStatus 只管"这个雷达是否启用"
 *   - RunStatus 只管"这一次运行是否正在跑"
 *
 * 状态转换规则：
 *   draft → active（用户确认草案后激活）
 *   active → paused（用户暂停）
 *   active → archived（用户归档，软删除）
 *   paused → active（用户恢复）
 *   paused → archived（用户归档）
 *   archived → （终态，不可转出，3 天后物理删除）
 */
export type RadarStatus = "draft" | "active" | "paused" | "archived";

/**
 * 雷达运行状态（独立于生命周期状态，V1.5-01 新增 queued）。
 *
 * RunStatus 管"本次运行"的即时状态，不持久化到 Radar.runStatus
 * （Radar 通过 currentRunId 关联当前运行，通过 lastRunStatus 记录上次结果）。
 */
export type RunStatus = "idle" | "queued" | "running" | "succeeded" | "failed";

/**
 * 雷达运行记录状态（V1.5-01 新增）。
 *
 * 比 RunStatus 多 cancelled/skipped，用于 RadarRun 持久化记录。
 */
export type RadarRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";

/** 上次运行结果摘要（V1.5-01 新增） */
export type LastRunStatus = "succeeded" | "failed" | "cancelled";

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
// Provider 路由配置（V1.5-01 新增）
// ============================================================

/** 允许的 Provider 白名单 */
export const ALLOWED_PROVIDERS = ["serper", "bocha", "exa", "google_cse"] as const;

/**
 * Provider 路由配置。
 *
 * 放在 Radar 外壳（不塞进 RadarRequirementSpec）。
 * 只允许从 ALLOWED_PROVIDERS 白名单选择，不允许 LLM 生成任意 provider。
 */
export interface ProviderRouting {
  /** 主力 Provider（按优先级排序） */
  primary: string[];
  /** 备选 Provider（主力失败时 fallback） */
  fallback: string[];
}

// ============================================================
// RadarRun 运行记录（V1.5-01 新增）
// ============================================================

/** 运行触发方式 */
export type RunMode = "manual" | "scheduled";

/** 运行触发者 */
export type RunTriggeredBy = "user" | "scheduler" | "system";

/**
 * 雷达运行记录。
 *
 * 每次雷达运行（手动或定时）生成一条记录。
 * 存储路径：data/radar-runs.json
 * 用于排查问题和展示运行历史。
 */
export interface RadarRun {
  /** 运行唯一 ID（run_ 前缀 + 时间戳 + 随机串） */
  id: string;
  /** 所属雷达 ID */
  radarId: string;
  /** 运行状态 */
  status: RadarRunStatus;
  /** 触发方式（手动/定时） */
  mode: RunMode;
  /** 触发者（用户/调度器/系统） */
  triggeredBy: RunTriggeredBy;
  /** 开始时间（ISO 8601） */
  startedAt: string;
  /** 结束时间（ISO 8601，运行中为 null） */
  finishedAt: string | null;
  /** 原始搜索结果数 */
  totalRaw: number;
  /** 评分后的机会数 */
  totalScored: number;
  /** 本次运行产出的机会 ID 列表 */
  opportunityKeys: string[];
  /** 来源候选数（V1.3 来源透明） */
  sourceCandidateCount?: number;
  /** 本次运行的搜索查询词 */
  query?: string;
  /** 关联的报告 ID（生成报告后填充） */
  reportId?: string;
  /** 错误信息（status=failed 时有值） */
  error?: string;
  /** 错误码（status=failed 时有值） */
  errorCode?: string;
}

// ============================================================
// Radar 主体
// ============================================================

/**
 * Radar 实体。
 *
 * 包装 RadarRequirementSpec，增加身份、状态、隐私、运行追踪等元数据。
 * V1.5-01 新增：currentRunId / lastRunStatus / isBuiltin / providerRouting。
 */
export interface Radar {
  /** 雷达唯一 ID（UUID v4 或内置稳定 ID） */
  id: string;
  /** 雷达名称（用户命名或 LLM 自动命名，≤20 字） */
  name: string;
  /** 雷达类型 */
  kind: RadarKind;
  /** 生命周期状态（draft/active/paused/archived） */
  status: RadarStatus;
  /** 隐私配置 */
  privacy: RadarPrivacy;
  /** 雷达需求规格（复用现有 RadarRequirementSpec） */
  spec: RadarRequirementSpec;
  /** Provider 路由配置（V1.5-01 新增，不塞进 spec） */
  providerRouting?: ProviderRouting;

  // 运行追踪（V1.5-01 新增）
  /** 当前运行 ID（运行中才有值，完成后清空） */
  currentRunId?: string;
  /** 上次运行结果摘要 */
  lastRunStatus?: LastRunStatus;

  // 内置雷达保护（V1.5-01 新增）
  /** 是否内置雷达（内置不可删除/不可编辑 spec） */
  isBuiltin: boolean;
  /** 是否可编辑（内置=false，自定义=true） */
  isEditable: boolean;
  /** 是否可删除（内置=false，自定义=true） */
  isDeletable: boolean;
  /** 所有者 ID（内置="system"，自定义="demo_user"） */
  ownerId: string;

  // 时间戳
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
 * 生成默认 Provider 路由（V1.5-01 新增）。
 *
 * 根据雷达类型返回默认 provider 配置，与 V1.0 RADAR_ROUTING 硬编码一致。
 */
export function createDefaultProviderRouting(kind: RadarKind): ProviderRouting {
  switch (kind) {
    case "ai_competition":
      return { primary: ["serper", "exa"], fallback: [] };
    case "opc_policy":
      return { primary: ["bocha", "google_cse"], fallback: [] };
    case "cultural_heritage":
      return { primary: ["bocha", "serper"], fallback: [] };
    case "custom":
      return { primary: ["serper"], fallback: ["bocha"] };
    default:
      return { primary: ["serper"], fallback: [] };
  }
}

/**
 * 生成默认 Radar 实体。
 *
 * @param name 雷达名称
 * @param kind 雷达类型
 * @param spec 需求规格（可选，不传则用 createDefaultSpec）
 * @param options 扩展选项（V1.5-01 新增）
 */
export function createDefaultRadar(
  name: string,
  kind: RadarKind,
  spec?: RadarRequirementSpec,
  options?: {
    isBuiltin?: boolean;
    ownerId?: string;
    providerRouting?: ProviderRouting;
  },
): Radar {
  const now = new Date().toISOString();
  const isBuiltin = options?.isBuiltin ?? false;
  return {
    id: generateRadarId(),
    name,
    kind,
    status: "draft",
    privacy: createDefaultPrivacy(),
    spec: spec ?? createDefaultSpec(),
    providerRouting: options?.providerRouting ?? createDefaultProviderRouting(kind),

    // 运行追踪
    currentRunId: undefined,
    lastRunStatus: undefined,

    // 内置保护
    isBuiltin,
    isEditable: !isBuiltin,
    isDeletable: !isBuiltin,
    ownerId: options?.ownerId ?? (isBuiltin ? "system" : "demo_user"),

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

/** 生成运行记录 ID（run_ 前缀 + 时间戳 + 随机串） */
export function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `run_${ts}${rand}`;
}
