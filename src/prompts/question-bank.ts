/**
 * 追问问题库
 *
 * 来源：02 号文档第 4 节 + Task 002 第 4.3 节。
 *
 * 把 02 号文档的"通用问题 + 三雷达专用问题"结构化为 QuestionToConfirm[]
 * （类型已在 Task 001 的 radar-requirement-spec.ts 中定义，此处 import 引用）。
 *
 * 每条问题含：question / why_it_matters / related_field / priority。
 * why_it_matters 关联到确认度 7 维度之一，说明该问题为何重要。
 */

import type { QuestionToConfirm } from "../schema/radar-requirement-spec";

/** 雷达类型（用于选择专用问题） */
export type RadarType = "general" | "ai_competition" | "opc_policy" | "cultural_heritage";

/**
 * 通用问题（8 条）
 * 对应 02 号文档第 4 节"通用问题"。
 */
export const GENERAL_QUESTIONS: QuestionToConfirm[] = [
  {
    question: "你是个人、团队、公司，还是机构？",
    why_it_matters: "明确用户类型直接决定 client_identity 维度得分，并影响可参赛/可申报的机会范围。",
    related_field: "client_profile.client_type",
    priority: "high",
  },
  {
    question: "你目前主要做什么业务？",
    why_it_matters: "行业判断是 client_identity 与 business_goal 的共同基础，影响机会匹配方向。",
    related_field: "client_profile.industry",
    priority: "high",
  },
  {
    question: "你最想通过这个雷达获得什么？",
    why_it_matters: "核心目标直接决定 business_goal 维度得分，是雷达设计的出发点。",
    related_field: "core_goals.primary_goal",
    priority: "high",
  },
  {
    question: "你希望雷达主要搜索哪几类机会？",
    why_it_matters: "机会类型清晰度是 opportunity_type 维度的核心，权重 20%。",
    related_field: "opportunity_scope.primary_opportunity_types",
    priority: "high",
  },
  {
    question: "哪些机会你完全不想看？",
    why_it_matters: "排除条件决定 exclusion_rules 维度，避免给用户推无效机会。",
    related_field: "opportunity_scope.excluded_opportunity_types",
    priority: "medium",
  },
  {
    question: "你只看中国大陆机会，还是也看海外机会？",
    why_it_matters: "地域范围直接决定 region_scope 维度得分，影响搜索边界。",
    related_field: "region_scope.primary_regions",
    priority: "medium",
  },
  {
    question: "你拿到机会后，是准备报名、申请、BD、收藏，还是转发给团队？",
    why_it_matters: "行动意图决定 action_scenario 维度，影响机会分级的可执行性判断。",
    related_field: "core_goals.action_intent",
    priority: "medium",
  },
  {
    question: "你希望每周收到一份报告，还是每天更新？",
    why_it_matters: "交付频率决定 report_format 维度，影响报告生成节奏。",
    related_field: "report_requirements.report_frequency",
    priority: "low",
  },
];

/**
 * AI 赛事雷达专用问题（7 条）
 * 对应 02 号文档第 4 节"AI 赛事雷达专用问题"。
 */
export const AI_COMPETITION_QUESTIONS: QuestionToConfirm[] = [
  {
    question: "你更关注 AI 视频、AI 动漫、AI 游戏、AI 应用，还是 AI Agent？",
    why_it_matters: "细化机会子类型，把 opportunity_type 从大类收敛到可搜索的具体赛道。",
    related_field: "opportunity_scope.primary_opportunity_types",
    priority: "high",
  },
  {
    question: "你是个人参赛，还是团队 / 公司参赛？",
    why_it_matters: "参赛身份细化 client_identity，并决定哪些比赛符合资格。",
    related_field: "client_profile.client_type",
    priority: "high",
  },
  {
    question: "你希望优先找奖金高的比赛，还是适合快速做 Demo 的比赛？",
    why_it_matters: "优先级排序决定 business_goal 的成功标准与机会分级的 business_value 权重细化。",
    related_field: "core_goals.priority_order",
    priority: "high",
  },
  {
    question: "你是否接受英文比赛和海外平台？",
    why_it_matters: "明确海外范围，细化 region_scope 的 overseas_allowed，影响搜索语种与平台。",
    related_field: "region_scope.overseas_allowed",
    priority: "medium",
  },
  {
    question: "你是否希望比赛必须支持使用 Qwen、DeepSeek、GPT、Trae、Codex 等工具？",
    why_it_matters: "must_have_conditions 细化 opportunity_scope，提升匹配精度。",
    related_field: "opportunity_scope.must_have_conditions",
    priority: "medium",
  },
  {
    question: "你是否关注比赛是否要求开源？",
    why_it_matters: "开源要求作为筛选信号，影响 filter_rules.must_include 的判定。",
    related_field: "filter_rules.must_include",
    priority: "low",
  },
  {
    question: "你是否希望优先找截止时间在 30 天以上的比赛？",
    why_it_matters: "时效偏好决定 high_priority_signals，影响机会分级与排序。",
    related_field: "filter_rules.high_priority_signals",
    priority: "low",
  },
];

