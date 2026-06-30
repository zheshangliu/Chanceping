/**
 * T10 搜索编排器（search orchestrator）
 *
 * 来源：Task 019d 第 4.4 节。
 *
 * 串联 T10 三层筛选：
 *   1. 根据 spec 雷达类型从 providerRegistry 获取 providers
 *   2. 并行调用各 provider 的 search()，合并搜索结果
 *   3. 第一层：ruleFilter 规则粗筛
 *   4. 第二层：aiFilter AI 精筛（enableContentFetch=false 时跳过，relevance 固定 50）
 *   5. 第三层：scoreOpportunities 机会评分
 *   6. 返回 SearchOrchestratorResult
 *
 * 错误隔离：
 *   - provider 调用失败 → errors 记录，不影响其他 provider
 *   - 无可用 provider → 返回空结果 + errors 记录
 *   - 整个流程不因单步失败而中断
 *
 * Mock 模式：全部走 Mock（SerperProvider Mock + QwenAdapter Mock），端到端可测试。
 */

import type { ScoredOpportunity, SearchResult, CleanedContent } from "./types";
import type { SearchProvider } from "./provider-registry";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import type { ProviderRouting } from "../schema/radar";
import type { LLMAdapter } from "../agents/llm-adapter";
import type { DataMode } from "../demo/data-mode";
import type { SourceCandidate } from "../schema/source-candidate";
import type { EvidenceItem } from "../schema/evidence-item";
import type { OpportunityCard } from "../schema/opportunity-card";
import type { RadarType, OpportunityStore } from "../agents/opportunity-store";
import { computeDedupKey } from "../agents/opportunity-store";
import { providerRegistry } from "./provider-registry";
import { ruleFilter } from "./rule-filter";
import { aiFilter, type AIFilterItem } from "./ai-filter";
import { scoreOpportunities } from "./opportunity-scorer";
import { deduplicateByUrL } from "./radar-router";
import { loadDemoSearchResults } from "../demo";
import { classifySources } from "./source-classifier";
import { extractEvidenceBatch } from "./evidence-extractor";
import { mapToCard } from "./opportunity-card-mapper";

/** 搜索编排器配置 */
export interface SearchOrchestratorConfig {
  /** LLM 适配器（Mock 或真实） */
  llmAdapter: LLMAdapter;
  /** 每个 provider 最大结果数，默认 10 */
  maxResultsPerProvider?: number;
  /** AI 精筛阈值，默认 50 */
  minRelevance?: number;
  /** 是否抓取正文，默认 true */
  enableContentFetch?: boolean;
  /** Jina Reader 抓取模式：true=Mock内容（默认），false=真实抓取 */
  mockContent?: boolean;
  /**
   * 数据模式（Task 036）：
   *   - "mock"：加载 Mock Demo 数据，跳过真实搜索
   *   - "recorded"：加载 Recorded 录制数据，跳过真实搜索
   *   - "live"：（默认）使用真实搜索 Provider
   * 未设置时默认 "live"，以保护现有测试不依赖环境变量。
   */
  dataMode?: DataMode;
  /**
   * V1.6-07 新增：机会库引用（可选，用于增量标签复用）。
   *
   * 传入后，AI 精筛前会检查 store 中是否已有同 dedupKey 且 incremental=true 的条目：
   *   - 命中：跳过 AI 精筛，复用 store 中的 card.ai_analysis 构造 AIFilterItem
   *   - 未命中：调用 aiFilter 正常精筛
   *
   * 不传入时行为不变（向后兼容）。
   */
  opportunityStore?: OpportunityStore;
}

