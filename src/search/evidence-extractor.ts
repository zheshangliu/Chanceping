/**
 * EvidenceExtractor —— 证据提取器
 *
 * V1.3 新增。从 CleanedContent → EvidenceItem[]。
 *
 * 安全红线：
 *   1. EvidenceItem.sourceId 必须指向已存在 SourceCandidate
 *   2. evidenceText 必须来自来源页面的真实文本
 *   3. 无 sourceId 时 needsReview 必须为 true
 *
 * 提取规则：纯正则 + 关键词（第一版不调用 LLM）
 */

import type { CleanedContent } from "./types";
import type { EvidenceItem, EvidenceField } from "../schema/evidence-item";
import { generateEvidenceId, shouldReviewEvidence } from "../schema/evidence-item";

// ============================================================
// 正则模式
// ============================================================

/** 截止日期提取 */
const DEADLINE_PATTERNS = [
  /(?:截止|报名截止|申报截止|提交截止|deadline)[日期时间：:\s]*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?)/i,
  /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?)\s*(?:截止|到期|结束)/,
];

/** 主办方提取 */
const ORGANIZER_PATTERNS = [
  /(?:主办方|主办单位|organizers?)[：:\s]*(.+?)(?:[。\n；;])/,
  /(?:承办方|承办单位)[：:\s]*(.+?)(?:[。\n；;])/,
];

/** 奖励提取 */
const REWARD_PATTERNS = [
  /(?:奖金|奖励|奖品|prize|reward)[总额：:\s]*([\d,.万亿千元元人民币￥$]+[^。\n；;]*)/,
  /(?:补贴|资助|扶持)[金额：:\s]*([\d,.万亿千元元人民币￥$]+[^。\n；;]*)/,
];

/** 适合对象提取 */
const ELIGIBILITY_PATTERNS = [
  /(?:参赛资格|适合对象|参赛条件|报名条件|eligibility)[：:\s]*(.+?)(?:[。\n；;])/,
  /(?:面向|针对)[：:\s]*(.+?)(?:[。\n；;])/,
];

/** 地区提取 */
const REGION_PATTERNS = [
  /(?:地区|地域|区域|region)[：:\s]*(.+?)(?:[。\n；;])/,
  /(?:全国|全省|全市|大湾区|长三角|京津冀)/,
];

/** 报名链接提取 */
const APPLICATION_URL_PATTERNS = [
  /(?:报名链接|报名地址|apply|register)[：:\s]*(https?:\/\/[^\s\n]+)/i,
];

/** 联系方式提取 */
const CONTACT_PATTERNS = [
  /(?:联系方式|联系人|contact)[：:\s]*([^。\n；;]+)/,
  /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
  /(电话|Tel|TEL)[：:\s]*([\d-]+)/,
];

// ============================================================
// 核心函数
// ============================================================

/**
 * 从 CleanedContent 提取证据项。
 *
 * @param content 清洗后的内容
 * @param sourceId 关联的来源 ID
 * @returns EvidenceItem 数组
 */
export function extractEvidence(content: CleanedContent, sourceId: string): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const text = content.main_text ?? "";

  // 提取 title
  if (content.title) {
    items.push(buildEvidence(sourceId, "title", content.title, content.title, 0.95));
  }

  // 提取 deadline
  const deadline = extractByPatterns(text, DEADLINE_PATTERNS);
  if (deadline) {
    items.push(buildEvidence(sourceId, "deadline", deadline.value, deadline.evidence, 0.8));
  }

  // 提取 organizer
  const organizer = extractByPatterns(text, ORGANIZER_PATTERNS);
  if (organizer) {
    items.push(buildEvidence(sourceId, "organizer", organizer.value, organizer.evidence, 0.75));
  }

  // 提取 reward_or_value
  const reward = extractByPatterns(text, REWARD_PATTERNS);
  if (reward) {
    items.push(buildEvidence(sourceId, "reward_or_value", reward.value, reward.evidence, 0.7));
  }

  // 提取 eligibility
  const eligibility = extractByPatterns(text, ELIGIBILITY_PATTERNS);
  if (eligibility) {
    items.push(buildEvidence(sourceId, "eligibility", eligibility.value, eligibility.evidence, 0.7));
  }

  // 提取 region
  const region = extractByPatterns(text, REGION_PATTERNS);
  if (region) {
    items.push(buildEvidence(sourceId, "region", region.value, region.evidence, 0.65));
  }

  // 提取 application_url
  const appUrl = extractByPatterns(text, APPLICATION_URL_PATTERNS);
  if (appUrl) {
    items.push(buildEvidence(sourceId, "application_url", appUrl.value, appUrl.evidence, 0.85));
  }

  // 提取 contact_info
  const contact = extractByPatterns(text, CONTACT_PATTERNS);
  if (contact) {
    items.push(buildEvidence(sourceId, "contact_info", contact.value, contact.evidence, 0.7));
  }

  return items;
}

/**
 * 批量提取证据。
 *
 * @param contents 清洗内容数组
 * @param sourceIds 对应的来源 ID 数组
 * @returns EvidenceItem 数组（合并所有来源的证据）
 */
export function extractEvidenceBatch(
  contents: CleanedContent[],
  sourceIds: string[],
): EvidenceItem[] {
  const allItems: EvidenceItem[] = [];
  for (let i = 0; i < contents.length && i < sourceIds.length; i++) {
    const items = extractEvidence(contents[i], sourceIds[i]);
    allItems.push(...items);
  }
  return allItems;
}

// ============================================================
// 私有函数
// ============================================================

/** 构建单个 EvidenceItem */
function buildEvidence(
  sourceId: string,
  field: EvidenceField,
  value: string,
  evidenceText: string,
  confidence: number,
): EvidenceItem {
  return {
    evidenceId: generateEvidenceId(),
    sourceId,
    field,
    value: value.slice(0, 500),
    evidenceText: evidenceText.slice(0, 300),
    confidence,
    needsReview: shouldReviewEvidence(sourceId, confidence),
  };
}

/** 使用多个正则模式提取文本 */
function extractByPatterns(
  text: string,
  patterns: RegExp[],
): { value: string; evidence: string } | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1] || match[0];
      // 提取上下文作为证据文本（匹配前后各 50 字符）
      const matchStart = match.index ?? 0;
      const contextStart = Math.max(0, matchStart - 30);
      const contextEnd = Math.min(text.length, matchStart + value.length + 50);
      const evidence = text.substring(contextStart, contextEnd);
      return { value: value.trim(), evidence: evidence.trim() };
    }
  }
  return null;
}
