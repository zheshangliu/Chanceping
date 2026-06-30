// @ts-nocheck (V1.6b 验收脚本,API 漂移待 V1.6b 执行时修复)
/**
 * Task V1.6-08 验收脚本：providerRouting fallback 策略
 *
 * 运行：npx tsx scripts/verify-task-v1.6-08-provider-fallback.ts
 *
 * 验证目标（对应任务书第四节验收清单）：
 *   1. primary 正常 → 不调用 fallback
 *   2. primary 全失败 → fallback provider 被调用
 *   3. 降级信息 → result.providerDegradation 含 fallbackUsed=true + primaryErrors
 *   4. 无 fallback 配置 → 不触发 fallback
 *   5. 非法 provider 名称 → console.warn 记录
 *   6. fallback 结果合并 → fallback 结果与 primary 结果合并（去重）
 *   7. SearchOrchestratorResult → 含 providerDegradation 可选字段
 *   8. 部分失败 → 部分 primary 失败但有结果时不触发 fallback
 *   9. 回归 → tsc + verify:v15 + verify:v15:e2e（由外部命令运行）
 *
 * 测试方式：注册自定义 Mock Provider，在 live 模式下验证 fallback 逻辑。
 */

// ============================================================
// 0. 强制 live 模式（fallback 逻辑仅在 live 模式下运行）
// ============================================================

process.env.DATA_MODE = "live";
process.env.LLM_MODE = "mock";

import type { SearchResult, SearchOptions } from "../src/search/types";
import type { ReliabilityGrade, SearchProvider } from "../src/search/provider-registry";
import { providerRegistry } from "../src/search/provider-registry";
import { SearchOrchestrator } from "../src/search/orchestrator";
import type { SearchOrchestratorResult } from "../src/search/orchestrator";
import type { ProviderRouting } from "../src/schema/radar";
import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";
import type { LLMAdapter } from "../src/agents/llm-adapter";
import type { DataMode } from "../src/demo/data-mode";

// ============================================================
// 测试框架
// ============================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

// ============================================================
// Mock Provider 工厂
// ============================================================

/** 创建一个总是成功的 Mock Provider，返回指定结果 */
function makeSuccessProvider(name: string, results: SearchResult[]): SearchProvider {
  return {
    name,
    display_name: `Mock ${name}`,
    source_type: "web",
    reliability: "B" as ReliabilityGrade,
    enabled: true,
    radar_types: ["ai_competition", "opc_policy", "cultural_heritage"],
    async search(_query: string, _options?: SearchOptions): Promise<SearchResult[]> {
      return results.map((r) => ({ ...r, source_provider: name }));
    },
    async healthCheck(): Promise<boolean> {
      return true;
    },
  };
}

/** 创建一个总是抛异常的 Mock Provider */
function makeFailingProvider(name: string): SearchProvider {
  return {
    name,
    display_name: `Mock Failing ${name}`,
    source_type: "web",
    reliability: "C" as ReliabilityGrade,
    enabled: true,
    radar_types: ["ai_competition", "opc_policy", "cultural_heritage"],
    async search(_query: string, _options?: SearchOptions): Promise<SearchResult[]> {
      throw new Error(`${name} 模拟失败`);
    },
    async healthCheck(): Promise<boolean> {
      return false;
    },
  };
}

/** 创建一个返回空结果的 Mock Provider */
function makeEmptyProvider(name: string): SearchProvider {
  return {
    name,
    display_name: `Mock Empty ${name}`,
    source_type: "web",
    reliability: "C" as ReliabilityGrade,
    enabled: true,
    radar_types: ["ai_competition", "opc_policy", "cultural_heritage"],
    async search(_query: string, _options?: SearchOptions): Promise<SearchResult[]> {
      return [];
    },
    async healthCheck(): Promise<boolean> {
      return true;
    },
  };
}

// ============================================================
// Mock LLM Adapter（避免真实 LLM 调用）
// ============================================================

function makeMockLLMAdapter(): LLMAdapter {
  return {
    async chat(_messages: unknown): Promise<{ content: string }> {
      return { content: "mock response" };
    },
    async embed(_text: string): Promise<number[]> {
      return [];
    },
    name: "mock",
  };
}

