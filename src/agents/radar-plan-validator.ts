/**
 * 雷达方案校验器（radar_plan_validator）
 *
 * 来源：Task 011 第 4 节。
 *
 * 输入：RadarPlanResult（Task 010 产出）+ RadarRequirementSpec（用于字段缺失检测）
 * 输出：校验报告 Markdown + 结构化校验结果
 *
 * 校验内容：
 *   1. 结构完整性（8 章节是否齐全）
 *   2. 缺失项检测（critical / warning / info 三级）
 *   3. 需人工复核项（filter_rules + questions_to_confirm + source_strategy 空值）
 *   4. 品牌合规（标题含品牌名/版本号/雷达名称）
 *
 * 不重复实现 validateSpec：本模块校验的是雷达方案的可执行性，不是 Spec 结构合法性。
 */

import type { RadarPlanResult } from "./radar-plan-generator";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import { BRAND } from "../brand/constants";

// ============================================================
// 类型定义
// ============================================================

/** 问题严重程度 */
export type IssueSeverity = "critical" | "warning" | "info";

/** 单个问题项 */
export interface ValidationIssue {
  /** 严重程度 */
  severity: IssueSeverity;
  /** 字段路径（如 "client_profile.client_type"） */
  field_path: string;
  /** 问题描述 */
  message: string;
  /** 所属章节（1-8） */
  section: number;
}

/** 需人工复核项 */
export interface ManualReviewItem {
  /** 复核内容 */
  content: string;
  /** 来源（filter_rules / questions_to_confirm / source_strategy） */
  source: string;
  /** 相关字段路径 */
  related_field: string;
}

/** 校验输入 */
export interface RadarPlanValidationInput {
  /** Task 010 产出的雷达方案结果 */
  plan_result: RadarPlanResult;
  /** 对应的 Spec（用于字段缺失检测） */
  spec: RadarRequirementSpec;
}

/** 校验结果 */
export interface RadarPlanValidationResult {
  /** 校验是否通过（无 critical 项且结构完整） */
  valid: boolean;
  /** 结构完整性 */
  structure: {
    sections_count: number;
    sections_expected: number;
    sections_complete: boolean;
    missing_sections: string[];
  };
  /** 缺失项列表（按 severity 分组） */
  issues: ValidationIssue[];
  /** 需人工复核项 */
  manual_review_items: ManualReviewItem[];
  /** 品牌合规检查 */
  brand_compliance: {
    has_product_name: boolean;
    has_version: boolean;
    has_radar_name: boolean;
  };
  /** 汇总统计 */
  summary: {
    total_issues: number;
    critical_count: number;
    warning_count: number;
    info_count: number;
    manual_review_count: number;
  };
  /** 校验报告 Markdown */
  report_markdown: string;
}

// ============================================================
// 常量：缺失项检测规则
// ============================================================

interface FieldCheckRule {
  path: string;
  section: number;
  message: string;
}

/** critical 字段（5 个）—— 雷达核心字段缺失，无法有效执行 */
const CRITICAL_FIELDS: FieldCheckRule[] = [
  { path: "client_profile.client_type", section: 1, message: "用户类型缺失，雷达无法定位目标用户" },
  { path: "core_goals.primary_goal", section: 1, message: "第一目标缺失，雷达无法确定追踪方向" },
  { path: "opportunity_scope.primary_opportunity_types", section: 2, message: "主要机会类型缺失，雷达无法筛选" },
  { path: "region_scope.primary_regions", section: 3, message: "主要地区缺失，雷达无法限定地域" },
  { path: "keyword_strategy.core_keywords_zh", section: 4, message: "核心关键词缺失，雷达无法搜索" },
];

