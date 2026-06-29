/**
 * SourceCandidate —— 来源候选实体
 *
 * V1.3 新增。实现 Perplexity 级别的来源透明能力。
 * 与 EvidenceItem 配合，实现字段级证据追溯。
 *
 * 安全红线：
 *   1. SourceCandidate 只能来自真实 SearchResult 或用户上传文件
 *   2. LLM 不允许自己生成 URL
 *   3. 报告来源索引只能从 SourceCandidate[] 渲染
 *   4. LLM 输出的未知来源直接丢弃或标记 rejected
 *
 * 设计依据：GPT 调研的关键优势——双实体架构（SourceCandidate + EvidenceItem）。
 */

// ============================================================
// 来源类型（9 分类）
// ============================================================

/**
 * 来源类型分类。
 *
 * 分类依据：URL 域名 + 内容特征，由 source-classifier.ts（Task C）实现。
 */
export type SourceType =
  | "official"            // 官方网站（赛事官网、政策原文）
  | "government"          // 政府网站（.gov.cn）
  | "organizer"           // 主办方网站
  | "media_authoritative" // 权威媒体（新华社、人民网）
  | "media_general"       // 一般媒体
  | "social"              // 社交媒体（微博、知乎、B站）
  | "forum"               // 论坛（V2EX、Reddit）
  | "user_uploaded"       // 用户上传文件
  | "unknown";            // 未知类型

// ============================================================
// 来源可信度等级（Admiralty Code 8 级简化版）
// ============================================================

/**
 * 来源可信度等级（Admiralty Code 简化版）。
 *
 * 原版 Admiralty Code 有 30 种组合（A-F × 1-6），
 * V1.3 简化为 8 级，覆盖实际场景的 95%+。
 *
 * 等级说明：
 *   A1：官方/政府来源，直接确认，完全可靠
 *   A2：官方来源，间接确认，高度可靠
 *   B1：权威媒体，报道一致，较可靠
 *   B2：一般媒体，报道一致，较可靠
 *   C1：社交媒体，多源一致，可信度一般
 *   C3：社交媒体，单一来源，可信度较低
 *   D4：论坛/匿名，可信度低
 *   E5：未知来源，不可信
 */
export type SourceConfidenceGrade = "A1" | "A2" | "B1" | "B2" | "C1" | "C3" | "D4" | "E5";

// ============================================================
// 验证状态
// ============================================================

/**
 * 来源验证状态。
 *
 * - verified：已验证（多源交叉确认或官方直接确认）
 * - partially_verified：部分验证（部分字段已验证，部分待复核）
 * - unverified：未验证（仅抓取，未经交叉验证）
 * - rejected：已拒绝（AI 编造的 URL 或无法访问的链接）
 */
export type VerificationStatus = "verified" | "partially_verified" | "unverified" | "rejected";

// ============================================================
// SourceCandidate 主体
// ============================================================

/**
 * 来源候选实体。
 *
 * 记录"来源是什么"：URL、媒体名称、类型、可信度等级、验证状态。
 * 与 EvidenceItem（记录"来源支撑了哪个字段"）通过 sourceId 关联。
 *
 * 安全约束：url 必须来自真实 SearchResult 或用户上传文件，
 * 严禁由 LLM 生成。
 */
export interface SourceCandidate {
  /** 来源唯一 ID（src_ 前缀） */
  sourceId: string;
  /** 来源 URL（必须来自真实 SearchResult，严禁 LLM 生成） */
  url: string;
  /** 媒体/网站名称（如"新华网"、"教育部官网"） */
  mediaName: string;
  /** 来源类型 */
  sourceType: SourceType;
  /** 可信度等级（Admiralty Code 8 级） */
  confidenceGrade: SourceConfidenceGrade;
  /** 验证状态 */
  verificationStatus: VerificationStatus;
  /** 发布时间（ISO 8601，可选） */
  publishedAt?: string;
  /** 摘录文本（来源页面中与本机会相关的片段，≤500 字） */
  excerpt?: string;
  /** 是否为官方来源（government 或 official 类型） */
  isOfficial: boolean;
  /** 抓取时间（ISO 8601） */
  retrievedAt: string;
}

// ============================================================
// 可信度等级映射
// ============================================================

/** 可信度等级 → 数值分数映射（用于评分计算） */
export const CONFIDENCE_GRADE_SCORES: Record<SourceConfidenceGrade, number> = {
  A1: 100,
  A2: 90,
  B1: 80,
  B2: 70,
  C1: 60,
  C3: 50,
  D4: 30,
  E5: 10,
};

/** 可信度等级 → 中文标签 */
export const CONFIDENCE_GRADE_LABELS: Record<SourceConfidenceGrade, string> = {
  A1: "官方直接确认",
  A2: "官方间接确认",
  B1: "权威媒体",
  B2: "一般媒体",
  C1: "社交媒体（多源）",
  C3: "社交媒体（单一）",
  D4: "论坛/匿名",
  E5: "未知来源",
};

/** 来源类型 → 中文标签 */
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  official: "官方网站",
  government: "政府网站",
  organizer: "主办方",
  media_authoritative: "权威媒体",
  media_general: "一般媒体",
  social: "社交媒体",
  forum: "论坛",
  user_uploaded: "用户上传",
  unknown: "未知",
};

// ============================================================
// 工厂函数
// ============================================================

/**
 * 生成来源 ID（src_ 前缀 + 时间戳 + 随机串）
 */
export function generateSourceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `src_${ts}${rand}`;
}

/**
 * 判断来源类型是否为官方来源。
 *
 * @param sourceType 来源类型
 * @returns official 或 government 类型返回 true
 */
export function isOfficialSource(sourceType: SourceType): boolean {
  return sourceType === "official" || sourceType === "government";
}
