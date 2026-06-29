/**
 * RadarRequirementSpec —— 本产品（品牌名见 ../brand/constants）的核心数据契约。
 *
 * 来源：03 号文档《RadarRequirementSpec Schema V0.12》第 17 节"V0.2 最小可用字段"
 *       + Task 001 第 4.3 节。
 *
 * 本文件提供：
 *   1. TypeScript 类型定义（开发期类型安全）
 *   2. JSON Schema（运行时校验，后续 LLM 结构化输出可复用）
 *   3. 默认工厂函数（引用品牌常量，避免硬编码）
 *   4. source_strategy 搜索引擎自演进预留字段（V0.4/V0.8 消费）
 */

import { BRAND, REPORT_TITLE_PREFIX } from "../brand/constants";
import type { RequirementConfidence } from "./requirement-confidence";
import type { ScoringRules } from "./scoring-rules";

// ---------------------------------------------------------------------------
// 枚举与常量
// ---------------------------------------------------------------------------

/** 核心目标中的行动意图（取自 03 号文档第 3 节） */
export const ACTION_INTENTS = [
  "报名比赛",
  "申请补贴",
  "申报项目",
  "寻找客户",
  "寻找合作",
  "寻找招聘线索",
  "保存观察",
  "转发团队",
  "准备材料",
  "发布内容",
] as const;
export type ActionIntent = (typeof ACTION_INTENTS)[number];

/** 确认状态（取自 03 号文档第 14 节） */
export const CONFIRMATION_STATUSES = [
  "draft",
  "needs_more_info",
  "ready_for_confirmation_card",
  "confirmation_card_generated",
  "user_revision_requested",
  "confirmed",
  "ready_for_radar_plan",
] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

/** 待确认问题优先级 */
export const QUESTION_PRIORITIES = ["high", "medium", "low"] as const;
export type QuestionPriority = (typeof QUESTION_PRIORITIES)[number];

/** 报告必含章节（取自 03 号文档第 11 节） */
export const MUST_INCLUDE_SECTIONS = [
  "本周一句话判断",
  "本周 S 级机会",
  "本周 A 级机会",
  "本周 B 级机会",
  "即将截止机会",
  "机会详情卡片",
  "本周建议行动",
  "不建议投入的机会",
  "下周继续追踪",
] as const;

/** 机会卡片必含字段（取自 03 号文档第 11 节） */
export const OPPORTUNITY_CARD_REQUIRED_FIELDS = [
  "机会名称",
  "类型",
  "主办方 / 发布方",
  "地区",
  "截止日期",
  "奖励 / 补贴 / 价值",
  "适合对象",
  "推荐等级",
  "为什么适合你",
  "下一步行动建议",
  "官方来源链接",
  "报名链接",
  "联系方式",
  "风险提醒",
] as const;

// ---------------------------------------------------------------------------
// 子结构类型
// ---------------------------------------------------------------------------

/** 客户画像（03 号文档第 2 节） */
export interface ClientProfile {
  client_name: string;
  client_type: string;
  industry: string;
  business_type: string;
  company_stage: string;
  products_or_projects: string[];
  target_users: string[];
  core_capabilities: string[];
  current_assets: string[];
  regions: string[];
  notes: string;
}

/** 核心目标（03 号文档第 3 节） */
export interface CoreGoals {
  primary_goal: string;
  secondary_goals: string[];
  success_definition: string;
  action_intent: ActionIntent[];
  priority_order: string[];
}

/** 机会范围（03 号文档第 4 节） */
export interface OpportunityScope {
  primary_opportunity_types: string[];
  secondary_opportunity_types: string[];
  excluded_opportunity_types: string[];
  must_have_conditions: string[];
  nice_to_have_conditions: string[];
}

/** 地域范围（03 号文档第 5 节） */
export interface RegionScope {
  primary_regions: string[];
  secondary_regions: string[];
  excluded_regions: string[];
  global_allowed: boolean;
  overseas_allowed: boolean;
}

