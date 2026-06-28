/**
 * Serper Provider（serper search provider）
 *
 * 来源：Task 019c 第 4.3 节。
 *
 * 搜索层第一层参考实现，调用 Serper（Google SERP）API。
 * 支持 Mock 降级：无 SERPER_API_KEY 时返回预设搜索结果。
 *
 * Mock 数据要求：
 *   - URL 全部 HTTPS 且通过 T1 validateLink 校验
 *   - URL 经过 T3 normalizeUrl 标准化（无追踪参数）
 *   - 根据 query 关键词返回不同 Mock 数据
 *
 * 不引入新 npm 依赖，HTTP 用 Node.js 内置 fetch。
 */

import type { SearchResult, SearchOptions } from "../types";
import type { SearchProvider } from "../provider-registry";
import { validateLink } from "../../utils/link-validator";
import { normalizeUrl } from "../../utils/url-normalizer";

/** Serper 配置 */
export interface SerperConfig {
  /** Serper API Key（从 env SERPER_API_KEY 读取） */
  apiKey?: string;
  /** Mock 模式开关，无 apiKey 时自动 true */
  mockMode?: boolean;
}

/** Serper API 端点 */
const SERPER_ENDPOINT = "https://google.serper.dev/search";

/** 默认最大结果数 */
const DEFAULT_MAX_RESULTS = 10;

// ============================================================
// Mock 数据
// ============================================================

/** AI 赛事类 Mock 搜索结果（含"AI"/"比赛"关键词时返回） */
const MOCK_AI_COMPETITION_RESULTS: SearchResult[] = [
  {
    title: "全国 AI 创新大赛 2026 官方报名通道",
    url: normalizeUrl("https://ai-competition.example.com/2026/register"),
    snippet: "全国 AI 创新大赛 2026 现已开放报名，面向全国高校学生和创业者，奖金池 100 万元。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-15",
  },
  {
    title: "2026 全球人工智能挑战赛 - 赛事详情",
    url: normalizeUrl("https://ai-challenge.example.org/2026/details"),
    snippet: "全球人工智能挑战赛 2026 赛道包括自然语言处理、计算机视觉、强化学习等方向。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-10",
  },
  {
    title: "AI 游戏开发大赛 2026 - 创意赛道",
    url: normalizeUrl("https://ai-game.example.net/contest/2026"),
    snippet: "AI 游戏开发大赛 2026 开设创意赛道，要求使用 AI 技术进行游戏内容生成。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-08",
  },
  {
    title: "智能体应用创新赛 - 报名指南",
    url: normalizeUrl("https://agent-innovation.example.edu/2026/guide"),
    snippet: "智能体应用创新赛聚焦 AI Agent 在教育、医疗、金融领域的应用，团队限 5 人。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-05",
  },
  {
    title: "2026 机器学习算法竞赛平台 - Kaggle",
    url: normalizeUrl("https://competition.example.com/ml/2026"),
    snippet: "Kaggle 2026 机器学习算法竞赛已上线，含奖金 5 万美元的视觉识别赛道。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-01",
  },
];

/** 政策补贴类 Mock 搜索结果（含"政策"/"补贴"关键词时返回） */
const MOCK_POLICY_RESULTS: SearchResult[] = [
  {
    title: "2026 年文化产业扶持政策汇总",
    url: normalizeUrl("https://gov.example.cn/policy/culture-2026"),
    snippet: "2026 年文化产业扶持政策涵盖影视、动漫、游戏等领域，补贴最高 200 万元。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-12",
  },
  {
    title: "科技型中小企业补贴申请指南 2026",
    url: normalizeUrl("https://gov.example.gov.cn/subsidy/tech-sme-2026"),
    snippet: "科技型中小企业补贴 2026 年申请指南，含研发费用加计扣除和一次性补贴政策。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-09",
  },
  {
    title: "人工智能产业专项扶持资金申报通知",
    url: normalizeUrl("https://policy.example.gov.cn/ai-fund-2026"),
    snippet: "人工智能产业专项扶持资金 2026 年申报通知，重点支持大模型和 AI 应用落地。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-06",
  },
  {
    title: "2026 数字创意产业政策解读",
    url: normalizeUrl("https://digital-creative.example.gov.cn/policy/2026"),
    snippet: "2026 数字创意产业政策解读，含数字藏品、元宇宙、AI 生成内容等新兴赛道补贴细则。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-03",
  },
];