/** 搜索编排器结果 */
export interface SearchOrchestratorResult {
  /** 原始搜索结果数 */
  total_raw: number;
  /** 规则粗筛通过数 */
  total_rule_passed: number;
  /** AI 精筛通过数 */
  total_ai_passed: number;
  /** 评分完成数 */
  total_scored: number;
  /** 最终机会列表 */
  opportunities: ScoredOpportunity[];
  /** 错误信息 */
  errors: string[];
  /** 总耗时（毫秒） */
  duration_ms: number;
  // ============================================================
  // V1.3 新增字段（来源透明，全部 optional）
  // ============================================================
  /** V1.3 新增：来源候选列表（每个搜索结果对应的来源分类） */
  sourceCandidates?: SourceCandidate[];
  /** V1.3 新增：证据项列表（从清洗内容中提取的字段级证据） */
  evidenceItems?: EvidenceItem[];
  /** V1.3 新增：机会卡片列表（映射后的 OpportunityCard，含 S 级硬规则） */
  opportunityCards?: OpportunityCard[];
  // ============================================================
  // V1.6-06 新增字段（Watch Rules 过滤指标）
  // ============================================================
  /** V1.6-06 新增：Watch Rules 过滤前数量（未配置规则时与 total_scored 相同） */
  watch_rules_before?: number;
  /** V1.6-06 新增：Watch Rules 过滤后数量（未配置规则时与 total_scored 相同） */
  watch_rules_after?: number;
  /** V1.6-06 新增：Watch Rules 被过滤掉的数量 */
  watch_rules_filtered_out?: number;
  // ============================================================
  // V1.6-07 新增字段（增量标签复用指标）
  // ============================================================
  /** V1.6-07 新增：因 incremental=true 跳过 AI 精筛的数量（复用上次分析） */
  ai_filter_skipped?: number;
  /** V1.6-07 新增：实际调用 AI 精筛的数量（fresh 未命中缓存） */
  ai_filter_executed?: number;
  // ============================================================
  // V1.6-08 新增字段（providerRouting fallback 降级信息）
  // ============================================================
  /** V1.6-08 新增：provider 降级信息（primary 全失败时记录 fallback 触发情况） */
  providerDegradation?: {
    /** 是否触发了 fallback */
    fallbackUsed: boolean;
    /** primary provider 的错误记录（provider name → 错误信息） */
    primaryErrors: Record<string, string>;
    /** 实际被调用的 fallback provider 名称列表 */
    fallbackProviders: string[];
  };
}

/** 默认每个 provider 最大结果数 */
const DEFAULT_MAX_RESULTS_PER_PROVIDER = 10;

/** 默认 AI 精筛阈值 */
const DEFAULT_MIN_RELEVANCE = 50;

/** 跳过内容抓取时的固定相关度 */
const SKIP_FETCH_RELEVANCE = 50;

/** 默认数据模式（未显式配置时使用 live，保护现有测试） */
const DEFAULT_DATA_MODE: DataMode = "live";

/**
 * 从 spec 推断雷达类型。
 * spec 没有 radar_type 字段，从 opportunity_scope.primary_opportunity_types 推断：
 *   - 含 "比赛"/"赛事" → "ai_competition"
 *   - 含 "政策"/"补贴" → "opc_policy"
 *   - 含 "文创"/"非遗" → "cultural_heritage"
 *   - 默认 → "ai_competition"
 */
function inferRadarType(spec: RadarRequirementSpec): string {
  const types = spec?.opportunity_scope?.primary_opportunity_types ?? [];
  const text = types.join(" ");
  if (/政策|补贴|扶持|申报/.test(text)) {
    return "opc_policy";
  }
  if (/文创|非遗|文化/.test(text)) {
    return "cultural_heritage";
  }
  // 默认 AI 赛事（SerperProvider 的 radar_types 含 ai_competition）
  return "ai_competition";
}

/**
 * 从 spec 拼接查询词。
 * 优先使用 core_keywords_zh，其次 core_keywords_en。
 */
function buildQueryFromSpec(spec: RadarRequirementSpec): string {
  const zh = spec?.keyword_strategy?.core_keywords_zh ?? [];
  const en = spec?.keyword_strategy?.core_keywords_en ?? [];
  if (zh.length > 0) {
    return zh.slice(0, 3).join(" ");
  }
  if (en.length > 0) {
    return en.slice(0, 3).join(" ");
  }
  return "AI 比赛";
}

/**
 * 构造跳过内容抓取时的 AIFilterItem（relevance 固定 50）。
 */
