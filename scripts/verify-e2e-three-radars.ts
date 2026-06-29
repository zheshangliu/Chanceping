/**
 * Task 042 三雷达 Mock 闭环 E2E 验证脚本
 *
 * 对三类雷达各执行一次完整闭环：
 *   ai_competition → POST /api/chat → POST /api/search → POST /api/opportunities → POST /api/reports/generate
 *   opc_policy     → 同上
 *   cultural_heritage → 同上
 *
 * 关键验证点：
 *   - 三类雷达搜索结果互不混淆（OPC 不含"AI 比赛"，文创不含"AI 比赛"）
 *   - 每类雷达至少返回 1 条机会
 *
 * 运行：npm run verify:e2e-three-radars
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.PORT = "3995";
process.env.STORE_TYPE = "meili";
process.env.MEILI_MOCK = "true";

// ============================================================
// 1. import
// ============================================================

import { serve } from "@hono/node-server";
import { createApp } from "../src/api/app";

// ============================================================
// 2. 测试框架
// ============================================================

const BASE = "http://localhost:3995";
const TOTAL_STEPS = 15; // 3 雷达 × 5 步
let passCount = 0;
let failCount = 0;
const failures: Array<{ step: string; name: string; reason: string }> = [];

function logStep(step: string, name: string, passed: boolean, reason?: string): void {
  if (passed) {
    console.log(`  [步骤 ${step}] ${name} ✓`);
    passCount++;
  } else {
    console.log(`  [步骤 ${step}] ${name} ✗`);
    console.log(`    原因: ${reason ?? "未知"}`);
    failCount++;
    failures.push({ step, name, reason: reason ?? "未知" });
  }
}

async function apiPost(apiPath: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// ============================================================
// 3. 三雷达测试
// ============================================================

interface RadarTestConfig {
  name: string;
  radarType: string;
  chatMessage: string;
  // 触发雷达类型推断的 primary_opportunity_types
  primaryOpportunityTypes: string[];
  // 搜索结果不应包含的关键词（验证数据不混淆）
  forbiddenKeywords: string[];
  // 搜索结果应包含的关键词（验证数据类型正确）
  expectedKeywords: string[];
}

const RADAR_TESTS: RadarTestConfig[] = [
  {
    name: "AI 赛事",
    radarType: "ai_competition",
    chatMessage: "我想找 AI 比赛机会",
    primaryOpportunityTypes: ["AI 比赛"],
    forbiddenKeywords: ["政策", "补贴", "非遗", "文创"],
    expectedKeywords: ["AI", "大赛", "比赛"],
  },
  {
    name: "OPC 政策",
    radarType: "opc_policy",
    chatMessage: "我想找政策申报机会",
    primaryOpportunityTypes: ["政策补贴"],
    forbiddenKeywords: ["AI 比赛", "黑客松", "非遗", "传承人"],
    expectedKeywords: ["政策", "补贴", "申报", "认定"],
  },
  {
    name: "文创非遗",
    radarType: "cultural_heritage",
    chatMessage: "我想找文创非遗项目机会",
    primaryOpportunityTypes: ["文创非遗"],
    forbiddenKeywords: ["AI 比赛", "黑客松", "高企", "专精特新"],
    expectedKeywords: ["非遗", "文创", "文化", "传承"],
  },
];

async function testRadar(config: RadarTestConfig, stepPrefix: string): Promise<void> {
  console.log(`\n--- ${config.name}（${config.radarType}）---`);

  // 步骤 1：POST /api/chat
  const chatRes = await apiPost("/api/chat", {
    message: config.chatMessage,
    radar_type: config.radarType,
  });
  const chatData = chatRes.data as { success?: boolean; data?: { conversation_id?: string }; error?: { message?: string } };
  logStep(`${stepPrefix}.1`, `${config.name} POST /api/chat 返回 200`, chatRes.status === 200, `status=${chatRes.status}`);
  logStep(`${stepPrefix}.2`, `${config.name} chat success=true`, chatData.success === true, chatData.error?.message ?? "");

  // 步骤 2：POST /api/search
  // Task 042: 通过 spec.opportunity_scope.primary_opportunity_types 推断雷达类型
  // ScoredOpportunity 的标题在 search_result.title
  const searchRes = await apiPost("/api/search", {
    enable_content_fetch: false,
    spec: {
      opportunity_scope: { primary_opportunity_types: config.primaryOpportunityTypes },
      keyword_strategy: { core_keywords_zh: [], core_keywords_en: [] },
      filter_rules: { must_exclude: [] },
      region_scope: { excluded_regions: [] },
    },
  });
  const searchData = searchRes.data as { success?: boolean; data?: { opportunities?: Array<{ search_result?: { title?: string; url?: string } }> }; error?: { message?: string } };
  logStep(`${stepPrefix}.3`, `${config.name} POST /api/search 返回 200`, searchRes.status === 200, `status=${searchRes.status}`);
  logStep(`${stepPrefix}.4`, `${config.name} search success=true`, searchData.success === true, searchData.error?.message ?? "");

  const opportunities = searchData.data?.opportunities ?? [];
  logStep(`${stepPrefix}.5`, `${config.name} 搜索结果 ≥1 条`, opportunities.length >= 1, `count=${opportunities.length}`);

  // 步骤 3：验证数据不混淆（搜索结果 title 不应包含禁用关键词）
  if (opportunities.length > 0) {
    const titles = opportunities.map((o) => o.search_result?.title || "");
    const allTitles = titles.join(" | ");

    // 验证不含禁用关键词
    const hasForbidden = config.forbiddenKeywords.some((kw) => allTitles.includes(kw));
    logStep(`${stepPrefix}.6`, `${config.name} 数据不混淆（不含 ${config.forbiddenKeywords.join("/")}）`, !hasForbidden, `titles=${allTitles.slice(0, 100)}`);

    // 验证含期望关键词（至少一条 title 含）
    const hasExpected = titles.some((t) => config.expectedKeywords.some((kw) => t.includes(kw)));
    logStep(`${stepPrefix}.7`, `${config.name} 数据类型正确（含 ${config.expectedKeywords.join("/")}）`, hasExpected, `titles=${allTitles.slice(0, 100)}`);

    // 步骤 4：POST /api/opportunities 入库（取第一条）
    const firstOpp = opportunities[0];
    const firstTitle = firstOpp?.search_result?.title || `${config.name}测试机会`;
    const firstUrl = firstOpp?.search_result?.url || "https://example.com/test";
    const card = {
      title: firstTitle,
      type: config.radarType,
      organizer: "测试主办方",
      region: "全国",
      deadline: "2026-12-31",
      reward_or_value: "测试奖励",
      eligibility: "测试资格",
      materials_required: "测试材料",
      match_reason: "测试匹配",
      next_action: "立即报名",
      official_source_url: firstUrl,
      application_url: "",
      contact_info: "",
      risk_note: "",
      backend_score: 80,
      visible_level: "A",
      status: "new",
    };
    const addRes = await apiPost("/api/opportunities", {
      card,
      radar_type: config.radarType,
    });
    const addData = addRes.data as { success?: boolean; data?: { dedup_key?: string }; error?: { message?: string } };
    logStep(`${stepPrefix}.8`, `${config.name} POST /api/opportunities 入库`, addRes.status === 200 && addData.success === true, addData.error?.message ?? "");

    // 步骤 5：POST /api/reports/generate
    const reportRes = await apiPost("/api/reports/generate", {
      radar_type: config.radarType,
      period_from: "2026-01-01",
      period_to: "2026-12-31",
    });
    const reportData = reportRes.data as { success?: boolean; data?: { markdown?: string }; error?: { message?: string } };
    logStep(`${stepPrefix}.9`, `${config.name} POST /api/reports/generate`, reportRes.status === 200 && reportData.success === true, reportData.error?.message ?? "");
  } else {
    logStep(`${stepPrefix}.6`, `${config.name} 数据不混淆`, false, "无搜索结果，无法验证");
    logStep(`${stepPrefix}.7`, `${config.name} 数据类型正确`, false, "无搜索结果，无法验证");
    logStep(`${stepPrefix}.8`, `${config.name} POST /api/opportunities 入库`, false, "无搜索结果");
    logStep(`${stepPrefix}.9`, `${config.name} POST /api/reports/generate`, false, "无搜索结果");
  }
}

// ============================================================
// 4. 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 042 三雷达 Mock 闭环 E2E ===\n");

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: 3995 });

  try {
    for (let i = 0; i < RADAR_TESTS.length; i++) {
      await testRadar(RADAR_TESTS[i], `${i + 1}`);
    }

    console.log("");
    console.log("========================================");
    console.log(`总计: ${passCount} PASS / ${failCount} FAIL`);
    console.log("========================================");
    if (failures.length > 0) {
      console.log("\n失败项：");
      failures.forEach((f) => {
        console.log(`  [${f.step}] ${f.name}: ${f.reason}`);
      });
    }
  } finally {
    server.close();
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("执行失败：", err);
  process.exit(1);
});
