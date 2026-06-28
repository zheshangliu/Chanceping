/**
 * T10 第三层：机会评分（opportunity scorer）
 *
 * 来源：Task 019d 第 4.3 节。
 *
 * ChanceScore 五维评分 → S/A/B/C 分级。
 *   - Fit（匹配度）30%：LLM 判断客户画像 × 机会类型
 *   - Intent（意图匹配）20%：LLM 判断行动意图 × 机会价值
 *   - Evidence（证据可信度）20%：基于 provider reliability 评级
 *   - Urgency（紧迫度）15%：基于日期距今天数
 *   - EffortCost（行动成本）15%：LLM 判断申报难度 × 资格门槛（越低越好，反向评分）
 *
 * total = Fit*0.30 + Intent*0.20 + Evidence*0.20 + Urgency*0.15 + EffortCost*0.15
 *
 * 分级（任务书 4.3 节专用阈值，不复用 scoring-rules.ts 的 90/80/65/50）：
 *   total ≥ 85 → "S"
 *   70 ≤ total < 85 → "A"
 *   55 ≤ total < 70 → "B"
 *   40 ≤ total < 55 → "C"
 *   total < 40 → "hidden"
 *
 * Mock 模式（QwenAdapter Mock 模式下，parsed 不含 fit/intent/effort_cost 字段时）：
 *   - fit=75, intent=70, effort_cost=50（根据 title 关键词微调）
 */

import type { ScoredOpportunity, SearchVisibleLevel, ChanceScore } from "./types";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import type { LLMAdapter, LLMRequest } from "../agents/llm-adapter";
import type { AIFilterItem } from "./ai-filter";
import type { ReliabilityGrade } from "./provider-registry";
import { providerRegistry } from "./provider-registry";
import { parseJsonWithRepair } from "../utils/json-repair";
import { normalizeUrl } from "../utils/url-normalizer";

/** 评分权重（固定，不得调整） */
const WEIGHT_FIT = 0.30;
const WEIGHT_INTENT = 0.20;
const WEIGHT_EVIDENCE = 0.20;
const WEIGHT_URGENCY = 0.15;
const WEIGHT_EFFORT_COST = 0.15;

/** reliability 评级 → Evidence 分数映射（对接 Admiralty Code） */
const RELIABILITY_TO_EVIDENCE: Record<ReliabilityGrade, number> = {
  A: 90,
  B: 75,
  C: 60,
  D: 40,
  F: 20,
};

/** LLM 评分结果 */
interface LLMScoringResult {
  fit: number;
  intent: number;
  effort_cost: number;
  fit_reason?: string;
  intent_reason?: string;
  effort_reason?: string;
}

/**
 * 从 LLM parsed 中提取评分字段。
 * 如果字段缺失（Mock 模式预设返回），按 title 关键词返回预设值。
 */
function extractScoring(parsed: unknown, title: string): LLMScoringResult {
  // 优先从 LLM 输出中提取
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.fit === "number" && typeof obj.intent === "number" && typeof obj.effort_cost === "number") {
      return {
        fit: Math.max(0, Math.min(100, obj.fit)),
        intent: Math.max(0, Math.min(100, obj.intent)),
        effort_cost: Math.max(0, Math.min(100, obj.effort_cost)),
        fit_reason: typeof obj.fit_reason === "string" ? obj.fit_reason : undefined,
        intent_reason: typeof obj.intent_reason === "string" ? obj.intent_reason : undefined,
        effort_reason: typeof obj.effort_reason === "string" ? obj.effort_reason : undefined,
      };
    }
  }

  // Mock 模式预设：根据 title 关键词微调
  if (/AI|大赛|比赛|赛事|竞赛/.test(title)) {
    return {
      fit: 80,
      intent: 75,
      effort_cost: 45,
      fit_reason: "Mock: AI 赛事匹配度高",
      intent_reason: "Mock: 行动意图匹配",
      effort_reason: "Mock: 申报难度中等",
    };
  }
  if (/政策|补贴|扶持|申报/.test(title)) {
    return {
      fit: 70,
      intent: 65,
      effort_cost: 55,
      fit_reason: "Mock: 政策补贴匹配",
      intent_reason: "Mock: 意图匹配中等",
      effort_reason: "Mock: 申报材料较多",
    };
  }
  return {
    fit: 75,
    intent: 70,
    effort_cost: 50,
    fit_reason: "Mock: 默认匹配度",
    intent_reason: "Mock: 默认意图",
    effort_reason: "Mock: 默认成本",
  };
}

/**
 * 计算 Evidence 分数：基于 provider reliability 评级。
 * A=90, B=75, C=60, D=40, F=20
 */
function computeEvidence(providerName: string): number {
  const provider = providerRegistry.get(providerName);
  if (!provider) {
    // 未知 provider，默认 C 级
    return RELIABILITY_TO_EVIDENCE.C;
  }
  return RELIABILITY_TO_EVIDENCE[provider.reliability] ?? RELIABILITY_TO_EVIDENCE.C;
}

/**
 * 计算 Urgency 分数：基于日期距今天数。
 * 0-3 天 → 95
 * 4-7 天 → 80
 * 8-14 天 → 60
 * 15-30 天 → 40
 * >30 天 → 20
 * 无日期 → 30
 */
function computeUrgency(dateStr?: string): number {
  if (!dateStr || typeof dateStr !== "string" || dateStr.trim() === "") {
    return 30;
  }

  // 提取日期（支持 2026-06-15 / 2026-06-15T10:00:00Z / 2026年6月15日）
  const match = dateStr.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (!match) {
    return 30;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const target = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(target.getTime())) {
    return 30;
  }

  // 计算距今天数（UTC 当天 0 点）
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays < 0) {
    // 已过期
    return 20;
  }
  if (diffDays <= 3) return 95;
  if (diffDays <= 7) return 80;
  if (diffDays <= 14) return 60;
  if (diffDays <= 30) return 40;
  return 20;
}

