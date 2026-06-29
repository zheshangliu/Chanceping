/**
 * RadarSpec 校验器（V1.5-05 新增）
 *
 * 来源：Task V1.5-05 第 3.3 节。
 *
 * 校验 RadarRequirementSpec 的 10 个核心字段完整性，返回完整率（0-100）+ 缺失字段列表。
 *
 * 10 个核心字段：
 *   1. keywords（core_keywords_zh 非空数组）
 *   2. region（primary_regions 非空数组）
 *   3. exclude_rules（must_exclude 数组，可为空）
 *   4. scoring_rules（对象存在）
 *   5. scoring_rules.match_weight（数字）
 *   6. scoring_rules.intent_weight（数字）
 *   7. scoring_rules.evidence_weight（数字）
 *   8. scoring_rules.urgency_weight（数字）
 *   9. scoring_rules.action_cost_weight（数字）
 *   10. visible_level_mapping（对象，含 S/A/B/C）
 *
 * 纯类型校验，不调 LLM，不引入依赖。
 */

import type { RadarRequirementSpec } from "./radar-requirement-spec";

// ============================================================
// 类型定义
// ============================================================

/** 校验结果 */
export interface RadarSpecValidationResult {
  /** 字段完整率（0-100） */
  completeness: number;
  /** 缺失字段列表 */
  missingFields: string[];
  /** 是否通过（completeness >= 90） */
  passed: boolean;
}

// ============================================================
// 常量
// ============================================================

/** 通过阈值 */
const PASS_THRESHOLD = 90;

/** 核心字段总数 */
const TOTAL_FIELDS = 10;

/** 每个字段权重（10 字段 × 10 = 100） */
const FIELD_WEIGHT = 100 / TOTAL_FIELDS;

// ============================================================
// 辅助函数
// ============================================================

/** 数组非空 */
function isNonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

/** 是数字 */
function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

/** 是对象（非 null） */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ============================================================
// 核心校验
// ============================================================

/**
 * 校验 Spec 字段完整性。
 *
 * @param spec 雷达需求规格
 * @returns 完整率（0-100）+ 缺失字段列表 + passed
 */
export function validateRadarSpec(spec: RadarRequirementSpec): RadarSpecValidationResult {
  const missingFields: string[] = [];

  // 1. keywords（core_keywords_zh 非空数组）
  if (!isNonEmptyArray(spec?.keyword_strategy?.core_keywords_zh)) {
    missingFields.push("keywords");
  }

  // 2. region（primary_regions 非空数组）
  if (!isNonEmptyArray(spec?.region_scope?.primary_regions)) {
    missingFields.push("region");
  }

  // 3. exclude_rules（must_exclude 数组，可为空 - 仅校验是数组）
  if (!Array.isArray(spec?.filter_rules?.must_exclude)) {
    missingFields.push("exclude_rules");
  }

  // 4. scoring_rules（对象存在）
  const scoringRules = spec?.scoring_rules;
  if (!isObject(scoringRules)) {
    missingFields.push("scoring_rules");
    // 后续 5-9 字段无法校验，全部记为缺失
    missingFields.push("scoring_rules.match_weight");
    missingFields.push("scoring_rules.intent_weight");
    missingFields.push("scoring_rules.evidence_weight");
    missingFields.push("scoring_rules.urgency_weight");
    missingFields.push("scoring_rules.action_cost_weight");
    // 10. visible_level_mapping
    missingFields.push("visible_level_mapping");
    const completeness = Math.max(0, 100 - missingFields.length * FIELD_WEIGHT);
    return {
      completeness: Math.round(completeness),
      missingFields,
      passed: false,
    };
  }

  // 5-9. scoring_rules 各权重字段
  const weights = scoringRules.weights as unknown as Record<string, unknown> | undefined;
  if (!isNumber(weights?.match_score)) {
    missingFields.push("scoring_rules.match_weight");
  }
  if (!isNumber(weights?.business_value)) {
    missingFields.push("scoring_rules.intent_weight");
  }
  if (!isNumber(weights?.credibility)) {
    missingFields.push("scoring_rules.evidence_weight");
  }
  if (!isNumber(weights?.timeliness)) {
    missingFields.push("scoring_rules.urgency_weight");
  }
  if (!isNumber(weights?.actionability)) {
    missingFields.push("scoring_rules.action_cost_weight");
  }

  // 10. visible_level_mapping（对象，含 S/A/B/C）
  const visibleLevelMapping = scoringRules.visible_level_mapping as Record<string, unknown> | undefined;
  if (
    !isObject(visibleLevelMapping) ||
    typeof visibleLevelMapping.S !== "string" ||
    typeof visibleLevelMapping.A !== "string" ||
    typeof visibleLevelMapping.B !== "string" ||
    typeof visibleLevelMapping.C !== "string"
  ) {
    missingFields.push("visible_level_mapping");
  }

  // 计算完整率
  const missingCount = missingFields.length;
  const completeness = Math.max(0, 100 - missingCount * FIELD_WEIGHT);

  return {
    completeness: Math.round(completeness),
    missingFields,
    passed: completeness >= PASS_THRESHOLD,
  };
}

/**
 * RadarSpec 校验器类（封装静态方法，便于以实例方式调用）。
 */
export class RadarSpecValidator {
  /**
   * 校验 Spec 字段完整性。
   *
   * @param spec 雷达需求规格
   * @returns 完整率（0-100）+ 缺失字段列表 + passed
   */
  validate(spec: RadarRequirementSpec): RadarSpecValidationResult {
    return validateRadarSpec(spec);
  }
}
