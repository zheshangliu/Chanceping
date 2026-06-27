/**
 * 需求确认度结构（requirement_confidence）
 *
 * 来源：03 号文档第 13 节 + Task 001 第 4.4 节。
 * 共 7 个维度，权重固定，总和 = 100。
 * 本任务只定义结构与计算公式，不实现"从对话推断各维度得分"的逻辑（Task 006）。
 */

/** 单个确认度维度 */
export interface ConfidenceDimension {
  /** 得分 0–100 */
  score: number;
  /** 权重 0–100，7 维度权重之和必须 = 100 */
  weight: number;
  /** 得分理由 */
  reason: string;
}

/** 需求确认度（7 维度 + 总分） */
export interface RequirementConfidence {
  /** 总分 0–100，计算公式：Σ(score × weight / 100) */
  total: number;
  /** 客户身份清晰度（权重 15） */
  client_identity: ConfidenceDimension;
  /** 业务目标清晰度（权重 20） */
  business_goal: ConfidenceDimension;
  /** 机会类型清晰度（权重 20） */
  opportunity_type: ConfidenceDimension;
  /** 地域范围清晰度（权重 10） */
  region_scope: ConfidenceDimension;
  /** 排除条件清晰度（权重 10） */
  exclusion_rules: ConfidenceDimension;
  /** 行动场景清晰度（权重 15） */
  action_scenario: ConfidenceDimension;
  /** 报告形式清晰度（权重 10） */
  report_format: ConfidenceDimension;
}

/** 7 个维度的固定权重（取自 03 号文档第 13 节，不得调整） */
export const CONFIDENCE_WEIGHTS = {
  client_identity: 15,
  business_goal: 20,
  opportunity_type: 20,
  region_scope: 10,
  exclusion_rules: 10,
  action_scenario: 15,
  report_format: 10,
} as const;

/** 7 个维度的键（顺序固定） */
export const CONFIDENCE_DIMENSIONS = [
  "client_identity",
  "business_goal",
  "opportunity_type",
  "region_scope",
  "exclusion_rules",
  "action_scenario",
  "report_format",
] as const;

export type ConfidenceDimensionKey = (typeof CONFIDENCE_DIMENSIONS)[number];

/** 各维度中文含义 */
export const CONFIDENCE_DIMENSION_LABELS: Record<ConfidenceDimensionKey, string> = {
  client_identity: "客户身份清晰度",
  business_goal: "业务目标清晰度",
  opportunity_type: "机会类型清晰度",
  region_scope: "地域范围清晰度",
  exclusion_rules: "排除条件清晰度",
  action_scenario: "行动场景清晰度",
  report_format: "报告形式清晰度",
};

/**
 * 分支阈值常量（取自 03 号文档第 13 节 confidence_rules）。
 * 用于决定确认度达到某区间后可执行的下一步动作。
 */
export const CONFIDENCE_THRESHOLDS = {
  /** 0–69：不能生成确认卡，继续追问 */
  BELOW_70: {
    min: 0,
    max: 69,
    description: "不能生成确认卡，继续追问",
  },
  /** 70–89：可输出初步理解，继续确认 */
  RANGE_70_89: {
    min: 70,
    max: 89,
    description: "可输出初步理解，继续确认",
  },
  /** 90–94：可生成确认卡 V0.1，需用户确认 */
  RANGE_90_94: {
    min: 90,
    max: 94,
    description: "可生成确认卡 V0.1，需用户确认",
  },
  /** 95–100：可生成正式雷达方案 V1.0 */
  ABOVE_95: {
    min: 95,
    max: 100,
    description: "可生成正式雷达方案 V1.0",
  },
} as const;

/**
 * 按公式 total = Σ(score × weight / 100) 计算确认度总分。
 * 结果保留两位小数，范围 0–100。
 *
 * 注意：这是纯数学公式，供校验工具与后续模块复用；
 * "从对话推断各维度 score" 的逻辑属于 Task 006，不在本任务范围。
 */
export function computeConfidenceTotal(confidence: RequirementConfidence): number {
  let total = 0;
  for (const key of CONFIDENCE_DIMENSIONS) {
    total += (confidence[key].score * confidence[key].weight) / 100;
  }
  return Math.round(total * 100) / 100;
}

/** 生成一份全 0 的默认确认度（权重已固定） */
export function createDefaultConfidence(): RequirementConfidence {
  const dim = (weight: number): ConfidenceDimension => ({ score: 0, weight, reason: "" });
  return {
    total: 0,
    client_identity: dim(CONFIDENCE_WEIGHTS.client_identity),
    business_goal: dim(CONFIDENCE_WEIGHTS.business_goal),
    opportunity_type: dim(CONFIDENCE_WEIGHTS.opportunity_type),
    region_scope: dim(CONFIDENCE_WEIGHTS.region_scope),
    exclusion_rules: dim(CONFIDENCE_WEIGHTS.exclusion_rules),
    action_scenario: dim(CONFIDENCE_WEIGHTS.action_scenario),
    report_format: dim(CONFIDENCE_WEIGHTS.report_format),
  };
}
