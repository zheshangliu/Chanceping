/**
 * SourceClassifier —— 来源分类器
 *
 * V1.3 新增。将 SearchResult → SourceCandidate。
 *
 * 安全红线：
 *   1. SourceCandidate 只来自真实 SearchResult
 *   2. LLM 不允许自己生成 URL
 *   3. LLM 输出的未知来源直接标记 rejected
 *
 * 分类规则：URL 域名 + provider reliability → SourceType + SourceConfidenceGrade
 */

import type { SearchResult } from "./types";
import type { SourceCandidate, SourceType, SourceConfidenceGrade, VerificationStatus } from "../schema/source-candidate";
import { generateSourceId, isOfficialSource } from "../schema/source-candidate";
import { providerRegistry } from "./provider-registry";

// ============================================================
// 域名 → 来源类型映射表
// ============================================================

/** 政府域名后缀 */
const GOV_DOMAINS = [".gov.cn", ".gov.com.cn"];

/** 教育域名后缀 */
const EDU_DOMAINS = [".edu.cn"];

/** 权威媒体域名 */
const AUTHORITATIVE_MEDIA_DOMAINS = [
  "xinhuanet.com", "news.cn", "people.com.cn", "cctv.com", "cntv.cn",
  "china.com.cn", "chinadaily.com.cn", "gmw.cn", "chinanews.com",
];

/** 社交平台域名 */
const SOCIAL_DOMAINS = [
  "weibo.com", "weibo.cn", "zhihu.com", "bilibili.com", "xiaohongshu.com",
  "douyin.com", "tiktok.com", "twitter.com", "x.com", "facebook.com",
];

/** 论坛域名 */
const FORUM_DOMAINS = [
  "v2ex.com", "reddit.com", "tieba.baidu.com", "douban.com",
];

// ============================================================
// 核心函数
// ============================================================

/**
 * 将 SearchResult 分类为 SourceCandidate。
 *
 * @param result 搜索结果
 * @returns 来源候选实体
 */
export function classifySource(result: SearchResult): SourceCandidate {
  const url = result.url;
  const domain = extractDomain(url);
  const providerName = result.source_provider;

  // 步骤 1：确定 SourceType
  const sourceType = determineSourceType(url, domain, result);

  // 步骤 2：确定 SourceConfidenceGrade
  const confidenceGrade = determineConfidenceGrade(domain, sourceType, providerName);

  // 步骤 3：确定 VerificationStatus
  const verificationStatus: VerificationStatus = "unverified";

  // 步骤 4：确定 isOfficial
  const official = isOfficialSource(sourceType);

  // 步骤 5：提取媒体名称
  const mediaName = extractMediaName(domain, providerName);

  return {
    sourceId: generateSourceId(),
    url,
    mediaName,
    sourceType,
    confidenceGrade,
    verificationStatus,
    publishedAt: result.published_at,
    excerpt: result.snippet?.slice(0, 500),
    isOfficial: official,
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * 批量分类搜索结果。
 *
 * @param results 搜索结果数组
 * @returns SourceCandidate 数组
 */
export function classifySources(results: SearchResult[]): SourceCandidate[] {
  return results.map(classifySource);
}

// ============================================================
// 私有函数
// ============================================================

/** 从 URL 提取域名 */
function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 精确域名匹配：hostname 等于 pattern，或以 "." + pattern 结尾。
 *
 * 避免子串误匹配（例如 "v2ex.com".includes("x.com") = true 的 bug）。
 */
function domainMatches(hostname: string, pattern: string): boolean {
  return hostname === pattern || hostname.endsWith("." + pattern);
}

/**
 * 确定来源类型。
 *
 * 优先级：政府 > 教育 > 权威媒体 > 社交 > 论坛 > provider reliability > 未知
 */
function determineSourceType(url: string, domain: string, result: SearchResult): SourceType {
  // 政府域名（后缀匹配，如 www.moe.gov.cn）
  if (GOV_DOMAINS.some((suffix) => domain.endsWith(suffix))) {
    return "government";
  }

  // 教育域名（后缀匹配）
  if (EDU_DOMAINS.some((suffix) => domain.endsWith(suffix))) {
    return "official";
  }

  // 权威媒体（精确域名匹配，避免子串误判）
  if (AUTHORITATIVE_MEDIA_DOMAINS.some((d) => domainMatches(domain, d))) {
    return "media_authoritative";
  }

  // 社交平台（精确域名匹配，避免 "v2ex.com" 误匹配 "x.com"）
  if (SOCIAL_DOMAINS.some((d) => domainMatches(domain, d))) {
    return "social";
  }

  // 论坛（精确域名匹配）
  if (FORUM_DOMAINS.some((d) => domainMatches(domain, d))) {
    return "forum";
  }

  // 含"官网"/"official"关键词
  if (result.title.includes("官网") || result.title.includes("official") || url.includes("official")) {
    return "official";
  }

  // 通过 provider reliability 推断
  const provider = providerRegistry.get(result.source_provider);
  if (provider) {
    if (provider.reliability === "A") return "official";
    if (provider.reliability === "B") return "media_authoritative";
    if (provider.reliability === "C") return "media_general";
    if (provider.reliability === "D") return "social";
  }

  return "unknown";
}

/**
 * 确定可信度等级（Admiralty Code 8 级）。
 */
function determineConfidenceGrade(
  domain: string,
  sourceType: SourceType,
  providerName: string,
): SourceConfidenceGrade {
  // 政府域名 → A1
  if (sourceType === "government") return "A1";

  // 教育域名 / 官网 → A2
  if (sourceType === "official") return "A2";

  // 权威媒体 → B1
  if (sourceType === "media_authoritative") return "B1";

  // 一般媒体 → B2
  if (sourceType === "media_general") return "B2";

  // 社交媒体
  if (sourceType === "social") {
    // 多源一致 → C1（V1.3 暂无法判断多源，默认 C3）
    return "C3";
  }

  // 论坛 → D4
  if (sourceType === "forum") return "D4";

  // 通过 provider reliability 推断
  const provider = providerRegistry.get(providerName);
  if (provider) {
    switch (provider.reliability) {
      case "A": return "A2";
      case "B": return "B1";
      case "C": return "B2";
      case "D": return "C3";
      case "F": return "E5";
    }
  }

  // 未知 → E5
  return "E5";
}

/** 提取媒体名称 */
function extractMediaName(domain: string, providerName: string): string {
  if (!domain) return providerName;

  // 已知域名映射（使用精确匹配避免子串误判）
  const domainNames: Record<string, string> = {
    "xinhuanet.com": "新华网",
    "news.cn": "新华网",
    "people.com.cn": "人民网",
    "cctv.com": "央视网",
    "weibo.com": "微博",
    "zhihu.com": "知乎",
    "bilibili.com": "哔哩哔哩",
    "xiaohongshu.com": "小红书",
  };

  for (const [d, name] of Object.entries(domainNames)) {
    if (domainMatches(domain, d)) return name;
  }

  // 提取主域名
  const parts = domain.split(".");
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return providerName;
}
