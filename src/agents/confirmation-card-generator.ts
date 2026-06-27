/**
 * 需求确认卡生成器（confirmation_card_generator）
 *
 * 来源：Task 008 第 4 节。
 *
 * 输入：ExtractedRequirementInfo + RequirementConfidence
 * 输出：符合 02 号文档第 5 节格式的 Markdown 确认卡
 *
 * 规则：
 *   - 确认度 < 90%：拒绝生成，返回 error
 *   - 确认度 90-94%：生成确认卡 V0.1，末尾追加"第一版"提示
 *   - 确认度 ≥ 95%：生成确认卡 V1.0，末尾追加"95%"提示
 *
 * 不接入 LLM：内容从 ExtractedRequirementInfo 规则映射，缺失字段写"未明确"。
 * 报告结构以 MUST_INCLUDE_SECTIONS（9 项）为准，不以 system prompt 的 7 项为准。
 */

import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { RequirementConfidence, ConfidenceDimensionKey } from "../schema/requirement-confidence";
import {
  CONFIDENCE_DIMENSIONS,
  CONFIDENCE_DIMENSION_LABELS,
} from "../schema/requirement-confidence";
import { BRAND } from "../brand/constants";
import { MUST_INCLUDE_SECTIONS } from "../schema/radar-requirement-spec";
import { LEVEL_DEFINITIONS } from "../schema/scoring-rules";
import { t } from "../i18n/locales";

// ============================================================
// 类型定义
// ============================================================

/** 确认卡生成结果 */
export interface ConfirmationCardResult {
  /** 是否成功生成 */
  success: boolean;
  /** 生成的 Markdown 确认卡（success=true 时有值） */
  markdown: string | null;
  /** 失败原因（success=false 时有值） */
  error: string | null;
  /** 确认卡版本：V0.1（90-94%）或 V1.0（≥95%） */
  version: "V0.1" | "V1.0" | null;
}

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

/** 取字符串值，缺失返回"未明确" */
function strOrUnknown(v: string | undefined): string {
  return hasStr(v) ? v : "未明确";
}

/** 取数组 join 值，缺失返回"未明确" */
function arrOrUnknown(v: string[] | undefined): string {
  return hasArr(v) ? v.join("、") : "未明确";
}

/**
 * 模块 4：基于 primary_types 推导建议信号。
 * 缺失 must_have_conditions 时调用，至少返回 3 条，标注"(AI 建议)"。
 */
function deriveMustHaveSignals(primaryTypes: string[] | undefined): string[] {
  if (!hasArr(primaryTypes)) {
    return [
      "奖金金额 (AI 建议)",
      "截止时间 (AI 建议)",
      "参赛资格 (AI 建议)",
    ];
  }

  const signals: string[] = [];
  const joined = primaryTypes.join(" ");

  // 通用信号
  signals.push("截止时间 (AI 建议)");

  // 基于机会类型关键词的推导
  if (/比赛|赛事|竞赛|hackathon/i.test(joined)) {
    signals.push("奖金金额 (AI 建议)");
    signals.push("个人参赛资格 (AI 建议)");
  } else if (/补贴|政策|申报|政府/i.test(joined)) {
    signals.push("申报资格 (AI 建议)");
    signals.push("补贴金额 (AI 建议)");
  } else if (/征集|文创|非遗/i.test(joined)) {
    signals.push("征集主题匹配 (AI 建议)");
    signals.push("作品要求 (AI 建议)");
  } else if (/合作|BD|客户/i.test(joined)) {
    signals.push("客户匹配度 (AI 建议)");
    signals.push("合作条件 (AI 建议)");
  } else {
    signals.push("奖金金额 (AI 建议)");
    signals.push("参赛资格 (AI 建议)");
  }

  return signals;
}

// ============================================================
// 各模块生成函数
// ============================================================