/** warning 字段（6 个）—— 影响执行质量但不致命 */
const WARNING_FIELDS: FieldCheckRule[] = [
  { path: "client_profile.industry", section: 1, message: "行业信息缺失，影响匹配精度" },
  { path: "client_profile.business_type", section: 1, message: "业务类型缺失，影响匹配精度" },
  { path: "core_goals.success_definition", section: 1, message: "成功标准缺失，影响评分基准" },
  { path: "core_goals.action_intent", section: 1, message: "行动意图缺失，影响行动建议" },
  { path: "filter_rules.must_include", section: 5, message: "必须包含条件缺失，筛选规则不完整" },
  { path: "filter_rules.must_exclude", section: 5, message: "必须排除条件缺失，筛选规则不完整" },
];

/** info 字段（5 个）—— 可选字段，缺失不影响执行 */
const INFO_FIELDS: FieldCheckRule[] = [
  { path: "client_profile.notes", section: 1, message: "备注缺失" },
  { path: "opportunity_scope.secondary_opportunity_types", section: 2, message: "次要机会类型缺失" },
  { path: "opportunity_scope.nice_to_have_conditions", section: 2, message: "加分条件缺失" },
  { path: "client_profile.current_assets", section: 1, message: "现有资产缺失" },
  { path: "client_profile.target_users", section: 1, message: "目标用户缺失" },
];

/** 8 章节标题关键词（用于结构完整性检测） */
const SECTION_HEADERS = [
  "## 1.",
  "## 2.",
  "## 3.",
  "## 4.",
  "## 5.",
  "## 6.",
  "## 7.",
  "## 8.",
];

/** 雷达名称关键词（用于品牌合规检测） */
const RADAR_NAME_KEYWORDS = ["AI 赛事雷达", "OPC 政策雷达", "文创非遗雷达"];

// ============================================================
// 辅助函数
// ============================================================

/** 字符串是否为空 */
function isEmptyStr(v: string | undefined): boolean {
  return typeof v !== "string" || v.trim() === "";
}

/** 数组是否为空 */
function isEmptyArr(v: unknown[] | undefined): boolean {
  return !Array.isArray(v) || v.length === 0;
}

/**
 * 按 path 检查 Spec 字段是否缺失。
 * path 格式：`a.b.c`，按点分隔逐层取值。
 * 字符串空 / 数组空 / undefined 均视为缺失。
 */
function isFieldMissing(spec: RadarRequirementSpec, path: string): boolean {
  const parts = path.split(".");
  let current: unknown = spec;
  for (const p of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return true;
    }
    current = (current as Record<string, unknown>)[p];
  }
  // 字符串空判定
  if (typeof current === "string") return isEmptyStr(current);
  // 数组空判定
  if (Array.isArray(current)) return isEmptyArr(current);
  // undefined / null
  return current === undefined || current === null;
}

/** 生成校验结论文本 */
function getValidationConclusion(
  valid: boolean,
  criticalCount: number,
  warningCount: number,
): string {
  if (!valid || criticalCount > 0) return "不通过";
  if (warningCount > 0) return "有警告";
  return "通过";
}

/** 生成校验结果标签（PASS / WARN / FAIL） */
function getValidationLabel(
  valid: boolean,
  criticalCount: number,
  warningCount: number,
): string {
  if (!valid || criticalCount > 0) return "FAIL";
  if (warningCount > 0) return "WARN";
  return "PASS";
}

// ============================================================
// 结构完整性检测
// ============================================================

function checkStructure(markdown: string): RadarPlanValidationResult["structure"] {
  const missing: string[] = [];
  let count = 0;
  for (let i = 0; i < SECTION_HEADERS.length; i++) {
    if (markdown.includes(SECTION_HEADERS[i])) {
      count++;
    } else {
      missing.push(`章节 ${i + 1}`);
    }
  }
  return {
    sections_count: count,
    sections_expected: 8,
    sections_complete: count === 8,
    missing_sections: missing,
  };
}

// ============================================================
// 缺失项检测
// ============================================================

