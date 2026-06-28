/**
 * Exa Provider（语义搜索 + AI 赛事）
 *
 * 来源：Task 026 第 5.2 节。
 *
 * Exa API 端点：https://api.exa.ai/search
 * 请求方式：POST，Header x-api-key: {API_KEY}
 * 支持 Neural（语义）和 Keyword（关键词）两种搜索模式。
 * 支持 Mock 降级：无 EXA_API_KEY 时返回预设搜索结果。
 *
 * Mock 数据要求：
 *   - AI 赛事类（语义匹配，URL 与 Serper Mock 不同）
 *   - URL 全部 HTTPS 且通过 T1 validateLink 校验
 *
 * 不引入新 npm 依赖，HTTP 用 Node.js 内置 fetch。
 */

import type { SearchResult, SearchOptions } from "../types";
import type { SearchProvider } from "../provider-registry";
import { validateLink } from "../../utils/link-validator";
import { normalizeUrl } from "../../utils/url-normalizer";

/** Exa 配置 */
export interface ExaConfig {
  /** Exa API Key（从 env EXA_API_KEY 读取） */
  apiKey?: string;
  /** Mock 模式开关，无 apiKey 时自动 true */
  mockMode?: boolean;
  /** 搜索模式：neural（语义，默认）| keyword（关键词） */
  searchType?: "neural" | "keyword";
}

/** Exa API 端点 */
const EXA_ENDPOINT = "https://api.exa.ai/search";

/** 默认最大结果数 */
const DEFAULT_MAX_RESULTS = 10;

// ============================================================
// Mock 数据（URL 与 Serper Mock 不同，测试去重时可见效果）
// ============================================================

/** AI 赛事语义类 Mock 搜索结果（含"AI"/"创新"/"创业"关键词时返回） */
const MOCK_AI_SEMANTIC_RESULTS: SearchResult[] = [
  {
    title: "AI for Good Global Summit 2026 - Exa 语义匹配",
    url: normalizeUrl("https://exa-aiforgood.example.org/2026/summit"),
    snippet: "AI for Good 全球峰会 2026 聚焦 AI 向善，含创业赛道和创新应用展示。",
    source_provider: "exa",
    source_type: "web",
    published_at: "2026-06-15",
  },
  {
    title: "2026 大模型应用创新挑战赛 - Exa 语义匹配",
    url: normalizeUrl("https://exa-llm.example.com/challenge/2026"),
    snippet: "大模型应用创新挑战赛 2026，要求基于 LLM 构建垂直领域应用，奖金 50 万。",
    source_provider: "exa",
    source_type: "web",
    published_at: "2026-06-12",
  },
  {
    title: "NeurIPS 2026 竞赛赛道 - Exa 语义匹配",
    url: normalizeUrl("https://exa-neurips.example.net/2026/competition"),
    snippet: "NeurIPS 2026 开放竞赛赛道，含多模态学习、强化学习、AI 安全等方向。",
    source_provider: "exa",
    source_type: "web",
    published_at: "2026-06-09",
  },
  {
    title: "AI 创业加速器 2026 招生 - Exa 语义匹配",
    url: normalizeUrl("https://exa-accelerator.example.edu/2026/cohort"),
    snippet: "AI 创业加速器 2026 招生中，提供 50 万种子资金 + 3 个月孵化 + 导师网络。",
    source_provider: "exa",
    source_type: "web",
    published_at: "2026-06-05",
  },
  {
    title: "全球 AI 开源贡献大赛 - Exa 语义匹配",
    url: normalizeUrl("https://exa-opensource.example.org/ai/2026"),
    snippet: "全球 AI 开源贡献大赛 2026，表彰在 AI 开源项目中的杰出贡献者。",
    source_provider: "exa",
    source_type: "web",
    published_at: "2026-06-01",
  },
];

