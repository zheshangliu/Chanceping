/**
 * 博查 Bocha Provider（中文搜索主力）
 *
 * 来源：Task 026 第 5.1 节。
 *
 * 博查 API 端点：https://api.bochaai.com/v1/web-search
 * 请求方式：POST，Header Authorization: Bearer {API_KEY}
 * 支持 Mock 降级：无 BOCHA_API_KEY 时返回预设搜索结果。
 *
 * Mock 数据要求：
 *   - 政策类 + 文创类（URL 与 Serper Mock 不同，测试多 Provider 去重）
 *   - URL 全部 HTTPS 且通过 T1 validateLink 校验
 *   - URL 经过 T3 normalizeUrl 标准化
 *
 * 不引入新 npm 依赖，HTTP 用 Node.js 内置 fetch。
 */

import type { SearchResult, SearchOptions } from "../types";
import type { SearchProvider } from "../provider-registry";
import { validateLink } from "../../utils/link-validator";
import { normalizeUrl } from "../../utils/url-normalizer";

/** 博查配置 */
export interface BochaConfig {
  /** 博查 API Key（从 env BOCHA_API_KEY 读取） */
  apiKey?: string;
  /** Mock 模式开关，无 apiKey 时自动 true */
  mockMode?: boolean;
}

/** 博查 API 端点 */
const BOCHA_ENDPOINT = "https://api.bochaai.com/v1/web-search";

/** 默认最大结果数 */
const DEFAULT_MAX_RESULTS = 10;

// ============================================================
// Mock 数据（URL 与 Serper Mock 不同，测试去重时可见效果）
// ============================================================

/** 政策类 Mock 搜索结果（含"政策"/"补贴"/"申报"关键词时返回） */
const MOCK_POLICY_RESULTS: SearchResult[] = [
  {
    title: "2026 年科技创新政策汇总 - 博查",
    url: normalizeUrl("https://bocha-policy.example.cn/tech-2026"),
    snippet: "2026 年科技创新政策汇总，涵盖研发补贴、人才引进、税收优惠等多维度扶持。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-14",
  },
  {
    title: "中小企业专项补贴申报指南 - 博查",
    url: normalizeUrl("https://bocha-subsidy.example.org/sme-2026"),
    snippet: "中小企业专项补贴 2026 年申报指南，含高新技术企业认定和研发费用补贴。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-11",
  },
  {
    title: "文化产业扶持资金通知 - 博查",
    url: normalizeUrl("https://bocha-culture.example.net/fund-2026"),
    snippet: "文化产业扶持资金 2026 年申报通知，重点支持非遗传承和文化创新项目。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-08",
  },
  {
    title: "2026 创业扶持政策解读 - 博查",
    url: normalizeUrl("https://bocha-startup.example.edu/policy/2026"),
    snippet: "2026 创业扶持政策解读，含场地补贴、贷款贴息、社保减免等具体措施。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-04",
  },
];

/** 文创类 Mock 搜索结果（含"文创"/"非遗"/"文化"关键词时返回） */
const MOCK_CULTURAL_RESULTS: SearchResult[] = [
  {
    title: "2026 非物质文化遗产传承人申报 - 博查",
    url: normalizeUrl("https://bocha-heritage.example.cn/ich-2026"),
    snippet: "2026 年非物质文化遗产代表性传承人申报启动，涵盖传统技艺、传统美术等类别。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-13",
  },
  {
    title: "文创产品设计大赛 2026 - 博查",
    url: normalizeUrl("https://bocha-design.example.org/contest/2026"),
    snippet: "文创产品设计大赛 2026 面向全国设计师征集作品，主题为传统文化创新表达。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-10",
  },
  {
    title: "文化IP 开发扶持计划 - 博查",
    url: normalizeUrl("https://bocha-ip.example.net/dev/2026"),
    snippet: "文化 IP 开发扶持计划 2026，支持博物馆文创、非遗 IP 转化等项目。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-06",
  },
  {
    title: "传统工艺振兴目录 2026 - 博查",
    url: normalizeUrl("https://bocha-craft.example.edu/catalog/2026"),
    snippet: "传统工艺振兴目录 2026 版发布，含 200+ 国家级传统工艺项目。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-02",
  },
];

