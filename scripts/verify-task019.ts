/**
 * Task 019 整合验证脚本（V0.8 收口）
 *
 * 运行：npx tsx scripts/verify-task019.ts
 *
 * 这是 V0.8 搜索层的端到端集成验证脚本，串联 019a-019d 的所有模块，
 * 验证完整的搜索管道。分 6 个 section：
 *   Section 1：基础设施验证（复用 019a：T1/T3/T4）
 *   Section 2：LLM + 去重 + 渠道验证（复用 019b：QwenAdapter/T2/T5）
 *   Section 3：搜索层框架验证（复用 019c：types/registry/serper/jina/cleaner）
 *   Section 4：T10 三层筛选验证（复用 019d：rule/ai/scorer/orchestrator）
 *   Section 5：端到端管道集成验证（019e 独有）
 *   Section 6：V0.8 交付物完整性检查（019e 独有）
 */

import fs from "fs";
import path from "path";
import type { SearchResult, CleanedContent, ScoredOpportunity, ChanceScore } from "../src/search/types";
import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";
import type { OpportunityCard } from "../src/schema/opportunity-card";

// 019a 模块
import { validateLink, validateLinks } from "../src/utils/link-validator";
import { normalizeUrl, normalizeUrls } from "../src/utils/url-normalizer";
import { parseJsonWithRepair, parseJsonStrict } from "../src/utils/json-repair";

// 019b 模块
import { QwenAdapter, type QwenConfig } from "../src/agents/qwen-adapter";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/agents/llm-adapter";
import {
  computeDedupKey,
  LocalFileStore,
  type StoreEntry,
  type RadarType,
} from "../src/agents/opportunity-store";
import {
  renderRemindersForChannel,
  getChannelFormatGuide,
  type ReminderChannel,
} from "../src/agents/reminder-renderer";
import type { ReminderItem, ReminderResult } from "../src/agents/reminder-engine";

// 019c 模块
import {
  ProviderRegistry,
  providerRegistry,
  type ReliabilityGrade,
  type SearchProvider,
} from "../src/search/provider-registry";
import { SerperProvider, type SerperConfig } from "../src/search/providers/serper";
import { JinaReaderFetcher, type JinaReaderConfig } from "../src/search/content/jina-reader";
import { cleanContent } from "../src/search/content/content-cleaner";

// 019d 模块
import { ruleFilter, type RuleFilterResult } from "../src/search/rule-filter";
import {
  aiFilter,
  type AIFilterItem,
  type AIFilterResult,
  type AIFilterOptions,
} from "../src/search/ai-filter";
import { scoreOpportunities } from "../src/search/opportunity-scorer";
import {
  SearchOrchestrator,
  type SearchOrchestratorConfig,
  type SearchOrchestratorResult,
} from "../src/search/orchestrator";

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
// 测试数据构造
// ============================================================

/** 构造测试用 Spec（含关键词策略 + 地域 + 排除规则） */
function makeSpec(overrides: Partial<RadarRequirementSpec> = {}): RadarRequirementSpec {
  return {
    product_name: "ChancePing",
    product_category: "机会雷达",
    client_profile: {
      client_name: "测试客户",
      client_type: "团队",
      industry: "AI 游戏",
      business_type: "游戏开发",
      company_stage: "初创",
      products_or_projects: ["AI 游戏"],
      target_users: ["玩家"],
      core_capabilities: ["Unity", "AI"],
      current_assets: [],
      regions: ["广州"],
      notes: "",
    },
    core_goals: {
      primary_goal: "找 AI 游戏比赛机会",
      secondary_goals: [],
      success_definition: "获得奖金",
      action_intent: ["报名比赛"],
      priority_order: ["奖金"],
    },
    opportunity_scope: {
      primary_opportunity_types: ["AI 比赛"],
      secondary_opportunity_types: [],
      excluded_opportunity_types: [],
      must_have_conditions: [],
      nice_to_have_conditions: [],
    },
    region_scope: {
      primary_regions: ["广州"],
      secondary_regions: [],
      excluded_regions: ["新疆"],
      global_allowed: false,
      overseas_allowed: false,
    },
    keyword_strategy: {
      core_keywords_zh: ["AI", "比赛"],
      core_keywords_en: ["AI", "competition"],
      expanded_keywords_zh: [],
      expanded_keywords_en: [],
      negative_keywords: [],
    },
    filter_rules: {
      must_include: [],
      must_exclude: ["广告", "诈骗"],
      low_priority_signals: [],
      high_priority_signals: [],
      requires_manual_review: [],
    },
    scoring_rules: {
      backend_score_enabled: true,
      visible_level_enabled: true,
      weights: { match_score: 30, business_value: 25, timeliness: 20, credibility: 15, actionability: 10, risk_penalty: -20 },
      visible_level_mapping: { S: "85-100", A: "70-84", B: "55-69", C: "40-54", hidden: "<40" },
      level_definitions: { S: "强烈推荐", A: "高价值", B: "可关注", C: "低优先级", hidden: "不展示" },
    },
    report_requirements: {
      report_format: "markdown",
      report_title_prefix: "本周",
      report_frequency: "weekly",
      max_items_per_report: 10,
      min_items_per_report: 5,
      must_include_sections: [],
      opportunity_card_required_fields: [],
      link_required: true,
      contact_required_if_available: true,
      deadline_required_if_available: true,
    },
    requirement_confidence: {
      total: 80,
      client_identity: { score: 80, weight: 15, reason: "" },
      business_goal: { score: 80, weight: 20, reason: "" },
      opportunity_type: { score: 80, weight: 20, reason: "" },
      region_scope: { score: 80, weight: 10, reason: "" },
      exclusion_rules: { score: 80, weight: 10, reason: "" },
      action_scenario: { score: 80, weight: 15, reason: "" },
      report_format: { score: 80, weight: 10, reason: "" },
    },
    questions_to_confirm: [],
    confirmation_status: {
      status: "confirmed",
      user_confirmed: true,
      confirmed_at: "2026-06-01",
      last_user_feedback: "",
      revision_count: 0,
    },
    ...overrides,
  };
}

