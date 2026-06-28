/**
 * Task 019c 验收脚本
 *
 * 运行：npx tsx scripts/verify-task019c.ts
 *
 * 覆盖验收标准 5.1-5.5 + 搜索层框架自检。
 */

import fs from "fs";
import path from "path";
import type {
  SearchResult,
  CleanedContent,
  ScoredOpportunity,
  SearchOptions,
  ChanceScore,
} from "../src/search/types";
import {
  ProviderRegistry,
  providerRegistry,
  type ReliabilityGrade,
  type SearchProvider,
} from "../src/search/provider-registry";
import { SerperProvider, type SerperConfig } from "../src/search/providers/serper";
import { JinaReaderFetcher, type JinaReaderConfig } from "../src/search/content/jina-reader";
import { cleanContent } from "../src/search/content/content-cleaner";
import { validateLink } from "../src/utils/link-validator";
import { normalizeUrl } from "../src/utils/url-normalizer";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

// ============================================================
// 主函数（async，包装所有验收逻辑）
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 019c 验收检查 ===\n");

  // ============================================================
  // 验收 5.1：搜索层类型定义
  // ============================================================

  console.log("[验收 5.1] 搜索层类型定义\n");

  {
    // types.ts 存在
    const typesPath = path.resolve(process.cwd(), "src/search/types.ts");
    check("types.ts 存在", fs.existsSync(typesPath));

    // 导出 SearchResult interface
    const SearchResultMock: SearchResult = {
      title: "test",
      url: "https://example.com",
      snippet: "snippet",
      source_provider: "serper",
      source_type: "web",
    };
    check("SearchResult 含 title", "title" in SearchResultMock);
    check("SearchResult 含 url", "url" in SearchResultMock);
    check("SearchResult 含 snippet", "snippet" in SearchResultMock);
    check("SearchResult 含 source_provider", "source_provider" in SearchResultMock);
    check("SearchResult 含 source_type", "source_type" in SearchResultMock);
    check("SearchResult.published_at 可选", SearchResultMock.published_at === undefined);
    check("SearchResult.raw_data 可选", SearchResultMock.raw_data === undefined);

    // 导出 CleanedContent interface
    const CleanedContentMock: CleanedContent = {
      url: "https://example.com",
      title: "title",
      main_text: "text",
      word_count: 10,
      fetch_success: true,
    };
    check("CleanedContent 含 url", "url" in CleanedContentMock);
    check("CleanedContent 含 title", "title" in CleanedContentMock);
    check("CleanedContent 含 main_text", "main_text" in CleanedContentMock);
    check("CleanedContent 含 word_count", "word_count" in CleanedContentMock);
    check("CleanedContent 含 fetch_success", "fetch_success" in CleanedContentMock);
    check("CleanedContent.publish_date 可选", CleanedContentMock.publish_date === undefined);
    check("CleanedContent.author 可选", CleanedContentMock.author === undefined);
    check("CleanedContent.fetch_error 可选", CleanedContentMock.fetch_error === undefined);

    // 导出 ScoredOpportunity interface
    const ScoredOppMock: ScoredOpportunity = {
      search_result: SearchResultMock,
      cleaned_content: CleanedContentMock,
      relevance_score: 80,
      relevance_reason: "reason",
      chance_score: {
        fit: 80,
        intent: 70,
        evidence: 60,
        urgency: 50,
        effort_cost: 30,
        total: 72,
      },
      visible_level: "A",
      backend_score: 72,
    };
    check("ScoredOpportunity 含 search_result", "search_result" in ScoredOppMock);
    check("ScoredOpportunity 含 cleaned_content", "cleaned_content" in ScoredOppMock);
    check("ScoredOpportunity 含 relevance_score", "relevance_score" in ScoredOppMock);
    check("ScoredOpportunity 含 relevance_reason", "relevance_reason" in ScoredOppMock);
    check("ScoredOpportunity 含 chance_score", "chance_score" in ScoredOppMock);
    check("ScoredOpportunity 含 visible_level", "visible_level" in ScoredOppMock);
    check("ScoredOpportunity 含 backend_score", "backend_score" in ScoredOppMock);
    check("ScoredOpportunity.guid 可选", ScoredOppMock.guid === undefined);

    // chance_score 六个字段
    const cs: ChanceScore = ScoredOppMock.chance_score;
    check("chance_score 含 fit", "fit" in cs);
    check("chance_score 含 intent", "intent" in cs);
    check("chance_score 含 evidence", "evidence" in cs);
    check("chance_score 含 urgency", "urgency" in cs);
    check("chance_score 含 effort_cost", "effort_cost" in cs);
    check("chance_score 含 total", "total" in cs);

    // 导出 SearchOptions interface
    const opts: SearchOptions = {};
    check("SearchOptions.max_results 可选", opts.max_results === undefined);
    check("SearchOptions.language 可选", opts.language === undefined);
    check("SearchOptions.region 可选", opts.region === undefined);
    check("SearchOptions.site_filter 可选", opts.site_filter === undefined);
  }

  // ============================================================
  // 验收 5.2：T6 机会源注册表
  // ============================================================

  console.log("\n[验收 5.2] T6 机会源注册表\n");

  {
    // provider-registry.ts 存在
    const registryPath = path.resolve(process.cwd(), "src/search/provider-registry.ts");
    check("provider-registry.ts 存在", fs.existsSync(registryPath));

    // ReliabilityGrade 类型
    const grades: ReliabilityGrade[] = ["A", "B", "C", "D", "F"];
    check("ReliabilityGrade 含 A/B/C/D/F", grades.length === 5);

    // ProviderRegistry class 可实例化
    const registry = new ProviderRegistry();
    check("ProviderRegistry 可实例化", registry instanceof ProviderRegistry);

    // 创建一个 Mock provider 用于测试
    const mockProvider: SearchProvider = {
      name: "mock-test",
      display_name: "Mock Test Provider",
      source_type: "web",
      reliability: "A",
      enabled: true,
      radar_types: ["ai_competition", "opc_policy"],
      async search() {
        return [];
      },
      async healthCheck() {
        return true;
      },
    };

    // register 注册成功
    registry.register(mockProvider);
    check("register 注册成功", registry.get("mock-test") !== undefined);

    // get 返回已注册的 provider
    const got = registry.get("mock-test");
    check("get 返回正确 provider", got?.name === "mock-test");

    // getEnabled 返回 enabled=true 的
    const enabled = registry.getEnabled();
    check("getEnabled 返回 enabled=true 的", enabled.some((p) => p.name === "mock-test"));

    // getByRadarType
    const byRadar = registry.getByRadarType("ai_competition");
    check("getByRadarType 含 ai_competition", byRadar.some((p) => p.name === "mock-test"));

    // getByReliability("A") 返回 reliability="A" 的
    const byRelA = registry.getByReliability("A");
    check("getByReliability(A) 含 A 级", byRelA.some((p) => p.name === "mock-test"));

    // 注册 B 级 provider 测试筛选
    const bProvider: SearchProvider = {
      name: "mock-b",
      display_name: "Mock B Provider",
      source_type: "web",
      reliability: "B",
      enabled: true,
      radar_types: ["cultural_heritage"],
      async search() {
        return [];
      },
      async healthCheck() {
        return true;
      },
    };
    registry.register(bProvider);

    // getByReliability("B") 返回 A + B 级
    const byRelB = registry.getByReliability("B");
    check("getByReliability(B) 含 A 级", byRelB.some((p) => p.name === "mock-test"));
    check("getByReliability(B) 含 B 级", byRelB.some((p) => p.name === "mock-b"));

    // getByReliability("C") 返回 A + B + C 级
    const byRelC = registry.getByReliability("C");
    check("getByReliability(C) 含 A 级", byRelC.some((p) => p.name === "mock-test"));
    check("getByReliability(C) 含 B 级", byRelC.some((p) => p.name === "mock-b"));

    // unregister 后 get 返回 undefined
    registry.unregister("mock-test");
    check("unregister 后 get 返回 undefined", registry.get("mock-test") === undefined);

    // healthCheckAll 返回 Map
    const healthMap = await registry.healthCheckAll();
    check("healthCheckAll 返回 Map", healthMap instanceof Map);
    check("healthCheckAll 含 mock-b", healthMap.has("mock-b"));

    // providerRegistry 单例已自动注册 SerperProvider
    const serperInGlobal = providerRegistry.get("serper");
    check("providerRegistry 单例含 serper", serperInGlobal !== undefined);
    check("providerRegistry.serper 是 SerperProvider", serperInGlobal instanceof SerperProvider);
  }

  // ============================================================
  // 验收 5.3：Serper Provider
  // ============================================================

  console.log("\n[验收 5.3] Serper Provider\n");

  {
    // serper.ts 存在
    const serperPath = path.resolve(process.cwd(), "src/search/providers/serper.ts");
    check("serper.ts 存在", fs.existsSync(serperPath));

    // SerperProvider 实例化（无 SERPER_API_KEY → Mock 模式）
    const originalKey = process.env.SERPER_API_KEY;
    delete process.env.SERPER_API_KEY;
    const serper = new SerperProvider();
    check("SerperProvider 可实例化", serper instanceof SerperProvider);

    // 接口属性
    check('SerperProvider.name = "serper"', serper.name === "serper");
    check('SerperProvider.display_name = "Serper (Google SERP)"', serper.display_name === "Serper (Google SERP)");
    check('SerperProvider.source_type = "web"', serper.source_type === "web");
    check('SerperProvider.reliability = "B"', serper.reliability === "B");
    check("SerperProvider.enabled = true", serper.enabled === true);
    check('SerperProvider.radar_types 含 "ai_competition"', serper.radar_types.includes("ai_competition"));
    check('SerperProvider.radar_types 含 "cultural_heritage"', serper.radar_types.includes("cultural_heritage"));

    // 实现 SearchProvider 接口
    check("SerperProvider 实现 SearchProvider 接口", typeof serper.search === "function" && typeof serper.healthCheck === "function");

    // SerperConfig interface 可用
    const config: SerperConfig = { apiKey: "test", mockMode: true };
    check("SerperConfig interface 可用", config.apiKey === "test");

    // Mock 模式下 search("AI 比赛") 返回 4-5 条
    const results = await serper.search("AI 比赛");
    check("Mock search 返回 4-5 条", results.length >= 4 && results.length <= 5, `length=${results.length}`);

    // 每条结果含 title（非空）/url（非空）/snippet（非空）
    const allValid = results.every(
      (r) => r.title && r.title.length > 0 && r.url && r.url.length > 0 && r.snippet && r.snippet.length > 0,
    );
    check("每条结果含非空 title/url/snippet", allValid);

    // Mock URL 全部为 HTTPS
    const allHttps = results.every((r) => r.url.startsWith("https://"));
    check("Mock URL 全部 HTTPS", allHttps);

    // Mock URL 全部通过 T1 validateLink 校验
    const allValidated = results.every((r) => {
      const v = validateLink(r.url);
      return v.valid;
    });
    check("Mock URL 全部通过 T1 校验", allValidated);

    // Mock URL 经过 T3 标准化（无追踪参数 utm_source 等）
    const allNormalized = results.every((r) => {
      // 标准化后的 URL 不应含 utm_source/fbclid 等追踪参数
      return !r.url.includes("utm_source") && !r.url.includes("fbclid") && !r.url.includes("gclid");
    });
    check("Mock URL 无追踪参数（T3 标准化）", allNormalized);

    // source_provider = "serper"
    check('source_provider = "serper"', results.every((r) => r.source_provider === "serper"));

    // source_type = "web"
    check('source_type = "web"', results.every((r) => r.source_type === "web"));

    // healthCheck Mock 模式返回 true
    const healthy = await serper.healthCheck();
    check("healthCheck Mock 返回 true", healthy === true);

    // 不同关键词返回不同 Mock 数据
    const policyResults = await serper.search("政策补贴");
    check("含政策关键词 → 返回政策类数据", policyResults.some((r) => r.title.includes("政策") || r.title.includes("补贴")));
    check("政策类返回 4-5 条", policyResults.length >= 4 && policyResults.length <= 5, `length=${policyResults.length}`);

    const genericResults = await serper.search("创新创业");
    check("通用关键词 → 返回 4-5 条", genericResults.length >= 4 && genericResults.length <= 5, `length=${genericResults.length}`);

    // max_results 限制生效
    const limited = await serper.search("AI 比赛", { max_results: 2 });
    check("max_results=2 限制生效", limited.length === 2, `length=${limited.length}`);

    // 真实模式代码路径存在（读源码）
    const serperSrc = fs.readFileSync(serperPath, "utf-8");
    check("serper.ts 含 fetch 调用", serperSrc.includes("fetch("));
    check("serper.ts 含 google.serper.dev", serperSrc.includes("google.serper.dev"));
    check("serper.ts 导入 validateLink", serperSrc.includes("validateLink"));
    check("serper.ts 导入 normalizeUrl", serperSrc.includes("normalizeUrl"));

    // 恢复环境变量
    if (originalKey !== undefined) {
      process.env.SERPER_API_KEY = originalKey;
    }
  }

  // ============================================================
  // 验收 5.4：Jina Reader 抓取
  // ============================================================

  console.log("\n[验收 5.4] Jina Reader 抓取\n");

  {
    // jina-reader.ts 存在
    const jinaPath = path.resolve(process.cwd(), "src/search/content/jina-reader.ts");
    check("jina-reader.ts 存在", fs.existsSync(jinaPath));

    // JinaReaderFetcher 实例化（Mock 模式）
    const fetcher = new JinaReaderFetcher({ mockMode: true });
    check("JinaReaderFetcher 可实例化", fetcher instanceof JinaReaderFetcher);

    // JinaReaderConfig interface 可用
    const config: JinaReaderConfig = { apiKey: "test", mockMode: true };
    check("JinaReaderConfig interface 可用", config.mockMode === true);

    // fetch 方法存在
    check("JinaReaderFetcher 有 fetch 方法", typeof fetcher.fetch === "function");

    // Mock 模式 fetch 返回 CleanedContent
    const content = await fetcher.fetch("https://example.com/test");
    check("Mock fetch 返回 CleanedContent", content !== null && content !== undefined);

    // main_text 非空（200-500 字）
    check("main_text 非空", content.main_text.length > 0);
    check("main_text >= 200 字符", content.main_text.length >= 200, `length=${content.main_text.length}`);

    // word_count > 0
    check("word_count > 0", content.word_count > 0);

    // fetch_success = true
    check("fetch_success = true", content.fetch_success === true);

    // url = 传入的 url
    check("url = 传入的 url", content.url === "https://example.com/test");

    // title 非空
    check("title 非空", content.title.length > 0);

    // gov.cn 域名返回政策类内容
    const govContent = await fetcher.fetch("https://www.gov.cn/policy/test");
    check("gov.cn Mock 返回政策类内容", govContent.main_text.includes("政策") || govContent.main_text.includes("扶持"));

    // 真实模式代码路径存在（读源码）
    const jinaSrc = fs.readFileSync(jinaPath, "utf-8");
    check("jina-reader.ts 含 fetch 调用", jinaSrc.includes("fetch("));
    check("jina-reader.ts 含 r.jina.ai", jinaSrc.includes("r.jina.ai"));
    check("jina-reader.ts 导入 cleanContent", jinaSrc.includes("cleanContent"));
  }

  // ============================================================
  // 验收 5.5：内容清洗
  // ============================================================

  console.log("\n[验收 5.5] 内容清洗\n");

  {
    // content-cleaner.ts 存在
    const cleanerPath = path.resolve(process.cwd(), "src/search/content/content-cleaner.ts");
    check("content-cleaner.ts 存在", fs.existsSync(cleanerPath));

    // cleanContent 是函数
    check("cleanContent 是函数", typeof cleanContent === "function");

    // 基本清洗：HTML 标签移除
    const result1 = cleanContent("<p>Hello World</p>", "https://example.com");
    check("cleanContent 返回 CleanedContent", result1 !== null && result1 !== undefined);
    check("HTML 标签被移除（不含 <p>）", !result1.main_text.includes("<p>"));
    check("HTML 标签被移除（不含 </p>）", !result1.main_text.includes("</p>"));
    check("fetch_success = true", result1.fetch_success === true);
    check("保留文本内容", result1.main_text.includes("Hello World"));

    // <script> 标签及内容被移除
    const result2 = cleanContent(
      '<script>alert("xss")</script><p>这是一段足够长的正文内容用于测试script移除</p>',
      "https://example.com",
    );
    check("<script> 标签被移除", !result2.main_text.includes("<script>"));
    check("<script> 内容被移除", !result2.main_text.includes('alert("xss")'));
    check("保留正文", result2.main_text.includes("正文内容"));

    // <style> 标签及内容被移除
    const result3 = cleanContent(
      '<style>body { color: red; }</style><p>正文</p>',
      "https://example.com",
    );
    check("<style> 标签被移除", !result3.main_text.includes("<style>"));
    check("<style> 内容被移除", !result3.main_text.includes("color: red"));

    // 截断超长文本
    const longText = "A".repeat(200);
    const result4 = cleanContent(longText, "https://example.com", { maxChars: 100 });
    check("超长文本被截断（< maxChars + 后缀长度）", result4.main_text.length <= 100 + 20);
    check("截断后含 [截断]", result4.main_text.includes("[截断]"));

    // word_count = 清洗后文本字数
    check("word_count > 0", result4.word_count > 0);

    // title 提取：<title> 标签
    const result5 = cleanContent(
      '<title>测试标题</title><p>正文内容</p>',
      "https://example.com",
    );
    check("title 从 <title> 提取", result5.title === "测试标题", `title=${result5.title}`);

    // title 提取：<h1> 标签（无 <title> 时）
    const result6 = cleanContent("<h1>H1 标题</h1><p>正文</p>", "https://example.com");
    check("title 从 <h1> 提取", result6.title === "H1 标题", `title=${result6.title}`);

    // publish_date 提取：20XX-XX-XX 格式
    const result7 = cleanContent(
      '<p>发布日期：2026-06-15</p><p>正文</p>',
      "https://example.com",
    );
    check("publish_date 提取 2026-06-15", result7.publish_date === "2026-06-15", `date=${result7.publish_date}`);

    // publish_date 提取：20XX年XX月XX日 格式
    const result8 = cleanContent(
      '<p>发布于 2026年6月15日</p><p>正文内容</p>',
      "https://example.com",
    );
    check("publish_date 提取 2026-06-15（中文格式）", result8.publish_date === "2026-06-15", `date=${result8.publish_date}`);

    // author 提取：作者：xxx 格式
    const result9 = cleanContent(
      '<p>作者：张三</p><p>正文内容</p>',
      "https://example.com",
    );
    check("author 提取 张三", result9.author === "张三", `author=${result9.author}`);

    // author 提取：<meta name="author">
    const result10 = cleanContent(
      '<meta name="author" content="李四"><p>正文内容</p>',
      "https://example.com",
    );
    check("author 从 meta 提取 李四", result10.author === "李四", `author=${result10.author}`);

    // 空字符串入参不崩溃
    const result11 = cleanContent("", "https://example.com");
    check("空字符串入参不崩溃", result11 !== null);
    check("空字符串 → fetch_success=false", result11.fetch_success === false);

    // null/undefined 入参不崩溃（转空字符串处理）
    const result12 = cleanContent(null as unknown as string, "https://example.com");
    check("null 入参不崩溃", result12 !== null);

    // 连续空行压缩
    const result13 = cleanContent(
      "<p>第一行</p>\n\n\n\n\n<p>第二行</p>",
      "https://example.com",
    );
    const blankLines = result13.main_text.split("\n\n").filter((s) => s.trim() === "").length;
    check("连续空行压缩为单个", blankLines <= 1);

    // URL 保留
    check("URL 保留在结果中", result1.url === "https://example.com");

    // 源码检查
    const cleanerSrc = fs.readFileSync(cleanerPath, "utf-8");
    check("content-cleaner.ts 导出 cleanContent", cleanerSrc.includes("export function cleanContent"));
  }

  // ============================================================
  // 约束自检
  // ============================================================

  console.log("\n[约束自检]\n");

  {
    // 不修改任何现有文件：检查 git status
    // 不引入新 npm 依赖：检查 package.json 无变化
    // 不调用真实 API：验证脚本全部走 Mock 模式

    // 检查新增文件结构
    const searchDir = path.resolve(process.cwd(), "src/search");
    check("src/search/ 目录存在", fs.existsSync(searchDir));
    check("src/search/types.ts 存在", fs.existsSync(path.join(searchDir, "types.ts")));
    check("src/search/provider-registry.ts 存在", fs.existsSync(path.join(searchDir, "provider-registry.ts")));
    check("src/search/providers/ 目录存在", fs.existsSync(path.join(searchDir, "providers")));
    check("src/search/providers/serper.ts 存在", fs.existsSync(path.join(searchDir, "providers", "serper.ts")));
    check("src/search/content/ 目录存在", fs.existsSync(path.join(searchDir, "content")));
    check("src/search/content/jina-reader.ts 存在", fs.existsSync(path.join(searchDir, "content", "jina-reader.ts")));
    check("src/search/content/content-cleaner.ts 存在", fs.existsSync(path.join(searchDir, "content", "content-cleaner.ts")));

    // 不引入新依赖：检查 package.json 未被修改（git 状态）
    // 此项在 git 提交时验证
  }

  // ============================================================
  // 汇总
  // ============================================================

  console.log("\n=== 汇总 ===");
  console.log(`PASS: ${passed}`);
  console.log(`FAIL: ${failed}`);
  if (failed > 0) {
    console.log("\n❌ 存在失败项");
    process.exit(1);
  } else {
    console.log("\n✅ 全部通过");
    process.exit(0);
  }
}

main().catch((err: unknown) => {
  console.error("验收脚本异常退出:", err);
  process.exit(1);
});