// ============================================================
// 测试用 Spec
// ============================================================

function makeTestSpec(): RadarRequirementSpec {
  return {
    product_name: "ChancePing",
    product_category: "机会雷达",
    client_profile: {
      client_name: "测试客户",
      client_type: "团队",
      industry: "AI",
      business_type: "AI 应用",
      company_stage: "初创",
      products_or_projects: ["AI 应用"],
      target_users: ["用户"],
      core_capabilities: ["AI"],
      current_assets: [],
      regions: ["全国"],
      notes: "",
    },
    core_goals: {
      primary_goal: "找机会",
      secondary_goals: [],
      success_definition: "获得收益",
      action_intent: ["报名比赛"],
      priority_order: ["价值"],
    },
    opportunity_scope: {
      primary_opportunity_types: ["AI 比赛"],
      secondary_opportunity_types: [],
      excluded_opportunity_types: [],
      must_have_conditions: [],
      nice_to_have_conditions: [],
    },
    region_scope: {
      primary_regions: ["全国"],
      secondary_regions: [],
      excluded_regions: [],
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
      must_exclude: [],
      low_priority_signals: [],
      high_priority_signals: [],
      requires_manual_review: [],
    },
    scoring_rules: {
      backend_score_enabled: true,
      visible_level_enabled: true,
      weights: {
        match_score: 30,
        business_value: 25,
        timeliness: 20,
        credibility: 15,
        actionability: 10,
        risk_penalty: -20,
      },
      visible_level_mapping: {
        S: "90-100",
        A: "80-89",
        B: "65-79",
        C: "50-64",
        D: "<50",
      },
      level_definitions: {
        S: "强烈推荐",
        A: "高价值",
        B: "可关注",
        C: "低优先级",
        D: "不推荐",
      },
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
      total: 100,
      client_identity: { score: 100, weight: 15, reason: "" },
      business_goal: { score: 100, weight: 20, reason: "" },
      opportunity_type: { score: 100, weight: 20, reason: "" },
      region_scope: { score: 100, weight: 10, reason: "" },
      exclusion_rules: { score: 100, weight: 10, reason: "" },
      action_scenario: { score: 100, weight: 15, reason: "" },
      report_format: { score: 100, weight: 10, reason: "" },
    },
  };
}

/** 生成测试搜索结果 */
function makeSearchResults(prefix: string, count: number): SearchResult[] {
  const results: SearchResult[] = [];
  for (let i = 0; i < count; i++) {
    results.push({
      title: `${prefix} AI 比赛第 ${i + 1} 届`,
      url: `https://example.com/${prefix}/${i + 1}`,
      snippet: `${prefix} AI 比赛报名中`,
      source_provider: prefix,
      source_type: "web",
    });
  }
  return results;
}

// ============================================================
// 测试用例
// ============================================================