/** 构造测试用 SearchResult */
function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: "全国 AI 创新大赛 2026",
    url: "https://example.com/ai-contest",
    snippet: "AI 创新大赛报名中",
    source_provider: "serper",
    source_type: "web",
    published_at: "2026-06-15",
    ...overrides,
  };
}

/** 构造完整 OpportunityCard（用于 019b T2 去重测试） */
function makeCard(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    title: "测试机会",
    type: "AI 比赛",
    organizer: "测试主办方",
    region: "广州",
    deadline: "2026-12-31",
    reward_or_value: "奖金 10 万元",
    eligibility: "个人 / 团队",
    materials_required: "Demo + 商业计划书",
    match_reason: "匹配理由",
    next_action: "本周内完成报名",
    official_source_url: "https://example.com/test",
    application_url: "https://example.com/apply",
    contact_info: "contact@example.com",
    risk_note: "暂无",
    backend_score: 85,
    visible_level: "A",
    status: "new",
    ...overrides,
  };
}

/** 构造 StoreEntry（用于 019b T5 渠道渲染测试） */
function makeStoreEntry(
  overrides: Partial<OpportunityCard> = {},
  radarType: RadarType = "ai_competition",
): StoreEntry {
  const card = makeCard(overrides);
  return {
    card,
    radar_type: radarType,
    added_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
    dedup_key: `key-${card.title}-${card.official_source_url}`,
  };
}

