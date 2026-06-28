/**
 * Google CSE Provider（站点限定搜索）
 *
 * 来源：Task 026 第 5.3 节。
 *
 * Google CSE API 端点：https://www.googleapis.com/customsearch/v1
 * 请求方式：GET，Query 参数 key={API_KEY}&cx={CSE_ID}&q={query}&num={count}
 * 站点限定：通过 CSE 配置或 siteSearch 参数限定 gov.cn
 * 支持 Mock 降级：无 GOOGLE_CSE_API_KEY 或 GOOGLE_CSE_ID 时返回预设数据。
 *
 * Mock 数据要求：
 *   - 政策类，URL 含 .gov.cn 域名
 *   - 可靠性 A 级（官方来源，对接 Admiralty Code 最高评级）
 *
 * 不引入新 npm 依赖，HTTP 用 Node.js 内置 fetch。
 */

import type { SearchResult, SearchOptions } from "../types";
import type { SearchProvider } from "../provider-registry";
import { validateLink } from "../../utils/link-validator";
import { normalizeUrl } from "../../utils/url-normalizer";

/** Google CSE 配置 */
export interface GoogleCseConfig {
  /** Google CSE API Key（从 env GOOGLE_CSE_API_KEY 读取） */
  apiKey?: string;
  /** Google CSE 搜索引擎 ID（从 env GOOGLE_CSE_ID 读取） */
  cseId?: string;
  /** Mock 模式开关，无 apiKey 或 cseId 时自动 true */
  mockMode?: boolean;
  /** 站点限定（如 "gov.cn"），空则不限 */
  siteFilter?: string;
}

/** Google CSE API 端点 */
const GOOGLE_CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

/** 默认最大结果数 */
const DEFAULT_MAX_RESULTS = 10;

// ============================================================
// Mock 数据（URL 含 .gov.cn 域名，可靠性 A 级）
// ============================================================

/** 政策类 Mock 搜索结果（含"政策"/"通知"/"公告"关键词时返回） */
const MOCK_GOV_POLICY_RESULTS: SearchResult[] = [
  {
    title: "国务院关于 2026 年科技创新政策的通知",
    url: normalizeUrl("https://www.gov.cn/zhengce/2026/tech-innovation"),
    snippet: "国务院发布 2026 年科技创新政策通知，明确研发投入加计扣除和高新技术企业扶持措施。",
    source_provider: "google_cse",
    source_type: "gov",
    published_at: "2026-06-15",
  },
  {
    title: "科技部 2026 年重点研发计划申报指南",
    url: normalizeUrl("https://www.most.gov.cn/2026/rd-plan/guide"),
    snippet: "科技部发布 2026 年重点研发计划申报指南，涵盖 AI、量子计算、生物科技等方向。",
    source_provider: "google_cse",
    source_type: "gov",
    published_at: "2026-06-12",
  },
  {
    title: "工信部中小企业补贴政策公告 2026",
    url: normalizeUrl("https://www.miit.gov.cn/2026/sme-subsidy"),
    snippet: "工信部公告 2026 年中小企业补贴政策，含专精特新认定和数字化转型补贴。",
    source_provider: "google_cse",
    source_type: "gov",
    published_at: "2026-06-09",
  },
  {
    title: "文化和旅游部非遗保护资金通知",
    url: normalizeUrl("https://www.mct.gov.cn/2026/ich-fund"),
    snippet: "文化和旅游部发布非物质文化遗产保护资金通知，2026 年度申报截止 7 月 31 日。",
    source_provider: "google_cse",
    source_type: "gov",
    published_at: "2026-06-06",
  },
  {
    title: "财政部 2026 年文化产业扶持资金公告",
    url: normalizeUrl("https://www.mof.gov.cn/2026/culture-fund"),
    snippet: "财政部公告 2026 年文化产业扶持资金安排，重点支持文化科技融合项目。",
    source_provider: "google_cse",
    source_type: "gov",
    published_at: "2026-06-03",
  },
];

