/**
 * RadarRequirementSpec 编译器（spec_compiler）
 *
 * 来源：Task 009 第 4 节。
 *
 * 输入：ExtractedRequirementInfo + RequirementConfidence + 对话上下文
 * 输出：通过 validateSpec 校验的 RadarRequirementSpec JSON
 *
 * 规则：
 *   - 确认度 < 90%：拒绝编译
 *   - 确认状态非 confirmed / ready_for_radar_plan：拒绝编译
 *   - 编译产物必须通过 validateSpec 校验
 *
 * 不接入 LLM：纯规则映射，从 ExtractedRequirementInfo 推导 Spec 各字段。
 */

import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { RequirementConfidence } from "../schema/requirement-confidence";
import type {
  RadarRequirementSpec,
  QuestionToConfirm,
  ConfirmationStatus,
  ActionIntent,
} from "../schema/radar-requirement-spec";
import {
  ACTION_INTENTS,
  MUST_INCLUDE_SECTIONS,
  OPPORTUNITY_CARD_REQUIRED_FIELDS,
} from "../schema/radar-requirement-spec";
import { createDefaultSpec } from "../schema/radar-requirement-spec";
import { createDefaultScoringRules } from "../schema/scoring-rules";
import { BRAND, REPORT_TITLE_PREFIX } from "../brand/constants";
import { validateSpec } from "../utils/validators";

// ============================================================
// 类型定义
// ============================================================

/** Spec 编译结果 */
export interface SpecCompileResult {
  /** 是否成功编译 */
  success: boolean;
  /** 编译出的 Spec（success=true 时有值） */
  spec: RadarRequirementSpec | null;
  /** 失败原因（success=false 时有值） */
  error: string | null;
}

/** 编译输入参数 */
export interface SpecCompileInput {
  /** 已提取的需求信息 */
  extracted_info: ExtractedRequirementInfo;
  /** 当前确认度 */
  confidence: RequirementConfidence;
  /** 当前确认状态 */
  confirmation_status: ConfirmationStatus;
  /** 雷达类型（影响关键词推导） */
  radar_type: "ai_competition" | "opc_policy" | "cultural_heritage";
  /** 用户确认时间（ISO 字符串） */
  confirmed_at?: string;
  /** 待确认问题（从对话中遗留的未解决问题） */
  questions_to_confirm?: QuestionToConfirm[];
}

// ============================================================
// 雷达关键词表（编译器内置常量）
// ============================================================

interface RadarKeywords {
  core_keywords_zh: string[];
  core_keywords_en: string[];
}

const RADAR_KEYWORDS_TABLE: Record<SpecCompileInput["radar_type"], RadarKeywords> = {
  ai_competition: {
    core_keywords_zh: ["AI 比赛", "AI 竞赛", "AI 黑客松", "AI 游戏 Jam", "AI 应用大赛"],
    core_keywords_en: ["AI competition", "AI hackathon", "AI game jam", "AI app contest"],
  },
  opc_policy: {
    core_keywords_zh: ["创业补贴", "社保补贴", "人才补贴", "科技项目申报", "小微企业政策"],
    core_keywords_en: ["startup subsidy", "social security subsidy", "policy application"],
  },
  cultural_heritage: {
    core_keywords_zh: ["文创比赛", "非遗创新", "城市礼物征集", "文创设计大赛", "非遗文创"],
    core_keywords_en: ["cultural creative competition", "intangible heritage", "city gift design"],
  },
};

// ============================================================
// 辅助函数
// ============================================================

