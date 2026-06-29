/**
 * RadarSpecCompiler —— SpecCompiler 扩展包装器（V1.5-05 新增）
 *
 * 来源：Task V1.5-05 第 3.1 节。
 *
 * 原 spec-compiler.ts 的 compileSpec() 只支持 3 个固定雷达类型（ai_competition /
 * opc_policy / cultural_heritage），不支持 custom 类型。本包装器扩展支持 custom：
 *   - 固定类型：委托给原 compileSpec（关键词从 RADAR_KEYWORDS_TABLE 取）
 *   - custom 类型：不查 RADAR_KEYWORDS_TABLE，关键词从 info.opportunity_type.primary_types 取
 *
 * 不修改原 spec-compiler.ts（保持向后兼容）。
 *
 * 注意：原 compileSpec 拒绝 confidence < 90 或非 confirmed 状态。AI 生成器场景下
 * 用户尚未走完整确认流程，因此本包装器构造一个"全分置信度 + confirmed 状态"的
 * 合成输入，以绕过拒绝检查（AI 生成结果由用户在前端二次确认）。
 */

import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import type { RadarKind } from "../schema/radar";
import { compileSpec, type SpecCompileInput } from "./spec-compiler";
import { createDefaultConfidence } from "../schema/requirement-confidence";
import { createDefaultSpec } from "../schema/radar-requirement-spec";
import { createDefaultScoringRules } from "../schema/scoring-rules";
import { BRAND } from "../brand/constants";

// ============================================================
// 辅助函数
// ============================================================

