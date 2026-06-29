/**
 * 端到端雷达扫描测试（真实 LLM + Mock 搜索）
 *
 * 运行：npx tsx scripts/verify-e2e-radar.ts
 *
 * 完整链路：
 *   阶段1 需求理解（真实 LLM 跑 ConversationManager 一轮对话）
 *   阶段2 Spec 编译（高确认度 Mock 数据快速编译，绕过多轮对话）
 *   阶段3 搜索+三层筛选（真实 LLM 精筛+评分 + Serper Mock 搜索）
 *   阶段4 卡片创建 + 报告生成
 *
 * 前置条件：.env 已配置 LLM API Key（商业版或参赛版）
 */

import fs from "fs";
import path from "path";

// ============================================================
// 1. 手动加载 .env
// ============================================================
function loadEnvFile(): void {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error("[FATAL] .env 文件不存在");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
}
loadEnvFile();

// ============================================================
// 2. 导入被测模块
// ============================================================
import { ConversationManager } from "../src/agents/conversation-manager";
import { ModelRouter } from "../src/agents/model-router";
import { getStrategyFromEnv } from "../src/config/llm-strategy";
import { compileSpec } from "../src/agents/spec-compiler";
import { calculateConfidence } from "../src/agents/confidence-engine";
import { SearchOrchestrator } from "../src/search/orchestrator";
import { createOpportunityCards, type CreateCardInput } from "../src/agents/card-factory";
import { generateRadarReport } from "../src/agents/radar-report-generator";
import type { ScoredOpportunity } from "../src/search/types";
import type { ExtractedRequirementInfo } from "../src/schema/extracted-requirement-info";
import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";
import type { OpportunityCard } from "../src/schema/opportunity-card";

// ============================================================
// 3. 测试框架
// ============================================================
let passed = 0;
let failed = 0;
const errors: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS  ${name}`);
  } else {
    failed++;
    errors.push(`${name}: ${detail}`);
    console.log(`  ❌ FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`════════════════════════════════════════════`);
  console.log(`  ${title}`);
  console.log(`════════════════════════════════════════════`);
}

// ============================================================
// 4. 高确认度 Mock 数据（复用集成测试的 buildHighConfidenceInfo）
// ============================================================
function buildHighConfidenceInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {
      client_type: "公司",
      industry: "人工智能",
      business_type: "AI 应用开发",
      core_capabilities: ["大模型应用", "AI Agent 开发", "RAG 系统"],
      products_or_projects: ["智能助手产品", "AI 客服系统"],
      company_stage: "成长期",
      regions: ["上海"],
      notes: "聚焦企业服务",
    },
    business_goal: {
      primary_goal: "通过参与 AI 赛事获取品牌曝光和融资机会",
      secondary_goals: ["寻找合作伙伴", "验证产品技术能力"],
      success_definition: "进入决赛或获得投资机构关注",
      priority_order: ["品牌曝光", "融资对接", "技术验证"],
    },
    opportunity_type: {
      primary_types: ["AI 创新大赛", "AI 黑客松"],
      secondary_types: ["AI 应用征集"],
      excluded_types: ["学术论文会议"],
      must_have_conditions: ["有奖金", "允许企业参赛"],
    },
    region_scope: {
      primary_regions: ["上海", "全国"],
      secondary_regions: ["杭州", "苏州"],
      excluded_regions: ["海外"],
      overseas_allowed: false,
      global_allowed: false,
    },
    exclusion_rules: {
      must_exclude: ["纯学术会议", "无奖金赛事", "海外赛事", "需现场参赛且无差旅支持"],
      low_priority_signals: ["报名费过高", "周期过长"],
      count: 4,
    },
    action_scenario: {
      action_intent: "报名比赛",
      priority_order: ["品牌曝光赛事", "融资对接赛事", "技术验证赛事"],
    },
    report_format: {
      frequency: "weekly",
      format: "markdown",
      must_include_sections: ["本周一句话判断", "本周 S 级机会", "即将截止机会"],
    },
  };
}

