/**
 * 雷达方案 V1.0 生成器（radar_plan_generator）
 *
 * 来源：Task 010 第 4 节。
 *
 * 输入：RadarRequirementSpec（Task 009 编译产出）
 * 输出：符合 8 章节结构的雷达方案 Markdown 文档
 *
 * 规则：
 *   - 确认度 ≥ 95% 且状态为 confirmed / ready_for_radar_plan：生成正式雷达方案 V1.0
 *   - 确认度 < 95% 或未确认：拒绝生成，返回 error
 *   - 所有内容从 Spec 字段映射，不接入 LLM，不编造信息
 *   - 空字段标注「未明确」（字符串）/「暂无」（数组），不省略章节
 *
 * 雷达方案 ≠ 雷达报告。雷达方案是「这份雷达会怎么帮你盯」的配置说明书，不含具体机会。
 */

import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import { BRAND } from "../brand/constants";

// ============================================================
// 类型定义
// ============================================================

/** 雷达方案生成输入 */
export interface RadarPlanInput {
  /** Task 009 编译产出的 Spec */
  spec: RadarRequirementSpec;
  /** 雷达类型（影响标题展示） */
  radar_type: "ai_competition" | "opc_policy" | "cultural_heritage";
  /** 生成时间（ISO 字符串，可选，默认当前时间） */
  generated_at?: string;
}

/** 雷达方案生成结果 */
export interface RadarPlanResult {
  /** 是否成功生成 */
  success: boolean;
  /** 生成的 Markdown 雷达方案（success=true 时有值） */
  markdown: string | null;
  /** 失败原因（success=false 时有值） */
  error: string | null;
  /** 方案版本：V1.0（≥95% 时生成） */
  version: "V1.0" | null;
  /** 生成时间（ISO 字符串） */
  generated_at: string;
  /** 章节数量（固定 8） */
  sections_count: number;
}

// ============================================================
// 雷达类型映射表（内置常量，非品牌文案）
// ============================================================

const RADAR_TYPE_NAMES: Record<RadarPlanInput["radar_type"], string> = {
  ai_competition: "AI 赛事雷达",
  opc_policy: "OPC 政策雷达",
  cultural_heritage: "文创非遗雷达",
};

// ============================================================
// 辅助格式化函数
// ============================================================

/** 字符串格式化：空字符串 → 「未明确」 */
function fmtStr(v: string | undefined): string {
  return typeof v === "string" && v.trim() !== "" ? v : "未明确";
}

/** 字符串数组格式化：用「、」连接；空数组 → 「暂无」 */
function fmtArr(v: string[] | undefined): string {
  return Array.isArray(v) && v.length > 0 ? v.join("、") : "暂无";
}

/** 布尔值格式化：true → 「是」，false → 「否」 */
function fmtBool(v: boolean | undefined): string {
  return v ? "是" : "否";
}

/** 布尔值格式化（开启/关闭变体）：true → 「开启」，false → 「关闭」 */
function fmtBoolOnOff(v: boolean | undefined): string {
  return v ? "开启" : "关闭";
}

/** 布尔值格式化（启用/禁用变体）：true → 「启用」，false → 「禁用」 */
function fmtBoolEnabled(v: boolean | undefined): string {
  return v ? "启用" : "禁用";
}

/** 数字格式化：直接输出 */
function fmtNum(v: number | undefined): string {
  return typeof v === "number" ? String(v) : "未明确";
}

// ============================================================
// 各章节生成函数
// ============================================================

/** 元信息（标题 + 生成时间 + 雷达类型 + 确认度 + 确认状态） */
function buildHeader(
  spec: RadarRequirementSpec,
  radarTypeName: string,
  generatedAt: string,
): string {
  return [
    `# ${BRAND.product_name}｜${radarTypeName}方案 V1.0`,
    "",
    `生成时间：${generatedAt}`,
    `雷达类型：${radarTypeName}`,
    `需求确认度：${spec.requirement_confidence.total}%`,
    `确认状态：${spec.confirmation_status.status}`,
    "",
    "---",
  ].join("\n");
}

/** 章节 1：雷达概述（用户画像 + 核心目标） */
function buildSection1(spec: RadarRequirementSpec): string {
  const cp = spec.client_profile;
  const cg = spec.core_goals;
  return [
    "## 1. 雷达概述",
    "",
    "### 1.1 用户画像",
    `- 用户类型：${fmtStr(cp.client_type)}`,
    `- 所属行业：${fmtStr(cp.industry)}`,
    `- 业务类型：${fmtStr(cp.business_type)}`,
    `- 发展阶段：${fmtStr(cp.company_stage)}`,
    `- 核心能力：${fmtArr(cp.core_capabilities)}`,
    `- 代表项目：${fmtArr(cp.products_or_projects)}`,
    `- 主要地区：${fmtArr(cp.regions)}`,
    `- 备注：${fmtStr(cp.notes)}`,
    "",
    "### 1.2 核心目标",
    `- 第一目标：${fmtStr(cg.primary_goal)}`,
    `- 次要目标：${fmtArr(cg.secondary_goals)}`,
    `- 成功标准：${fmtStr(cg.success_definition)}`,
    `- 行动意图：${fmtArr(cg.action_intent)}`,
    `- 优先级排序：${fmtArr(cg.priority_order)}`,
  ].join("\n");
}