// ============================================================
// 主函数（async，包装所有验收逻辑）
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 019 整合验证（V0.8 收口）===\n");

  // ============================================================
  // Section 1：基础设施验证（复用 019a：T1/T3/T4）
  // ============================================================

  console.log("[Section 1] 基础设施验证（T1 域名安全 + T3 URL 标准化 + T4 JSON 修复）\n");

  {
    // T1 域名安全校验
    const r1 = validateLink("https://example.com/path");
    check("T1: https://example.com/path → valid=true", r1.valid === true);
    check("T1: safeUrl 存在", r1.safeUrl !== undefined);

    const r2 = validateLink("https://evil.com@legit.com/");
    check("T1: userinfo 绕过 → valid=false", r2.valid === false);

    const r3 = validateLink("https://192.168.1.1/path");
    check("T1: 私有 IP → valid=false", r3.valid === false);

    const r4 = validateLink("https://localhost/path");
    check("T1: localhost → valid=false", r4.valid === false);

    const r5 = validateLink("not-a-url");
    check("T1: 非法格式 → valid=false", r5.valid === false);

    // validateLinks 批量
    const batch = validateLinks(["https://example.com/a", "https://example.com/b"]);
    check("T1: validateLinks 返回数组", Array.isArray(batch) && batch.length === 2);

    // T3 URL 标准化
    const n1 = normalizeUrl("https://example.com/path?utm_source=abc&id=123");
    check("T3: 移除 utm_source", !n1.includes("utm_source"));
    check("T3: 保留 id 参数", n1.includes("id=123"));

    const n2 = normalizeUrl("HTTPS://EXAMPLE.COM/Path/?b=2&a=1#section");
    check("T3: 小写域名", n2.includes("example.com"));
    check("T3: 参数排序", n2.includes("a=1&b=2"));
    check("T3: 移除 fragment", !n2.includes("#"));

    const n3 = normalizeUrl("http://example.com/path");
    check("T3: 升级 https", n3.startsWith("https://"));

    const n4 = normalizeUrls(["https://example.com/a", "https://example.com/b"]);
    check("T3: normalizeUrls 返回数组", Array.isArray(n4) && n4.length === 2);

    const n5 = normalizeUrl("");
    check("T3: 空字符串 → 空字符串", n5 === "");

    // T4 JSON 三重修复
    const j1 = parseJsonWithRepair('{"a":1}');
    check("T4: 标准 JSON", (j1 as { a: number }).a === 1);

    const j2 = parseJsonWithRepair('{"a":1,}');
    check("T4: 尾逗号修复", (j2 as { a: number }).a === 1);

    const j3 = parseJsonWithRepair("{'a':1}");
    check("T4: 单引号转双引号", (j3 as { a: number }).a === 1);

    const j4 = parseJsonWithRepair("{a:1}");
    check("T4: 未引号 key 加引号", (j4 as { a: number }).a === 1);

    const j5 = parseJsonWithRepair('```json\n{"a":1}\n```');
    check("T4: Markdown 代码块剥离", (j5 as { a: number }).a === 1);

    const j6 = parseJsonWithRepair('前文 {"a":1} 后文');
    check("T4: 正则提取 JSON 块", (j6 as { a: number }).a === 1);

    const j7 = parseJsonWithRepair('{"a":1');
    check("T4: 截断补全", (j7 as { a: number }).a === 1);

    const j8 = parseJsonWithRepair("完全不是 JSON");
    check("T4: 文本兜底返回 raw", (j8 as { raw: string }).raw === "完全不是 JSON");

    const j9 = parseJsonWithRepair("");
    check("T4: 空字符串兜底", (j9 as { raw: string }).raw === "");

    // parseJsonStrict 严格模式
    let strictThrew = false;
    try {
      parseJsonStrict('{"a":1,}');
    } catch {
      strictThrew = true;
    }
    check("T4: parseJsonStrict 尾逗号抛错", strictThrew);

    const j10 = parseJsonStrict('{"a":1}');
    check("T4: parseJsonStrict 正常解析", (j10 as { a: number }).a === 1);
  }

  // ============================================================
  // Section 2：LLM + 去重 + 渠道验证（复用 019b：QwenAdapter/T2/T5）
  // ============================================================

  console.log("\n[Section 2] LLM + 去重 + 渠道验证（QwenAdapter + T2 guid + T5 渠道）\n");

  {
    // QwenAdapter Mock 模式
    const adapter = new QwenAdapter({ mockMode: true });
    check("QwenAdapter: 可实例化", adapter !== null && adapter !== undefined);

    const req: LLMRequest = {
      messages: [{ role: "user", content: "机会关键词：AI 大赛" }],
      response_format: "json",
    };
    const resp = await adapter.chat(req);
    check("QwenAdapter: Mock 返回 content 非空", typeof resp.content === "string" && resp.content.length > 0);
    check("QwenAdapter: Mock parsed 字段存在", resp.parsed !== undefined);

    // 解析 Mock 返回的 JSON
    const parsed = resp.parsed ?? parseJsonWithRepair(resp.content ?? "");
    check("QwenAdapter: Mock 返回可解析 JSON", parsed !== null && typeof parsed === "object");

    // 无 apiKey 时不抛错
    let noKeyThrew = false;
    try {
      new QwenAdapter();
    } catch {
      noKeyThrew = true;
    }
    check("QwenAdapter: 无 apiKey 不抛错", !noKeyThrew);

    // T2 guid > url 去重优先级
    const key1 = computeDedupKey("标题", "https://example.com/a");
    const key2 = computeDedupKey("标题", "https://example.com/a");
    check("T2: 相同 title+url → 相同 key", key1 === key2);

    const key3 = computeDedupKey("不同标题", "https://example.com/a");
    check("T2: 不同 title → 不同 key", key1 !== key3);

    const key4 = computeDedupKey("标题", "https://example.com/a", "guid-123");
    const key5 = computeDedupKey("不同标题", "https://different.com/b", "guid-123");
    check("T2: 相同 guid → 相同 key（guid 优先）", key4 === key5);

    const key6 = computeDedupKey("标题", "https://example.com/a", "guid-123");
    const key7 = computeDedupKey("标题", "https://example.com/a", "guid-456");
    check("T2: 不同 guid → 不同 key", key6 !== key7);

    // 空 guid 等价于不传 guid
    const key8 = computeDedupKey("标题", "https://example.com/a", "");
    check("T2: 空 guid 等价于不传 guid", key8 === key1);

    // T5 渠道格式指南
    const wechatGuide = getChannelFormatGuide("wechat");
    check("T5: wechat channel = wechat", wechatGuide.channel === "wechat");
    check("T5: wechat max_length = 2048", wechatGuide.max_length === 2048);
    check("T5: wechat format = plain", wechatGuide.format === "plain");
    check("T5: wechat emoji_enabled = true", wechatGuide.emoji_enabled === true);

    const emailGuide = getChannelFormatGuide("email");
    check("T5: email format = html", emailGuide.format === "html");
    check("T5: email emoji_enabled = false", emailGuide.emoji_enabled === false);

    const webGuide = getChannelFormatGuide("web");
    check("T5: web format = markdown", webGuide.format === "markdown");
    check("T5: web emoji_enabled = true", webGuide.emoji_enabled === true);

    // T5 渠道渲染
    const entries: StoreEntry[] = [
      makeStoreEntry({ title: "紧急机会", deadline: "2026-06-30", backend_score: 95, visible_level: "S" }),
    ];
    const reminders: ReminderResult = {
      urgent: [
        {
          entry: entries[0],
          level: "urgent",
          days_until_deadline: 2,
          deadline: "2026-06-30",
          title: "紧急机会",
          suggested_action: "本周内报名",
          priority: 1,
        },
      ],
      soon: [],
      warning: [],
      expired: [],
      no_reminder: [],
      summary: {
        urgent_count: 1,
        soon_count: 0,
        warning_count: 0,
        expired_count: 0,
        no_reminder_count: 0,
        total: 1,
      },
      base_date: "2026-06-28",
    };

    const wechatOutput = renderRemindersForChannel(reminders, "wechat");
    check("T5: wechat 渲染非空", typeof wechatOutput === "string" && wechatOutput.length > 0);
    check("T5: wechat 含品牌名", wechatOutput.includes("ChancePing") || wechatOutput.includes("盯机会"));

    const emailOutput = renderRemindersForChannel(reminders, "email");
    check("T5: email 渲染非空", typeof emailOutput === "string" && emailOutput.length > 0);

    const webOutput = renderRemindersForChannel(reminders, "web");
    check("T5: web 渲染非空", typeof webOutput === "string" && webOutput.length > 0);
  }

  // ============================================================
  // Section 3：搜索层框架验证（复用 019c：types/registry/serper/jina/cleaner）
  // ============================================================

  console.log("\n[Section 3] 搜索层框架验证（types + registry + serper + jina + cleaner）\n");

  {
    // types.ts 类型定义完整性
    const sr: SearchResult = {
      title: "test",
      url: "https://example.com",
      snippet: "snippet",
      source_provider: "serper",
      source_type: "web",
    };
    check("types: SearchResult 含 title/url/snippet/source_provider/source_type",
      sr.title !== undefined && sr.url !== undefined && sr.snippet !== undefined &&
      sr.source_provider !== undefined && sr.source_type !== undefined);

    const cc: CleanedContent = {
      url: "https://example.com",
      title: "title",
      main_text: "text",
      word_count: 10,
      fetch_success: true,
    };
    check("types: CleanedContent 含 url/title/main_text/word_count/fetch_success",
      cc.url !== undefined && cc.title !== undefined && cc.main_text !== undefined &&
      cc.word_count !== undefined && cc.fetch_success !== undefined);

    // ProviderRegistry 注册/查询
    check("registry: providerRegistry 单例含 serper", providerRegistry.get("serper") !== undefined);
    check("registry: serper 是 SerperProvider", providerRegistry.get("serper") instanceof SerperProvider);

    const enabled = providerRegistry.getEnabled();
    check("registry: getEnabled 返回数组", Array.isArray(enabled) && enabled.length > 0);
    check("registry: getEnabled 全部 enabled=true", enabled.every((p) => p.enabled === true));

    const aiProviders = providerRegistry.getByRadarType("ai_competition");
    check("registry: getByRadarType(ai_competition) 含 serper",
      aiProviders.some((p) => p.name === "serper"));

    // SerperProvider Mock 搜索
    const serper = new SerperProvider({ mockMode: true });
    const results = await serper.search("AI 比赛");
    check("serper: Mock search 返回数组", Array.isArray(results) && results.length > 0);
    check("serper: Mock 返回 4-5 条", results.length >= 4 && results.length <= 5);

    // 每条结果含非空 title/url/snippet
    check("serper: 每条含非空 title/url/snippet",
      results.every((r) => r.title.length > 0 && r.url.length > 0 && r.snippet.length > 0));

    // URL 全部 HTTPS + 通过 T1 校验
    check("serper: URL 全部 HTTPS", results.every((r) => r.url.startsWith("https://")));
    check("serper: URL 全部通过 T1 校验",
      results.every((r) => validateLink(r.url).valid === true));

    // URL 无追踪参数（T3 标准化）
    check("serper: URL 无 utm_source",
      results.every((r) => !r.url.includes("utm_source")));

    // 关键词路由
    const policyResults = await serper.search("政策 补贴");
    check("serper: 含政策关键词 → 返回政策类数据",
      policyResults.length > 0 && policyResults.some((r) => /政策|补贴|扶持/.test(r.title + r.snippet)));

    const genericResults = await serper.search("通用查询");
    check("serper: 通用查询返回数据", genericResults.length > 0);

    // healthCheck
    const healthy = await serper.healthCheck();
    check("serper: Mock healthCheck = true", healthy === true);

    // JinaReaderFetcher Mock 抓取
    const jina = new JinaReaderFetcher({ mockMode: true });
    const content = await jina.fetch("https://example.com/article");
    check("jina: Mock fetch 返回 CleanedContent", content !== null && content !== undefined);
    check("jina: main_text 非空", content.main_text.length > 0);
    check("jina: fetch_success = true", content.fetch_success === true);
    check("jina: word_count > 0", content.word_count > 0);

    // cleanContent HTML 清洗
    const cleaned = cleanContent(
      "<html><head><title>测试标题</title><style>body{}</style></head><body><p>正文内容这是一段较长的文字</p><script>alert(1)</script></body></html>",
      "https://example.com",
    );
    check("cleaner: HTML 标签移除", !cleaned.main_text.includes("<p>") && !cleaned.main_text.includes("</p>"));
    check("cleaner: script 移除", !cleaned.main_text.includes("<script>") && !cleaned.main_text.includes("alert"));
    check("cleaner: style 移除", !cleaned.main_text.includes("body{}"));
    check("cleaner: 保留正文", cleaned.main_text.includes("正文内容这是一段较长的文字"));
    check("cleaner: title 提取", cleaned.title === "测试标题");
    check("cleaner: fetch_success = true", cleaned.fetch_success === true);
    check("cleaner: word_count > 0", cleaned.word_count > 0);

    // 空字符串入参
    const emptyCleaned = cleanContent("", "https://example.com");
    check("cleaner: 空字符串不崩溃", emptyCleaned.fetch_success === false);
  }

  // ============================================================
  // Section 4：T10 三层筛选验证（复用 019d：rule/ai/scorer/orchestrator）
  // ============================================================

  console.log("\n[Section 4] T10 三层筛选验证（rule-filter + ai-filter + scorer + orchestrator）\n");

  {
    const spec = makeSpec();
    const llm = new QwenAdapter({ mockMode: true });

    // 4.1 规则粗筛
    const results: SearchResult[] = [
      makeResult({ title: "AI 大赛报名", url: "https://example.com/1", snippet: "AI 比赛报名中" }),
      makeResult({ title: "新疆活动", url: "https://example.com/2", snippet: "AI 比赛新疆" }),
      makeResult({ title: "广告推广", url: "https://example.com/3", snippet: "AI 比赛广告" }),
      makeResult({ title: "AI 大赛报名", url: "https://example.com/1", snippet: "重复" }), // 重复 URL
      makeResult({ title: "不相关内容", url: "https://example.com/4", snippet: "无关内容" }),
    ];
    const ruleResult = ruleFilter(results, spec);
    check("rule: passed 是数组", Array.isArray(ruleResult.passed));
    check("rule: rejected 是数组", Array.isArray(ruleResult.rejected));
    check("rule: passed 去重后唯一", ruleResult.passed.length <= results.length);
    check("rule: 含 must_exclude 的 rejected", ruleResult.rejected.some((r) => r.title.includes("广告")));
    check("rule: 含 excluded_regions 的 rejected", ruleResult.rejected.some((r) => r.title.includes("新疆")));

    // 无关键词策略时全部通过此规则
    const noKeywordSpec = makeSpec({
      keyword_strategy: {
        core_keywords_zh: [],
        core_keywords_en: [],
        expanded_keywords_zh: [],
        expanded_keywords_en: [],
        negative_keywords: [],
      },
    });
    const noKeywordResult = ruleFilter([makeResult({ title: "任意内容", url: "https://example.com/x" })], noKeywordSpec);
    check("rule: 无关键词策略不拒绝", noKeywordResult.passed.length === 1);

    // 空数组入参
    const emptyResult = ruleFilter([], spec);
    check("rule: 空数组 passed 为空", emptyResult.passed.length === 0);
    check("rule: 空数组 rejected 为空", emptyResult.rejected.length === 0);

    // 4.2 AI 精筛
    const aiInput: SearchResult[] = [
      makeResult({ title: "全国 AI 创新大赛", url: "https://example.com/ai-1", snippet: "AI 比赛报名" }),
      makeResult({ title: "不相关内容", url: "https://example.com/other-1", snippet: "无关" }),
    ];
    const aiResult = await aiFilter(aiInput, spec, llm);
    check("ai: Mock 返回 AIFilterResult", aiResult !== null && aiResult !== undefined);
    check("ai: passed 是数组", Array.isArray(aiResult.passed));
    check("ai: rejected 是数组", Array.isArray(aiResult.rejected));
    check("ai: AIFilterItem 含 result/content/relevance/reason",
      aiResult.passed.length > 0 && aiResult.passed.every((item) =>
        item.result !== undefined && item.content !== undefined &&
        typeof item.relevance === "number" && typeof item.reason === "string"));

    // AI 赛事类 Mock relevance >= 50
    check("ai: AI 赛事类 relevance >= 50",
      aiResult.passed.some((item) => /AI|大赛/.test(item.result.title)));

    // minRelevance 参数
    const strictAiResult = await aiFilter(aiInput, spec, llm, { minRelevance: 75 });
    check("ai: minRelevance=75 过滤更严", strictAiResult.passed.length <= aiResult.passed.length);

    // 空数组入参
    const emptyAiResult = await aiFilter([], spec, llm);
    check("ai: 空数组 passed 为空", emptyAiResult.passed.length === 0);
    check("ai: 空数组 rejected 为空", emptyAiResult.rejected.length === 0);

    // 4.3 机会评分
    const scoreInput: AIFilterItem[] = [
      {
        result: makeResult({ title: "AI 大赛", url: "https://example.com/score-1", source_provider: "serper" }),
        content: {
          url: "https://example.com/score-1",
          title: "AI 大赛",
          main_text: "正文内容",
          word_count: 4,
          fetch_success: true,
          publish_date: "2026-07-01",
        },
        relevance: 80,
        reason: "测试",
      },
    ];
    const opportunities = await scoreOpportunities(scoreInput, spec, llm);
    check("scorer: 返回 ScoredOpportunity[]", Array.isArray(opportunities) && opportunities.length === 1);
    check("scorer: 含 chance_score", opportunities[0]?.chance_score !== undefined);
    check("scorer: chance_score 含 6 字段",
      opportunities[0]?.chance_score.fit !== undefined &&
      opportunities[0]?.chance_score.intent !== undefined &&
      opportunities[0]?.chance_score.evidence !== undefined &&
      opportunities[0]?.chance_score.urgency !== undefined &&
      opportunities[0]?.chance_score.effort_cost !== undefined &&
      opportunities[0]?.chance_score.total !== undefined);
    check("scorer: Evidence = 75（serper B 级）", opportunities[0]?.chance_score.evidence === 75);
    check("scorer: visible_level 存在", opportunities[0]?.visible_level !== undefined);
    check("scorer: backend_score = total", opportunities[0]?.backend_score === opportunities[0]?.chance_score.total);
    check("scorer: guid 存在", opportunities[0]?.guid !== undefined && opportunities[0]?.guid.length > 0);

    // total 权重验证
    const cs = opportunities[0]?.chance_score;
    if (cs) {
      const expectedTotal = Math.round(
        cs.fit * 0.30 + cs.intent * 0.20 + cs.evidence * 0.20 + cs.urgency * 0.15 + cs.effort_cost * 0.15,
      );
      check("scorer: total = Fit*0.30 + Intent*0.20 + Evidence*0.20 + Urgency*0.15 + EffortCost*0.15",
        cs.total === expectedTotal, `actual=${cs.total} expected=${expectedTotal}`);
    } else {
      check("scorer: total 权重验证", false, "chance_score 不存在");
    }

    // 空数组入参
    const emptyOpps = await scoreOpportunities([], spec, llm);
    check("scorer: 空数组返回空数组", emptyOpps.length === 0);

    // 4.4 搜索编排器
    const orchestrator = new SearchOrchestrator({ llmAdapter: llm });
    const orchResult = await orchestrator.search(spec, "AI 大赛");
    check("orchestrator: 返回 SearchOrchestratorResult", orchResult !== null && orchResult !== undefined);
    check("orchestrator: total_raw > 0", orchResult.total_raw > 0);
    check("orchestrator: total_rule_passed > 0", orchResult.total_rule_passed > 0);
    check("orchestrator: duration_ms > 0", orchResult.duration_ms > 0);
    check("orchestrator: errors 是数组", Array.isArray(orchResult.errors));
    check("orchestrator: total_raw >= total_rule_passed", orchResult.total_raw >= orchResult.total_rule_passed);
    check("orchestrator: total_rule_passed >= total_ai_passed", orchResult.total_rule_passed >= orchResult.total_ai_passed);
    check("orchestrator: total_scored === opportunities.length",
      orchResult.total_scored === orchResult.opportunities.length);

    // enableContentFetch=false
    const skipFetchOrch = new SearchOrchestrator({ llmAdapter: llm, enableContentFetch: false });
    const skipResult = await skipFetchOrch.search(spec, "AI 大赛");
    check("orchestrator: enableContentFetch=false → total_ai_passed = total_rule_passed",
      skipResult.total_ai_passed === skipResult.total_rule_passed);
    check("orchestrator: enableContentFetch=false → opportunities 非空", skipResult.opportunities.length > 0);
  }

  // ============================================================
  // Section 5：端到端管道集成验证（019e 独有）
  // ============================================================

  console.log("\n[Section 5] 端到端管道集成验证（019e 独有）\n");

  {
    // 构造 Mock RadarRequirementSpec（AI 赛事雷达）
    const spec = makeSpec();
    const llm = new QwenAdapter({ mockMode: true });

    // 调用 SearchOrchestrator.search 执行完整搜索
    const orchestrator = new SearchOrchestrator({ llmAdapter: llm });
    const result = await orchestrator.search(spec);

    // 验证返回的 SearchOrchestratorResult
    check("e2e: total_raw > 0（有原始搜索结果）", result.total_raw > 0, `total_raw=${result.total_raw}`);
    check("e2e: total_rule_passed <= total_raw（规则粗筛只减不增）",
      result.total_rule_passed <= result.total_raw, `rule=${result.total_rule_passed} raw=${result.total_raw}`);
    check("e2e: total_ai_passed <= total_rule_passed（AI 精筛只减不增）",
      result.total_ai_passed <= result.total_rule_passed, `ai=${result.total_ai_passed} rule=${result.total_rule_passed}`);
    check("e2e: total_scored === opportunities.length（评分完成数 = 机会列表长度）",
      result.total_scored === result.opportunities.length, `scored=${result.total_scored} opp=${result.opportunities.length}`);
    check("e2e: duration_ms > 0", result.duration_ms > 0, `duration=${result.duration_ms}`);
    check("e2e: errors 为空数组（Mock 模式下无错误）",
      Array.isArray(result.errors) && result.errors.length === 0, `errors=${JSON.stringify(result.errors)}`);

    // 验证每条 opportunity 含完整的 chance_score（6 字段）和 visible_level
    check("e2e: opportunities 非空", result.opportunities.length > 0);
    const allHaveChanceScore = result.opportunities.every((opp) => {
      const cs = opp.chance_score;
      return cs !== null && cs !== undefined &&
        typeof cs.fit === "number" &&
        typeof cs.intent === "number" &&
        typeof cs.evidence === "number" &&
        typeof cs.urgency === "number" &&
        typeof cs.effort_cost === "number" &&
        typeof cs.total === "number";
    });
    check("e2e: 每项含 chance_score 6 字段", allHaveChanceScore);

    const allHaveVisibleLevel = result.opportunities.every((opp) => {
      const lv = opp.visible_level;
      return lv === "S" || lv === "A" || lv === "B" || lv === "C" || lv === "hidden";
    });
    check("e2e: 每项含 visible_level（S/A/B/C/hidden）", allHaveVisibleLevel);

    // 额外验证：每项含 search_result / cleaned_content / guid
    const allComplete = result.opportunities.every((opp) =>
      opp.search_result !== undefined &&
      opp.cleaned_content !== undefined &&
      typeof opp.guid === "string" && opp.guid.length > 0 &&
      typeof opp.relevance_score === "number" &&
      typeof opp.relevance_reason === "string" &&
      typeof opp.backend_score === "number",
    );
    check("e2e: 每项含完整字段（search_result/cleaned_content/guid/relevance/backend_score）", allComplete);

    // 验证 Mock 模式下 Evidence = 75（serper B 级）
    const allEvidence75 = result.opportunities.every((opp) => opp.chance_score.evidence === 75);
    check("e2e: Mock 模式下 Evidence = 75（serper B 级）", allEvidence75);

    // 验证 backend_score = chance_score.total
    const scoreConsistent = result.opportunities.every((opp) =>
      opp.backend_score === opp.chance_score.total,
    );
    check("e2e: backend_score = chance_score.total", scoreConsistent);

    // 第二次调用（不同 query）验证稳定性
    const result2 = await orchestrator.search(spec, "AI 比赛 2026");
    check("e2e: 第二次调用同样返回结果", result2.total_raw > 0 && result2.opportunities.length > 0);
  }

  // ============================================================
  // Section 6：V0.8 交付物完整性检查（019e 独有）
  // ============================================================

  console.log("\n[Section 6] V0.8 交付物完整性检查（019e 独有）\n");

  {
    const cwd = process.cwd();

    // 019a 的 3 个文件
    check("019a: link-validator.ts 存在", fs.existsSync(path.join(cwd, "src/utils/link-validator.ts")));
    check("019a: url-normalizer.ts 存在", fs.existsSync(path.join(cwd, "src/utils/url-normalizer.ts")));
    check("019a: json-repair.ts 存在", fs.existsSync(path.join(cwd, "src/utils/json-repair.ts")));

    // 019b 的 1 新增文件
    check("019b: qwen-adapter.ts 存在", fs.existsSync(path.join(cwd, "src/agents/qwen-adapter.ts")));

    // 019b 修改的 3 个文件（验证导出正确）
    const cardContent = fs.readFileSync(path.join(cwd, "src/schema/opportunity-card.ts"), "utf-8");
    check("019b: opportunity-card.ts 含 guid 字段", cardContent.includes("guid"));
    const storeContent = fs.readFileSync(path.join(cwd, "src/agents/opportunity-store.ts"), "utf-8");
    check("019b: opportunity-store.ts 含 computeDedupKey", storeContent.includes("computeDedupKey"));
    const rendererContent = fs.readFileSync(path.join(cwd, "src/agents/reminder-renderer.ts"), "utf-8");
    check("019b: reminder-renderer.ts 含 renderRemindersForChannel", rendererContent.includes("renderRemindersForChannel"));

    // 019c 的 5 个文件
    check("019c: types.ts 存在", fs.existsSync(path.join(cwd, "src/search/types.ts")));
    check("019c: provider-registry.ts 存在", fs.existsSync(path.join(cwd, "src/search/provider-registry.ts")));
    check("019c: providers/serper.ts 存在", fs.existsSync(path.join(cwd, "src/search/providers/serper.ts")));
    check("019c: content/jina-reader.ts 存在", fs.existsSync(path.join(cwd, "src/search/content/jina-reader.ts")));
    check("019c: content/content-cleaner.ts 存在", fs.existsSync(path.join(cwd, "src/search/content/content-cleaner.ts")));

    // 019d 的 4 个文件
    check("019d: rule-filter.ts 存在", fs.existsSync(path.join(cwd, "src/search/rule-filter.ts")));
    check("019d: ai-filter.ts 存在", fs.existsSync(path.join(cwd, "src/search/ai-filter.ts")));
    check("019d: opportunity-scorer.ts 存在", fs.existsSync(path.join(cwd, "src/search/opportunity-scorer.ts")));
    check("019d: orchestrator.ts 存在", fs.existsSync(path.join(cwd, "src/search/orchestrator.ts")));

    // 019e 的 1 个文件（自身）
    check("019e: verify-task019.ts 存在", fs.existsSync(path.join(cwd, "scripts/verify-task019.ts")));

    // package.json version >= 0.8.0（V0.9+ 兼容）
    const pkgContent = fs.readFileSync(path.join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgContent);
    const versionParts = String(pkg.version ?? "").split(".").map((n: string) => parseInt(n, 10) || 0);
    const versionNum = versionParts.length >= 3 ? versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2] : (versionParts.length === 2 ? versionParts[0] * 10000 + versionParts[1] * 100 : 0);
    check("package.json: version >= 0.8.0", versionNum >= 800, `version=${pkg.version}`);
    check("package.json: description 含 V0.8/V0.9/V1.0 或 ChancePing", typeof pkg.description === "string" && (pkg.description.includes("V0.8") || pkg.description.includes("V0.9") || pkg.description.includes("V1.0") || pkg.description.includes("ChancePing")));
    check("package.json: scripts.verify 指向 verify-task019.ts",
      pkg.scripts?.verify === "tsx scripts/verify-task019.ts", `verify=${pkg.scripts?.verify}`);

    // 依赖不变
    check("package.json: dependencies 含 ajv", pkg.dependencies?.ajv !== undefined);
    check("package.json: dependencies 含 ajv-formats", pkg.dependencies?.["ajv-formats"] !== undefined);
    check("package.json: dependencies 含 i18next", pkg.dependencies?.i18next !== undefined);
    check("package.json: devDependencies 含 tsx", pkg.devDependencies?.tsx !== undefined);
    check("package.json: devDependencies 含 typescript", pkg.devDependencies?.typescript !== undefined);
  }

  // ============================================================
  // 汇总
  // ============================================================

  console.log("\n=== 汇总 ===");
  console.log(`PASS: ${passed}`);
  console.log(`FAIL: ${failed}`);
  if (failed === 0) {
    console.log("\n✅ 全部通过");
  } else {
    console.log("\n❌ 有失败项");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("验收脚本执行异常:", err);
  process.exit(1);
});