function detectIssues(spec: RadarRequirementSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const rule of CRITICAL_FIELDS) {
    if (isFieldMissing(spec, rule.path)) {
      issues.push({
        severity: "critical",
        field_path: rule.path,
        message: rule.message,
        section: rule.section,
      });
    }
  }

  for (const rule of WARNING_FIELDS) {
    if (isFieldMissing(spec, rule.path)) {
      issues.push({
        severity: "warning",
        field_path: rule.path,
        message: rule.message,
        section: rule.section,
      });
    }
  }

  for (const rule of INFO_FIELDS) {
    if (isFieldMissing(spec, rule.path)) {
      issues.push({
        severity: "info",
        field_path: rule.path,
        message: rule.message,
        section: rule.section,
      });
    }
  }

  return issues;
}

// ============================================================
// 需人工复核项检测
// ============================================================

function detectManualReviewItems(spec: RadarRequirementSpec): ManualReviewItem[] {
  const items: ManualReviewItem[] = [];

  // 来源 1：filter_rules.requires_manual_review
  for (const item of spec.filter_rules.requires_manual_review ?? []) {
    items.push({
      content: item,
      source: "filter_rules",
      related_field: "filter_rules.requires_manual_review",
    });
  }

  // 来源 2：questions_to_confirm
  for (const q of spec.questions_to_confirm ?? []) {
    items.push({
      content: q.question,
      source: "questions_to_confirm",
      related_field: "questions_to_confirm",
    });
  }

  // 来源 3：source_strategy 空值提示
  const ss = spec.source_strategy;
  if (ss && isEmptyArr(ss.official_sites)) {
    items.push({
      content: "数据源未配置（official_sites 为空），V0.4+ 消费时需填充",
      source: "source_strategy",
      related_field: "source_strategy.official_sites",
    });
  }

  return items;
}

// ============================================================
// 品牌合规检测
// ============================================================

function checkBrandCompliance(markdown: string): RadarPlanValidationResult["brand_compliance"] {
  const firstLine = markdown.split("\n")[0] ?? "";
  return {
    has_product_name: markdown.includes(BRAND.product_name),
    has_version: firstLine.includes("V1.0"),
    has_radar_name: RADAR_NAME_KEYWORDS.some((name) => markdown.includes(name)),
  };
}

// ============================================================
// 校验报告 Markdown 生成
// ============================================================