function buildSkipFetchItems(results: SearchResult[]): AIFilterItem[] {
  return results.map((result) => {
    const emptyContent: CleanedContent = {
      url: result.url,
      title: result.title,
      main_text: result.snippet ?? "",
      word_count: result.snippet?.length ?? 0,
      fetch_success: true,
    };
    return {
      result,
      content: emptyContent,
      relevance: SKIP_FETCH_RELEVANCE,
      reason: "跳过内容抓取，固定相关度 50",
    };
  });
}

/**
 * 搜索编排器：串联 T10 三层筛选。
 */
export class SearchOrchestrator {
  private readonly llmAdapter: LLMAdapter;
  private readonly maxResultsPerProvider: number;
  private readonly minRelevance: number;
  private readonly enableContentFetch: boolean;
  private readonly mockContent: boolean;
  private readonly dataMode: DataMode;
  /** V1.6-07：机会库引用（可选，用于增量标签复用） */
  private readonly opportunityStore?: OpportunityStore;

  constructor(config: SearchOrchestratorConfig) {
    this.llmAdapter = config.llmAdapter;
    this.maxResultsPerProvider = config.maxResultsPerProvider ?? DEFAULT_MAX_RESULTS_PER_PROVIDER;
    this.minRelevance = config.minRelevance ?? DEFAULT_MIN_RELEVANCE;
    this.enableContentFetch = config.enableContentFetch ?? true;
    this.mockContent = config.mockContent ?? true;
    this.dataMode = config.dataMode ?? DEFAULT_DATA_MODE;
    this.opportunityStore = config.opportunityStore;
  }

  /**
   * 执行搜索 + T10 三层筛选。
   *
   * @param spec 雷达需求规格
   * @param query 查询词（可选，为空时从 spec 拼接）
   * @param providerRouting Provider 路由（可选，V1.5 自检：优先于 inferRadarType）
   * @param watchRules Watch Rules DSL 规则列表（可选，V1.6-06 新增：搜索结果入库前过滤）
   * @returns SearchOrchestratorResult
   */
  async search(
    spec: RadarRequirementSpec,
    query?: string,
    providerRouting?: ProviderRouting,
    watchRules?: string[],
  ): Promise<SearchOrchestratorResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    // V1.6-08：provider 降级信息（live 模式下由 primary/fallback 逻辑写入）
    let _providerDegradation: SearchOrchestratorResult["providerDegradation"] | undefined;

    // 步骤 0：推断雷达类型（供 Demo 数据加载和真实搜索共用）
    const radarType = inferRadarType(spec);

    // 步骤 1：根据数据模式获取原始搜索结果（Task 036）
    // - mock/recorded：加载 Demo 数据，跳过真实搜索
    // - live：调用真实搜索 Provider
    let rawResults: SearchResult[];