/** 通用 Mock 搜索结果 */
const MOCK_GENERIC_RESULTS: SearchResult[] = [
  {
    title: "2026 全国创新创业机会汇总 - 博查",
    url: normalizeUrl("https://bocha-news.example.com/roundup/2026"),
    snippet: "博查整理 2026 年全国创新创业机会，含政策、赛事、文创等多类信息。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-15",
  },
  {
    title: "机会情报周报 - 博查",
    url: normalizeUrl("https://bocha-weekly.example.org/2026/24"),
    snippet: "博查机会情报周报第 24 期，本周重点推荐 10 个高价值机会。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-12",
  },
  {
    title: "科技文化融合项目征集 - 博查",
    url: normalizeUrl("https://bocha-fusion.example.net/2026"),
    snippet: "科技文化融合项目征集 2026，支持 AR/VR 文化体验、AI 文化创作等方向。",
    source_provider: "bocha",
    source_type: "web",
    published_at: "2026-06-07",
  },
];

/**
 * 博查 Bocha Provider 实现。
 *
 * 中文搜索主力，radar_types 覆盖 opc_policy + cultural_heritage。
 */
export class BochaProvider implements SearchProvider {
  readonly name = "bocha";
  readonly display_name = "博查 Bocha (中文搜索)";
  readonly source_type = "web" as const;
  readonly reliability = "B" as const;
  readonly enabled = true;
  readonly radar_types = ["opc_policy", "cultural_heritage"];

  private readonly apiKey: string;
  private readonly mockMode: boolean;

  constructor(config?: Partial<BochaConfig>) {
    const envKey =
      typeof process !== "undefined" ? process.env?.BOCHA_API_KEY ?? "" : "";
    this.apiKey = config?.apiKey ?? envKey;
    this.mockMode = config?.mockMode ?? this.apiKey === "";
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
      const results = await this.searchReal("测试", { max_results: 1 });
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
    if (/政策|补贴|扶持|申报/.test(query)) {
      results = MOCK_POLICY_RESULTS;
    } else if (/文创|非遗|文化|传统/.test(query)) {
      results = MOCK_CULTURAL_RESULTS;
    } else {
      results = MOCK_GENERIC_RESULTS;
    }

    const max = options?.max_results ?? DEFAULT_MAX_RESULTS;
    return results.slice(0, max).map((r) => ({ ...r, raw_data: undefined }));
  }

  // ============================================================
  // 真实模式
  // ============================================================

  /** 真实搜索：调用博查 API */
  private async searchReal(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      count: options?.max_results ?? DEFAULT_MAX_RESULTS,
    };
    if (options?.region) {
      body.freshness = "oneMonth";
    }

    const response = await fetch(BOCHA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Bocha API error: status=${response.status}, body=${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      data?: {
        webPages?: {
          value?: Array<{
            name?: string;
            url?: string;
            snippet?: string;
            dateLastCrawled?: string;
          }>;
        };
      };
    };

    const values = data?.data?.webPages?.value ?? [];
    const results: SearchResult[] = [];

    for (const item of values) {
      const url = item.url ?? "";
      if (!url) continue;

      const validation = validateLink(url);
      if (!validation.valid) continue;

      const normalizedUrl = normalizeUrl(validation.safeUrl ?? url);

      results.push({
        title: item.name ?? "",
        url: normalizedUrl,
        snippet: item.snippet ?? "",
        source_provider: "bocha",
        source_type: "web",
        published_at: item.dateLastCrawled,
        raw_data: item,
      });
    }

    return results;
  }
}