/** 关键词策略（03 号文档第 7 节） */
export interface KeywordStrategy {
  core_keywords_zh: string[];
  core_keywords_en: string[];
  expanded_keywords_zh: string[];
  expanded_keywords_en: string[];
  negative_keywords: string[];
}

/** 用户补充信息源单项（搜索引擎自演进预留，Task 001 第 10 节） */
export interface UserSuppliedSource {
  source_name: string;
  source_url: string;
  added_at: string;
  contributed_by: string;
}

/**
 * 数据源策略（03 号文档第 8 节 + Task 001 第 10 节预留字段）。
 * sources_used_in_report / user_supplied_sources / source_transparency_enabled
 * 三个字段本任务只做类型定义，不实现逻辑，V0.4 报告生成器与 V0.8 搜索 API 接入时消费。
 */
export interface SourceStrategy {
  official_sites: string[];
  platforms: string[];
  search_engines: string[];
  social_media: string[];
  rss_sources: string[];
  manual_sources: string[];
  source_priority: string[];
  /** 本次报告实际用到的数据源（来源透明展示用，V0.4 起填充） */
  sources_used_in_report: string[];
  /** 用户主动补充的信息源，后续每次搜索都会纳入 */
  user_supplied_sources: UserSuppliedSource[];
  /** 是否在报告中展示数据源清单，默认 true */
  source_transparency_enabled: boolean;
}

/** 筛选规则（03 号文档第 9 节） */
export interface FilterRules {
  must_include: string[];
  must_exclude: string[];
  low_priority_signals: string[];
  high_priority_signals: string[];
  requires_manual_review: string[];
}

/** 报告要求（03 号文档第 11 节） */
export interface ReportRequirements {
  report_format: string;
  report_title_prefix: string;
  report_frequency: string;
  max_items_per_report: number;
  min_items_per_report: number;
  must_include_sections: string[];
  opportunity_card_required_fields: string[];
  link_required: boolean;
  contact_required_if_available: boolean;
  deadline_required_if_available: boolean;
}

/** 确认状态（03 号文档第 14 节） */
export interface ConfirmationStatusInfo {
  status: ConfirmationStatus;
  user_confirmed: boolean;
  confirmed_at: string;
  last_user_feedback: string;
  revision_count: number;
}

/** 待确认问题（03 号文档第 15 节） */
export interface QuestionToConfirm {
  question: string;
  why_it_matters: string;
  related_field: string;
  priority: QuestionPriority;
}

/**
 * RadarRequirementSpec 顶层结构（V0.2 最小可用字段集 + source_strategy 预留）。
 * 最小字段集对应 03 号文档第 17 节。
 */
export interface RadarRequirementSpec {
  /** 引用品牌常量 BRAND.product_name */
  product_name: string;
  /** 引用品牌常量 BRAND.product_category */
  product_category: string;
  client_profile: ClientProfile;
  core_goals: CoreGoals;
  opportunity_scope: OpportunityScope;
  region_scope: RegionScope;
  keyword_strategy: KeywordStrategy;
  /** 搜索引擎自演进预留（V0.2 可选，V0.4 起消费） */
  source_strategy?: SourceStrategy;
  filter_rules: FilterRules;
  scoring_rules: ScoringRules;
  report_requirements: ReportRequirements;
  requirement_confidence: RequirementConfidence;
  questions_to_confirm: QuestionToConfirm[];
  confirmation_status: ConfirmationStatusInfo;
}

// ---------------------------------------------------------------------------
// JSON Schema（运行时校验 / LLM 结构化输出约束）
// ---------------------------------------------------------------------------

const stringArray = { type: "array", items: { type: "string" } } as const;

const confidenceDimensionSchema = {
  type: "object",
  required: ["score", "weight", "reason"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    weight: { type: "number", minimum: 0, maximum: 100 },
    reason: { type: "string" },
  },
  additionalProperties: true,
} as const;