/** 通用政策类 Mock 搜索结果 */
const MOCK_GENERIC_RESULTS: SearchResult[] = [
  {
    title: "中国政府网 2026 年政策汇总",
    url: normalizeUrl("https://www.gov.cn/2026/policies/summary"),
    snippet: "中国政府网汇总 2026 年各项政策文件，含科技创新、文化产业、中小企业扶持等。",
    source_provider: "google_cse",
    source_type: "gov",
    published_at: "2026-06-14",
  },
  {
    title: "国家发改委 2026 年产业政策解读",
    url: normalizeUrl("https://www.ndrc.gov.cn/2026/industry-policy"),
    snippet: "国家发改委发布 2026 年产业政策解读，涵盖战略性新兴产业和未来产业布局。",
    source_provider: "google_cse",
    source_type: "gov",
    published_at: "2026-06-10",
  },
  {
    title: "教育部 2026 年创新创业教育通知",
    url: normalizeUrl("https://www.moe.gov.cn/2026/innovation-education"),
    snippet: "教育部发布 2026 年创新创业教育通知，要求高校完善创业课程和孵化体系。",
    source_provider: "google_cse",
    source_type: "gov",
    published_at: "2026-06-05",
  },
];

/**
 * Google CSE Provider 实现。
 *
 * 站点限定搜索（gov.cn），reliability=A（官方来源）。
 * radar_types 仅覆盖 opc_policy。
 */
export class GoogleCseProvider implements SearchProvider {
  readonly name = "google_cse";
  readonly display_name = "Google CSE (站点限定)";
  readonly source_type = "gov" as const;
  readonly reliability = "A" as const;
  readonly enabled = true;
  readonly radar_types = ["opc_policy"];

  private readonly apiKey: string;
  private readonly cseId: string;
  private readonly mockMode: boolean;
  private readonly siteFilter: string;

  constructor(config?: Partial<GoogleCseConfig>) {
    const envKey =
      typeof process !== "undefined" ? process.env?.GOOGLE_CSE_API_KEY ?? "" : "";
    const envCseId =
      typeof process !== "undefined" ? process.env?.GOOGLE_CSE_ID ?? "" : "";
    this.apiKey = config?.apiKey ?? envKey;
    this.cseId = config?.cseId ?? envCseId;
    this.mockMode = config?.mockMode ?? (this.apiKey === "" || this.cseId === "");
    this.siteFilter = config?.siteFilter ?? "gov.cn";
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
    if (/政策|通知|公告|申报|补贴|扶持/.test(query)) {
      results = MOCK_GOV_POLICY_RESULTS;
    } else {
      results = MOCK_GENERIC_RESULTS;
    }

    const max = options?.max_results ?? DEFAULT_MAX_RESULTS;
    return results.slice(0, max).map((r) => ({ ...r, raw_data: undefined }));
  }

  // ============================================================
  // 真实模式
  // ============================================================

  /** 真实搜索：调用 Google CSE API */
  private async searchReal(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      key: this.apiKey,
      cx: this.cseId,
      q: query,
      num: String(options?.max_results ?? DEFAULT_MAX_RESULTS),
    });
    if (this.siteFilter) {
      params.set("siteSearch", this.siteFilter);
    }

    const response = await fetch(`${GOOGLE_CSE_ENDPOINT}?${params.toString()}`, {
      method: "GET",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Google CSE API error: status=${response.status}, body=${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      items?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        displayLink?: string;
        formattedUrl?: string;
      }>;
    };

    const items = data?.items ?? [];
    const results: SearchResult[] = [];

    for (const item of items) {
      const url = item.link ?? "";
      if (!url) continue;

      const validation = validateLink(url);
      if (!validation.valid) continue;

      const normalizedUrl = normalizeUrl(validation.safeUrl ?? url);

      results.push({
        title: item.title ?? "",
        url: normalizedUrl,
        snippet: item.snippet ?? "",
        source_provider: "google_cse",
        source_type: "gov",
        published_at: undefined,
        raw_data: item,
      });
    }

    return results;
  }
}