/** 通用 Mock 搜索结果（无特定关键词匹配时返回） */
const MOCK_GENERIC_RESULTS: SearchResult[] = [
  {
    title: "2026 创新创业机会汇总 - 全国大赛信息",
    url: normalizeUrl("https://innovation.example.com/opportunities/2026"),
    snippet: "2026 年全国创新创业机会汇总，含赛事、补贴、征集等多类机会信息。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-14",
  },
  {
    title: "机会雷达 - 最新机会推送",
    url: normalizeUrl("https://radar.example.org/feed/2026"),
    snippet: "机会雷达每日推送最新赛事、政策、文创机会，支持个性化订阅。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-13",
  },
  {
    title: "2026 青年创业扶持计划",
    url: normalizeUrl("https://youth-startup.example.net/2026"),
    snippet: "2026 青年创业扶持计划面向 35 岁以下创业者，提供资金、场地、导师全方位支持。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-11",
  },
  {
    title: "科技赛事日历 2026 - 全年规划",
    url: normalizeUrl("https://tech-calendar.example.edu/2026"),
    snippet: "2026 科技赛事日历，涵盖 AI、机器人、编程等方向的全年赛事安排。",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-07",
  },
];

/**
 * Serper Provider 实现。
 *
 * 实现 SearchProvider 接口，对接 Google SERP API。
 */
export class SerperProvider implements SearchProvider {
  readonly name = "serper";
  readonly display_name = "Serper (Google SERP)";
  readonly source_type = "web" as const;
  readonly reliability = "B" as const;
  readonly enabled = true;
  readonly radar_types = ["ai_competition", "cultural_heritage"];

  private readonly apiKey: string;
  private readonly mockMode: boolean;

  constructor(config?: Partial<SerperConfig>) {
    const envKey =
      typeof process !== "undefined" ? process.env?.SERPER_API_KEY ?? "" : "";
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
    // 真实模式：尝试一次简单搜索判断 API 可用性
    try {
      const results = await this.searchReal("test", { max_results: 1 });
      return results.length >= 0; // 只要不抛错就视为健康
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
    if (/AI|比赛|赛事|竞赛/.test(query)) {
      results = MOCK_AI_COMPETITION_RESULTS;
    } else if (/政策|补贴|扶持|申报/.test(query)) {
      results = MOCK_POLICY_RESULTS;
    } else {
      results = MOCK_GENERIC_RESULTS;
    }

    // 限制返回数量
    const max = options?.max_results ?? DEFAULT_MAX_RESULTS;
    const limited = results.slice(0, max);

    // 返回深拷贝（避免外部修改 Mock 常量）
    return limited.map((r) => ({ ...r, raw_data: undefined }));
  }

  // ============================================================
  // 真实模式
  // ============================================================

  /** 真实搜索：调用 Serper API */
  private async searchReal(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      q: query,
      num: options?.max_results ?? DEFAULT_MAX_RESULTS,
    };
    if (options?.region) {
      body.gl = options.region;
    }
    if (options?.language) {
      body.hl = options.language;
    }
    if (options?.site_filter) {
      body.as_sitesearch = options.site_filter;
    }

    const response = await fetch(SERPER_ENDPOINT, {
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Serper API error: status=${response.status}, body=${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      organic?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        date?: string;
      }>;
    };

    const organic = data?.organic ?? [];
    const results: SearchResult[] = [];

    for (const item of organic) {
      const url = item.link ?? "";
      if (!url) continue;

      // T1 校验：不通过则跳过（安全第一）
      const validation = validateLink(url);
      if (!validation.valid) continue;

      // T3 标准化
      const normalizedUrl = normalizeUrl(validation.safeUrl ?? url);

      results.push({
        title: item.title ?? "",
        url: normalizedUrl,
        snippet: item.snippet ?? "",
        source_provider: "serper",
        source_type: "web",
        published_at: item.date,
        raw_data: item,
      });
    }

    return results;
  }
}
