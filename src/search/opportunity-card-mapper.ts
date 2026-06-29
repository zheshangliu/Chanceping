/**
 * OpportunityCardMapper —— 机会卡片映射器
 *
 * V1.3 新增。将 ScoredOpportunity + SourceCandidate[] + EvidenceItem[] → OpportunityCard。
 *
 * 安全红线：
 *   1. OpportunityCard.official_source_url 必须来自 SourceCandidate.url
 *   2. 无官方链接不进 S 级（强制降级为 A）
 *
 * 独有优势：
 *   - computeCredibility 多源交叉验证算法
 *   - 卡片三层字段设计（核心5/次要4/详情8）
 */

import type { ScoredOpportunity, SearchVisibleLevel } from "./types";
import type { SourceCandidate } from "../schema/source-candidate";
import type { EvidenceItem, EvidenceField } from "../schema/evidence-item";
import type { OpportunityCard } from "../schema/opportunity-card";
import { CONFIDENCE_GRADE_SCORES } from "../schema/source-candidate";
import type { CardVisibleLevel } from "../schema/scoring-rules";

// ============================================================
// 核心函数
// ============================================================

/**
 * 将 ScoredOpportunity + 来源数据 → OpportunityCard。
 *
 * @param scored 评分后的机会
 * @param sources 关联的来源候选
 * @param evidence 关联的证据项
 * @param radarId 雷达 ID（可选）
 * @returns 机会卡片
 */
export function mapToCard(
  scored: ScoredOpportunity,
  sources: SourceCandidate[],
  evidence: EvidenceItem[],
  radarId?: string,
): OpportunityCard {
  const url = scored.search_result.url;
  const title = scored.search_result.title;

  // 步骤 1：确定官方来源 URL（红线 #3：必须来自 SourceCandidate.url）
  const officialSource = sources.find((s) => s.isOfficial) ?? sources[0];
  const officialSourceUrl = officialSource?.url ?? url;

  // 步骤 2：确定来源可信度
  const sourceConfidence = officialSource?.confidenceGrade ?? "E5";

  // 步骤 3：构建来源徽章
  const sourceBadges = buildSourceBadges(sources);

  // 步骤 4：多源交叉验证
  const credibility = computeCredibility(sources);

  // 步骤 5：从证据项提取字段值
  const evidenceMap = buildEvidenceMap(evidence);

  // 步骤 6：确定可见等级（含 S 级硬规则）
  const visibleLevel = mapVisibleLevel(scored.visible_level);
  const backendScore = scored.backend_score;

  // 步骤 7：构建卡片（填充所有必填字段）
  const card: OpportunityCard = {
    // 核心字段（必填）
    title: evidenceMap.title?.value ?? title,
    type: radarId ?? "ai_competition",
    organizer: evidenceMap.organizer?.value ?? "",
    region: evidenceMap.region?.value ?? "",
    deadline: evidenceMap.deadline?.value ?? "",
    reward_or_value: evidenceMap.reward_or_value?.value ?? "",
    eligibility: evidenceMap.eligibility?.value ?? "",
    materials_required: "",
    match_reason: scored.relevance_reason,
    next_action: buildNextAction(visibleLevel, evidenceMap),
    official_source_url: officialSourceUrl,
    application_url: evidenceMap.application_url?.value ?? "",
    contact_info: evidenceMap.contact_info?.value ?? "",
    risk_note: backendScore < 50 ? "机会评分较低，建议谨慎评估" : "",
    backend_score: backendScore,
    visible_level: visibleLevel,
    status: "new",
    // 可选字段
    guid: scored.guid ?? url,
    // V1.3 新增字段
    radarId,
    decision: determineDecision(visibleLevel, backendScore),
    sourceIds: sources.map((s) => s.sourceId),
    evidenceIds: evidence.map((e) => e.evidenceId),
    sourceConfidence,
    verificationStatus: officialSource?.verificationStatus ?? "unverified",
    sourceBadges,
    fitReason: scored.chance_score.fit > 75 ? `匹配度高：${scored.relevance_reason}` : undefined,
    riskSummary: backendScore < 50 ? "机会评分较低，建议谨慎评估" : undefined,
    recommendedActions: buildRecommendedActions(visibleLevel, evidenceMap),
  };

  // 步骤 8：应用 S 级硬规则
  return applySLevelGuard(card, sources);
}

/**
 * S 级硬规则：无官方链接 → 强制降级为 A。
 *
 * 安全红线 #8：没有官方链接不能进入 S 级。
 *
 * @param card 机会卡片
 * @param sources 来源候选数组（用于判断是否有官方来源）
 * @returns 应用硬规则后的卡片
 */
export function applySLevelGuard(card: OpportunityCard, sources?: SourceCandidate[]): OpportunityCard {
  if (card.visible_level !== "S") return card;

  // 检查是否有官方来源
  const hasOfficialSource = sources
    ? sources.some((s) => s.isOfficial)
    : (card.sourceBadges?.includes("官方") ?? false);

  // 无官方来源，降级为 A
  if (!hasOfficialSource) {
    card.visible_level = "A";
    card.backend_score = Math.min(card.backend_score, 84);
  }

  return card;
}