/** 模块 1：我理解你的身份 */
function buildModule1(info: ExtractedRequirementInfo): string {
  const ci = info.client_identity ?? {};
  return [
    `## ${t("chat.section.identity")}`,
    `- 用户类型：${strOrUnknown(ci.client_type)}`,
    `- 所属行业：${strOrUnknown(ci.industry)}`,
    `- 当前项目 / 公司：${arrOrUnknown(ci.products_or_projects)}`,
    `- 主要地区：${arrOrUnknown(ci.regions)}`,
  ].join("\n");
}

/** 模块 2：我理解你的核心目标 */
function buildModule2(info: ExtractedRequirementInfo): string {
  const bg = info.business_goal ?? {};
  return [
    `## ${t("chat.section.goals")}`,
    `- 第一目标：${strOrUnknown(bg.primary_goal)}`,
    `- 第二目标：${arrOrUnknown(bg.secondary_goals)}`,
    `- 成功标准：${strOrUnknown(bg.success_definition)}`,
  ].join("\n");
}

/** 模块 3：我理解你需要盯的机会类型 */
function buildModule3(info: ExtractedRequirementInfo): string {
  const ot = info.opportunity_type ?? {};
  const lines: string[] = [`## ${t("chat.section.opportunityTypes")}`];

  if (hasArr(ot.primary_types)) {
    ot.primary_types.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
    if (hasArr(ot.secondary_types)) {
      lines.push(`次要类型：${ot.secondary_types.join("、")}`);
    }
  } else {
    lines.push("未明确，请在确认时补充");
  }

  return lines.join("\n");
}

/** 模块 4：我建议优先追踪的信号 */
function buildModule4(info: ExtractedRequirementInfo): string {
  const ot = info.opportunity_type ?? {};
  const lines: string[] = [`## ${t("chat.section.trackingSignals")}`];

  let signals: string[];
  if (hasArr(ot.must_have_conditions)) {
    signals = ot.must_have_conditions;
  } else {
    signals = deriveMustHaveSignals(ot.primary_types);
  }

  signals.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  return lines.join("\n");
}

/** 模块 5：我建议优先排除的信息 */
function buildModule5(info: ExtractedRequirementInfo): string {
  const ot = info.opportunity_type ?? {};
  const er = info.exclusion_rules ?? { count: 0 };

  // 合并 must_exclude + excluded_types 去重
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...(er.must_exclude ?? []), ...(ot.excluded_types ?? [])]) {
    if (!seen.has(item)) {
      seen.add(item);
      merged.push(item);
    }
  }

  const lines: string[] = [`## ${t("chat.section.excludedInfo")}`];
  if (merged.length === 0) {
    lines.push("暂无排除条件，请在确认时补充");
  } else {
    merged.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  return lines.join("\n");
}

/** 模块 6：我建议的雷达方向 */
function buildModule6(info: ExtractedRequirementInfo): string {
  const ot = info.opportunity_type ?? {};
  const ci = info.client_identity ?? {};
  const as = info.action_scenario ?? {};

  const lines: string[] = [`## ${t("chat.section.radarDirection")}`];

  let radars: string[] = [];
  if (hasArr(ot.primary_types)) {
    radars = ot.primary_types.slice(0, 3); // 至少 1 个，最多 3 个
  }

  if (radars.length === 0) {
    lines.push("（未明确机会类型，请在确认时补充）");
    return lines.join("\n");
  }

  const clientType = hasStr(ci.client_type) ? ci.client_type : "用户";
  const intent = hasStr(as.action_intent) ? as.action_intent : "决策";

  radars.forEach((r, i) => {
    lines.push(`### 子雷达 ${i + 1}：${r}`);
    lines.push(`- 作用：盯${r}类机会，为${clientType}提供${intent}支持`);
  });

  return lines.join("\n");
}

/** 模块 7：我建议的机会分级方式 */
function buildModule7(): string {
  return [
    `## ${t("chat.section.opportunityGrading")}`,
    `- S 级：${LEVEL_DEFINITIONS.S}`,
    `- A 级：${LEVEL_DEFINITIONS.A}`,
    `- B 级：${LEVEL_DEFINITIONS.B}`,
    `- C 级：${LEVEL_DEFINITIONS.C}`,
  ].join("\n");
}