/** 章节 2：机会追踪范围 */
function buildSection2(spec: RadarRequirementSpec): string {
  const os = spec.opportunity_scope;
  return [
    "## 2. 机会追踪范围",
    `- 主要类型：${fmtArr(os.primary_opportunity_types)}`,
    `- 次要类型：${fmtArr(os.secondary_opportunity_types)}`,
    `- 排除类型：${fmtArr(os.excluded_opportunity_types)}`,
    `- 必须满足条件：${fmtArr(os.must_have_conditions)}`,
    `- 加分条件：${fmtArr(os.nice_to_have_conditions)}`,
  ].join("\n");
}

/** 章节 3：地域范围 */
function buildSection3(spec: RadarRequirementSpec): string {
  const rs = spec.region_scope;
  return [
    "## 3. 地域范围",
    `- 主要地区：${fmtArr(rs.primary_regions)}`,
    `- 次要地区：${fmtArr(rs.secondary_regions)}`,
    `- 排除地区：${fmtArr(rs.excluded_regions)}`,
    `- 允许全球范围：${fmtBool(rs.global_allowed)}`,
    `- 允许海外：${fmtBool(rs.overseas_allowed)}`,
  ].join("\n");
}

/** 章节 4：关键词策略 */
function buildSection4(spec: RadarRequirementSpec): string {
  const ks = spec.keyword_strategy;
  return [
    "## 4. 关键词策略",
    `- 核心关键词（中文）：${fmtArr(ks.core_keywords_zh)}`,
    `- 核心关键词（英文）：${fmtArr(ks.core_keywords_en)}`,
    `- 扩展关键词（中文）：${fmtArr(ks.expanded_keywords_zh)}`,
    `- 扩展关键词（英文）：${fmtArr(ks.expanded_keywords_en)}`,
    `- 负面关键词（排除用）：${fmtArr(ks.negative_keywords)}`,
  ].join("\n");
}

/** 章节 5：筛选与排除规则 */
function buildSection5(spec: RadarRequirementSpec): string {
  const fr = spec.filter_rules;
  return [
    "## 5. 筛选与排除规则",
    `- 必须包含：${fmtArr(fr.must_include)}`,
    `- 必须排除：${fmtArr(fr.must_exclude)}`,
    `- 高优先级信号：${fmtArr(fr.high_priority_signals)}`,
    `- 低优先级信号：${fmtArr(fr.low_priority_signals)}`,
    `- 需人工复核：${fmtArr(fr.requires_manual_review)}`,
  ].join("\n");
}

/** 章节 6：评分与分级规则 */
function buildSection6(spec: RadarRequirementSpec): string {
  const sr = spec.scoring_rules;
  const w = sr.weights;
  const m = sr.visible_level_mapping;
  const d = sr.level_definitions;
  return [
    "## 6. 评分与分级规则",
    "- 评分维度权重：",
    `  - 匹配度：${fmtNum(w.match_score)}`,
    `  - 业务价值：${fmtNum(w.business_value)}`,
    `  - 时效性：${fmtNum(w.timeliness)}`,
    `  - 可信度：${fmtNum(w.credibility)}`,
    `  - 可执行性：${fmtNum(w.actionability)}`,
    `  - 风险扣分：${fmtNum(w.risk_penalty)}`,
    "- 分级标准：",
    `  - S 级（${m.S}）：${d.S}`,
    `  - A 级（${m.A}）：${d.A}`,
    `  - B 级（${m.B}）：${d.B}`,
    `  - C 级（${m.C}）：${d.C}`,
    `- 前台显示等级：${fmtBoolOnOff(sr.visible_level_enabled)}`,
    `- 后台分数隐藏：${fmtBoolEnabled(sr.backend_score_enabled)}`,
  ].join("\n");
}

/** 章节 7：报告规格 */
function buildSection7(spec: RadarRequirementSpec): string {
  const rr = spec.report_requirements;
  const lines: string[] = [
    "## 7. 报告规格",
    `- 报告频率：${fmtStr(rr.report_frequency)}`,
    `- 报告格式：${fmtStr(rr.report_format)}`,
    `- 每期机会数量：${rr.min_items_per_report}-${rr.max_items_per_report} 条`,
    `- 报告标题前缀：${fmtStr(rr.report_title_prefix)}`,
    `- 必含章节（${rr.must_include_sections.length} 项）：`,
  ];
  rr.must_include_sections.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  lines.push(`- 机会卡片必含字段（${rr.opportunity_card_required_fields.length} 项）：${rr.opportunity_card_required_fields.join("、")}`);
  lines.push(`- 官方链接必填：${fmtBool(rr.link_required)}`);
  return lines.join("\n");
}