/**
 * OPC 政策雷达专用问题（7 条）
 * 对应 02 号文档第 4 节"OPC 政策雷达专用问题"。
 */
export const OPC_POLICY_QUESTIONS: QuestionToConfirm[] = [
  {
    question: "你的公司注册在哪个城市？",
    why_it_matters: "政策强依赖注册地，城市信息是 region_scope 与 client_profile.regions 的关键。",
    related_field: "client_profile.regions",
    priority: "high",
  },
  {
    question: "你是个人创业、个体户、有限公司，还是准备注册公司？",
    why_it_matters: "主体类型决定可申报政策范围，细化 client_identity 与 business_type。",
    related_field: "client_profile.business_type",
    priority: "high",
  },
  {
    question: "你主要做 AI、文创、科技、跨境电商、教育，还是其他行业？",
    why_it_matters: "行业决定可申报政策类别，是 client_identity 与 opportunity_type 的共同基础。",
    related_field: "client_profile.industry",
    priority: "high",
  },
  {
    question: "你目前最想找创业补贴、社保补贴、人才补贴、科技项目，还是场地补贴？",
    why_it_matters: "政策子类型直接收敛 opportunity_type，权重 20%。",
    related_field: "opportunity_scope.primary_opportunity_types",
    priority: "high",
  },
  {
    question: "你是否已经有营业执照、社保、纳税记录？",
    why_it_matters: "已有资质决定可申报政策，细化 client_profile.current_assets 与资格匹配。",
    related_field: "client_profile.current_assets",
    priority: "medium",
  },
  {
    question: "你希望优先找「容易申请」的政策，还是「金额更高」的政策？",
    why_it_matters: "优先级排序决定 business_goal 的成功标准与机会分级的 business_value 权重细化。",
    related_field: "core_goals.priority_order",
    priority: "medium",
  },
  {
    question: "你是否只关注大湾区，还是全国政策也可以？",
    why_it_matters: "地域范围决定 region_scope，政策强依赖地域，影响搜索边界。",
    related_field: "region_scope.primary_regions",
    priority: "medium",
  },
];

/**
 * 文创 / 非遗雷达专用问题（7 条）
 * 对应 02 号文档第 4 节"文创 / 非遗机会雷达专用问题"。
 */
export const CULTURAL_HERITAGE_QUESTIONS: QuestionToConfirm[] = [
  {
    question: "你主要做哪类文创或非遗产品？",
    why_it_matters: "产品类型决定 client_identity 的细节，并影响可匹配的赛事/展会类别。",
    related_field: "client_profile.products_or_projects",
    priority: "high",
  },
  {
    question: "你希望找比赛、展会、政策、品牌合作，还是城市礼物征集？",
    why_it_matters: "机会子类型直接收敛 opportunity_type，权重 20%。",
    related_field: "opportunity_scope.primary_opportunity_types",
    priority: "high",
  },
  {
    question: "你是个人设计师、工作室，还是公司参赛？",
    why_it_matters: "参赛身份细化 client_identity，并决定哪些赛事符合资格。",
    related_field: "client_profile.client_type",
    priority: "high",
  },
  {
    question: "你是否有非遗资质、获奖经历、企业主体？",
    why_it_matters: "资质与能力决定可申报机会，细化 client_profile.core_capabilities。",
    related_field: "client_profile.core_capabilities",
    priority: "medium",
  },
  {
    question: "你更重视奖金、政府背书、曝光，还是实际合作机会？",
    why_it_matters: "价值偏好决定 business_goal 的成功标准与机会分级的 business_value 权重细化。",
    related_field: "core_goals.priority_order",
    priority: "medium",
  },
  {
    question: "学生类比赛是否要排除？",
    why_it_matters: "排除条件决定 exclusion_rules，避免推送不符合身份的机会。",
    related_field: "opportunity_scope.excluded_opportunity_types",
    priority: "medium",
  },
  {
    question: "你是否接受需要实物寄送或线下参展的机会？",
    why_it_matters: "交付方式偏好影响 filter_rules.must_include 的判定，决定机会是否可执行。",
    related_field: "filter_rules.must_include",
    priority: "low",
  },
];

/**
 * 根据雷达类型获取专用问题 + 通用问题。
 *
 * - general：仅返回通用问题 8 条
 * - ai_competition / opc_policy / cultural_heritage：返回通用 8 + 专用 7 = 15 条
 *
 * @param radarType 雷达类型
 */
export function getQuestionsForRadarType(radarType: RadarType): QuestionToConfirm[] {
  const general = GENERAL_QUESTIONS;
  switch (radarType) {
    case "ai_competition":
      return [...general, ...AI_COMPETITION_QUESTIONS];
    case "opc_policy":
      return [...general, ...OPC_POLICY_QUESTIONS];
    case "cultural_heritage":
      return [...general, ...CULTURAL_HERITAGE_QUESTIONS];
    case "general":
    default:
      return general;
  }
}
