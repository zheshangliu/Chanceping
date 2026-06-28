/**
 * Watch Rules 与搜索层集成
 *
 * 来源：Task 024 第 4.3 节。
 *
 * 提供：
 *   - scoredOpportunityToCard：ScoredOpportunity → OpportunityCard 转换
 *   - scoredOpportunityToStoreEntry：ScoredOpportunity → StoreEntry 转换（用于 Watch Rules 匹配）
 *   - filterByWatchRules：用 Watch Rules 过滤 ScoredOpportunity
 *   - integrateSearchWithWatchRules：搜索 → 去重 → 过滤 → 入库（完整流程）
 *
 * 纯函数 + 接口注入，不接 LLM，不编造信息。
 *
 * 注意：ScoredOpportunity 的 SearchResult 仅含 title/url/snippet 等字段，
 * 不含 type/organizer/region/deadline 等。转换时这些字段填空字符串，
 * 入库后由业务层补充。OpportunityCard 必填字段保持完整。
 */

import type { ScoredOpportunity } from "../search/types";
import type { StoreEntry, OpportunityStore, RadarType } from "../agents/opportunity-store";
import type { OpportunityCard } from "../schema/opportunity-card";
import type { CardVisibleLevel } from "../schema/scoring-rules";
import type { WatchRuleSet } from "./types";
import { filterByRules } from "./rule-matcher";
import type { IncrementalTagger, IncrementalTagResult } from "../search/incremental-tagger";

// ============================================================
// 类型定义
// ============================================================