/** 字符串字段是否有值 */
function hasStr(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** 数组字段是否有值 */
function hasArr(v: string[] | undefined): v is string[] {
  return Array.isArray(v) && v.length > 0;
}

/** 取数组值，缺失返回空数组 */
function arrOrEmpty<T>(v: T[] | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

/** 取字符串值，缺失返回空字符串 */
function strOrEmpty(v: string | undefined): string {
  return hasStr(v) ? v : "";
}

/**
 * action_intent 映射规则：
 * 包含"报名"→"报名比赛"；"申请"→"申请补贴"；"BD"/"客户"→"寻找客户"；
 * "收藏"/"保存"→"保存观察"；"转发"→"转发团队"。
 * 只保留 ACTION_INTENTS 中存在的值，去重。
 */
function mapActionIntent(rawIntent: string | undefined): ActionIntent[] {
  if (!hasStr(rawIntent)) return [];

  const result: ActionIntent[] = [];
  const seen = new Set<string>();
  const intent = rawIntent;

  const tryPush = (value: string): void => {
    if ((ACTION_INTENTS as readonly string[]).includes(value) && !seen.has(value)) {
      seen.add(value);
      result.push(value as ActionIntent);
    }
  };

  if (/报名/.test(intent)) tryPush("报名比赛");
  if (/申请/.test(intent)) tryPush("申请补贴");
  if (/申报/.test(intent)) tryPush("申报项目");
  if (/BD|客户/.test(intent)) tryPush("寻找客户");
  if (/合作/.test(intent)) tryPush("寻找合作");
  if (/招聘|招人/.test(intent)) tryPush("寻找招聘线索");
  if (/收藏|保存/.test(intent)) tryPush("保存观察");
  if (/转发/.test(intent)) tryPush("转发团队");
  if (/准备材料|准备/.test(intent)) tryPush("准备材料");
  if (/发布|内容/.test(intent)) tryPush("发布内容");

  return result;
}

/** 简单中→英翻译推导（基于关键词表，用于 expanded_keywords_en） */
function deriveEnKeywords(primaryTypes: string[] | undefined): string[] {
  if (!hasArr(primaryTypes)) return [];
  const result: string[] = [];
  for (const t of primaryTypes) {
    if (/比赛|竞赛/.test(t)) result.push("competition");
    if (/黑客松|hackathon/i.test(t)) result.push("hackathon");
    if (/补贴|政策/.test(t)) result.push("subsidy", "policy");
    if (/申报|项目/.test(t)) result.push("application");
    if (/文创|文化/.test(t)) result.push("cultural creative");
    if (/非遗/.test(t)) result.push("intangible heritage");
    if (/征集|礼物/.test(t)) result.push("call for entries");
    if (/游戏/.test(t)) result.push("game");
    if (/AI|人工智能/i.test(t)) result.push("AI");
  }
  return [...new Set(result)];
}

// ============================================================
// 字段映射函数
// ============================================================

/** 映射 client_profile */
function mapClientProfile(info: ExtractedRequirementInfo): RadarRequirementSpec["client_profile"] {
  const ci = info.client_identity ?? {};
  return {
    client_name: "",
    client_type: strOrEmpty(ci.client_type),
    industry: strOrEmpty(ci.industry),
    business_type: strOrEmpty(ci.business_type),
    company_stage: strOrEmpty(ci.company_stage),
    products_or_projects: arrOrEmpty(ci.products_or_projects),
    target_users: [],
    core_capabilities: arrOrEmpty(ci.core_capabilities),
    current_assets: [],
    regions: arrOrEmpty(ci.regions),
    notes: strOrEmpty(ci.notes),
  };
}

/** 映射 core_goals */
function mapCoreGoals(info: ExtractedRequirementInfo): RadarRequirementSpec["core_goals"] {
  const bg = info.business_goal ?? {};
  const as = info.action_scenario ?? {};
  return {
    primary_goal: strOrEmpty(bg.primary_goal),
    secondary_goals: arrOrEmpty(bg.secondary_goals),
    success_definition: strOrEmpty(bg.success_definition),
    action_intent: mapActionIntent(as.action_intent),
    priority_order: arrOrEmpty(bg.priority_order),
  };
}

/** 映射 opportunity_scope */
function mapOpportunityScope(info: ExtractedRequirementInfo): RadarRequirementSpec["opportunity_scope"] {
  const ot = info.opportunity_type ?? {};
  return {
    primary_opportunity_types: arrOrEmpty(ot.primary_types),
    secondary_opportunity_types: arrOrEmpty(ot.secondary_types),
    excluded_opportunity_types: arrOrEmpty(ot.excluded_types),
    must_have_conditions: arrOrEmpty(ot.must_have_conditions),
    nice_to_have_conditions: [],
  };
}

/** 映射 region_scope */
function mapRegionScope(info: ExtractedRequirementInfo): RadarRequirementSpec["region_scope"] {
  const rs = info.region_scope ?? {};
  return {
    primary_regions: arrOrEmpty(rs.primary_regions),
    secondary_regions: arrOrEmpty(rs.secondary_regions),
    excluded_regions: arrOrEmpty(rs.excluded_regions),
    global_allowed: rs.global_allowed ?? false,
    overseas_allowed: rs.overseas_allowed ?? false,
  };
}

/** 推导 keyword_strategy */
function mapKeywordStrategy(
  info: ExtractedRequirementInfo,
  radarType: SpecCompileInput["radar_type"],
): RadarRequirementSpec["keyword_strategy"] {
  const ot = info.opportunity_type ?? {};
  const ci = info.client_identity ?? {};
  const er = info.exclusion_rules ?? { count: 0 };

  const radarKw = RADAR_KEYWORDS_TABLE[radarType];

  // core_keywords_zh: 从 primary_types 提取 + 雷达核心中文关键词
  const coreZh: string[] = [];
  const seenZh = new Set<string>();
  for (const t of arrOrEmpty(ot.primary_types)) {
    if (!seenZh.has(t)) {
      seenZh.add(t);
      coreZh.push(t);
    }
  }
  for (const kw of radarKw.core_keywords_zh) {
    if (!seenZh.has(kw)) {
      seenZh.add(kw);
      coreZh.push(kw);
    }
  }

  // core_keywords_en: 雷达核心英文关键词
  const coreEn = [...radarKw.core_keywords_en];

  // expanded_keywords_zh: 从 secondary_types + core_capabilities 提取
  const expandedZh: string[] = [];
  const seenExpZh = new Set<string>();
  for (const t of [...arrOrEmpty(ot.secondary_types), ...arrOrEmpty(ci.core_capabilities)]) {
    if (!seenExpZh.has(t)) {
      seenExpZh.add(t);
      expandedZh.push(t);
    }
  }

  // expanded_keywords_en: 从 primary_types 翻译推导
  const expandedEn = deriveEnKeywords(ot.primary_types);

  // negative_keywords: 从 excluded_types + must_exclude 合并
  const negative: string[] = [];
  const seenNeg = new Set<string>();
  for (const t of [...arrOrEmpty(ot.excluded_types), ...arrOrEmpty(er.must_exclude)]) {
    if (!seenNeg.has(t)) {
      seenNeg.add(t);
      negative.push(t);
    }
  }

  return {
    core_keywords_zh: coreZh,
    core_keywords_en: coreEn,
    expanded_keywords_zh: expandedZh,
    expanded_keywords_en: expandedEn,
    negative_keywords: negative,
  };
}

/** 映射 filter_rules */
function mapFilterRules(info: ExtractedRequirementInfo): RadarRequirementSpec["filter_rules"] {
  const ot = info.opportunity_type ?? {};
  const er = info.exclusion_rules ?? { count: 0 };
  return {
    must_include: arrOrEmpty(ot.must_have_conditions),
    must_exclude: arrOrEmpty(er.must_exclude),
    low_priority_signals: arrOrEmpty(er.low_priority_signals),
    high_priority_signals: [],
    requires_manual_review: [],
  };
}

/** 映射 report_requirements */
function mapReportRequirements(info: ExtractedRequirementInfo): RadarRequirementSpec["report_requirements"] {
  const rf = info.report_format ?? {};
  return {
    report_format: "markdown",
    report_title_prefix: REPORT_TITLE_PREFIX,
    report_frequency: hasStr(rf.frequency) ? rf.frequency : "每周",
    max_items_per_report: 10,
    min_items_per_report: 5,
    must_include_sections: [...MUST_INCLUDE_SECTIONS],
    opportunity_card_required_fields: [...OPPORTUNITY_CARD_REQUIRED_FIELDS],
    link_required: true,
    contact_required_if_available: true,
    deadline_required_if_available: true,
  };
}

/** 映射 confirmation_status */
function mapConfirmationStatus(
  input: SpecCompileInput,
): RadarRequirementSpec["confirmation_status"] {
  return {
    status: input.confirmation_status,
    user_confirmed: true,
    confirmed_at: input.confirmed_at ?? new Date().toISOString(),
    last_user_feedback: "",
    revision_count: 0,
  };
}

/** 初始化 source_strategy（V0.4/V0.8 消费） */
function initSourceStrategy(): NonNullable<RadarRequirementSpec["source_strategy"]> {
  return {
    official_sites: [],
    platforms: [],
    search_engines: [],
    social_media: [],
    rss_sources: [],
    manual_sources: [],
    source_priority: [],
    sources_used_in_report: [],
    user_supplied_sources: [],
    source_transparency_enabled: true,
  };
}

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 将已提取的需求信息编译为 RadarRequirementSpec。
 *
 * 规则：
 *   - 确认度 < 90%：拒绝编译，返回 error
 *   - 确认状态非 confirmed / ready_for_radar_plan：拒绝编译
 *   - 编译产物必须通过 validateSpec 校验
 *
 * @param input 编译输入
 * @returns 编译结果
 */
export function compileSpec(input: SpecCompileInput): SpecCompileResult {
  const { extracted_info, confidence, confirmation_status, radar_type } = input;

  // 拒绝条件 1：确认度 < 90%
  if (confidence.total < 90) {
    return {
      success: false,
      spec: null,
      error: `需求确认度仅 ${confidence.total}%，低于 90% 阈值，拒绝编译 Spec。请继续补充需求信息。`,
    };
  }

  // 拒绝条件 2：确认状态非 confirmed / ready_for_radar_plan
  if (confirmation_status !== "confirmed" && confirmation_status !== "ready_for_radar_plan") {
    return {
      success: false,
      spec: null,
      error: `确认状态为 "${confirmation_status}"，用户尚未确认，拒绝编译 Spec。仅 confirmed 或 ready_for_radar_plan 状态可编译。`,
    };
  }

  // 以 createDefaultSpec 为骨架，逐字段覆盖
  const spec: RadarRequirementSpec = {
    ...createDefaultSpec(),
    product_name: BRAND.product_name,
    product_category: BRAND.product_category,
    client_profile: mapClientProfile(extracted_info),
    core_goals: mapCoreGoals(extracted_info),
    opportunity_scope: mapOpportunityScope(extracted_info),
    region_scope: mapRegionScope(extracted_info),
    keyword_strategy: mapKeywordStrategy(extracted_info, radar_type),
    source_strategy: initSourceStrategy(),
    filter_rules: mapFilterRules(extracted_info),
    scoring_rules: createDefaultScoringRules(),
    report_requirements: mapReportRequirements(extracted_info),
    requirement_confidence: confidence,
    questions_to_confirm: input.questions_to_confirm ?? [],
    confirmation_status: mapConfirmationStatus(input),
  };

  // 编译产物必须通过 validateSpec
  const validation = validateSpec(spec);
  if (!validation.valid) {
    return {
      success: false,
      spec: null,
      error: `编译产物未通过 validateSpec 校验：${validation.errors.join("; ")}`,
    };
  }

  return {
    success: true,
    spec,
    error: null,
  };
}