function buildReportMarkdown(
  input: RadarPlanValidationInput,
  structure: RadarPlanValidationResult["structure"],
  issues: ValidationIssue[],
  manualReviewItems: ManualReviewItem[],
  brandCompliance: RadarPlanValidationResult["brand_compliance"],
  summary: RadarPlanValidationResult["summary"],
  valid: boolean,
): string {
  const { plan_result } = input;
  const label = getValidationLabel(valid, summary.critical_count, summary.warning_count);
  const conclusion = getValidationConclusion(valid, summary.critical_count, summary.warning_count);

  const lines: string[] = [];

  // 标题
  lines.push(`# ${BRAND.product_name}｜雷达方案校验报告`);
  lines.push("");
  lines.push(`校验时间：${new Date().toISOString()}`);
  lines.push(`雷达方案版本：${plan_result.version ?? "未知"}`);
  lines.push(`校验结果：${label}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 章节 1：结构完整性
  lines.push("## 1. 结构完整性");
  lines.push(`- 章节数量：${structure.sections_count}/${structure.sections_expected}`);
  lines.push(`- 结构完整性：${structure.sections_complete ? "通过" : "不通过"}`);
  lines.push(`- 缺失章节：${structure.missing_sections.length === 0 ? "无" : structure.missing_sections.join("、")}`);
  lines.push("");

  // 章节 2：缺失项检测
  lines.push("## 2. 缺失项检测");
  lines.push("");

  // 严重缺失
  const criticalIssues = issues.filter((i) => i.severity === "critical");
  lines.push(`### 严重缺失（${criticalIssues.length} 项）`);
  if (criticalIssues.length === 0) {
    lines.push("暂无");
  } else {
    criticalIssues.forEach((issue, i) => {
      lines.push(`${i + 1}. [${issue.section}.${issue.field_path}] ${issue.message}`);
    });
  }
  lines.push("");

  // 警告缺失
  const warningIssues = issues.filter((i) => i.severity === "warning");
  lines.push(`### 警告缺失（${warningIssues.length} 项）`);
  if (warningIssues.length === 0) {
    lines.push("暂无");
  } else {
    warningIssues.forEach((issue, i) => {
      lines.push(`${i + 1}. [${issue.section}.${issue.field_path}] ${issue.message}`);
    });
  }
  lines.push("");

  // 提示缺失
  const infoIssues = issues.filter((i) => i.severity === "info");
  lines.push(`### 提示缺失（${infoIssues.length} 项）`);
  if (infoIssues.length === 0) {
    lines.push("暂无");
  } else {
    infoIssues.forEach((issue, i) => {
      lines.push(`${i + 1}. [${issue.section}.${issue.field_path}] ${issue.message}`);
    });
  }
  lines.push("");

  // 章节 3：需人工复核项
  lines.push(`## 3. 需人工复核项（${manualReviewItems.length} 项）`);
  if (manualReviewItems.length === 0) {
    lines.push("暂无");
  } else {
    manualReviewItems.forEach((item, i) => {
      lines.push(`${i + 1}. [来源：${item.source}] ${item.content}（相关字段：${item.related_field}）`);
    });
  }
  lines.push("");

  // 章节 4：品牌合规
  lines.push("## 4. 品牌合规");
  lines.push(`- 标题含品牌名：${brandCompliance.has_product_name ? "是" : "否"}`);
  lines.push(`- 标题含版本号：${brandCompliance.has_version ? "是" : "否"}`);
  lines.push(`- 标题含雷达名称：${brandCompliance.has_radar_name ? "是" : "否"}`);
  lines.push("");

  // 章节 5：汇总
  lines.push("## 5. 汇总");
  lines.push(`- 总问题数：${summary.total_issues}`);
  lines.push(`- 严重：${summary.critical_count}`);
  lines.push(`- 警告：${summary.warning_count}`);
  lines.push(`- 提示：${summary.info_count}`);
  lines.push(`- 需人工复核：${summary.manual_review_count}`);
  lines.push(`- 校验结论：${conclusion}`);

  return lines.join("\n");
}

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 校验雷达方案。
 *
 * 校验内容：
 *   1. 结构完整性（8 章节是否齐全）
 *   2. 缺失项检测（critical / warning / info 三级）
 *   3. 需人工复核项（filter_rules + questions_to_confirm + source_strategy 空值）
 *   4. 品牌合规（标题含品牌名/版本号/雷达名称）
 *
 * @param input 校验输入（plan_result + spec）
 * @returns 校验结果（含报告 Markdown）
 */
export function validateRadarPlan(input: RadarPlanValidationInput): RadarPlanValidationResult {
  const { plan_result, spec } = input;
  const markdown = plan_result.markdown ?? "";

  // 1. 结构完整性
  const structure = checkStructure(markdown);

  // 2. 缺失项检测
  const issues = detectIssues(spec);

  // 3. 需人工复核项
  const manualReviewItems = detectManualReviewItems(spec);

  // 4. 品牌合规
  const brandCompliance = checkBrandCompliance(markdown);

  // 汇总统计
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;
  const summary = {
    total_issues: issues.length,
    critical_count: criticalCount,
    warning_count: warningCount,
    info_count: infoCount,
    manual_review_count: manualReviewItems.length,
  };

  // 校验是否通过：无 critical 项且结构完整
  const valid = criticalCount === 0 && structure.sections_complete;

  // 生成校验报告 Markdown
  const reportMarkdown = buildReportMarkdown(
    input,
    structure,
    issues,
    manualReviewItems,
    brandCompliance,
    summary,
    valid,
  );

  return {
    valid,
    structure,
    issues,
    manual_review_items: manualReviewItems,
    brand_compliance: brandCompliance,
    summary,
    report_markdown: reportMarkdown,
  };
}
