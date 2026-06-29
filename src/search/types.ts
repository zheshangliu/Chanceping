/**
 * 搜索层类型定义（search types）
 *
 * 来源：Task 019c 第 4.1 节。
 *
 * 搜索层 6 层架构的数据契约：
 *   第一层（搜索 API）→ SearchResult
 *   第三层（爬虫抓取）→ CleanedContent
 *   第六层（评分）→ ScoredOpportunity
 *
 * 纯类型定义，无运行时逻辑，不引入依赖。
 */

/** 搜索结果来源类型 */
export type SearchSourceType = "web" | "rss" | "social" | "gov";

/** 可见等级（与 OpportunityCard.visible_level 对齐；V1.3 新增 D 级） */
export type SearchVisibleLevel = "S" | "A" | "B" | "C" | "D" | "hidden";

/**
 * 搜索结果（第一层 API 返回的原始结果）。
 *
 * 由 SearchProvider.search() 返回，是搜索层最基础的产出。
 */
export interface SearchResult {
  /** 结果标题 */
  title: string;
  /** 结果链接（HTTPS，已通过 T1 校验 + T3 标准化） */
  url: string;
  /** 摘要（搜索 API 返回的 snippet） */
  snippet: string;
  /** 来源 provider（如 "serper" / "bocha"） */
  source_provider: string;
  /** 来源类型 */
  source_type: SearchSourceType;
  /** 发布日期（ISO 8601，可选） */
  published_at?: string;
  /** 原始 API 返回（调试用，不参与业务逻辑） */
  raw_data?: unknown;
}

/**
 * 清洗后的内容（第四层输出）。
 *
 * 由 JinaReaderFetcher.fetch() 或 cleanContent() 产出，
 * 供第六层 AI 评分使用。
 */
export interface CleanedContent {
  /** 来源 URL */
  url: string;
  /** 页面标题 */
  title: string;
  /** 正文文本（AI 可读，已移除 HTML 标签和噪音） */
  main_text: string;
  /** 发布日期（ISO 8601，可选） */
  publish_date?: string;
  /** 作者（可选） */
  author?: string;
  /** 正文字数 */
  word_count: number;
  /** 抓取是否成功 */
  fetch_success: boolean;
  /** 抓取失败时的错误信息 */
  fetch_error?: string;
}

/** 机会评分维度（chance_score） */
export interface ChanceScore {
  /** 匹配度（0-100） */
  fit: number;
  /** 意图匹配（0-100） */
  intent: number;
  /** 证据可信度（0-100） */
  evidence: number;
  /** 紧迫度（0-100） */
  urgency: number;
  /** 行动成本（0-100，越低越好） */
  effort_cost: number;
  /** 综合分（0-100） */
  total: number;
}

/**
 * 评分后的机会（第六层输出，Task 019d 使用）。
 *
 * 包含搜索结果 + 清洗内容 + AI 评分，是搜索层的最终产出。
 */
export interface ScoredOpportunity {
  /** 搜索结果 */
  search_result: SearchResult;
  /** 清洗后的内容 */
  cleaned_content: CleanedContent;
  /** AI 精筛相关度（0-100） */
  relevance_score: number;
  /** AI 判断理由 */
  relevance_reason: string;
  /** 机会评分（六维） */
  chance_score: ChanceScore;
  /** 可见等级 */
  visible_level: SearchVisibleLevel;
  /** 后台分数（= chance_score.total） */
  backend_score: number;
  /** T2: 全局唯一标识（可选） */
  guid?: string;
}

/**
 * 搜索选项。
 *
 * 传递给 SearchProvider.search()，控制搜索行为。
 */
export interface SearchOptions {
  /** 最大结果数（默认 10） */
  max_results?: number;
  /** 搜索语言（i18n searchLocales） */
  language?: string;
  /** 地域限定（如 "cn" / "us"） */
  region?: string;
  /** 站点限定（如 "gov.cn"） */
  site_filter?: string;
}
