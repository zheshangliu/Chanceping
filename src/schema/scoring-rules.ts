/**
 * 评分与分级规则（scoring_rules）
 *
 * 来源：03 号文档第 10 节 + Task 001 第 4.6 节。
 * 后台 100 分制，前台显示 S/A/B/C（hidden 默认不展示）。
 * 权重与分级阈值严格按文档，不得调整。
 */

import { t } from "../i18n/locales";

/** 前台可见等级（hidden 表示默认不主动展示） */
export type VisibleLevel = "S" | "A" | "B" | "C" | "hidden";

/** 机会卡片前台展示用的等级（不含 hidden，hidden 不进卡片） */
export type CardVisibleLevel = "S" | "A" | "B" | "C";

/** 评分各维度权重 */
export interface ScoringWeights {
  /** 匹配度（30） */
  match_score: number;
  /** 业务价值（25） */
  business_value: number;
  /** 时效性（20） */
  timeliness: number;
  /** 可信度（15） */
  credibility: number;
  /** 可执行性（10） */
  actionability: number;
  /** 风险扣分（-20） */
  risk_penalty: number;
}

/** 评分与分级规则 */
export interface ScoringRules {
  /** 是否启用后台分数 */
  backend_score_enabled: boolean;
  /** 是否启用前台等级 */
  visible_level_enabled: boolean;
  /** 各维度权重 */
  weights: ScoringWeights;
  /** 等级与分数区间的映射 */
  visible_level_mapping: Record<VisibleLevel, string>;
  /** 等级定义说明 */
  level_definitions: Record<VisibleLevel, string>;
}

/** 默认评分权重（取自 03 号文档第 10 节） */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  match_score: 30,
  business_value: 25,
  timeliness: 20,
  credibility: 15,
  actionability: 10,
  risk_penalty: -20,
};

/** 等级与分数区间映射（取自 03 号文档第 10 节） */
export const VISIBLE_LEVEL_MAPPING: Record<VisibleLevel, string> = {
  S: "90-100",
  A: "80-89",
  B: "65-79",
  C: "50-64",
  hidden: "<50",
};

/** 等级定义说明（取自 03 号文档第 10 节） */
export const LEVEL_DEFINITIONS: Record<VisibleLevel, string> = {
  S: "强烈推荐，优先行动",
  A: "高价值机会，建议认真考虑",
  B: "可关注，适合收藏或观察",
  C: "低优先级，仅供参考",
  hidden: "默认不主动展示",
};

/**
 * 根据后台分数换算前台等级。
 * 规则（取自 03 号文档第 10 节 + Task 001 第 4.6 节）：
 *   90–100 → S
 *   80–89  → A
 *   65–79  → B
 *   50–64  → C
 *   < 50   → hidden
 */
export function scoreToLevel(score: number): VisibleLevel {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "hidden";
}

/** 生成默认评分规则 */
export function createDefaultScoringRules(): ScoringRules {
  return {
    backend_score_enabled: true,
    visible_level_enabled: true,
    weights: { ...DEFAULT_SCORING_WEIGHTS },
    visible_level_mapping: { ...VISIBLE_LEVEL_MAPPING },
    level_definitions: { ...LEVEL_DEFINITIONS },
  };
}

// ============================================================
// locale 感知等级定义函数（Task 018 新增，向后兼容）
// ============================================================

/** 获取等级定义说明的 locale 感知文案 */
export function getLevelDefinition(level: VisibleLevel, locale?: string): string {
  const key = `opportunity.level.${level}`;
  return locale ? t(key, { lng: locale }) : t(key);
}
