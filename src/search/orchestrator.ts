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
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import type { LLMAdapter } from "../agents/llm-adapter";
import { providerRegistry } from "./provider-registry";
import { ruleFilter } from "./rule-filter";
import { aiFilter, type AIFilterItem } from "./ai-filter";
import { scoreOpportunities } from "./opportunity-scorer";

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
}

/** 默认每个 provider 最大结果数 */
const DEFAULT_MAX_RESULTS_PER_PROVIDER = 10;

/** 默认 AI 精筛阈值 */
const DEFAULT_MIN_RELEVANCE = 50;

/** 跳过内容抓取时的固定相关度 */
const SKIP_FETCH_RELEVANCE = 50;

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

  constructor(config: SearchOrchestratorConfig) {
    this.llmAdapter = config.llmAdapter;
    this.maxResultsPerProvider = config.maxResultsPerProvider ?? DEFAULT_MAX_RESULTS_PER_PROVIDER;
    this.minRelevance = config.minRelevance ?? DEFAULT_MIN_RELEVANCE;
    this.enableContentFetch = config.enableContentFetch ?? true;
  }

  /**
   * 执行搜索 + T10 三层筛选。
   *
   * @param spec 雷达需求规格
   * @param query 查询词（可选，为空时从 spec 拼接）
   * @returns SearchOrchestratorResult
   */
  async search(
    spec: RadarRequirementSpec,
    query?: string,
  ): Promise<SearchOrchestratorResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    // 步骤 1：推断雷达类型，获取适用 providers
    const radarType = inferRadarType(spec);
    const providers = providerRegistry.getByRadarType(radarType).filter((p) => p.enabled);

    if (providers.length === 0) {
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

    // 步骤 2：并行调用各 provider 的 search()
    const searchQuery = query && query.trim() ? query.trim() : buildQueryFromSpec(spec);
    const searchOptions = { max_results: this.maxResultsPerProvider };

    const providerResults = await Promise.all(
      providers.map(async (provider) => {
        try {
          const results = await provider.search(searchQuery, searchOptions);
          return { provider: provider.name, results, error: null as string | null };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { provider: provider.name, results: [] as SearchResult[], error: `provider ${provider.name} 调用失败: ${errMsg}` };
        }
      }),
    );

    // 收集错误
    for (const r of providerResults) {
      if (r.error) {
        errors.push(r.error);
      }
    }

    // 合并搜索结果
    const rawResults: SearchResult[] = providerResults.flatMap((r) => r.results);

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
    let aiPassed: AIFilterItem[];
    if (this.enableContentFetch) {
      const aiResult = await aiFilter(ruleResult.passed, spec, this.llmAdapter, {
        minRelevance: this.minRelevance,
      });
      aiPassed = aiResult.passed;
    } else {
      // 跳过内容抓取，relevance 固定 50，全部通过
      aiPassed = buildSkipFetchItems(ruleResult.passed);
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

    return {
      total_raw: rawResults.length,
      total_rule_passed: ruleResult.passed.length,
      total_ai_passed: aiPassed.length,
      total_scored: opportunities.length,
      opportunities,
      errors,
      duration_ms: Date.now() - startTime,
    };
  }
}