/**
 * RadarRequirementSpec 的 JSON Schema（V0.2 最小可用字段集）。
 * product_name / product_category / report_title_prefix 引用品牌常量，
 * 全项目不硬编码品牌字符串。
 */
export const radarRequirementSpecSchema = {
  type: "object",
  required: [
    "product_name",
    "product_category",
    "client_profile",
    "core_goals",
    "opportunity_scope",
    "region_scope",
    "keyword_strategy",
    "filter_rules",
    "scoring_rules",
    "report_requirements",
    "requirement_confidence",
    "questions_to_confirm",
    "confirmation_status",
  ],
  properties: {
    product_name: { const: BRAND.product_name },
    product_category: { const: BRAND.product_category },
    client_profile: {
      type: "object",
      required: [
        "client_name",
        "client_type",
        "industry",
        "business_type",
        "company_stage",
        "products_or_projects",
        "target_users",
        "core_capabilities",
        "current_assets",
        "regions",
        "notes",
      ],
      properties: {
        client_name: { type: "string" },
        client_type: { type: "string" },
        industry: { type: "string" },
        business_type: { type: "string" },
        company_stage: { type: "string" },
        products_or_projects: stringArray,
        target_users: stringArray,
        core_capabilities: stringArray,
        current_assets: stringArray,
        regions: stringArray,
        notes: { type: "string" },
      },
      additionalProperties: true,
    },
    core_goals: {
      type: "object",
      required: ["primary_goal", "secondary_goals", "success_definition", "action_intent", "priority_order"],
      properties: {
        primary_goal: { type: "string" },
        secondary_goals: stringArray,
        success_definition: { type: "string" },
        action_intent: {
          type: "array",
          items: { enum: ACTION_INTENTS },
        },
        priority_order: stringArray,
      },
      additionalProperties: true,
    },
    opportunity_scope: {
      type: "object",
      required: [
        "primary_opportunity_types",
        "secondary_opportunity_types",
        "excluded_opportunity_types",
        "must_have_conditions",
        "nice_to_have_conditions",
      ],
      properties: {
        primary_opportunity_types: stringArray,
        secondary_opportunity_types: stringArray,
        excluded_opportunity_types: stringArray,
        must_have_conditions: stringArray,
        nice_to_have_conditions: stringArray,
      },
      additionalProperties: true,
    },
    region_scope: {
      type: "object",
      required: ["primary_regions", "secondary_regions", "excluded_regions", "global_allowed", "overseas_allowed"],
      properties: {
        primary_regions: stringArray,
        secondary_regions: stringArray,
        excluded_regions: stringArray,
        global_allowed: { type: "boolean" },
        overseas_allowed: { type: "boolean" },
      },
      additionalProperties: true,
    },
    keyword_strategy: {
      type: "object",
      required: ["core_keywords_zh", "core_keywords_en", "expanded_keywords_zh", "expanded_keywords_en", "negative_keywords"],
      properties: {
        core_keywords_zh: stringArray,
        core_keywords_en: stringArray,
        expanded_keywords_zh: stringArray,
        expanded_keywords_en: stringArray,
        negative_keywords: stringArray,
      },
      additionalProperties: true,
    },
    source_strategy: {
      type: "object",
      properties: {
        official_sites: stringArray,
        platforms: stringArray,
        search_engines: stringArray,
        social_media: stringArray,
        rss_sources: stringArray,
        manual_sources: stringArray,
        source_priority: stringArray,
        sources_used_in_report: stringArray,
        user_supplied_sources: {
          type: "array",
          items: {
            type: "object",
            required: ["source_name", "source_url", "added_at", "contributed_by"],
            properties: {
              source_name: { type: "string" },
              source_url: { type: "string" },
              added_at: { type: "string" },
              contributed_by: { type: "string" },
            },
            additionalProperties: true,
          },
        },
        source_transparency_enabled: { type: "boolean" },
      },
      additionalProperties: true,
    },
    filter_rules: {
      type: "object",
      required: ["must_include", "must_exclude", "low_priority_signals", "high_priority_signals", "requires_manual_review"],
      properties: {
        must_include: stringArray,
        must_exclude: stringArray,
        low_priority_signals: stringArray,
        high_priority_signals: stringArray,
        requires_manual_review: stringArray,
      },
      additionalProperties: true,
    },
    scoring_rules: {
      type: "object",
      required: ["backend_score_enabled", "visible_level_enabled", "weights", "visible_level_mapping", "level_definitions"],
      properties: {
        backend_score_enabled: { type: "boolean" },
        visible_level_enabled: { type: "boolean" },
        weights: {
          type: "object",
          required: ["match_score", "business_value", "timeliness", "credibility", "actionability", "risk_penalty"],
          properties: {
            match_score: { type: "number" },
            business_value: { type: "number" },
            timeliness: { type: "number" },
            credibility: { type: "number" },
            actionability: { type: "number" },
            risk_penalty: { type: "number" },
          },
          additionalProperties: true,
        },
        visible_level_mapping: {
          type: "object",
          required: ["S", "A", "B", "C", "hidden"],
          properties: {
            S: { type: "string" },
            A: { type: "string" },
            B: { type: "string" },
            C: { type: "string" },
            hidden: { type: "string" },
          },
          additionalProperties: true,
        },
        level_definitions: {
          type: "object",
          required: ["S", "A", "B", "C", "hidden"],
          properties: {
            S: { type: "string" },
            A: { type: "string" },
            B: { type: "string" },
            C: { type: "string" },
            hidden: { type: "string" },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    report_requirements: {
      type: "object",
      required: [
        "report_format",
        "report_title_prefix",
        "report_frequency",
        "max_items_per_report",
        "min_items_per_report",
        "must_include_sections",
        "opportunity_card_required_fields",
        "link_required",
        "contact_required_if_available",
        "deadline_required_if_available",
      ],
      properties: {
        report_format: { type: "string" },
        // 仅校验类型为 string；具体取值由 createDefaultSpec 引用 REPORT_TITLE_PREFIX 保证，
        // 不做 const 强校验以避免全角分隔符"｜"在不同来源下的字符差异导致误报。
        report_title_prefix: { type: "string" },
        report_frequency: { type: "string" },
        max_items_per_report: { type: "number" },
        min_items_per_report: { type: "number" },
        must_include_sections: { type: "array", items: { type: "string" }, minItems: 1 },
        opportunity_card_required_fields: { type: "array", items: { type: "string" }, minItems: 1 },
        link_required: { type: "boolean" },
        contact_required_if_available: { type: "boolean" },
        deadline_required_if_available: { type: "boolean" },
      },
      additionalProperties: true,
    },
    requirement_confidence: {
      type: "object",
      required: [
        "total",
        "client_identity",
        "business_goal",
        "opportunity_type",
        "region_scope",
        "exclusion_rules",
        "action_scenario",
        "report_format",
      ],
      properties: {
        total: { type: "number", minimum: 0, maximum: 100 },
        client_identity: confidenceDimensionSchema,
        business_goal: confidenceDimensionSchema,
        opportunity_type: confidenceDimensionSchema,
        region_scope: confidenceDimensionSchema,
        exclusion_rules: confidenceDimensionSchema,
        action_scenario: confidenceDimensionSchema,
        report_format: confidenceDimensionSchema,
      },
      additionalProperties: true,
    },
    questions_to_confirm: {
      type: "array",
      items: {
        type: "object",
        required: ["question", "why_it_matters", "related_field", "priority"],
        properties: {
          question: { type: "string" },
          why_it_matters: { type: "string" },
          related_field: { type: "string" },
          priority: { enum: QUESTION_PRIORITIES },
        },
        additionalProperties: true,
      },
    },
    confirmation_status: {
      type: "object",
      required: ["status", "user_confirmed", "confirmed_at", "last_user_feedback", "revision_count"],
      properties: {
        status: { enum: CONFIRMATION_STATUSES },
        user_confirmed: { type: "boolean" },
        confirmed_at: { type: "string" },
        last_user_feedback: { type: "string" },
        revision_count: { type: "number" },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;

// ---------------------------------------------------------------------------
// 默认工厂函数（引用品牌常量）
// ---------------------------------------------------------------------------

/** 生成一份带品牌常量与默认评分/报告配置的空 Spec 骨架 */
export function createDefaultSpec(): RadarRequirementSpec {
  return {
    product_name: BRAND.product_name,
    product_category: BRAND.product_category,
    client_profile: {
      client_name: "",
      client_type: "",
      industry: "",
      business_type: "",
      company_stage: "",
      products_or_projects: [],
      target_users: [],
      core_capabilities: [],
      current_assets: [],
      regions: [],
      notes: "",
    },
    core_goals: {
      primary_goal: "",
      secondary_goals: [],
      success_definition: "",
      action_intent: [],
      priority_order: [],
    },
    opportunity_scope: {
      primary_opportunity_types: [],
      secondary_opportunity_types: [],
      excluded_opportunity_types: [],
      must_have_conditions: [],
      nice_to_have_conditions: [],
    },
    region_scope: {
      primary_regions: [],
      secondary_regions: [],
      excluded_regions: [],
      global_allowed: false,
      overseas_allowed: false,
    },
    keyword_strategy: {
      core_keywords_zh: [],
      core_keywords_en: [],
      expanded_keywords_zh: [],
      expanded_keywords_en: [],
      negative_keywords: [],
    },
    source_strategy: {
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
    },
    filter_rules: {
      must_include: [],
      must_exclude: [],
      low_priority_signals: [],
      high_priority_signals: [],
      requires_manual_review: [],
    },
    scoring_rules: {
      backend_score_enabled: true,
      visible_level_enabled: true,
      weights: { match_score: 30, business_value: 25, timeliness: 20, credibility: 15, actionability: 10, risk_penalty: -20 },
      // V1.3 P0 修复：与 scoring-rules.ts 的 VISIBLE_LEVEL_MAPPING 阈值统一为 90/80/65/50+D
      visible_level_mapping: { S: "90-100", A: "80-89", B: "65-79", C: "50-64", D: "0-49", hidden: "不展示" },
      level_definitions: {
        S: "强烈推荐，优先行动",
        A: "高价值机会，建议认真考虑",
        B: "可关注，适合收藏或观察",
        C: "低优先级，仅供参考",
        D: "不推荐",
        hidden: "默认不主动展示",
      },
    },
    report_requirements: {
      report_format: "markdown",
      report_title_prefix: REPORT_TITLE_PREFIX,
      report_frequency: "weekly",
      max_items_per_report: 10,
      min_items_per_report: 5,
      must_include_sections: [...MUST_INCLUDE_SECTIONS],
      opportunity_card_required_fields: [...OPPORTUNITY_CARD_REQUIRED_FIELDS],
      link_required: true,
      contact_required_if_available: true,
      deadline_required_if_available: true,
    },
    requirement_confidence: {
      total: 0,
      client_identity: { score: 0, weight: 15, reason: "" },
      business_goal: { score: 0, weight: 20, reason: "" },
      opportunity_type: { score: 0, weight: 20, reason: "" },
      region_scope: { score: 0, weight: 10, reason: "" },
      exclusion_rules: { score: 0, weight: 10, reason: "" },
      action_scenario: { score: 0, weight: 15, reason: "" },
      report_format: { score: 0, weight: 10, reason: "" },
    },
    questions_to_confirm: [],
    confirmation_status: {
      status: "draft",
      user_confirmed: false,
      confirmed_at: "",
      last_user_feedback: "",
      revision_count: 0,
    },
  };
}