// ============================================================
// 5. 主测试流程
// ============================================================
(async () => {
  const strategy = getStrategyFromEnv();
  console.log(`策略: ${strategy.profile}`);
  console.log(`LLM_STRATEGY=${process.env.LLM_STRATEGY ?? "commercial(默认)"}`);

  // ============================================================
  // 阶段 1：需求理解（真实 LLM 跑一轮 ConversationManager 对话）
  // ============================================================
  section("阶段 1：需求理解（真实 LLM）");

  const router = new ModelRouter(strategy);
  const manager = new ConversationManager(router, "ai_competition");

  console.log(`  用户输入: "我是上海一家做 AI 应用的公司，想参加 AI 比赛获取品牌曝光"`);
  const turnStart = Date.now();
  let turn1;
  try {
    turn1 = await manager.processUserInput(
      "我是上海一家做 AI 应用的公司，想参加 AI 比赛获取品牌曝光和融资机会"
    );
    check("ConversationManager 真实 LLM 调用成功", true, `耗时 ${Date.now() - turnStart}ms`);
    check("返回 summary 非空", turn1.summary.length > 0, `summary="${turn1.summary.substring(0, 60)}..."`);
    check("返回 confidence 对象", turn1.confidence !== undefined, `total=${turn1.confidence.total}`);
    check("返回 confirmed_items 数组", Array.isArray(turn1.confirmed_items), `数量=${turn1.confirmed_items.length}`);
    check("返回 questions 数组", Array.isArray(turn1.questions), `数量=${turn1.questions.length}`);
    console.log(`  ℹ️  确认度: ${turn1.confidence.total}%`);
    console.log(`  ℹ️  状态: ${turn1.status}`);
    console.log(`  ℹ️  AI 回复: "${turn1.summary.substring(0, 100)}..."`);
  } catch (e) {
    check("ConversationManager 真实 LLM 调用成功", false, e instanceof Error ? e.message : String(e));
    console.log(`  ⚠️  真实 LLM 调用失败，后续使用 Mock 高确认度数据继续测试`);
  }

  // ============================================================
  // 阶段 2：Spec 编译（用高确认度数据快速编译）
  // ============================================================
  section("阶段 2：Spec 编译");

  const info = buildHighConfidenceInfo();
  const confidence = calculateConfidence(info);
  console.log(`  确认度: ${confidence.total}%`);

  const specResult = compileSpec({
    extracted_info: info,
    confidence,
    confirmation_status: "ready_for_radar_plan",
    radar_type: "ai_competition",
    confirmed_at: new Date().toISOString(),
  });

  check("Spec 编译成功", specResult.success, specResult.error ?? "");
  if (!specResult.success || !specResult.spec) {
    console.log(`  ❌ Spec 编译失败，无法继续后续阶段`);
    process.exit(1);
  }

  const spec = specResult.spec as RadarRequirementSpec;
  check("Spec 确认度 >= 95", spec.requirement_confidence.total >= 95, `actual=${spec.requirement_confidence.total}`);
  check("Spec 机会类型含 AI 创新大赛", spec.opportunity_scope.primary_opportunity_types.includes("AI 创新大赛"));
  console.log(`  ℹ️  Spec 目标用户: ${spec.client_profile.client_type}/${spec.client_profile.industry}`);
  console.log(`  ℹ️  Spec 机会类型: ${spec.opportunity_scope.primary_opportunity_types.join(", ")}`);

  // ============================================================
  // 阶段 3：搜索 + 三层筛选（真实 LLM + Mock 搜索）
  // ============================================================
  section("阶段 3：搜索 + 三层筛选（真实 LLM 精筛+评分）");

  console.log(`  搜索层: Serper Mock 模式（无 SERPER_API_KEY）`);
  console.log(`  LLM 层: 真实 ${strategy.profile} 策略`);

  const orchestrator = new SearchOrchestrator({
    llmAdapter: router,
    maxResultsPerProvider: 5,
    minRelevance: 30, // 降低阈值，确保有结果通过
    enableContentFetch: true,
  });

  const searchStart = Date.now();
  let searchResult;
  try {
    searchResult = await orchestrator.search(spec);
    check("SearchOrchestrator.search() 成功", true, `耗时 ${Date.now() - searchStart}ms`);
  } catch (e) {
    check("SearchOrchestrator.search() 成功", false, e instanceof Error ? e.message : String(e));
    console.log(`  ❌ 搜索编排器失败，无法继续`);
    process.exit(1);
  }

  check("原始搜索结果 > 0", searchResult.total_raw > 0, `total_raw=${searchResult.total_raw}`);
  check("规则粗筛通过 > 0", searchResult.total_rule_passed > 0, `total_rule_passed=${searchResult.total_rule_passed}`);
  console.log(`  ℹ️  原始结果: ${searchResult.total_raw}`);
  console.log(`  ℹ️  规则粗筛通过: ${searchResult.total_rule_passed}`);
  console.log(`  ℹ️  AI 精筛通过: ${searchResult.total_ai_passed}`);
  console.log(`  ℹ️  评分完成: ${searchResult.total_scored}`);
  console.log(`  ℹ️  错误数: ${searchResult.errors.length}`);
  if (searchResult.errors.length > 0) {
    searchResult.errors.forEach((e, i) => console.log(`    [${i}] ${e.substring(0, 80)}`));
  }

  if (searchResult.opportunities.length > 0) {
    check("最终机会数 > 0", true, `count=${searchResult.opportunities.length}`);
    console.log(`  ℹ️  机会列表:`);
    searchResult.opportunities.forEach((opp, i) => {
      const sr = opp.search_result;
      console.log(`    [${i}] ${opp.visible_level} (${opp.backend_score}) ${sr.title.substring(0, 50)}`);
      console.log(`        URL: ${sr.url.substring(0, 60)}`);
      console.log(`        相关度: ${opp.relevance_score}, 理由: ${opp.relevance_reason.substring(0, 60)}`);
    });
  } else {
    check("最终机会数 > 0", false, "无机会通过筛选");
    console.log(`  ⚠️  无机会通过三层筛选，后续报告将生成空报告`);
  }

  // ============================================================
  // 阶段 4：卡片创建 + 报告生成
  // ============================================================
  section("阶段 4：卡片创建 + 报告生成");

  // ScoredOpportunity → CreateCardInput 映射（跳过 hidden 级别，卡片不展示 hidden）
  const cardInputs: CreateCardInput[] = searchResult.opportunities
    .filter((opp: ScoredOpportunity) => opp.visible_level !== "hidden")
    .map((opp: ScoredOpportunity) => {
    const sr = opp.search_result;
    const cc = opp.cleaned_content;
    return {
      title: sr.title,
      type: spec.opportunity_scope.primary_opportunity_types[0] ?? "AI 赛事",
      organizer: "未知主办方", // Mock 搜索结果无主办方字段，用默认值
      official_source_url: sr.url,
      deadline: "2026-07-15", // 设为未来日期，避免被 isExpired 排除（Mock 搜索无 deadline 字段）
      region: spec.region_scope.primary_regions[0] ?? "全国",
      reward_or_value: "详见官方链接",
      eligibility: "详见官方链接",
      match_reason: opp.relevance_reason,
      next_action: "访问官方链接了解详情并报名",
      application_url: sr.url,
      backend_score: opp.backend_score,
      visible_level: opp.visible_level as "S" | "A" | "B" | "C",
      source: "search" as const,
    };
  });

  let cards: OpportunityCard[] = [];
  try {
    cards = createOpportunityCards(cardInputs);
    check("卡片创建成功", true, `数量=${cards.length}`);
  } catch (e) {
    check("卡片创建成功", false, e instanceof Error ? e.message : String(e));
  }

  if (cards.length > 0) {
    console.log(`  ℹ️  卡片列表:`);
    cards.forEach((card, i) => {
      console.log(`    [${i}] ${card.visible_level}级 ${card.title.substring(0, 40)} | 分数=${card.backend_score}`);
    });
  }

  // 报告生成
  const periodStart = "2026-06-28";
  const periodEnd = "2026-07-04";
  const reportResult = generateRadarReport({
    spec,
    opportunities: cards,
    radar_type: "ai_competition",
    period_start: periodStart,
    period_end: periodEnd,
    generated_at: new Date().toISOString(),
  });

  check("报告生成成功", reportResult.success, reportResult.error ?? "");
  if (reportResult.success) {
    check("报告 markdown 非空", (reportResult.markdown ?? "").length > 0, `长度=${reportResult.markdown?.length ?? 0}`);
    check("报告章节 = 9", reportResult.sections_count === 9, `actual=${reportResult.sections_count}`);
    console.log(`  ℹ️  报告统计:`);
    console.log(`       总机会: ${reportResult.stats.total_opportunities}`);
    console.log(`       S级: ${reportResult.stats.s_count} | A级: ${reportResult.stats.a_count} | B级: ${reportResult.stats.b_count} | C级: ${reportResult.stats.c_count}`);
    console.log(`       即将截止: ${reportResult.stats.expiring_soon_count}`);
    console.log(`       不建议: ${reportResult.stats.hidden_count}`);
    console.log(`  ℹ️  报告预览（前 500 字符）:`);
    console.log(`       ${(reportResult.markdown ?? "").substring(0, 500)}`);

    // 保存报告到文件
    const reportDir = path.join(process.cwd(), "reports", "e2e-test");
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    const reportPath = path.join(reportDir, `e2e-radar-${Date.now()}.md`);
    fs.writeFileSync(reportPath, reportResult.markdown ?? "", "utf-8");
    console.log(`  ℹ️  报告已保存: ${reportPath}`);
  }

  // ============================================================
  // 汇总
  // ============================================================
  section("汇总");

  const total = passed + failed;
  console.log(`  总计: ${total} 项`);
  console.log(`  通过: ${passed} 项`);
  console.log(`  失败: ${failed} 项`);

  console.log("");
  if (failed === 0) {
    console.log("🎉 端到端雷达扫描测试全部通过！");
    console.log("");
    console.log("完整链路验证：");
    console.log("  ✅ 阶段1 需求理解：真实 LLM 调用 ConversationManager 成功");
    console.log("  ✅ 阶段2 Spec 编译：高确认度数据编译成功，确认度 >= 95");
    console.log("  ✅ 阶段3 搜索+三层筛选：Mock 搜索 + 真实 LLM 精筛+评分成功");
    console.log("  ✅ 阶段4 卡片+报告：ScoredOpportunity → OpportunityCard → 9章节报告成功");
  } else {
    console.log(`⚠️ 有 ${failed} 项失败：`);
    errors.forEach((e) => console.log(`  - ${e}`));
  }

  console.log("");
  console.log(`LLM 策略: ${strategy.profile}`);
  console.log(`搜索模式: Mock（Serper 预设结果）`);
})().then(() => {
  process.exit(failed === 0 ? 0 : 1);
}).catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