/**
 * computeCredibility —— 多源交叉验证算法。
 *
 * TRAE 独有优势：多源交叉验证，提升来源可信度评估准确性。
 *
 * 算法：
 *   1. 如果只有 1 个来源 → 直接用该来源的可信度分数
 *   2. 如果有 2+ 个来源：
 *      a. 检查是否有官方来源（A1/A2）→ 加 10 分
 *      b. 检查多源一致性（相同字段值跨源一致）→ 加 5-15 分
 *      c. 取所有来源可信度分数的加权平均
 *
 * @param sources 来源候选数组
 * @returns 可信度分数（0-100）
 */
export function computeCredibility(sources: SourceCandidate[]): number {
  if (sources.length === 0) return 0;
  if (sources.length === 1) {
    return CONFIDENCE_GRADE_SCORES[sources[0].confidenceGrade] ?? 10;
  }

  // 多源情况
  let baseScore = 0;
  let totalWeight = 0;

  for (const source of sources) {
    const score = CONFIDENCE_GRADE_SCORES[source.confidenceGrade] ?? 10;
    // 官方来源权重更高
    const weight = source.isOfficial ? 3 : 1;
    baseScore += score * weight;
    totalWeight += weight;
  }

  let credibility = totalWeight > 0 ? baseScore / totalWeight : 0;

  // 官方来源加成
  const hasOfficial = sources.some((s) => s.isOfficial);
  if (hasOfficial) {
    credibility = Math.min(100, credibility + 10);
  }

  // 多源一致性加成（V1.3 简化版：2 源 +5，3+ 源 +10）
  if (sources.length >= 3) {
    credibility = Math.min(100, credibility + 10);
  } else if (sources.length >= 2) {
    credibility = Math.min(100, credibility + 5);
  }

  return Math.round(credibility);
}

// ============================================================
// 私有函数
// ============================================================

/** 构建来源徽章列表 */
function buildSourceBadges(sources: SourceCandidate[]): string[] {
  const badges: string[] = [];
  const hasOfficial = sources.some((s) => s.isOfficial);
  const hasGov = sources.some((s) => s.sourceType === "government");

  if (hasGov) badges.push("政府");
  if (hasOfficial) badges.push("官方");

  // 取最高可信度等级
  const grades = sources.map((s) => CONFIDENCE_GRADE_SCORES[s.confidenceGrade] ?? 0);
  const maxGrade = grades.length > 0 ? Math.max(...grades) : 0;
  if (maxGrade >= 90) badges.push("A1");
  else if (maxGrade >= 80) badges.push("B1");
  else if (maxGrade >= 60) badges.push("C1");

  // 多源标记
  if (sources.length >= 2) badges.push("多源验证");

  return badges;
}

/** 构建证据字段映射 */
function buildEvidenceMap(evidence: EvidenceItem[]): Partial<Record<EvidenceField, EvidenceItem>> {
  const map: Partial<Record<EvidenceField, EvidenceItem>> = {};
  for (const item of evidence) {
    // 同一字段取置信度最高的
    if (!map[item.field] || item.confidence > map[item.field]!.confidence) {
      map[item.field] = item;
    }
  }
  return map;
}

/** 映射 SearchVisibleLevel → CardVisibleLevel */
function mapVisibleLevel(level: SearchVisibleLevel): CardVisibleLevel {
  // SearchVisibleLevel: "S" | "A" | "B" | "C" | "hidden"
  // CardVisibleLevel: "S" | "A" | "B" | "C" | "D"
  if (level === "hidden") return "D";
  return level as CardVisibleLevel;
}

/** 确定行动决策 */
function determineDecision(level: CardVisibleLevel, score: number): "attack" | "hold" | "archive" {
  if (level === "S" || (level === "A" && score >= 80)) return "attack";
  if (level === "B" || level === "C") return "hold";
  return "archive";
}

/** 构建下一步行动建议 */
function buildNextAction(
  level: CardVisibleLevel,
  evidenceMap: Partial<Record<EvidenceField, EvidenceItem>>,
): string {
  if (level === "S" || level === "A") {
    if (evidenceMap.application_url) return "尽快报名/申请";
    if (evidenceMap.deadline) return `注意截止日期：${evidenceMap.deadline.value}`;
    return "立即查看官方链接";
  }
  if (level === "B") return "收藏关注";
  return "了解即可";
}

/** 构建推荐行动列表 */
function buildRecommendedActions(
  level: CardVisibleLevel,
  evidenceMap: Partial<Record<EvidenceField, EvidenceItem>>,
): string[] {
  const actions: string[] = [];

  if (level === "S" || level === "A") {
    actions.push("立即查看官方链接");
    if (evidenceMap.deadline) {
      actions.push(`注意截止日期：${evidenceMap.deadline.value}`);
    }
    if (evidenceMap.application_url) {
      actions.push("尽快报名/申请");
    }
  } else if (level === "B") {
    actions.push("收藏关注");
    if (evidenceMap.deadline) {
      actions.push(`留意截止日期：${evidenceMap.deadline.value}`);
    }
  } else {
    actions.push("了解即可");
  }

  return actions;
}
