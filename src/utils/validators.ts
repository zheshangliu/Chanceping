/**
 * 校验工具
 *
 * 来源：Task 001 第 4.7 节。
 * 提供 3 个校验器：
 *   - validateSpec            校验 RadarRequirementSpec 最小字段集
 *   - validateConfidence      校验需求确认度 7 维度 + 权重和 + total 正确性
 *   - validateOpportunityCard 校验机会卡片字段
 *
 * 校验结果统一为 { valid: boolean; errors: string[] }。
 */

import Ajv, { type ErrorObject } from "ajv";
import {
  radarRequirementSpecSchema,
  ACTION_INTENTS,
  CONFIRMATION_STATUSES,
} from "../schema/radar-requirement-spec";
import {
  CONFIDENCE_DIMENSIONS,
  CONFIDENCE_WEIGHTS,
  computeConfidenceTotal,
  type RequirementConfidence,
} from "../schema/requirement-confidence";
import type { OpportunityCard } from "../schema/opportunity-card";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSpecSchema = ajv.compile(radarRequirementSpecSchema);

/** 把 ajv 错误转成可读字符串 */
function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((e) => {
    const path = e.instancePath || "(root)";
    return `${path}: ${e.message ?? "校验失败"}${e.params ? " " + JSON.stringify(e.params) : ""}`;
  });
}

/**
 * 校验 RadarRequirementSpec 最小字段集是否齐全、类型是否正确。
 * 内部使用 JSON Schema（ajv）；额外补充 action_intent / status 枚举的友好提示。
 */
export function validateSpec(spec: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof spec !== "object" || spec === null) {
    return { valid: false, errors: ["spec 必须是对象"] };
  }

  const ok = validateSpecSchema(spec);
  if (!ok) {
    errors.push(...formatAjvErrors(validateSpecSchema.errors));
  }

  // 友好补充：明确指出缺失的顶层字段（对应验收 #2）
  const requiredTopLevel = [
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
  ];
  const specObj = spec as Record<string, unknown>;
  for (const key of requiredTopLevel) {
    if (!(key in specObj)) {
      errors.push(`缺少顶层必填字段: ${key}`);
    }
  }

  // action_intent 枚举校验（给出更友好的提示）
  const actionIntent = (specObj as { core_goals?: { action_intent?: unknown[] } }).core_goals?.action_intent;
  if (Array.isArray(actionIntent)) {
    actionIntent.forEach((v, i) => {
      if (!(ACTION_INTENTS as readonly string[]).includes(v as string)) {
        errors.push(`core_goals.action_intent[${i}] 不是合法枚举值: ${String(v)}`);
      }
    });
  }

  // confirmation_status.status 枚举校验
  const status = (specObj as { confirmation_status?: { status?: unknown } }).confirmation_status?.status;
  if (typeof status === "string" && !(CONFIRMATION_STATUSES as readonly string[]).includes(status)) {
    errors.push(`confirmation_status.status 不是合法枚举值: ${status}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 校验需求确认度：
 *   - 7 个维度齐全
 *   - 各维度 score 在 0–100
 *   - 各维度 weight 与固定权重一致，且 7 维度权重之和 = 100
 *   - total 与按公式计算的结果一致
 */
export function validateConfidence(confidence: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof confidence !== "object" || confidence === null) {
    return { valid: false, errors: ["confidence 必须是对象"] };
  }
  const c = confidence as Record<string, unknown>;

  if (typeof c.total !== "number") {
    errors.push("total 必须是数字");
  }

  let weightSum = 0;
  for (const key of CONFIDENCE_DIMENSIONS) {
    const dim = c[key] as { score?: number; weight?: number; reason?: string } | undefined;
    if (!dim || typeof dim !== "object") {
      errors.push(`缺少确认度维度: ${key}`);
      continue;
    }
    if (typeof dim.score !== "number" || dim.score < 0 || dim.score > 100) {
      errors.push(`${key}.score 必须是 0–100 的数字`);
    }
    if (typeof dim.weight !== "number") {
      errors.push(`${key}.weight 必须是数字`);
    } else {
      weightSum += dim.weight;
      if (dim.weight !== CONFIDENCE_WEIGHTS[key]) {
        errors.push(
          `${key}.weight=${dim.weight} 与固定权重 ${CONFIDENCE_WEIGHTS[key]} 不一致`,
        );
      }
    }
    if (typeof dim.reason !== "string") {
      errors.push(`${key}.reason 必须是字符串`);
    }
  }

  if (weightSum !== 100) {
    errors.push(`7 维度权重之和=${weightSum}，必须等于 100`);
  }

  // total 计算正确性（仅在结构基本完整时校验）
  const dimensionsAllPresent = CONFIDENCE_DIMENSIONS.every(
    (key) => typeof c[key] === "object" && c[key] !== null,
  );
  if (dimensionsAllPresent) {
    const expected = computeConfidenceTotal(confidence as RequirementConfidence);
    const actual = c.total as number;
    if (typeof actual === "number" && Math.abs(actual - expected) > 0.01) {
      errors.push(`total=${actual} 与计算值 ${expected} 不一致`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 机会卡片必填字段（与 01 号文档第 10.2 节一致） */
const OPPORTUNITY_CARD_FIELDS: Array<keyof OpportunityCard> = [
  "title",
  "type",
  "organizer",
  "region",
  "deadline",
  "reward_or_value",
  "eligibility",
  "materials_required",
  "match_reason",
  "next_action",
  "official_source_url",
  "application_url",
  "contact_info",
  "risk_note",
  "backend_score",
  "visible_level",
  "status",
];

/**
 * 校验机会卡片：
 *   - 字段齐全
 *   - visible_level 合法（S/A/B/C）
 *   - backend_score 在 0–100
 *   - official_source_url 必填（每条机会必须有官方链接）
 */
export function validateOpportunityCard(card: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof card !== "object" || card === null) {
    return { valid: false, errors: ["card 必须是对象"] };
  }
  const obj = card as Record<string, unknown>;

  for (const field of OPPORTUNITY_CARD_FIELDS) {
    if (!(field in obj)) {
      errors.push(`缺少卡片字段: ${field}`);
    }
  }

  if (typeof obj.backend_score === "number") {
    if (obj.backend_score < 0 || obj.backend_score > 100) {
      errors.push("backend_score 必须在 0–100 之间");
    }
  } else if ("backend_score" in obj) {
    errors.push("backend_score 必须是数字");
  }

  if ("visible_level" in obj) {
    if (!["S", "A", "B", "C"].includes(obj.visible_level as string)) {
      errors.push("visible_level 必须是 S/A/B/C 之一");
    }
  }

  if ("status" in obj) {
    if (typeof obj.status !== "string") {
      errors.push("status 必须是字符串");
    }
  }

  if ("official_source_url" in obj) {
    if (typeof obj.official_source_url !== "string" || obj.official_source_url.trim() === "") {
      errors.push("official_source_url 必填且不能为空（每条机会必须有官方链接）");
    }
  }

  return { valid: errors.length === 0, errors };
}