/** 模块 8：我建议的报告结构 */
function buildModule8(): string {
  const lines: string[] = [`## ${t("chat.section.reportStructure")}`];
  MUST_INCLUDE_SECTIONS.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  return lines.join("\n");
}

/** 模块 9：当前需求确认度 */
function buildModule9(confidence: RequirementConfidence): string {
  const lines: string[] = [`## ${t("chat.section.confidenceLevel")}`];
  const total = Math.round(confidence.total * 10) / 10;
  lines.push(`- 总体确认度：${total}%`);

  // 遍历 7 维度，列出 score < 90 的维度中文名 + reason
  const uncertain: Array<{ label: string; score: number; reason: string }> = [];
  for (const key of CONFIDENCE_DIMENSIONS) {
    const dim = confidence[key];
    if (dim.score < 90) {
      uncertain.push({
        label: CONFIDENCE_DIMENSION_LABELS[key as ConfidenceDimensionKey],
        score: dim.score,
        reason: dim.reason,
      });
    }
  }

  if (uncertain.length === 0) {
    lines.push("- 仍有不确定项：暂无不确定项");
  } else {
    lines.push("- 仍有不确定项：");
    for (const u of uncertain) {
      lines.push(`  - ${u.label}（${u.score} 分）：${u.reason}`);
    }
  }

  return lines.join("\n");
}

/** 模块 10：请你确认（固定 3 问） */
function buildModule10(): string {
  return [
    `## ${t("chat.section.pleaseConfirm")}`,
    "1. 这个需求理解是否准确？",
    "2. 有没有需要删除或补充的机会类型？",
    "3. 是否可以基于这份需求确认卡，生成第一版雷达方案？",
  ].join("\n");
}

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 生成需求确认卡。
 *
 * 规则：
 *   - 确认度 < 90%：拒绝生成，返回 error
 *   - 确认度 90-94%：生成确认卡 V0.1，提示用户这是第一版
 *   - 确认度 ≥ 95%：生成确认卡 V1.0，建议进入雷达方案生成
 *
 * @param info 已提取的需求信息
 * @param confidence 当前确认度
 * @returns 确认卡生成结果
 */
export function generateConfirmationCard(
  info: ExtractedRequirementInfo,
  confidence: RequirementConfidence,
): ConfirmationCardResult {
  const total = confidence.total;

  // 拒绝生成逻辑：确认度 < 90%
  if (total < 90) {
    return {
      success: false,
      markdown: null,
      error: `需求确认度仅 ${total}%，低于 90% 阈值，暂不生成确认卡。请继续补充需求信息。`,
      version: null,
    };
  }

  // 版本判定
  const version: "V0.1" | "V1.0" = total >= 95 ? "V1.0" : "V0.1";

  // 标题
  const title =
    version === "V0.1"
      ? `# ${BRAND.product_name}｜需求确认卡 V0.1`
      : `# ${BRAND.product_name}｜需求确认卡`;

  // 各模块内容
  const modules: string[] = [
    title,
    "",
    buildModule1(info),
    "",
    buildModule2(info),
    "",
    buildModule3(info),
    "",
    buildModule4(info),
    "",
    buildModule5(info),
    "",
    buildModule6(info),
    "",
    buildModule7(),
    "",
    buildModule8(),
    "",
    buildModule9(confidence),
    "",
    buildModule10(),
  ];

  // 末尾追加版本提示
  if (version === "V0.1") {
    modules.push("");
    modules.push("---");
    modules.push("");
    modules.push("这是第一版确认卡，请仔细核对以上信息。确认无误后我们将生成正式雷达方案。");
  } else {
    modules.push("");
    modules.push("---");
    modules.push("");
    modules.push("需求确认度已达 95% 以上，确认后即可生成正式雷达方案 V1.0。");
  }

  return {
    success: true,
    markdown: modules.join("\n"),
    error: null,
    version,
  };
}
