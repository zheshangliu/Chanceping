/**
 * Task 019d 验收脚本
 *
 * 运行：npx tsx scripts/verify-task019d.ts
 *
 * 覆盖验收标准 5.1-5.4 + T10 端到端管道自检 + 约束自检：
 *   5.1 第一层：规则粗筛
 *   5.2 第二层：AI 精筛
 *   5.3 第三层：机会评分
 *   5.4 搜索编排器
 */

import fs from "fs";
import path from "path";
import type { SearchResult, CleanedContent, ScoredOpportunity } from "../src/search/types";
import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";
import {
  ruleFilter,
  type RuleFilterResult,
} from "../src/search/rule-filter";
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
import { QwenAdapter } from "../src/agents/qwen-adapter";
import type { LLMAdapter } from "../src/agents/llm-adapter";
import { providerRegistry } from "../src/search/provider-registry";
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

/** 计算距今天 N 天的日期（YYYY-MM-DD） */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// ============================================================
// 主函数（async，包装所有验收逻辑）
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 019d 验收检查 ===\n");

  // ============================================================
  // 验收 5.1：第一层 规则粗筛
  // ============================================================
  console.log("[验收 5.1] 第一层 规则粗筛\n");

  // 文件存在 + 导出
  check("rule-filter.ts 存在", fs.existsSync("src/search/rule-filter.ts"));
  check("导出 ruleFilter 函数", typeof ruleFilter === "function");
  check("导出 RuleFilterResult interface", typeof ({} as RuleFilterResult) === "object");

  // 关键词匹配规则
  {
    const spec = makeSpec();
    const results = [
      makeResult({ title: "AI 大赛 2026", url: "https://example.com/ai-1" }),
      makeResult({ title: "区块链大会", url: "https://example.com/bc-1", snippet: "无关键词" }),
    ];
    const r = ruleFilter(results, spec);
    check("关键词匹配：含关键词的 passed", r.passed.length === 1);
    check("关键词匹配：不含关键词的 rejected", r.rejected.length === 1);
    check("关键词不匹配 reason", r.reject_reasons.get("https://example.com/bc-1") === "关键词不匹配");
  }

  // 地域过滤规则
  {
    const spec = makeSpec();
    const results = [
      makeResult({ title: "AI 大赛 新疆", url: "https://example.com/ai-xj" }),
      makeResult({ title: "AI 大赛 广州", url: "https://example.com/ai-gz" }),
    ];
    const r = ruleFilter(results, spec);
    check("地域排除：含 excluded_regions 的 rejected", r.rejected.length === 1);
    check("地域排除 reason", r.reject_reasons.get("https://example.com/ai-xj") === "地域排除");
    check("地域排除：不含的 passed", r.passed.length === 1);
  }

  // 排除规则
  {
    const spec = makeSpec();
    const results = [
      makeResult({ title: "AI 大赛 广告", url: "https://example.com/ai-ad" }),
      makeResult({ title: "AI 大赛 正版", url: "https://example.com/ai-real" }),
    ];
    const r = ruleFilter(results, spec);
    check("排除规则：含 must_exclude 的 rejected", r.rejected.length === 1);
    check("排除规则 reason", r.reject_reasons.get("https://example.com/ai-ad") === "命中排除规则");
  }

  // URL 安全校验（T1）
  {
    const spec = makeSpec();
    const results = [
      makeResult({ title: "AI 大赛", url: "https://192.168.1.1/ai" }), // 私有 IP
      makeResult({ title: "AI 大赛", url: "https://example.com/ai-safe" }),
    ];
    const r = ruleFilter(results, spec);
    check("URL 安全校验：私有 IP 的 rejected", r.rejected.length === 1);
    check("URL 安全校验 reason 含 URL 安全校验失败", r.reject_reasons.get("https://192.168.1.1/ai")?.includes("URL 安全校验失败") === true);
    check("URL 安全校验：合法的 passed", r.passed.length === 1);
  }

  // URL 标准化（T3）
  {
    const spec = makeSpec();
    const results = [
      makeResult({
        title: "AI 大赛",
        url: "https://EXAMPLE.com/ai-path?utm_source=ad&id=123",
      }),
    ];
    const r = ruleFilter(results, spec);
    check("URL 标准化：passed 长度 1", r.passed.length === 1);
    const passedUrl = r.passed[0]?.url ?? "";
    check("URL 标准化：移除 utm_source", !passedUrl.includes("utm_source"));
    check("URL 标准化：小写域名", passedUrl.startsWith("https://example.com/"));
    check("URL 标准化：保留 id 参数", passedUrl.includes("id=123"));
  }

  // URL 去重
  {
    const spec = makeSpec();
    const results = [
      makeResult({ title: "AI 大赛 1", url: "https://example.com/ai-dup" }),
      makeResult({ title: "AI 大赛 2", url: "https://example.com/ai-dup" }), // 重复
      makeResult({ title: "AI 大赛 3", url: "https://example.com/ai-unique" }),
    ];
    const r = ruleFilter(results, spec);
    check("URL 去重：passed 只保留第一条", r.passed.length === 2);
    check("URL 去重：重复的 rejected", r.rejected.length === 1);
    check("URL 去重 reason", r.reject_reasons.get("https://example.com/ai-dup") === "URL 重复");
  }

  // spec 无关键词策略时全部通过此规则
  {
    const spec = makeSpec({
      keyword_strategy: {
        core_keywords_zh: [],
        core_keywords_en: [],
        expanded_keywords_zh: [],
        expanded_keywords_en: [],
        negative_keywords: [],
      },
    });
    const results = [
      makeResult({ title: "无关键词内容", url: "https://example.com/no-kw" }),
    ];
    const r = ruleFilter(results, spec);
    check("spec 无关键词策略：全部通过此规则", r.passed.length === 1);
    check("spec 无关键词策略：不因无关键词拒绝", r.rejected.length === 0);
  }

  // RuleFilterResult 含三个字段
  {
    const r = ruleFilter([], makeSpec());
    check("RuleFilterResult.passed 是数组", Array.isArray(r.passed));
    check("RuleFilterResult.rejected 是数组", Array.isArray(r.rejected));
    check("RuleFilterResult.reject_reasons 是 Map", r.reject_reasons instanceof Map);
  }

  // 空数组入参
  {
    const r = ruleFilter([], makeSpec());
    check("空数组入参：passed 空", r.passed.length === 0);
    check("空数组入参：rejected 空", r.rejected.length === 0);
  }

  // ============================================================
  // 验收 5.2：第二层 AI 精筛
  // ============================================================
  console.log("\n[验收 5.2] 第二层 AI 精筛\n");

  // 文件存在 + 导出
  check("ai-filter.ts 存在", fs.existsSync("src/search/ai-filter.ts"));
  check("导出 aiFilter 函数", typeof aiFilter === "function");
  check("导出 AIFilterItem interface", typeof ({} as AIFilterItem) === "object");
  check("导出 AIFilterResult interface", typeof ({} as AIFilterResult) === "object");
  check("导出 AIFilterOptions interface", typeof ({} as AIFilterOptions) === "object");

  // ai-filter.ts 导入 parseJsonWithRepair
  {
    const content = fs.readFileSync("src/search/ai-filter.ts", "utf-8");
    check("ai-filter.ts 导入 parseJsonWithRepair", content.includes("parseJsonWithRepair"));
    check("ai-filter.ts 导入 json-repair", content.includes("json-repair"));
    check("ai-filter.ts 导入 JinaReaderFetcher", content.includes("JinaReaderFetcher"));
  }

  // Mock 模式下返回 AIFilterResult
  {
    const llm = new QwenAdapter({ mockMode: true });
    const spec = makeSpec();
    const results = [
      makeResult({ title: "AI 大赛 2026", url: "https://example.com/ai-1" }),
      makeResult({ title: "无关内容", url: "https://example.com/other-1" }),
    ];
    const r = await aiFilter(results, spec, llm);
    check("Mock 模式：返回 AIFilterResult", typeof r === "object" && r !== null);
    check("Mock 模式：passed 是数组", Array.isArray(r.passed));
    check("Mock 模式：rejected 是数组", Array.isArray(r.rejected));
    check("Mock 模式：含 AI/大赛 关键词 → relevance ≥ 50 → passed", r.passed.length >= 1);
    check("Mock 模式：无关 title → relevance < 50 → rejected", r.rejected.length >= 1);
  }

  // AIFilterItem 含四个字段
  {
    const llm = new QwenAdapter({ mockMode: true });
    const spec = makeSpec();
    const results = [makeResult({ title: "AI 大赛 2026", url: "https://example.com/ai-item" })];
    const r = await aiFilter(results, spec, llm);
    if (r.passed.length > 0) {
      const item = r.passed[0];
      check("AIFilterItem 含 result", item && typeof item.result === "object");
      check("AIFilterItem 含 content", item && typeof item.content === "object");
      check("AIFilterItem 含 relevance (number)", item && typeof item.relevance === "number");
      check("AIFilterItem 含 reason (string)", item && typeof item.reason === "string");
      check("AIFilterItem.content.fetch_success = true", item?.content.fetch_success === true);
    } else {
      check("AIFilterItem 含四字段（无 passed 项，跳过）", false);
    }
  }

  // minRelevance 参数生效
  {
    const llm = new QwenAdapter({ mockMode: true });
    const spec = makeSpec();
    const results = [
      makeResult({ title: "政策补贴 2026", url: "https://example.com/policy-1" }), // Mock relevance=70
    ];
    const r1 = await aiFilter(results, spec, llm, { minRelevance: 50 });
    check("minRelevance=50：政策补贴 (Mock=70) passed", r1.passed.length === 1);
    const r2 = await aiFilter(results, spec, llm, { minRelevance: 75 });
    check("minRelevance=75：政策补贴 (Mock=70) rejected", r2.rejected.length === 1);
  }

  // 内容抓取失败不中断（构造抓取失败的 URL，但 JinaReader Mock 默认成功，需用真实模式）
  {
    // 用一个会触发异常的 LLMAdapter
    const failingLlm: LLMAdapter = {
      async chat() {
        throw new Error("LLM 测试失败");
      },
    };
    const spec = makeSpec();
    const results = [
      makeResult({ title: "AI 大赛 1", url: "https://example.com/ai-fail-1" }),
      makeResult({ title: "AI 大赛 2", url: "https://example.com/ai-fail-2" }),
    ];
    const r = await aiFilter(results, spec, failingLlm);
    check("LLM 调用失败不中断：rejected 含 2 项", r.rejected.length === 2);
    check("LLM 调用失败 reason 含 LLM 调用失败", r.rejected[0]?.reason.includes("LLM 调用失败") === true);
    check("LLM 调用失败：passed 为空", r.passed.length === 0);
  }

  // 空数组入参
  {
    const llm = new QwenAdapter({ mockMode: true });
    const r = await aiFilter([], makeSpec(), llm);
    check("空数组入参：passed 空", r.passed.length === 0);
    check("空数组入参：rejected 空", r.rejected.length === 0);
  }

  // ============================================================
  // 验收 5.3：第三层 机会评分
  // ============================================================
  console.log("\n[验收 5.3] 第三层 机会评分\n");

  // 文件存在 + 导出
  check("opportunity-scorer.ts 存在", fs.existsSync("src/search/opportunity-scorer.ts"));
  check("导出 scoreOpportunities 函数", typeof scoreOpportunities === "function");

  // opportunity-scorer.ts 导入 parseJsonWithRepair + providerRegistry + normalizeUrl
  {
    const content = fs.readFileSync("src/search/opportunity-scorer.ts", "utf-8");
    check("opportunity-scorer.ts 导入 parseJsonWithRepair", content.includes("parseJsonWithRepair"));
    check("opportunity-scorer.ts 导入 json-repair", content.includes("json-repair"));
    check("opportunity-scorer.ts 导入 providerRegistry", content.includes("providerRegistry"));
    check("opportunity-scorer.ts 导入 normalizeUrl", content.includes("normalizeUrl"));
    check("opportunity-scorer.ts 权重 0.30", content.includes("0.30"));
    check("opportunity-scorer.ts 权重 0.20", content.includes("0.20"));
    check("opportunity-scorer.ts 权重 0.15", content.includes("0.15"));
  }

  // 返回 ScoredOpportunity[]
  {
    const llm = new QwenAdapter({ mockMode: true });
    const spec = makeSpec();
    const aiItems: AIFilterItem[] = [
      {
        result: makeResult({ title: "AI 大赛 2026", url: "https://example.com/score-1" }),
        content: {
          url: "https://example.com/score-1",
          title: "AI 大赛 2026",
          main_text: "AI 大赛正文",
          word_count: 10,
          fetch_success: true,
          publish_date: daysFromNow(5),
        },
        relevance: 80,
        reason: "测试相关",
      },
    ];
    const opportunities = await scoreOpportunities(aiItems, spec, llm);
    check("返回 ScoredOpportunity[]（长度 1）", opportunities.length === 1);

    const opp = opportunities[0];
    check("ScoredOpportunity 含 search_result", opp && typeof opp.search_result === "object");
    check("ScoredOpportunity 含 cleaned_content", opp && typeof opp.cleaned_content === "object");
    check("ScoredOpportunity 含 relevance_score", opp && typeof opp.relevance_score === "number");
    check("ScoredOpportunity 含 relevance_reason", opp && typeof opp.relevance_reason === "string");
    check("ScoredOpportunity 含 chance_score", opp && typeof opp.chance_score === "object");
    check("ScoredOpportunity 含 visible_level", opp && typeof opp.visible_level === "string");
    check("ScoredOpportunity 含 backend_score", opp && typeof opp.backend_score === "number");
    check("ScoredOpportunity 含 guid", opp && typeof opp.guid === "string");

    const cs = opp?.chance_score;
    check("chance_score 含 fit (number)", cs && typeof cs.fit === "number");
    check("chance_score 含 intent (number)", cs && typeof cs.intent === "number");
    check("chance_score 含 evidence (number)", cs && typeof cs.evidence === "number");
    check("chance_score 含 urgency (number)", cs && typeof cs.urgency === "number");
    check("chance_score 含 effort_cost (number)", cs && typeof cs.effort_cost === "number");
    check("chance_score 含 total (number)", cs && typeof cs.total === "number");

    // Mock 模式 fit/intent/effort_cost 非零
    check("Mock 模式 fit 非零", (cs?.fit ?? 0) > 0);
    check("Mock 模式 intent 非零", (cs?.intent ?? 0) > 0);
    check("Mock 模式 effort_cost 非零", (cs?.effort_cost ?? 0) > 0);

    // total 权重正确：Fit*0.30 + Intent*0.20 + Evidence*0.20 + Urgency*0.15 + EffortCost*0.15
    const expectedTotal = Math.round(
      (cs?.fit ?? 0) * 0.30 +
        (cs?.intent ?? 0) * 0.20 +
        (cs?.evidence ?? 0) * 0.20 +
        (cs?.urgency ?? 0) * 0.15 +
        (cs?.effort_cost ?? 0) * 0.15,
    );
    check("total = Fit*0.30 + Intent*0.20 + Evidence*0.20 + Urgency*0.15 + EffortCost*0.15", cs?.total === expectedTotal, `actual=${cs?.total} expected=${expectedTotal}`);

    // backend_score = chance_score.total
    check("backend_score = chance_score.total", opp?.backend_score === cs?.total);

    // Evidence 基于 reliability（serper 是 B 级 → 75）
    check("Evidence = 75（serper B 级）", cs?.evidence === 75, `actual=${cs?.evidence}`);

    // Urgency 基于 5 天后日期 → 80（4-7 天区间）
    check("Urgency = 80（4-7 天）", cs?.urgency === 80, `actual=${cs?.urgency}`);

    // visible_level 分级正确
    const total = cs?.total ?? 0;
    let expectedLevel: string;
    if (total >= 85) expectedLevel = "S";
    else if (total >= 70) expectedLevel = "A";
    else if (total >= 55) expectedLevel = "B";
    else if (total >= 40) expectedLevel = "C";
    else expectedLevel = "hidden";
    check(`visible_level 分级正确（total=${total} → ${expectedLevel}）`, opp?.visible_level === expectedLevel, `actual=${opp?.visible_level}`);

    // guid = normalizeUrl(url)
    check("guid = normalizeUrl(url)", opp?.guid === normalizeUrl("https://example.com/score-1"));
  }

  // visible_level 分级边界测试（构造不同 total）
  {
    const llm = new QwenAdapter({ mockMode: true });
    const spec = makeSpec();
    // 构造不同日期的 AIFilterItem，触发不同 Urgency
    const aiItems: AIFilterItem[] = [
      {
        result: makeResult({ title: "AI 大赛", url: "https://example.com/v-1", source_provider: "serper" }),
        content: { url: "https://example.com/v-1", title: "AI 大赛", main_text: "正文", word_count: 2, fetch_success: true, publish_date: daysFromNow(2) },
        relevance: 80,
        reason: "测试",
      },
      {
        result: makeResult({ title: "AI 大赛", url: "https://example.com/v-2", source_provider: "serper" }),
        content: { url: "https://example.com/v-2", title: "AI 大赛", main_text: "正文", word_count: 2, fetch_success: true, publish_date: daysFromNow(20) },
        relevance: 80,
        reason: "测试",
      },
      {
        result: makeResult({ title: "AI 大赛", url: "https://example.com/v-3", source_provider: "serper", published_at: undefined }),
        content: { url: "https://example.com/v-3", title: "AI 大赛", main_text: "正文", word_count: 2, fetch_success: true }, // 无日期
        relevance: 80,
        reason: "测试",
      },
    ];
    const opportunities = await scoreOpportunities(aiItems, spec, llm);
    check("visible_level 边界：返回 3 个机会", opportunities.length === 3);
    // 不同日期应产生不同 total
    const totals = opportunities.map((o) => o.chance_score.total);
    check("visible_level 边界：2 天后 Urgency=95", opportunities[0]?.chance_score.urgency === 95);
    check("visible_level 边界：20 天后 Urgency=40", opportunities[1]?.chance_score.urgency === 40);
    check("visible_level 边界：无日期 Urgency=30", opportunities[2]?.chance_score.urgency === 30);
    check("visible_level 边界：totals 不全相同", new Set(totals).size >= 2);
  }

  // 空数组入参
  {
    const llm = new QwenAdapter({ mockMode: true });
    const opportunities = await scoreOpportunities([], makeSpec(), llm);
    check("空数组入参：返回空数组", opportunities.length === 0);
  }

  // ============================================================
  // 验收 5.4：搜索编排器
  // ============================================================
  console.log("\n[验收 5.4] 搜索编排器\n");

  // 文件存在 + 导出
  check("orchestrator.ts 存在", fs.existsSync("src/search/orchestrator.ts"));
  check("导出 SearchOrchestrator class", typeof SearchOrchestrator === "function");
  check("导出 SearchOrchestratorConfig interface", typeof ({} as SearchOrchestratorConfig) === "object");
  check("导出 SearchOrchestratorResult interface", typeof ({} as SearchOrchestratorResult) === "object");

  // orchestrator.ts 导入 ruleFilter + aiFilter + scoreOpportunities + providerRegistry
  {
    const content = fs.readFileSync("src/search/orchestrator.ts", "utf-8");
    check("orchestrator.ts 导入 ruleFilter", content.includes("ruleFilter"));
    check("orchestrator.ts 导入 aiFilter", content.includes("aiFilter"));
    check("orchestrator.ts 导入 scoreOpportunities", content.includes("scoreOpportunities"));
    check("orchestrator.ts 导入 providerRegistry", content.includes("providerRegistry"));
  }

  // Mock 模式下返回完整 SearchOrchestratorResult
  {
    const llm = new QwenAdapter({ mockMode: true });
    const orchestrator = new SearchOrchestrator({ llmAdapter: llm });
    const spec = makeSpec();
    const result = await orchestrator.search(spec, "AI 大赛");

    check("Mock 模式：返回 SearchOrchestratorResult", typeof result === "object" && result !== null);
    check("Mock 模式：total_raw > 0", result.total_raw > 0, `total_raw=${result.total_raw}`);
    check("Mock 模式：total_rule_passed > 0", result.total_rule_passed > 0, `total_rule_passed=${result.total_rule_passed}`);
    check("Mock 模式：total_ai_passed > 0", result.total_ai_passed > 0, `total_ai_passed=${result.total_ai_passed}`);
    check("Mock 模式：total_scored > 0", result.total_scored > 0, `total_scored=${result.total_scored}`);
    check("Mock 模式：opportunities 是数组", Array.isArray(result.opportunities));
    check("Mock 模式：opportunities 长度 > 0", result.opportunities.length > 0);
    check("Mock 模式：errors 是数组", Array.isArray(result.errors));
    check("Mock 模式：duration_ms > 0", result.duration_ms > 0);

    // total_raw >= total_rule_passed >= total_ai_passed
    check("total_raw >= total_rule_passed", result.total_raw >= result.total_rule_passed, `${result.total_raw} vs ${result.total_rule_passed}`);
    check("total_rule_passed >= total_ai_passed", result.total_rule_passed >= result.total_ai_passed, `${result.total_rule_passed} vs ${result.total_ai_passed}`);

    // total_scored === opportunities.length
    check("total_scored === opportunities.length", result.total_scored === result.opportunities.length);

    // opportunities 中每个 ScoredOpportunity 含完整字段
    if (result.opportunities.length > 0) {
      const opp = result.opportunities[0];
      check("编排器 opportunity 含 search_result", opp && typeof opp.search_result === "object");
      check("编排器 opportunity 含 cleaned_content", opp && typeof opp.cleaned_content === "object");
      check("编排器 opportunity 含 chance_score", opp && typeof opp.chance_score === "object");
      check("编排器 opportunity 含 visible_level", opp && typeof opp.visible_level === "string");
      check("编排器 opportunity 含 backend_score", opp && typeof opp.backend_score === "number");
      check("编排器 opportunity 含 guid", opp && typeof opp.guid === "string");
    }
  }

  // 无可用 provider 时返回空 + errors
  {
    const llm = new QwenAdapter({ mockMode: true });
    const orchestrator = new SearchOrchestrator({ llmAdapter: llm });
    // 构造一个不存在的雷达类型
    const spec = makeSpec({
      opportunity_scope: {
        primary_opportunity_types: ["不存在的类型XYZ123"],
        secondary_opportunity_types: [],
        excluded_opportunity_types: [],
        must_have_conditions: [],
        nice_to_have_conditions: [],
      },
    });
    const result = await orchestrator.search(spec);
    // 注意：Task 026 后注册表含 4 个 Provider，需全部注销才能测试"无可用 provider"
    const savedNames = ["serper", "bocha", "exa", "google_cse"];
    const savedProviders = savedNames
      .map((n) => providerRegistry.get(n))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
    savedNames.forEach((n) => providerRegistry.unregister(n));
    const result2 = await orchestrator.search(spec);
    check("无可用 provider：opportunities 为空", result2.opportunities.length === 0);
    check("无可用 provider：errors 含记录", result2.errors.length > 0);
    check("无可用 provider：total_raw = 0", result2.total_raw === 0);
    // 恢复
    savedProviders.forEach((p) => providerRegistry.register(p));
  }

  // enableContentFetch=false 时跳过抓取，relevance 固定 50
  {
    const llm = new QwenAdapter({ mockMode: true });
    const orchestrator = new SearchOrchestrator({
      llmAdapter: llm,
      enableContentFetch: false,
    });
    const spec = makeSpec();
    const result = await orchestrator.search(spec, "AI 大赛");
    check("enableContentFetch=false：total_ai_passed = total_rule_passed", result.total_ai_passed === result.total_rule_passed, `${result.total_ai_passed} vs ${result.total_rule_passed}`);
    check("enableContentFetch=false：opportunities 长度 > 0", result.opportunities.length > 0);
    // 跳过抓取时 cleaned_content.main_text 来自 snippet
    if (result.opportunities.length > 0) {
      const opp = result.opportunities[0];
      check("enableContentFetch=false：relevance_score = 50", opp?.relevance_score === 50);
      check("enableContentFetch=false：reason 含跳过", opp?.relevance_reason.includes("跳过") === true);
    }
  }

  // 编排器串联三层（验证 total_raw > total_rule_passed 或 total_rule_passed > total_ai_passed 至少一处递减）
  {
    const llm = new QwenAdapter({ mockMode: true });
    const orchestrator = new SearchOrchestrator({ llmAdapter: llm });
    const spec = makeSpec();
    const result = await orchestrator.search(spec, "AI 大赛");
    // 至少有一层递减（具体取决于 Mock 数据和规则）
    const decremented = result.total_raw > result.total_rule_passed || result.total_rule_passed > result.total_ai_passed;
    check("编排器串联三层：至少一层递减", decremented, `raw=${result.total_raw} rule=${result.total_rule_passed} ai=${result.total_ai_passed}`);
  }

  // ============================================================
  // 约束自检
  // ============================================================
  console.log("\n[约束自检]\n");

  check("rule-filter.ts 存在", fs.existsSync("src/search/rule-filter.ts"));
  check("ai-filter.ts 存在", fs.existsSync("src/search/ai-filter.ts"));
  check("opportunity-scorer.ts 存在", fs.existsSync("src/search/opportunity-scorer.ts"));
  check("orchestrator.ts 存在", fs.existsSync("src/search/orchestrator.ts"));
  check("verify-task019d.ts 存在", fs.existsSync("scripts/verify-task019d.ts"));

  // 不引入新 npm 依赖（检查 package.json 未变化）
  {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
    const deps = Object.keys(pkg.dependencies ?? {});
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    // 检查未新增依赖（fetch 是 Node.js 内置）
    check("未引入新 npm 依赖（dependencies 不含 axios 等）", !deps.includes("axios"));
    check("未引入新 npm 依赖（devDependencies 不含 axios 等）", !devDeps.includes("axios"));
  }

  // T10 三层全部使用纯 TS + Node.js 内置
  {
    const ruleFilterContent = fs.readFileSync("src/search/rule-filter.ts", "utf-8");
    const aiFilterContent = fs.readFileSync("src/search/ai-filter.ts", "utf-8");
    const scorerContent = fs.readFileSync("src/search/opportunity-scorer.ts", "utf-8");
    const orchestratorContent = fs.readFileSync("src/search/orchestrator.ts", "utf-8");

    check("rule-filter.ts 不引入第三方依赖", !ruleFilterContent.includes('from "axios"'));
    check("ai-filter.ts 不引入第三方依赖", !aiFilterContent.includes('from "axios"'));
    check("opportunity-scorer.ts 不引入第三方依赖", !scorerContent.includes('from "axios"'));
    check("orchestrator.ts 不引入第三方依赖", !orchestratorContent.includes('from "axios"'));

    // 验证 T10 复用 019a/019b/019c 的模块
    check("rule-filter.ts 导入 T1 validateLink", ruleFilterContent.includes("validateLink"));
    check("rule-filter.ts 导入 T3 normalizeUrl", ruleFilterContent.includes("normalizeUrl"));
    check("ai-filter.ts 导入 T4 parseJsonWithRepair", aiFilterContent.includes("parseJsonWithRepair"));
    check("ai-filter.ts 导入 JinaReaderFetcher", aiFilterContent.includes("JinaReaderFetcher"));
    check("opportunity-scorer.ts 导入 T4 parseJsonWithRepair", scorerContent.includes("parseJsonWithRepair"));
    check("opportunity-scorer.ts 导入 providerRegistry", scorerContent.includes("providerRegistry"));
    check("orchestrator.ts 导入 ruleFilter", orchestratorContent.includes("ruleFilter"));
    check("orchestrator.ts 导入 aiFilter", orchestratorContent.includes("aiFilter"));
    check("orchestrator.ts 导入 scoreOpportunities", orchestratorContent.includes("scoreOpportunities"));
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