    if (this.dataMode === "mock" || this.dataMode === "recorded") {
      // Mock/Recorded 模式：加载 Demo 数据
      try {
        rawResults = loadDemoSearchResults(radarType, this.dataMode);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`加载 Demo 数据失败（mode=${this.dataMode}）: ${errMsg}`);
        return {
          total_raw: 0,
          total_rule_passed: 0,
          total_ai_passed: 0,
          total_scored: 0,
          opportunities: [],
          errors,
          duration_ms: Date.now() - startTime,
        };
      }
    } else {
      // Live 模式：获取适用 providers
      // V1.5 自检：优先使用 providerRouting，fallback 到 inferRadarType
      // V1.6-08：支持 primary 全失败时启用 fallback provider
      let primaryProviders: SearchProvider[] = [];
      let fallbackProviders: SearchProvider[] = [];
      let providerDegradation: SearchOrchestratorResult["providerDegradation"] | undefined;

      if (providerRouting && providerRouting.primary && providerRouting.primary.length > 0) {
        // V1.6-08：非法 provider 名称告警
        const invalidNames = providerRouting.primary.filter(
          (name) => !providerRegistry.get(name),
        );
        if (invalidNames.length > 0) {
          console.warn(`[V1.6-08] 非法 provider 名称: ${invalidNames.join(", ")}`);
        }
        primaryProviders = providerRegistry.getByNames(providerRouting.primary);
        // V1.6-08：预取 fallback providers（primary 全失败时启用）
        if (providerRouting.fallback && providerRouting.fallback.length > 0) {
          const invalidFallbackNames = providerRouting.fallback.filter(
            (name) => !providerRegistry.get(name),
          );
          if (invalidFallbackNames.length > 0) {
            console.warn(`[V1.6-08] 非法 fallback provider 名称: ${invalidFallbackNames.join(", ")}`);
          }
          fallbackProviders = providerRegistry.getByNames(providerRouting.fallback);
        }
      } else {
        primaryProviders = providerRegistry.getByRadarType(radarType).filter((p) => p.enabled);
      }

      if (primaryProviders.length === 0 && fallbackProviders.length === 0) {
        errors.push(`无可用搜索 provider（radar_type=${radarType}）`);
        return {
          total_raw: 0,
          total_rule_passed: 0,
          total_ai_passed: 0,
          total_scored: 0,
          opportunities: [],
          errors,
          duration_ms: Date.now() - startTime,
        };
      }

      // 步骤 2：并行调用各 primary provider 的 search()
      const searchQuery = query && query.trim() ? query.trim() : buildQueryFromSpec(spec);
      const searchOptions = { max_results: this.maxResultsPerProvider };

      const primaryResults = await Promise.all(
        primaryProviders.map(async (provider) => {
          try {
            const results = await provider.search(searchQuery, searchOptions);
            return { provider: provider.name, results, error: null as string | null };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            return { provider: provider.name, results: [] as SearchResult[], error: `provider ${provider.name} 调用失败: ${errMsg}` };
          }
        }),
      );

      // 收集 primary 错误
      const primaryErrors: Record<string, string> = {};
      for (const r of primaryResults) {
        if (r.error) {
          errors.push(r.error);
          primaryErrors[r.provider] = r.error;
        }
      }

      // 合并 primary 搜索结果
      let allResults = deduplicateByUrL(primaryResults.flatMap((r) => r.results));

      // V1.6-08：primary 全失败（无结果）时启用 fallback
      let fallbackUsed = false;
      const fallbackProviderNames: string[] = [];
      if (
        allResults.length === 0 &&
        primaryProviders.length > 0 &&
        fallbackProviders.length > 0
      ) {
        fallbackUsed = true;
        const fallbackResults = await Promise.all(
          fallbackProviders.map(async (provider) => {
            fallbackProviderNames.push(provider.name);
            try {
              const results = await provider.search(searchQuery, searchOptions);
              return { provider: provider.name, results, error: null as string | null };
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              const fallbackErrMsg = `[fallback] provider ${provider.name} 调用失败: ${errMsg}`;
              return { provider: provider.name, results: [] as SearchResult[], error: fallbackErrMsg };
            }
          }),
        );

        for (const r of fallbackResults) {
          if (r.error) {
            errors.push(r.error);
            primaryErrors[r.provider] = r.error;
          }
        }

        allResults = deduplicateByUrL(fallbackResults.flatMap((r) => r.results));
        errors.push(
          `[V1.6-08] primary providers 全失败，已降级到 fallback: ${fallbackProviderNames.join(", ")}`,
        );
      }

      // V1.6-08：记录降级信息（仅在配置了 fallback 时才输出，即使未触发）
      if (providerRouting?.fallback && providerRouting.fallback.length > 0) {
        providerDegradation = {
          fallbackUsed,
          primaryErrors,
          fallbackProviders: fallbackProviderNames,
        };
      }

      rawResults = allResults;

      // 将 providerDegradation 存入闭包变量，供最终 return 使用
      _providerDegradation = providerDegradation;
    }

    // 边界情况：无搜索结果
    if (rawResults.length === 0) {
      return {
        total_raw: 0,
        total_rule_passed: 0,
        total_ai_passed: 0,
        total_scored: 0,
        opportunities: [],
        errors,
        duration_ms: Date.now() - startTime,
        // V1.6-08：即使在无结果时也输出降级信息（便于排查 primary 失败原因）
        providerDegradation: _providerDegradation,
      };
    }

    // 步骤 3：第一层规则粗筛
    const ruleResult = ruleFilter(rawResults, spec);

    // 边界情况：规则粗筛全部失败
    if (ruleResult.passed.length === 0) {
      return {
        total_raw: rawResults.length,
        total_rule_passed: 0,
        total_ai_passed: 0,
        total_scored: 0,
        opportunities: [],
        errors,
        duration_ms: Date.now() - startTime,
      };
    }

    // 步骤 4：第二层 AI 精筛
    // V1.6-07：增量标签复用 —— 如果 opportunityStore 已传入，先检查每条搜索结果是否在 store 中
    // 已有同 dedupKey 且 card.ai_analysis 非空（之前 AI 精筛过），命中则跳过 AI 精筛复用上次分析
    // 注：dedupKey 相同即视为同一机会（title+url 一致），复用上次 AI 分析；
    //     incremental/changeRatio 在入库阶段计算，作为统计指标，不作为复用判据
    let aiPassed: AIFilterItem[];
    let aiFilterSkipped = 0;
    let aiFilterExecuted = 0;
    if (this.enableContentFetch) {
      if (this.opportunityStore) {
        // V1.6-07：按 dedupKey 拆分 cached（命中复用）和 fresh（需 AI 精筛）
        // 注：dedupKey 计算需与 mapToCard 入库时一致。
        //   mapToCard 设置 `guid: scored.guid ?? url`，当搜索结果无 guid 时 card.guid=url，
        //   computeDedupKey 优先用 guid，故 dedupKey = sha256(url).slice(0,16)。
        //   这里用 `result.url` 作为第三参数 guid，保持与入库路径一致。
        const cached: AIFilterItem[] = [];
        const fresh: SearchResult[] = [];
        for (const result of ruleResult.passed) {
          const dedupKey = computeDedupKey(result.title, result.url, result.url);
          const existing = this.opportunityStore.getByDedupKey(dedupKey);
          if (existing && existing.card.ai_analysis) {
            // 命中缓存：复用上次 AI 分析结果，构造 AIFilterItem
            const cachedContent: CleanedContent = {
              url: result.url,
              title: result.title,
              main_text: existing.card.match_reason || result.snippet || "",
              word_count: (existing.card.match_reason || "").length,
              fetch_success: true,
            };
            cached.push({
              result,
              content: cachedContent,
              relevance: 50, // 复用值，刚好通过阈值
              reason: existing.card.ai_analysis,
            });
          } else {
            fresh.push(result);
          }
        }
        aiFilterSkipped = cached.length;
        aiFilterExecuted = fresh.length;

        // 对 fresh 部分调用 AI 精筛
        let freshPassed: AIFilterItem[] = [];
        if (fresh.length > 0) {
          const aiResult = await aiFilter(fresh, spec, this.llmAdapter, {
            minRelevance: this.minRelevance,
            mockContent: this.mockContent,
          });
          freshPassed = aiResult.passed;
        }
        aiPassed = [...cached, ...freshPassed];
      } else {
        // 未传入 store：走原逻辑（全量 AI 精筛）
        const aiResult = await aiFilter(ruleResult.passed, spec, this.llmAdapter, {
          minRelevance: this.minRelevance,
          mockContent: this.mockContent,
        });
        aiPassed = aiResult.passed;
        aiFilterExecuted = ruleResult.passed.length;
      }
    } else {
      // 跳过内容抓取，relevance 固定 50，全部通过
      aiPassed = buildSkipFetchItems(ruleResult.passed);
      aiFilterExecuted = ruleResult.passed.length;
    }

    // 边界情况：AI 精筛全部失败
    if (aiPassed.length === 0) {
      return {
        total_raw: rawResults.length,
        total_rule_passed: ruleResult.passed.length,
        total_ai_passed: 0,
        total_scored: 0,
        opportunities: [],
        errors,
        duration_ms: Date.now() - startTime,
      };
    }

    // 步骤 5：第三层机会评分
    let opportunities: ScoredOpportunity[] = [];
    try {
      opportunities = await scoreOpportunities(aiPassed, spec, this.llmAdapter);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`机会评分失败: ${errMsg}`);
    }

    // 步骤 6：V1.3 来源透明（来源分类 + 证据提取 + 卡片映射）
    let sourceCandidates: SourceCandidate[] | undefined;
    let evidenceItems: EvidenceItem[] | undefined;
    let opportunityCards: OpportunityCard[] | undefined;

    try {
      // 6.1 来源分类
      const scoredResults = opportunities.map((o) => o.search_result);
      sourceCandidates = classifySources(scoredResults);

      // 6.2 证据提取
      const cleanedContents = opportunities.map((o) => o.cleaned_content);
      const sourceIds = sourceCandidates.map((s) => s.sourceId);
      evidenceItems = extractEvidenceBatch(cleanedContents, sourceIds);

      // 6.3 卡片映射（含 S 级硬规则）
      // V1.6-07：构建 url → ai_analysis 映射，用于把 AI 精筛 reason 写入 card.ai_analysis
      // 这样下次运行时，store 中的 card.ai_analysis 可被增量标签复用逻辑读取
      const aiAnalysisByUrl = new Map<string, string>();
      for (const item of aiPassed) {
        aiAnalysisByUrl.set(item.result.url, item.reason);
      }
      opportunityCards = opportunities.map((opp) => {
        // 为每个机会找到对应的来源和证据
        const oppUrl = opp.search_result.url;
        const oppSources = sourceCandidates!.filter((s) => s.url === oppUrl);
        const oppSourceIds = oppSources.map((s) => s.sourceId);
        const oppEvidence = evidenceItems!.filter((e) => oppSourceIds.includes(e.sourceId));
        const radarId = radarType;
        const card = mapToCard(opp, oppSources, oppEvidence, radarId);
        // V1.6-07：写入 AI 精筛 reason 到 card.ai_analysis（供下次增量复用）
        const aiAnalysis = aiAnalysisByUrl.get(oppUrl);
        if (aiAnalysis) {
          card.ai_analysis = aiAnalysis;
        }
        return card;
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`来源透明处理失败: ${errMsg}`);
    }

    // 步骤 7：V1.6-06 Watch Rules 过滤（三层筛选之后，入库之前）
    let watchRulesBefore = opportunities.length;
    let watchRulesAfter = opportunities.length;
    let watchRulesFilteredOut = 0;
    if (watchRules && watchRules.length > 0 && opportunities.length > 0) {
      try {
        const { parseWatchRules } = await import("../watch/dsl-parser");
        const { filterByWatchRules } = await import("../watch/search-integration");
        const ruleSet = parseWatchRules(watchRules.join("\n"));
        // 仅在有有效规则时过滤（空规则集返回全部，避免误过滤）
        if (ruleSet.rules.length > 0) {
          const radarTypeCast = radarType as RadarType;
          const { filtered, filtered_out } = filterByWatchRules(
            opportunities,
            ruleSet,
            radarTypeCast,
          );
          watchRulesBefore = opportunities.length;
          watchRulesAfter = filtered.length;
          watchRulesFilteredOut = filtered_out;

          // 同步过滤 opportunityCards 和 sourceCandidates（按 url 对齐）
          const filteredUrls = new Set(filtered.map((o) => o.search_result.url));
          if (opportunityCards && opportunityCards.length > 0) {
            opportunityCards = opportunityCards.filter((card) =>
              filteredUrls.has(card.official_source_url),
            );
          }
          if (sourceCandidates && sourceCandidates.length > 0) {
            sourceCandidates = sourceCandidates.filter((s) => filteredUrls.has(s.url));
          }
          // evidenceItems 与 sourceId 关联，难以直接对齐，保留全部（不影响入库）
          opportunities = filtered;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Watch Rules 过滤失败: ${errMsg}`);
      }
    }

    return {
      total_raw: rawResults.length,
      total_rule_passed: ruleResult.passed.length,
      total_ai_passed: aiPassed.length,
      total_scored: opportunities.length,
      opportunities,
      errors,
      duration_ms: Date.now() - startTime,
      // V1.3 新增字段
      sourceCandidates,
      evidenceItems,
      opportunityCards,
      // V1.6-06 新增字段
      watch_rules_before: watchRulesBefore,
      watch_rules_after: watchRulesAfter,
      watch_rules_filtered_out: watchRulesFilteredOut,
      // V1.6-07 新增字段（增量标签复用指标）
      ai_filter_skipped: aiFilterSkipped,
      ai_filter_executed: aiFilterExecuted,
      // V1.6-08 新增字段（provider 降级信息）
      providerDegradation: _providerDegradation,
    };
  }
}