/**
 * 根据 total 计算 visible_level。
 * 任务书 4.3 节专用阈值（85/70/55/40），不复用 scoring-rules.ts 的 90/80/65/50。
 */
function computeVisibleLevel(total: number): SearchVisibleLevel {
  if (total >= 85) return "S";
  if (total >= 70) return "A";
  if (total >= 55) return "B";
  if (total >= 40) return "C";
  return "hidden";
}

/**
 * 构造 LLM 评分 prompt。
 * system 消息：spec + 五维评分规则
 * user 消息：title + main_text + relevance
 */
function buildScoringLLMRequest(
  item: AIFilterItem,
  spec: RadarRequirementSpec,
): LLMRequest {
  const clientProfile = spec?.client_profile;
  const coreGoals = spec?.core_goals;
  const oppScope = spec?.opportunity_scope;

  const systemMsg = [
    "你是一个机会评分助手。根据用户的需求规格和搜索结果，对机会进行五维评分。",
    "",
    "【五维评分规则】（每维 0-100）",
    "- Fit（匹配度）：客户画像 × 机会类型匹配度",
    "- Intent（意图匹配）：行动意图 × 机会价值",
    "- EffortCost（行动成本）：申报难度 × 资格门槛（越低越好，反向评分）",
    "",
    "【客户画像】",
    `行业：${clientProfile?.industry ?? "未指定"}`,
    `客户类型：${clientProfile?.client_type ?? "未指定"}`,
    `核心能力：${(clientProfile?.core_capabilities ?? []).join("、") || "未指定"}`,
    "",
    "【核心目标】",
    `主要目标：${coreGoals?.primary_goal ?? "未指定"}`,
    `行动意图：${(coreGoals?.action_intent ?? []).join("、") || "未指定"}`,
    "",
    "【机会范围】",
    `主要机会类型：${(oppScope?.primary_opportunity_types ?? []).join("、") || "未指定"}`,
  ].join("\n");

  const userMsg = [
    "请对以下机会进行五维评分。",
    "",
    `【标题】${item.result.title}`,
    `【相关度】${item.relevance}`,
    `【正文】${item.content.main_text.slice(0, 3000)}${item.content.main_text.length > 3000 ? "...[截断]" : ""}`,
    "",
    '请返回 JSON：{ "fit": 0-100, "intent": 0-100, "effort_cost": 0-100, "fit_reason": "理由", "intent_reason": "理由", "effort_reason": "理由" }',
  ].join("\n");

  return {
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
    response_format: "json",
    temperature: 0.3,
  };
}

/**
 * T10 第三层：机会评分。
 *
 * @param aiFiltered AI 精筛通过的项
 * @param spec 雷达需求规格
 * @param llmAdapter LLM 适配器
 * @returns ScoredOpportunity[]（含 chance_score / visible_level / backend_score / guid）
 */
export async function scoreOpportunities(
  aiFiltered: AIFilterItem[],
  spec: RadarRequirementSpec,
  llmAdapter: LLMAdapter,
): Promise<ScoredOpportunity[]> {
  const opportunities: ScoredOpportunity[] = [];

  // 边界情况：空数组
  if (!Array.isArray(aiFiltered) || aiFiltered.length === 0) {
    return opportunities;
  }

  for (const item of aiFiltered) {
    // 边界情况：缺字段
    if (!item || !item.result) {
      continue;
    }

    // Evidence：基于 provider reliability
    const evidence = computeEvidence(item.result.source_provider);

    // Urgency：基于日期（优先 cleaned_content.publish_date，其次 search_result.published_at）
    const urgency = computeUrgency(
      item.content.publish_date ?? item.result.published_at,
    );

    // Fit / Intent / EffortCost：LLM 评分
    let llmResult: LLMScoringResult;
    try {
      const llmRequest = buildScoringLLMRequest(item, spec);
      const llmResponse = await llmAdapter.chat(llmRequest);
      const parsed =
        llmResponse.parsed ?? parseJsonWithRepair(llmResponse.content ?? "");
      llmResult = extractScoring(parsed, item.result.title);
    } catch {
      // LLM 调用失败：使用 Mock 预设
      llmResult = extractScoring(null, item.result.title);
    }

    // 综合分计算
    const total = Math.round(
      llmResult.fit * WEIGHT_FIT +
        llmResult.intent * WEIGHT_INTENT +
        evidence * WEIGHT_EVIDENCE +
        urgency * WEIGHT_URGENCY +
        llmResult.effort_cost * WEIGHT_EFFORT_COST,
    );

    // 分级
    const visibleLevel = computeVisibleLevel(total);

    // guid：从 search_result.raw_data 提取，或用 normalizeUrl(url) 作为伪 guid
    let guid: string | undefined;
    const rawData = item.result.raw_data as Record<string, unknown> | undefined;
    if (rawData && typeof rawData.guid === "string" && rawData.guid) {
      guid = rawData.guid;
    } else if (rawData && typeof rawData.id === "string" && rawData.id) {
      guid = rawData.id;
    } else {
      guid = normalizeUrl(item.result.url);
    }

    const chanceScore: ChanceScore = {
      fit: llmResult.fit,
      intent: llmResult.intent,
      evidence,
      urgency,
      effort_cost: llmResult.effort_cost,
      total,
    };

    opportunities.push({
      search_result: item.result,
      cleaned_content: item.content,
      relevance_score: item.relevance,
      relevance_reason: item.reason,
      chance_score: chanceScore,
      visible_level: visibleLevel,
      backend_score: total,
      guid,
    });
  }

  return opportunities;
}
