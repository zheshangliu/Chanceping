/**
 * EvidenceItem —— 证据项实体
 *
 * V1.3 新增。实现字段级证据追溯：每个机会字段可以追溯到具体来源的具体段落。
 * 与 SourceCandidate 配合，通过 sourceId 关联。
 *
 * 安全红线：
 *   1. EvidenceItem.sourceId 必须指向已存在的 SourceCandidate
 *   2. 没有 sourceId 的字段标记为 needsReview=true
 *   3. evidenceText 必须来自来源页面的真实文本，严禁 LLM 编造
 *
 * 设计依据：GPT 调研的关键优势——Perplexity 级别的字段级证据追溯。
 */

// ============================================================
// 证据字段类型
// ============================================================

/**
 * 证据字段类型（对应 OpportunityCard 的核心字段）。
 *
 * 每个证据项支撑一个具体字段，实现"截止日期来自哪里？"的字段级追溯。
 */
export type EvidenceField =
  | "title"             // 机会名称
  | "deadline"          // 截止日期
  | "organizer"         // 主办方
  | "reward_or_value"   // 奖励/价值
  | "eligibility"       // 适合对象/资格要求
  | "region"            // 地区
  | "application_url"   // 报名链接
  | "contact_info";     // 联系方式

// ============================================================
// EvidenceItem 主体
// ============================================================

/**
 * 证据项。
 *
 * 记录"这个来源支撑了哪个字段"：字段名、字段值、原文片段、置信度。
 * 与 SourceCandidate（记录"来源是什么"）通过 sourceId 关联。
 *
 * 安全约束：
 *   - sourceId 必须指向已存在的 SourceCandidate
 *   - evidenceText 必须来自来源页面的真实文本
 *   - 无 sourceId 时 needsReview 必须为 true
 */
export interface EvidenceItem {
  /** 证据项唯一 ID（ev_ 前缀） */
  evidenceId: string;
  /** 关联的来源 ID（必须指向已存在的 SourceCandidate） */
  sourceId: string;
  /** 支撑的字段 */
  field: EvidenceField;
  /** 字段值（从来源提取的值） */
  value: string;
  /** 原文片段（来源页面中支撑该字段的具体文本，≤300 字） */
  evidenceText: string;
  /** 提取置信度（0-1，规则提取约 0.8，LLM 提取约 0.9） */
  confidence: number;
  /** 是否需要人工复核（无 sourceId 或低置信度时为 true） */
  needsReview: boolean;
}

// ============================================================
// 辅助类型与常量
// ============================================================

/** 证据字段 → 中文标签 */
export const EVIDENCE_FIELD_LABELS: Record<EvidenceField, string> = {
  title: "机会名称",
  deadline: "截止日期",
  organizer: "主办方",
  reward_or_value: "奖励/价值",
  eligibility: "适合对象",
  region: "地区",
  application_url: "报名链接",
  contact_info: "联系方式",
};

/** 需要人工复核的置信度阈值 */
export const EVIDENCE_REVIEW_THRESHOLD = 0.6;

// ============================================================
// 工厂函数
// ============================================================

/**
 * 生成证据项 ID（ev_ 前缀 + 时间戳 + 随机串）
 */
export function generateEvidenceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `ev_${ts}${rand}`;
}

/**
 * 判断证据项是否需要人工复核。
 *
 * 规则：
 *   1. 无 sourceId → needsReview = true
 *   2. confidence < EVIDENCE_REVIEW_THRESHOLD → needsReview = true
 *   3. 否则 → needsReview = false
 *
 * @param sourceId 来源 ID（空字符串表示无来源）
 * @param confidence 提取置信度
 */
export function shouldReviewEvidence(sourceId: string, confidence: number): boolean {
  if (!sourceId) return true;
  return confidence < EVIDENCE_REVIEW_THRESHOLD;
}
