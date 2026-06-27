/**
 * 需求确认度计算引擎（confidence_engine）
 *
 * 来源：Task 006 第 4.2–4.4 节。
 *
 * 纯函数模块，输入是已从对话中提取的结构化需求信息（ExtractedRequirementInfo），
 * 输出是 7 维度分数（各含 reason）+ 总分 + 分支判断结果。
 *
 * 不依赖 LLM 调用——LLM 从对话中提取 ExtractedRequirementInfo 是 Task 007 的职责。
 *
 * 打分规则基于 Task 002 的 CONFIDENCE_CALCULATION_SPEC（7 维度 × 4 档标准）。
 * 总分计算复用 Task 001 的 computeConfidenceTotal，不重新实现公式。
 */

import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { RequirementConfidence, ConfidenceDimension } from "../schema/requirement-confidence";
import {
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_DIMENSIONS,
  CONFIDENCE_DIMENSION_LABELS,
  computeConfidenceTotal,
  createDefaultConfidence,
  type ConfidenceDimensionKey,
} from "../schema/requirement-confidence";

// ============================================================
// 辅助函数
// ============================================================

/** 字符串字段是否有值（非 undefined / 非空串） */
function hasStr(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** 数组字段是否有值（非 undefined / 非空数组） */
function hasArr(v: string[] | undefined): v is string[] {
  return Array.isArray(v) && v.length > 0;
}

/** 把字符串数组格式化为可读文本 */
function arrStr(v: string[] | undefined): string {
  return (v ?? []).join("、");
}

// ============================================================
// 各维度打分函数（基于 Task 002 CONFIDENCE_CALCULATION_SPEC 的 4 档标准）
// ============================================================

/**
 * client_identity（权重 15）
 * 打分依据：client_type / industry / core_capabilities / products_or_projects 四个字段的有无
 */
function scoreClientIdentity(info: ExtractedRequirementInfo): ConfidenceDimension {
  const ci = info.client_identity ?? {};
  const weight = CONFIDENCE_WEIGHTS.client_identity;
  const hasType = hasStr(ci.client_type);
  const hasIndustry = hasStr(ci.industry);
  const hasCaps = hasArr(ci.core_capabilities);
  const hasProducts = hasArr(ci.products_or_projects);
  const count = [hasType, hasIndustry, hasCaps, hasProducts].filter(Boolean).length;

  const parts: string[] = [];
  if (hasType) parts.push(ci.client_type!);
  if (hasIndustry) parts.push(ci.industry!);
  if (hasCaps) parts.push(`核心能力：${arrStr(ci.core_capabilities)}`);
  if (hasProducts) parts.push(`作品：${arrStr(ci.products_or_projects)}`);

  let score: number;
  let reason: string;

  switch (count) {
    case 0:
      score = 0;
      reason = "尚未获取用户身份信息";
      break;
    case 1:
      score = 55;
      reason = `已知用户是${parts.join("，")}，但行业信息不明确`;
      break;
    case 2:
      score = 75;
      reason = `已知用户是${hasType ? ci.client_type : "未知"}，从事${hasIndustry ? ci.industry : "未知"}，但核心能力和作品信息不完整`;
      break;
    case 3:
      score = 85;
      reason = `用户身份较清晰：${parts.join("，")}，但部分信息仍不完整`;
      break;
    default:
      score = 95;
      reason = `用户身份清晰：${parts.join("，")}`;
      break;
  }

  return { score, weight, reason };
}

/**
 * business_goal（权重 20）
 * 打分依据：primary_goal / success_definition / priority_order 三个字段的有无
 */
function scoreBusinessGoal(info: ExtractedRequirementInfo): ConfidenceDimension {
  const bg = info.business_goal ?? {};
  const weight = CONFIDENCE_WEIGHTS.business_goal;
  const hasGoal = hasStr(bg.primary_goal);
  const hasSuccess = hasStr(bg.success_definition);
  const hasPriority = hasArr(bg.priority_order);
  const count = [hasGoal, hasSuccess, hasPriority].filter(Boolean).length;

  let score: number;
  let reason: string;

  switch (count) {
    case 0:
      score = 0;
      reason = "业务目标完全不明";
      break;
    case 1:
      score = 55;
      reason = `已知大概方向：${bg.primary_goal}，但缺少具体成功标准`;
      break;
    case 2:
      score = 75;
      reason = `目标明确：${bg.primary_goal}，成功标准：${bg.success_definition}，但优先级未排序`;
      break;
    default:
      score = 95;
      reason = `业务目标完整：${bg.primary_goal}，成功标准：${bg.success_definition}，优先级：${arrStr(bg.priority_order)}`;
      break;
  }

  return { score, weight, reason };
}

/**
 * opportunity_type（权重 20）
 * 打分依据：primary_types / excluded_types / secondary_types 三个字段的有无
 */
function scoreOpportunityType(info: ExtractedRequirementInfo): ConfidenceDimension {
  const ot = info.opportunity_type ?? {};
  const weight = CONFIDENCE_WEIGHTS.opportunity_type;
  const hasPrimary = hasArr(ot.primary_types);
  const hasExcluded = hasArr(ot.excluded_types);
  const hasSecondary = hasArr(ot.secondary_types);
  const count = [hasPrimary, hasExcluded, hasSecondary].filter(Boolean).length;

  let score: number;
  let reason: string;

  switch (count) {
    case 0:
      score = 0;
      reason = "机会类型完全不明";
      break;
    case 1:
      score = 55;
      reason = `已知主要找${arrStr(ot.primary_types)}，但未定义排除类型`;
      break;
    case 2:
      score = 75;
      reason = `机会类型较清晰：主要找${arrStr(ot.primary_types)}，排除${arrStr(ot.excluded_types)}，但次要类型未明确`;
      break;
    default:
      score = 95;
      reason = `机会类型完整：主要${arrStr(ot.primary_types)}，次要${arrStr(ot.secondary_types)}，排除${arrStr(ot.excluded_types)}`;
      break;
  }

  return { score, weight, reason };
}

/**
 * region_scope（权重 10）
 * 打分依据：primary_regions / excluded_regions / secondary_regions 三个字段的有无
 */
function scoreRegionScope(info: ExtractedRequirementInfo): ConfidenceDimension {
  const rs = info.region_scope ?? {};
  const weight = CONFIDENCE_WEIGHTS.region_scope;
  const hasPrimary = hasArr(rs.primary_regions);
  const hasExcluded = hasArr(rs.excluded_regions);
  const hasSecondary = hasArr(rs.secondary_regions);
  const count = [hasPrimary, hasExcluded, hasSecondary].filter(Boolean).length;

  let score: number;
  let reason: string;

  switch (count) {
    case 0:
      score = 0;
      reason = "地域范围完全不明";
      break;
    case 1:
      score = 55;
      reason = `已知主要地域：${arrStr(rs.primary_regions)}，但未定义排除地域`;
      break;
    case 2:
      score = 75;
      reason = `地域较清晰：主要${arrStr(rs.primary_regions)}，排除${arrStr(rs.excluded_regions)}，但次要地域未明确`;
      break;
    default:
      score = 95;
      reason = `地域范围完整：主要${arrStr(rs.primary_regions)}，次要${arrStr(rs.secondary_regions)}，排除${arrStr(rs.excluded_regions)}`;
      break;
  }

  return { score, weight, reason };
}

/**
 * exclusion_rules（权重 10）
 * 打分依据：排除条件总数 count
 */
function scoreExclusionRules(info: ExtractedRequirementInfo): ConfidenceDimension {
  const er = info.exclusion_rules ?? { count: 0 };
  const weight = CONFIDENCE_WEIGHTS.exclusion_rules;
  const count = er.count;
  const mustExclude = arrStr(er.must_exclude);
  const lowPriority = arrStr(er.low_priority_signals);

  let score: number;
  let reason: string;

  if (count === 0) {
    score = 0;
    reason = "未提供任何排除条件";
  } else if (count === 1) {
    score = 55;
    reason = `有 1 条排除条件：${mustExclude}`;
  } else if (count <= 3) {
    score = 75;
    reason = `有 ${count} 条排除条件：${mustExclude}`;
  } else {
    score = 95;
    reason = `排除条件全面（${count} 条）：${mustExclude}，另有低优先级信号：${lowPriority}`;
  }

  return { score, weight, reason };
}

/**
 * action_scenario（权重 15）
 * 打分依据：action_intent 有无 + priority_order 项数
 */
function scoreActionScenario(info: ExtractedRequirementInfo): ConfidenceDimension {
  const as = info.action_scenario ?? {};
  const weight = CONFIDENCE_WEIGHTS.action_scenario;
  const hasIntent = hasStr(as.action_intent);
  const priorityCount = hasArr(as.priority_order) ? as.priority_order.length : 0;

  let score: number;
  let reason: string;

  if (!hasIntent) {
    score = 0;
    reason = "行动意图完全不明";
  } else if (priorityCount === 0) {
    score = 55;
    reason = `已知大概行动：${as.action_intent}，但优先级未明确`;
  } else if (priorityCount === 1) {
    score = 75;
    reason = `已知主要行动：${as.action_intent}，但只有单一优先级，缺少完整排序`;
  } else {
    score = 95;
    reason = `行动场景清晰：${as.action_intent}，优先级：${arrStr(as.priority_order)}`;
  }

  return { score, weight, reason };
}

/**
 * report_format（权重 10）
 * 打分依据：frequency / format / must_include_sections 三个字段的有无
 */
function scoreReportFormat(info: ExtractedRequirementInfo): ConfidenceDimension {
  const rf = info.report_format ?? {};
  const weight = CONFIDENCE_WEIGHTS.report_format;
  const hasFreq = hasStr(rf.frequency);
  const hasFormat = hasStr(rf.format);
  const hasSections = hasArr(rf.must_include_sections);
  const count = [hasFreq, hasFormat, hasSections].filter(Boolean).length;

  let score: number;
  let reason: string;

  switch (count) {
    case 0:
      score = 0;
      reason = "报告形式完全不明";
      break;
    case 1:
      score = 55;
      reason = `已知报告频率：${rf.frequency}，但格式未明确`;
      break;
    case 2:
      score = 75;
      reason = `已知频率：${rf.frequency}，格式：${rf.format}，但报告结构未定义`;
      break;
    default:
      score = 95;
      reason = `报告形式完整：频率${rf.frequency}，格式${rf.format}，含${rf.must_include_sections!.length}个必选章节`;
      break;
  }

  return { score, weight, reason };
}

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 计算单个维度的得分。
 * 根据该维度的打分指引（4 档标准）和已提取信息，返回 0–100 的分数 + reason。
 */
function scoreDimension(
  dimension: ConfidenceDimensionKey,
  info: ExtractedRequirementInfo,
): ConfidenceDimension {
  switch (dimension) {
    case "client_identity":
      return scoreClientIdentity(info);
    case "business_goal":
      return scoreBusinessGoal(info);
    case "opportunity_type":
      return scoreOpportunityType(info);
    case "region_scope":
      return scoreRegionScope(info);
    case "exclusion_rules":
      return scoreExclusionRules(info);
    case "action_scenario":
      return scoreActionScenario(info);
    case "report_format":
      return scoreReportFormat(info);
    default:
      return { score: 0, weight: CONFIDENCE_WEIGHTS[dimension], reason: "未知维度" };
  }
}

/**
 * 计算完整的确认度（7 维度 + 总分）。
 * 输入：已提取的结构化需求信息
 * 输出：RequirementConfidence（7 维度各自 score+weight+reason + total）
 *
 * 总分计算复用 Task 001 的 computeConfidenceTotal，不重新实现公式。
 */
export function calculateConfidence(info: ExtractedRequirementInfo): RequirementConfidence {
  const confidence = createDefaultConfidence();
  for (const key of CONFIDENCE_DIMENSIONS) {
    confidence[key] = scoreDimension(key, info);
  }
  confidence.total = computeConfidenceTotal(confidence);
  return confidence;
}

/**
 * 根据确认度总分返回分支判断结果。
 * 不调用 getNextStatus（那是状态机的职责），只返回"建议动作"。
 *
 * - <70：继续追问
 * - 70–89：可输出初步理解，继续确认
 * - 90–94：可生成确认卡 V0.1
 * - ≥95：可生成正式雷达方案
 */
export type ConfidenceBranch =
  | "needs_more_info"
  | "continue_confirming"
  | "can_generate_card_v01"
  | "can_generate_plan";

export function getConfidenceBranch(total: number): ConfidenceBranch {
  if (total < 70) return "needs_more_info";
  if (total < 90) return "continue_confirming";
  if (total < 95) return "can_generate_card_v01";
  return "can_generate_plan";
}

/**
 * 确认度变化对比（用于多轮对话中展示"本轮确认度提升了多少"）。
 */
export interface ConfidenceDelta {
  total_delta: number;
  dimension_deltas: Array<{
    dimension: string;
    label: string;
    previous_score: number;
    current_score: number;
    delta: number;
  }>;
}

/**
 * 生成确认度变化对比。
 * 比较前后两份 RequirementConfidence，返回总分差和各维度分数差。
 */
export function calculateConfidenceDelta(
  previous: RequirementConfidence,
  current: RequirementConfidence,
): ConfidenceDelta {
  const dimension_deltas = CONFIDENCE_DIMENSIONS.map((key) => {
    const prevScore = previous[key].score;
    const currScore = current[key].score;
    return {
      dimension: key,
      label: CONFIDENCE_DIMENSION_LABELS[key],
      previous_score: prevScore,
      current_score: currScore,
      delta: Math.round((currScore - prevScore) * 100) / 100,
    };
  });

  return {
    total_delta: Math.round((current.total - previous.total) * 100) / 100,
    dimension_deltas,
  };
}