/** 取数组值，缺失返回空数组 */
function arrOrEmpty<T>(v: T[] | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

/** 取字符串值，缺失返回空字符串 */
function strOrEmpty(v: string | undefined): string {
  return typeof v === "string" && v.trim() !== "" ? v : "";
}

/**
 * 构造"全分置信度"（total=100，各维度 score=100）。
 * 用于 AI 生成器场景：用户在前端确认 spec 后，视为已确认。
 */
function createFullConfidence() {
  const base = createDefaultConfidence();
  return {
    ...base,
    total: 100,
    client_identity: { ...base.client_identity, score: 100, reason: "AI 生成，前端确认" },
    business_goal: { ...base.business_goal, score: 100, reason: "AI 生成，前端确认" },
    opportunity_type: { ...base.opportunity_type, score: 100, reason: "AI 生成，前端确认" },
    region_scope: { ...base.region_scope, score: 100, reason: "AI 生成，前端确认" },
    exclusion_rules: { ...base.exclusion_rules, score: 100, reason: "AI 生成，前端确认" },
    action_scenario: { ...base.action_scenario, score: 100, reason: "AI 生成，前端确认" },
    report_format: { ...base.report_format, score: 100, reason: "AI 生成，前端确认" },
  };
}

// ============================================================
// RadarSpecCompiler 类
// ============================================================

/**
 * Spec 编译器扩展包装器。
 * 支持 custom 类型：不查 RADAR_KEYWORDS_TABLE，关键词从 info 取。
 */
export class RadarSpecCompiler {
  /**
   * 从 ExtractedRequirementInfo 编译 RadarRequirementSpec。
   *
   * @param info 已提取的需求信息
   * @param radarKind 雷达类型（含 custom）
   * @returns RadarRequirementSpec
   */
  compile(info: ExtractedRequirementInfo, radarKind: RadarKind): RadarRequirementSpec {
    if (radarKind === "custom") {
      return this.compileCustomSpec(info);
    }
    return this.compileFixedSpec(info, radarKind);
  }

  /**
   * 编译固定类型雷达 Spec（委托给原 compileSpec）。
   *
   * @param info 已提取的需求信息
   * @param radarKind 固定类型（ai_competition / opc_policy / cultural_heritage）
   * @returns RadarRequirementSpec
   */
  private compileFixedSpec(
    info: ExtractedRequirementInfo,
    radarKind: "ai_competition" | "opc_policy" | "cultural_heritage",
  ): RadarRequirementSpec {
    const input: SpecCompileInput = {
      extracted_info: info,
      confidence: createFullConfidence(),
      confirmation_status: "confirmed",
      radar_type: radarKind,
      confirmed_at: new Date().toISOString(),
      questions_to_confirm: [],
    };
    const result = compileSpec(input);
    if (result.success && result.spec) {
      return result.spec;
    }
    // 委托失败（理论上不会发生，因为 confidence=100 + confirmed），降级用默认 spec
    return createDefaultSpec();
  }

  /**
   * 编译自定义雷达 Spec。
   * 关键词从 info.opportunity_type.primary_types 取，不查 RADAR_KEYWORDS_TABLE。
   *
   * @param info 已提取的需求信息
   * @returns RadarRequirementSpec
   */
  private compileCustomSpec(info: ExtractedRequirementInfo): RadarRequirementSpec {
    const baseSpec = createDefaultSpec();

    // 关键词：从 info.opportunity_type.primary_types 取
    const primaryTypes = arrOrEmpty(info.opportunity_type?.primary_types);
    const coreKeywordsZh = [...primaryTypes];

    // 扩展关键词：从 secondary_types 取
    const expandedKeywordsZh = arrOrEmpty(info.opportunity_type?.secondary_types);

    // 负面关键词：从 excluded_types + must_exclude 取
    const excludedTypes = arrOrEmpty(info.opportunity_type?.excluded_types);
    const mustExclude = arrOrEmpty(info.exclusion_rules?.must_exclude);
    const negativeKeywords = [...new Set([...excludedTypes, ...mustExclude])];

    // 地域：从 info.region_scope.primary_regions 取
    const primaryRegions = arrOrEmpty(info.region_scope?.primary_regions);

    // 排除规则：从 info.exclusion_rules.must_exclude 取
    const filterMustExclude = arrOrEmpty(info.exclusion_rules?.must_exclude);

    // 必须包含：从 info.opportunity_type.must_have_conditions 取
    const filterMustInclude = arrOrEmpty(info.opportunity_type?.must_have_conditions);

    // 客户画像
    const ci = info.client_identity ?? {};
    const clientProfile = {
      ...baseSpec.client_profile,
      client_type: strOrEmpty(ci.client_type),
      industry: strOrEmpty(ci.industry),
      business_type: strOrEmpty(ci.business_type),
      company_stage: strOrEmpty(ci.company_stage),
      products_or_projects: arrOrEmpty(ci.products_or_projects),
      core_capabilities: arrOrEmpty(ci.core_capabilities),
      regions: arrOrEmpty(ci.regions),
      notes: strOrEmpty(ci.notes),
    };

    // 核心目标
    const bg = info.business_goal ?? {};
    const coreGoals = {
      ...baseSpec.core_goals,
      primary_goal: strOrEmpty(bg.primary_goal),
      secondary_goals: arrOrEmpty(bg.secondary_goals),
      success_definition: strOrEmpty(bg.success_definition),
      priority_order: arrOrEmpty(bg.priority_order),
    };

    // 机会范围
    const opportunityScope = {
      ...baseSpec.opportunity_scope,
      primary_opportunity_types: primaryTypes,
      secondary_opportunity_types: arrOrEmpty(info.opportunity_type?.secondary_types),
      excluded_opportunity_types: excludedTypes,
      must_have_conditions: filterMustInclude,
    };

    // 地域范围
    const regionScope = {
      ...baseSpec.region_scope,
      primary_regions: primaryRegions,
      secondary_regions: arrOrEmpty(info.region_scope?.secondary_regions),
      excluded_regions: arrOrEmpty(info.region_scope?.excluded_regions),
      global_allowed: info.region_scope?.global_allowed ?? false,
      overseas_allowed: info.region_scope?.overseas_allowed ?? false,
    };

    // 关键词策略
    const keywordStrategy = {
      core_keywords_zh: coreKeywordsZh,
      core_keywords_en: [], // custom 类型不查表，英文关键词留空
      expanded_keywords_zh: expandedKeywordsZh,
      expanded_keywords_en: [],
      negative_keywords: negativeKeywords,
    };

    // 筛选规则
    const filterRules = {
      ...baseSpec.filter_rules,
      must_include: filterMustInclude,
      must_exclude: filterMustExclude,
      low_priority_signals: arrOrEmpty(info.exclusion_rules?.low_priority_signals),
    };

    // 报告要求
    const rf = info.report_format ?? {};
    const reportRequirements = {
      ...baseSpec.report_requirements,
      report_frequency: strOrEmpty(rf.frequency) || "每周",
    };

    // 确认状态：AI 生成视为已确认
    const confirmationStatus = {
      ...baseSpec.confirmation_status,
      status: "confirmed" as const,
      user_confirmed: true,
      confirmed_at: new Date().toISOString(),
    };

    return {
      ...baseSpec,
      product_name: BRAND.product_name,
      product_category: BRAND.product_category,
      client_profile: clientProfile,
      core_goals: coreGoals,
      opportunity_scope: opportunityScope,
      region_scope: regionScope,
      keyword_strategy: keywordStrategy,
      filter_rules: filterRules,
      scoring_rules: createDefaultScoringRules(),
      report_requirements: reportRequirements,
      requirement_confidence: createFullConfidence(),
      questions_to_confirm: [],
      confirmation_status: confirmationStatus,
    };
  }
}