/** 章节 8：数据源策略 */
function buildSection8(spec: RadarRequirementSpec): string {
  const ss = spec.source_strategy;
  if (!ss) {
    return [
      "## 8. 数据源策略",
      "- （数据源策略未初始化）",
    ].join("\n");
  }
  const userSources = ss.user_supplied_sources.length > 0
    ? ss.user_supplied_sources.map((u) => `${u.source_name}(${u.source_url})`).join("、")
    : "暂无";
  return [
    "## 8. 数据源策略",
    `- 官方站点：${fmtArr(ss.official_sites)}`,
    `- 平台：${fmtArr(ss.platforms)}`,
    `- 搜索引擎：${fmtArr(ss.search_engines)}`,
    `- 社交媒体：${fmtArr(ss.social_media)}`,
    `- RSS 源：${fmtArr(ss.rss_sources)}`,
    `- 人工补充源：${fmtArr(ss.manual_sources)}`,
    `- 来源优先级：${fmtArr(ss.source_priority)}`,
    `- 来源透明展示：${fmtBoolOnOff(ss.source_transparency_enabled)}`,
    `- 用户补充信息源：${userSources}`,
  ].join("\n");
}

/** 确认信息 */
function buildConfirmationInfo(spec: RadarRequirementSpec): string {
  const rc = spec.requirement_confidence;
  const cs = spec.confirmation_status;
  return [
    "---",
    "",
    "## 确认信息",
    `- 需求确认度：${rc.total}%`,
    `- 确认状态：${cs.status}`,
    `- 用户已确认：${fmtBool(cs.user_confirmed)}`,
    `- 确认时间：${fmtStr(cs.confirmed_at)}`,
    `- 修订次数：${fmtNum(cs.revision_count)}`,
  ].join("\n");
}

/** 待确认问题 */
function buildQuestionsToConfirm(spec: RadarRequirementSpec): string {
  const qs = spec.questions_to_confirm;
  const lines: string[] = ["", "## 待确认问题"];
  if (qs.length === 0) {
    lines.push("暂无");
  } else {
    lines.push(`（${qs.length} 项）`);
    qs.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question}（优先级：${q.priority}）`);
    });
  }
  return lines.join("\n");
}

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 生成雷达方案 V1.0。
 *
 * 规则：
 *   - 确认度 ≥ 95% 且状态为 confirmed / ready_for_radar_plan：生成 V1.0
 *   - 确认度 < 95% 或未确认：拒绝生成，返回 error
 *
 * @param input 雷达方案生成输入
 * @returns 雷达方案生成结果
 */
export function generateRadarPlan(input: RadarPlanInput): RadarPlanResult {
  const { spec, radar_type } = input;
  const generatedAt = input.generated_at ?? new Date().toISOString();

  // 拒绝条件 1：确认度 < 95%
  if (spec.requirement_confidence.total < 95) {
    return {
      success: false,
      markdown: null,
      error: `需求确认度仅 ${spec.requirement_confidence.total}%，低于 95% 阈值，拒绝生成雷达方案。请继续补充需求信息至确认度 ≥ 95%。`,
      version: null,
      generated_at: generatedAt,
      sections_count: 0,
    };
  }

  // 拒绝条件 2：确认状态非 confirmed / ready_for_radar_plan
  const status = spec.confirmation_status.status;
  if (status !== "confirmed" && status !== "ready_for_radar_plan") {
    return {
      success: false,
      markdown: null,
      error: `确认状态为 "${status}"，用户尚未确认，拒绝生成雷达方案。仅 confirmed 或 ready_for_radar_plan 状态可生成。`,
      version: null,
      generated_at: generatedAt,
      sections_count: 0,
    };
  }

  const radarTypeName = RADAR_TYPE_NAMES[radar_type];

  // 组装 8 章节 + 元信息 + 确认信息 + 待确认问题
  const parts: string[] = [
    buildHeader(spec, radarTypeName, generatedAt),
    "",
    buildSection1(spec),
    "",
    buildSection2(spec),
    "",
    buildSection3(spec),
    "",
    buildSection4(spec),
    "",
    buildSection5(spec),
    "",
    buildSection6(spec),
    "",
    buildSection7(spec),
    "",
    buildSection8(spec),
    "",
    buildConfirmationInfo(spec),
    buildQuestionsToConfirm(spec),
  ];

  return {
    success: true,
    markdown: parts.join("\n"),
    error: null,
    version: "V1.0",
    generated_at: generatedAt,
    sections_count: 8,
  };
}