/** 搜索集成结果 */
export interface SearchIntegrationResult {
  /** 原始机会数（搜索产出） */
  total_opportunities: number;
  /** 去重后需分析数（is_analyzed=false） */
  needs_analysis: number;
  /** 去重复用数（is_analyzed=true，跳过 LLM） */
  cache_reused: number;
  /** Watch Rules 过滤后数 */
  watch_filtered: number;
  /** 被过滤掉数 */
  watch_filtered_out: number;
  /** 入库数 */
  stored: number;
  /** 入库的条目 */
  stored_entries: StoreEntry[];
  /** 增量标签详情 */
  tags: IncrementalTagResult[];
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 映射搜索层可见等级到卡片可见等级。
 *
 * SearchVisibleLevel 含 "hidden"，但 CardVisibleLevel 不含。
 * "hidden" 降级为 "C"（保证卡片必填字段有效）。
 */
function mapVisibleLevel(level: string): CardVisibleLevel {
  const valid: CardVisibleLevel[] = ["S", "A", "B", "C"];
  const upper = (level ?? "").toUpperCase();
  return valid.includes(upper as CardVisibleLevel) ? (upper as CardVisibleLevel) : "C";
}

/**
 * 为 ScoredOpportunity 生成临时 dedup_key（用于 Watch Rules 匹配回溯）。
 *
 * 注意：这是临时 key，仅用于 filterByWatchRules 中关联 StoreEntry 与 ScoredOpportunity。
 * 实际入库时由 OpportunityStore.addBatch 通过 computeDedupKey 计算真实 dedup_key。
 */
function tempDedupKey(opp: ScoredOpportunity): string {
  return `${opp.search_result.url}::${opp.guid ?? ""}`;
}

// ============================================================
// 转换函数
// ============================================================

/**
 * 将 ScoredOpportunity 转换为 OpportunityCard。
 *
 * ScoredOpportunity 是搜索层产出，OpportunityCard 是机会库存储格式。
 * SearchResult 仅含 title/url/snippet，其他卡片字段填空字符串。
 */
export function scoredOpportunityToCard(opp: ScoredOpportunity): OpportunityCard {
  const sr = opp.search_result;
  return {
    title: sr.title,
    type: "",
    organizer: "",
    region: "",
    deadline: "",
    reward_or_value: "",
    eligibility: "",
    materials_required: "",
    match_reason: opp.relevance_reason,
    next_action: "",
    official_source_url: sr.url,
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: opp.backend_score,
    visible_level: mapVisibleLevel(opp.visible_level),
    status: "new",
    guid: opp.guid,
  };
}

/**
 * 将 ScoredOpportunity 转换为 StoreEntry（用于 Watch Rules 匹配）。
 *
 * 临时 StoreEntry，dedup_key 用 url::guid 格式，仅用于过滤回溯。
 */
export function scoredOpportunityToStoreEntry(
  opp: ScoredOpportunity,
  radarType: RadarType,
): StoreEntry {
  const now = new Date().toISOString();
  return {
    card: scoredOpportunityToCard(opp),
    radar_type: radarType,
    added_at: now,
    updated_at: now,
    dedup_key: tempDedupKey(opp),
  };
}

// ============================================================
// 过滤函数
// ============================================================

/**
 * 用 Watch Rules 过滤 ScoredOpportunity 列表。
 *
 * 流程：
 *   1. 将 ScoredOpportunity 转为临时 StoreEntry
 *   2. 用 filterByRules 过滤（空规则集返回全部）
 *   3. 通过 dedup_key 回溯到原始 ScoredOpportunity
 *
 * @param opportunities 搜索产出的机会列表
 * @param ruleSet Watch Rules 规则集
 * @param radarType 雷达类型
 * @returns 过滤后的机会列表 + 被过滤掉的数量
 */
export function filterByWatchRules(
  opportunities: ScoredOpportunity[],
  ruleSet: WatchRuleSet,
  radarType: RadarType,
): { filtered: ScoredOpportunity[]; filtered_out: number } {
  // 转换为 StoreEntry 用于 Watch Rules 匹配
  const entries = opportunities.map((opp) =>
    scoredOpportunityToStoreEntry(opp, radarType),
  );

  // 用 Watch Rules 过滤（空规则集返回全部）
  const matchedEntries = filterByRules(entries, ruleSet);

  // 找回对应的 ScoredOpportunity（通过 dedup_key 关联）
  const matchedKeys = new Set(matchedEntries.map((e) => e.dedup_key));
  const filtered = opportunities.filter((opp) => matchedKeys.has(tempDedupKey(opp)));

  return {
    filtered,
    filtered_out: opportunities.length - filtered.length,
  };
}

// ============================================================
// 端到端集成
// ============================================================

/**
 * 端到端集成：搜索结果 → 去重 → Watch Rules 过滤 → 入库。
 *
 * 流程：
 *   1. IncrementalTagger 标记每条结果（判断是否需重新分析）
 *   2. 需要分析的标记 markAnalyzed（缓存结果，供下次复用）
 *   3. Watch Rules 过滤（只保留用户关注的）
 *   4. 过滤后的结果入库
 *
 * @param opportunities 搜索产出的机会列表
 * @param ruleSet Watch Rules 规则集
 * @param store 机会库
 * @param tagger 增量标签管理器
 * @param radarType 雷达类型
 * @returns 集成结果
 */
export function integrateSearchWithWatchRules(
  opportunities: ScoredOpportunity[],
  ruleSet: WatchRuleSet,
  store: OpportunityStore,
  tagger: IncrementalTagger,
  radarType: RadarType,
): SearchIntegrationResult {
  // 1. 增量标签标记
  const tags = tagger.tagBatch(opportunities);
  const needsAnalysis = tags.filter((t) => t.needs_reanalysis).length;
  const cacheReused = tags.filter((t) => t.is_analyzed).length;

  // 2. 记录分析结果（缓存，供下次复用）
  tagger.markBatchAnalyzed(opportunities);

  // 3. Watch Rules 过滤
  const { filtered, filtered_out: watchFilteredOut } = filterByWatchRules(
    opportunities,
    ruleSet,
    radarType,
  );

  // 4. 入库
  const cards = filtered.map(scoredOpportunityToCard);
  const storedEntries = store.addBatch(cards, radarType);

  return {
    total_opportunities: opportunities.length,
    needs_analysis: needsAnalysis,
    cache_reused: cacheReused,
    watch_filtered: filtered.length,
    watch_filtered_out: watchFilteredOut,
    stored: storedEntries.length,
    stored_entries: storedEntries,
    tags,
  };
}