/** 通用语义类 Mock 搜索结果 */
const MOCK_GENERIC_RESULTS: SearchResult[] = [
  {
    title: "2026 创新趋势报告 - Exa 语义匹配",
    url: normalizeUrl("https://exa-trends.example.com/2026/report"),
    snippet: "Exa 语义搜索 2026 创新趋势报告，涵盖 AI、生物科技、清洁能源等前沿领域。",
    source_provider: "exa",
    source_type: "web",
    published_at: "2026-06-14",
  },
  {
    title: "技术创业机会雷达 - Exa 语义匹配",
    url: normalizeUrl("https://exa-radar.example.net/tech/2026"),
    snippet: "Exa 语义匹配技术创业机会，含融资动态、人才需求、技术趋势等信号。",
    source_provider: "exa",
    source_type: "web",
    published_at: "2026-06-10",
  },
  {
    title: "全球创新大赛日历 - Exa 语义匹配",
    url: normalizeUrl("https://exa-calendar.example.edu/2026"),
    snippet: "Exa 语义搜索全球创新大赛日历，涵盖科技、设计、商业等多个领域。",
    source_provider: "exa",
    source_type: "web",
    published_at: "2026-06-06",
  },
];

/**
 * Exa Provider 实现。
 *
 * 语义搜索主力，radar_types 覆盖 ai_competition。
 */
export class ExaProvider implements SearchProvider {
  readonly name = "exa";
  readonly display_name = "Exa (语义搜索)";
  readonly source_type = "web" as const;
  readonly reliability = "B" as const;
  readonly enabled = true;
  readonly radar_types = ["ai_competition"];

  private readonly apiKey: string;
  private readonly mockMode: boolean;
  private readonly searchType: "neural" | "keyword";

  constructor(config?: Partial<ExaConfig>) {
    const envKey =
      typeof process !== "undefined" ? process.env?.EXA_API_KEY ?? "" : "";
    this.apiKey = config?.apiKey ?? envKey;
    this.mockMode = config?.mockMode ?? this.apiKey === "";
    this.searchType = config?.searchType ?? "neural";
  }

  /** 执行搜索 */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (this.mockMode) {
      return this.searchMock(query, options);
    }
    return this.searchReal(query, options);
  }

  /** 健康检查 */
  async healthCheck(): Promise<boolean> {
    if (this.mockMode) {
      return true;
    }
    try {
      const results = await this.searchReal("test", { max_results: 1 });
      return results.length >= 0;
    } catch {
      return false;
    }
  }

  // ============================================================
  // Mock 模式
  // ============================================================

  /** Mock 搜索：根据 query 关键词返回不同预设数据 */
  private searchMock(query: string, options?: SearchOptions): SearchResult[] {
    let results: SearchResult[];
    if (/AI|创新|创业|大赛|赛事|竞赛|大模型|LLM/.test(query)) {
      results = MOCK_AI_SEMANTIC_RESULTS;
    } else {
      results = MOCK_GENERIC_RESULTS;
    }

    const max = options?.max_results ?? DEFAULT_MAX_RESULTS;
    return results.slice(0, max).map((r) => ({ ...r, raw_data: undefined }));
  }

  // ============================================================
  // 真实模式
  // ============================================================

  /** 真实搜索：调用 Exa API */
  private async searchReal(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      numResults: options?.max_results ?? DEFAULT_MAX_RESULTS,
      type: this.searchType,
      contents: {
        text: true,
      },
    };

    const response = await fetch(EXA_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Exa API error: status=${response.status}, body=${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        text?: string;
        publishedDate?: string;
      }>;
    };

    const items = data?.results ?? [];
    const results: SearchResult[] = [];

    for (const item of items) {
      const url = item.url ?? "";
      if (!url) continue;

      const validation = validateLink(url);
      if (!validation.valid) continue;

      const normalizedUrl = normalizeUrl(validation.safeUrl ?? url);

      results.push({
        title: item.title ?? "",
        url: normalizedUrl,
        snippet: item.text?.slice(0, 200) ?? "",
        source_provider: "exa",
        source_type: "web",
        published_at: item.publishedDate,
        raw_data: item,
      });
    }

    return results;
  }
}