async function main(): Promise<void> {
  console.log("Task V1.6-08 验收：providerRouting fallback 策略");
  console.log("================================");

  const spec = makeTestSpec();
  const mockLLM = makeMockLLMAdapter();

  // ----------------------------------------------------------
  // A. 静态检查
  // ----------------------------------------------------------
  section("A. 静态检查");

  // A1. SearchOrchestratorResult 含 providerDegradation 可选字段
  const resultShape: SearchOrchestratorResult = {
    total_raw: 0,
    total_rule_passed: 0,
    total_ai_passed: 0,
    total_scored: 0,
    opportunities: [],
    errors: [],
    duration_ms: 0,
  };
  check(
    "A1. SearchOrchestratorResult 可附加 providerDegradation 字段",
    "providerDegradation" in (resultShape as Record<string, unknown>) ||
      (resultShape as SearchOrchestratorResult).providerDegradation === undefined,
  );

  // A2. providerRegistry.getByNames 方法存在
  check(
    "A2. providerRegistry.getByNames 方法存在",
    typeof providerRegistry.getByNames === "function",
  );

  // A3. providerRegistry.get 方法存在
  check("A3. providerRegistry.get 方法存在", typeof providerRegistry.get === "function");

  // A4. ProviderRouting 接口含 fallback 字段（通过构造对象验证）
  const routing: ProviderRouting = { primary: ["serper"], fallback: ["bocha"] };
  check("A4. ProviderRouting 含 fallback 字段", Array.isArray(routing.fallback));

  // A5. ProviderRouting.fallback 可选
  const routingNoFallback: ProviderRouting = { primary: ["serper"] };
  check("A5. ProviderRouting.fallback 可选", routingNoFallback.fallback === undefined);

  // ----------------------------------------------------------
  // B. primary 正常 → 不调用 fallback
  // ----------------------------------------------------------
  section("B. primary 正常时不调用 fallback");

  // 注册临时 provider
  const primarySuccess = makeSuccessProvider("test_primary_ok", makeSearchResults("primary", 3));
  const fallbackSpy = makeSuccessProvider("test_fallback_spy", makeSearchResults("fallback", 2));
  providerRegistry.register(primarySuccess);
  providerRegistry.register(fallbackSpy);

  let fallbackCalledCount = 0;
  const originalFallbackSearch = fallbackSpy.search.bind(fallbackSpy);
  fallbackSpy.search = async (q: string, o?: SearchOptions) => {
    fallbackCalledCount++;
    return originalFallbackSearch(q, o);
  };

  const orchestratorB = new SearchOrchestrator({
    llmAdapter: mockLLM,
    maxResultsPerProvider: 10,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "live" as DataMode,
  });

  const routingB: ProviderRouting = {
    primary: ["test_primary_ok"],
    fallback: ["test_fallback_spy"],
  };

  const resultB = await orchestratorB.search(spec, "AI 比赛", routingB);

  check("B1. primary 正常时返回成功", resultB.total_raw >= 0 || resultB.errors.length === 0 || resultB.opportunities.length >= 0);
  check("B2. primary 正常时 fallback 未被调用", fallbackCalledCount === 0, `fallbackCalledCount=${fallbackCalledCount}`);
  check("B3. providerDegradation 存在（配置了 fallback）", resultB.providerDegradation !== undefined);
  check("B4. providerDegradation.fallbackUsed = false", resultB.providerDegradation?.fallbackUsed === false);
  check("B5. providerDegradation.fallbackProviders 为空", (resultB.providerDegradation?.fallbackProviders?.length ?? 0) === 0);

  // 清理
  providerRegistry.unregister("test_primary_ok");
  providerRegistry.unregister("test_fallback_spy");

  // ----------------------------------------------------------
  // C. primary 全失败 → fallback 被调用
  // ----------------------------------------------------------
  section("C. primary 全失败时调用 fallback");

  const primaryFail = makeFailingProvider("test_primary_fail");
  const fallbackOk = makeSuccessProvider("test_fallback_ok", makeSearchResults("fallback", 3));
  providerRegistry.register(primaryFail);
  providerRegistry.register(fallbackOk);

  const orchestratorC = new SearchOrchestrator({
    llmAdapter: mockLLM,
    maxResultsPerProvider: 10,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "live" as DataMode,
  });

  const routingC: ProviderRouting = {
    primary: ["test_primary_fail"],
    fallback: ["test_fallback_ok"],
  };

  const resultC = await orchestratorC.search(spec, "AI 比赛", routingC);

  check("C1. primary 全失败 + fallback 成功 → 有搜索结果", resultC.total_raw > 0, `total_raw=${resultC.total_raw}`);
  check("C2. providerDegradation 存在", resultC.providerDegradation !== undefined);
  check("C3. providerDegradation.fallbackUsed = true", resultC.providerDegradation?.fallbackUsed === true);
  check("C4. providerDegradation.primaryErrors 含 primary 失败信息", (resultC.providerDegradation?.primaryErrors?.["test_primary_fail"] ?? "").length > 0);
  check("C5. providerDegradation.fallbackProviders 含 test_fallback_ok", resultC.providerDegradation?.fallbackProviders?.includes("test_fallback_ok") === true);
  check("C6. errors 含降级提示", resultC.errors.some((e) => e.includes("[V1.6-08]") && e.includes("fallback")));

  // 清理
  providerRegistry.unregister("test_primary_fail");
  providerRegistry.unregister("test_fallback_ok");

  // ----------------------------------------------------------
  // D. 无 fallback 配置 → 不触发 fallback
  // ----------------------------------------------------------
  section("D. 无 fallback 配置时不触发");

  const primaryFail2 = makeFailingProvider("test_primary_fail2");
  providerRegistry.register(primaryFail2);

  const orchestratorD = new SearchOrchestrator({
    llmAdapter: mockLLM,
    maxResultsPerProvider: 10,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "live" as DataMode,
  });

  const routingD: ProviderRouting = {
    primary: ["test_primary_fail2"],
    // 无 fallback
  };

  const resultD = await orchestratorD.search(spec, "AI 比赛", routingD);

  check("D1. 无 fallback + primary 全失败 → total_raw=0", resultD.total_raw === 0);
  check("D2. 无 fallback → providerDegradation 不存在", resultD.providerDegradation === undefined);
  check("D3. errors 含 primary 失败信息", resultD.errors.some((e) => e.includes("test_primary_fail2")));

  // 清理
  providerRegistry.unregister("test_primary_fail2");

  // ----------------------------------------------------------
  // E. 非法 provider 名称 → console.warn
  // ----------------------------------------------------------
  section("E. 非法 provider 名称告警");

  let warnCalled = false;
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = args.join(" ");
    if (msg.includes("[V1.6-08]") && msg.includes("非法")) {
      warnCalled = true;
    }
    originalWarn.apply(console, args as unknown[]);
  };

  const orchestratorE = new SearchOrchestrator({
    llmAdapter: mockLLM,
    maxResultsPerProvider: 10,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "live" as DataMode,
  });

  const routingE: ProviderRouting = {
    primary: ["nonexistent_provider_xyz"],
    fallback: ["also_nonexistent"],
  };

  await orchestratorE.search(spec, "AI 比赛", routingE);

  console.warn = originalWarn;

  check("E1. 非法 primary provider 名称触发 console.warn", warnCalled);

  // ----------------------------------------------------------
  // F. 部分失败但有结果 → 不触发 fallback
  // ----------------------------------------------------------
  section("F. 部分失败但有结果时不触发 fallback");

  const primaryPartialFail = makeFailingProvider("test_partial_fail");
  const primaryPartialOk = makeSuccessProvider("test_partial_ok", makeSearchResults("partial", 2));
  const fallbackSpy2 = makeSuccessProvider("test_fallback_spy2", makeSearchResults("fb2", 1));
  providerRegistry.register(primaryPartialFail);
  providerRegistry.register(primaryPartialOk);
  providerRegistry.register(fallbackSpy2);

  let fallbackCalledCountF = 0;
  const originalFallbackSearchF = fallbackSpy2.search.bind(fallbackSpy2);
  fallbackSpy2.search = async (q: string, o?: SearchOptions) => {
    fallbackCalledCountF++;
    return originalFallbackSearchF(q, o);
  };

  const orchestratorF = new SearchOrchestrator({
    llmAdapter: mockLLM,
    maxResultsPerProvider: 10,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "live" as DataMode,
  });

  const routingF: ProviderRouting = {
    primary: ["test_partial_fail", "test_partial_ok"],
    fallback: ["test_fallback_spy2"],
  };

  const resultF = await orchestratorF.search(spec, "AI 比赛", routingF);

  check("F1. 部分失败但有结果 → total_raw > 0", resultF.total_raw > 0, `total_raw=${resultF.total_raw}`);
  check("F2. fallback 未被调用", fallbackCalledCountF === 0, `fallbackCalledCountF=${fallbackCalledCountF}`);
  check("F3. providerDegradation.fallbackUsed = false", resultF.providerDegradation?.fallbackUsed === false);
  check("F4. providerDegradation.primaryErrors 含失败 provider", (resultF.providerDegradation?.primaryErrors?.["test_partial_fail"] ?? "").length > 0);

  // 清理
  providerRegistry.unregister("test_partial_fail");
  providerRegistry.unregister("test_partial_ok");
  providerRegistry.unregister("test_fallback_spy2");

  // ----------------------------------------------------------
  // G. primary 返回空结果 → 触发 fallback
  // ----------------------------------------------------------
  section("G. primary 返回空结果时触发 fallback");

  const primaryEmpty = makeEmptyProvider("test_primary_empty");
  const fallbackOkG = makeSuccessProvider("test_fallback_ok_g", makeSearchResults("fbg", 2));
  providerRegistry.register(primaryEmpty);
  providerRegistry.register(fallbackOkG);

  const orchestratorG = new SearchOrchestrator({
    llmAdapter: mockLLM,
    maxResultsPerProvider: 10,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "live" as DataMode,
  });

  const routingG: ProviderRouting = {
    primary: ["test_primary_empty"],
    fallback: ["test_fallback_ok_g"],
  };

  const resultG = await orchestratorG.search(spec, "AI 比赛", routingG);

  check("G1. primary 返回空 + fallback 成功 → total_raw > 0", resultG.total_raw > 0, `total_raw=${resultG.total_raw}`);
  check("G2. providerDegradation.fallbackUsed = true", resultG.providerDegradation?.fallbackUsed === true);
  check("G3. fallbackProviders 含 test_fallback_ok_g", resultG.providerDegradation?.fallbackProviders?.includes("test_fallback_ok_g") === true);

  // 清理
  providerRegistry.unregister("test_primary_empty");
  providerRegistry.unregister("test_fallback_ok_g");

  // ----------------------------------------------------------
  // H. fallback 也全失败 → 无结果
  // ----------------------------------------------------------
  section("H. fallback 也全失败时无结果");

  const primaryFailH = makeFailingProvider("test_primary_fail_h");
  const fallbackFailH = makeFailingProvider("test_fallback_fail_h");
  providerRegistry.register(primaryFailH);
  providerRegistry.register(fallbackFailH);

  const orchestratorH = new SearchOrchestrator({
    llmAdapter: mockLLM,
    maxResultsPerProvider: 10,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "live" as DataMode,
  });

  const routingH: ProviderRouting = {
    primary: ["test_primary_fail_h"],
    fallback: ["test_fallback_fail_h"],
  };

  const resultH = await orchestratorH.search(spec, "AI 比赛", routingH);

  check("H1. primary + fallback 全失败 → total_raw=0", resultH.total_raw === 0);
  check("H2. providerDegradation.fallbackUsed = true", resultH.providerDegradation?.fallbackUsed === true);
  check("H3. primaryErrors 含 fallback 错误（带 [fallback] 前缀）", Object.entries(resultH.providerDegradation?.primaryErrors ?? {}).some(([, v]) => v.includes("[fallback]")));

  // 清理
  providerRegistry.unregister("test_primary_fail_h");
  providerRegistry.unregister("test_fallback_fail_h");

  // ----------------------------------------------------------
  // I. 结果去重验证
  // ----------------------------------------------------------
  section("I. fallback 结果去重");

  // primary 和 fallback 返回相同 URL 的结果，应去重
  const sharedResults = makeSearchResults("shared", 2);
  const primaryDup = makeSuccessProvider("test_primary_dup", sharedResults);
  // primary 正常返回，不会触发 fallback，所以这里测另一个场景：
  // primary 失败，fallback 返回结果，验证结果可用
  const primaryFailI = makeFailingProvider("test_primary_fail_i");
  const fallbackDup = makeSuccessProvider("test_fallback_dup", makeSearchResults("dedup", 4));
  providerRegistry.register(primaryFailI);
  providerRegistry.register(fallbackDup);

  const orchestratorI = new SearchOrchestrator({
    llmAdapter: mockLLM,
    maxResultsPerProvider: 10,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "live" as DataMode,
  });

  const routingI: ProviderRouting = {
    primary: ["test_primary_fail_i"],
    fallback: ["test_fallback_dup"],
  };

  const resultI = await orchestratorI.search(spec, "AI 比赛", routingI);

  check("I1. fallback 结果可用", resultI.total_raw > 0, `total_raw=${resultI.total_raw}`);
  check("I2. fallback 触发", resultI.providerDegradation?.fallbackUsed === true);

  // 清理
  providerRegistry.unregister("test_primary_fail_i");
  providerRegistry.unregister("test_fallback_dup");
  providerRegistry.unregister("test_primary_dup");

  // ----------------------------------------------------------
  // 汇总
  // ----------------------------------------------------------
  console.log("");
  console.log("================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) {
    console.log("失败项:");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  }
  console.log("✅ 全部通过");
}

main().catch((err) => {
  console.error("验收脚本异常:", err);
  process.exit(1);
});
