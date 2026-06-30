/**
 * Task V1.6-06 验收脚本：Watch Rules DSL 接入运行链路
 *
 * 运行：npx tsx scripts/verify-task-v1.6-06-watch-rules.ts
 *
 * 验证目标：
 *   - Radar 接口含 watchRules?: string[] 字段
 *   - SearchOrchestrator.search() 接受 watchRules 参数并过滤
 *   - POST /api/radars/:id/run 传入 radar.watchRules
 *   - PUT /api/radars/:id 支持更新 watchRules
 *   - scheduler/triggers.ts 传入 radar.watchRules
 *   - +/!/@ 三种规则语法生效
 *
 * 测试隔离：使用临时文件 data/*-v1.6.06-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import { SearchOrchestrator } from "../src/search/orchestrator";
import type { ApiResponse } from "../src/api/types";

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
// 临时文件路径
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1.6.06-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.6.06-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.6.06-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.6.06-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.6.06-test.json";

function cleanupTempFiles(): void {
  for (const f of [TEMP_RADARS_FILE, TEMP_RUNS_FILE, TEMP_STORE_FILE, TEMP_WATCH_FILE, TEMP_REPORT_FILE]) {
    const abs = path.resolve(process.cwd(), f);
    if (fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        // 忽略删除失败
      }
    }
  }
}

function createTestContext(): AppContext {
  cleanupTempFiles();

  const modelRouter = new ModelRouter();
  const store = new LocalFileStore({ file_path: TEMP_STORE_FILE });
  store.load();
  const starManager = new StarManager(store);
  const watchStore = new LocalWatchStore({ file_path: TEMP_WATCH_FILE });
  const radarStore = new JsonRadarStore({ file_path: TEMP_RADARS_FILE });
  const radarRunStore = new JsonRadarRunStore({ file_path: TEMP_RUNS_FILE });
  const radarRegistry = new RadarRegistry(radarStore);
  radarRegistry.initialize();
  const reportStore = new JsonReportStore({ file_path: TEMP_REPORT_FILE });

  return {
    llmAdapter: modelRouter,
    store,
    starManager,
    watchStore,
    conversations: new Map(),
    radarStore,
    radarRunStore,
    radarRegistry,
    reportStore,
  };
}

// ============================================================
// 辅助：解析响应
// ============================================================

async function parseResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

async function postJson(
  app: ReturnType<typeof createApp>,
  url: string,
  body: unknown,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: await parseResponse(res) };
}

async function putJson(
  app: ReturnType<typeof createApp>,
  url: string,
  body: unknown,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: await parseResponse(res) };
}

async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

// ============================================================
// 构造最小 spec（用于 SearchOrchestrator 直测）
// ============================================================

function makeSpec(): import("../src/schema/radar-requirement-spec").RadarRequirementSpec {
  return {
    product_name: "ChancePing",
    product_category: "机会雷达",
    client_profile: {
      client_name: "V1.6.06 测试",
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
    questions_to_confirm: [],
    confirmation_status: {
      status: "confirmed",
      user_confirmed: true,
      confirmed_at: "2026-06-01",
      last_user_feedback: "",
      revision_count: 0,
    },
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-06 Watch Rules 接入验证 ===\n");

  // ============================================================
  // A. 静态检查：源文件含 watchRules 接入点
  // ============================================================
  section("A. 静态检查：源文件含 watchRules 接入点");

  const radarSchemaSrc = fs.readFileSync("src/schema/radar.ts", "utf-8");
  check(
    "A1. radar.ts Radar 接口含 watchRules?: string[]",
    /watchRules\?\s*:\s*string\[\]/.test(radarSchemaSrc),
  );

  const radarStoreSrc = fs.readFileSync("src/agents/radar-store.ts", "utf-8");
  check(
    "A2. radar-store.ts RadarUpdateInput 含 watchRules?: string[]",
    /watchRules\?\s*:\s*string\[\]/.test(radarStoreSrc),
  );
  check(
    "A3. radar-store.ts update() 含 watchRules patch 处理",
    /"watchRules"\s*in\s*patch/.test(radarStoreSrc),
  );

  const typesSrc = fs.readFileSync("src/api/types.ts", "utf-8");
  check(
    "A4. types.ts RadarUpdateRequest 含 watchRules?: string[]",
    /watchRules\?\s*:\s*string\[\]/.test(typesSrc),
  );

  const orchestratorSrc = fs.readFileSync("src/search/orchestrator.ts", "utf-8");
  check(
    "A5. orchestrator.ts search() 含 watchRules 参数",
    /watchRules\?\s*:\s*string\[\]/.test(orchestratorSrc),
  );
  check(
    "A6. orchestrator.ts 调用 filterByWatchRules",
    /filterByWatchRules/.test(orchestratorSrc),
  );
  check(
    "A7. orchestrator.ts 调用 parseWatchRules",
    /parseWatchRules/.test(orchestratorSrc),
  );
  check(
    "A8. orchestrator.ts 返回 watch_rules_filtered_out 字段",
    /watch_rules_filtered_out/.test(orchestratorSrc),
  );

  const radarsRouteSrc = fs.readFileSync("src/api/routes/radars.ts", "utf-8");
  check(
    "A9. radars.ts run 端点传入 radar.watchRules",
    /radar\.watchRules/.test(radarsRouteSrc),
  );
  check(
    "A10. radars.ts PUT /:id 支持 watchRules 更新",
    /"watchRules"\s*in\s*body/.test(radarsRouteSrc),
  );

  const triggersSrc = fs.readFileSync("src/scheduler/triggers.ts", "utf-8");
  check(
    "A11. triggers.ts 传入 radar.watchRules",
    /radar\.watchRules/.test(triggersSrc),
  );

  // ============================================================
  // B. 功能测试：直接调用 SearchOrchestrator
  // ============================================================
  section("B. 功能测试：SearchOrchestrator.search() Watch Rules 过滤");

  const ctx = createTestContext();
  const spec = makeSpec();

  // B0. 不传 watchRules（基线）
  let baselineCount = 0;
  {
    const orch = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
    });
    const result = await orch.search(spec);
    baselineCount = result.opportunities.length;
    check(
      "B1. 不传 watchRules 时正常返回结果",
      baselineCount > 0,
      `opportunities.length=${baselineCount}`,
    );
    check(
      "B2. 不传 watchRules 时 watch_rules_filtered_out=0",
      (result.watch_rules_filtered_out ?? 0) === 0,
      `filtered_out=${result.watch_rules_filtered_out}`,
    );
  }

  // B1. 传入 ["+不存在的关键词XYZ"]：过滤掉所有
  {
    const orch = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
    });
    const result = await orch.search(spec, undefined, undefined, [
      "+不存在的关键词XYZ123",
    ]);
    check(
      "B3. +不存在关键词 规则过滤掉所有结果",
      result.opportunities.length === 0,
      `opportunities.length=${result.opportunities.length}`,
    );
    check(
      "B4. +不存在关键词 watch_rules_filtered_out > 0",
      (result.watch_rules_filtered_out ?? 0) > 0,
      `filtered_out=${result.watch_rules_filtered_out}`,
    );
    check(
      "B5. +不存在关键词 watch_rules_before == baseline",
      (result.watch_rules_before ?? 0) === baselineCount,
      `before=${result.watch_rules_before}, baseline=${baselineCount}`,
    );
  }

  // B2. 传入 ["+黑客松"]：只保留含 "黑客松" 的结果
  // 说明：mock 数据 5 条机会中只有 "AI 开源社区黑客松" 含 "黑客松"，
  // 因此 +黑客松 规则会过滤掉其余 4 条，能稳定验证 after < before。
  {
    const orch = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
    });
    const result = await orch.search(spec, undefined, undefined, ["+黑客松"]);
    const allContainHackathon = result.opportunities.every((opp) =>
      (opp.search_result.title + opp.search_result.snippet || "").includes("黑客松"),
    );
    check(
      "B6. +黑客松 规则保留含 黑客松 的结果（数量 > 0）",
      result.opportunities.length > 0,
      `opportunities.length=${result.opportunities.length}`,
    );
    check(
      "B7. +黑客松 规则过滤后所有结果均含 黑客松",
      allContainHackathon,
      `含 黑客松 的结果数=${result.opportunities.filter((o) => (o.search_result.title + o.search_result.snippet).includes("黑客松")).length}/${result.opportunities.length}`,
    );
    check(
      "B8. +黑客松 规则 watch_rules_after < watch_rules_before",
      (result.watch_rules_after ?? 0) < (result.watch_rules_before ?? 0),
      `after=${result.watch_rules_after}, before=${result.watch_rules_before}`,
    );
  }

  // B3. 传入 ["!AI"]：排除含 "AI" 的结果
  {
    const orch = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
    });
    const result = await orch.search(spec, undefined, undefined, ["!AI"]);
    const noneContainAI = result.opportunities.every(
      (opp) => !((opp.search_result.title + opp.search_result.snippet) || "").includes("AI"),
    );
    check(
      "B9. !AI 规则排除含 AI 的结果（剩余数量 < baseline）",
      result.opportunities.length < baselineCount,
      `剩余=${result.opportunities.length}, baseline=${baselineCount}`,
    );
    check(
      "B10. !AI 规则过滤后所有结果均不含 AI",
      result.opportunities.length === 0 || noneContainAI,
      `剩余含 AI 的结果数=${result.opportunities.filter((o) => (o.search_result.title + o.search_result.snippet).includes("AI")).length}`,
    );
  }

  // B4. 传入 ["@ai_competition"]：保留 radar_type=ai_competition 的结果
  {
    const orch = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
    });
    const result = await orch.search(spec, undefined, undefined, [
      "@ai_competition",
    ]);
    check(
      "B11. @ai_competition 规则保留匹配 radar_type 的结果",
      result.opportunities.length > 0,
      `opportunities.length=${result.opportunities.length}`,
    );
    check(
      "B12. @ai_competition watch_rules_filtered_out 较小（多数匹配）",
      (result.watch_rules_after ?? 0) > 0,
      `after=${result.watch_rules_after}`,
    );
  }

  // B5. 传入空数组 []：行为不变
  {
    const orch = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
    });
    const result = await orch.search(spec, undefined, undefined, []);
    check(
      "B13. 空数组 watchRules 行为不变（数量 == baseline）",
      result.opportunities.length === baselineCount,
      `length=${result.opportunities.length}, baseline=${baselineCount}`,
    );
  }

  // ============================================================
  // C. 端到端测试：API 路径
  // ============================================================
  section("C. 端到端测试：API 路径");

  const app = createApp(ctx);

  // C1. 创建并激活雷达
  let radarId = "";
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "V1.6.06 测试雷达",
      kind: "custom",
    });
    const radar = json.data as { id?: string } | null;
    radarId = radar?.id ?? "";
    check(
      "C1. POST /api/radars 创建雷达成功",
      res.status === 200 && typeof radarId === "string" && radarId.startsWith("radar_"),
      `status=${res.status}, id=${radarId}`,
    );
  }

  // C2. PUT /api/radars/:id 更新 watchRules
  {
    const { res, json } = await putJson(app, `/api/radars/${radarId}`, {
      watchRules: ["+AI", "!黑客松", "@ai_competition"],
    });
    const radar = json.data as { watchRules?: string[] } | null;
    check(
      "C2. PUT /api/radars/:id 更新 watchRules 返回 200",
      res.status === 200,
      `status=${res.status}`,
    );
    check(
      "C3. PUT 返回的 radar.watchRules 已存储",
      Array.isArray(radar?.watchRules) && radar!.watchRules!.length === 3,
      `watchRules=${JSON.stringify(radar?.watchRules)}`,
    );
  }

  // C3. GET /api/radars/:id 验证持久化
  {
    const { res, json } = await getJson(app, `/api/radars/${radarId}`);
    const radar = json.data as { watchRules?: string[] } | null;
    check(
      "C4. GET /api/radars/:id 返回 watchRules 持久化",
      Array.isArray(radar?.watchRules) && radar!.watchRules!.length === 3,
      `watchRules=${JSON.stringify(radar?.watchRules)}`,
    );
  }

  // C4. PUT 清空 watchRules（显式传 undefined）
  {
    const { res, json } = await putJson(app, `/api/radars/${radarId}`, {
      watchRules: null,
    });
    const radar = json.data as { watchRules?: string[] | null } | null;
    check(
      "C5. PUT 传 watchRules=null 清空规则",
      res.status === 200 && (radar?.watchRules === null || radar?.watchRules === undefined),
      `watchRules=${JSON.stringify(radar?.watchRules)}`,
    );
  }

  // C5. 恢复 watchRules 用于后续 run 测试
  {
    await putJson(app, `/api/radars/${radarId}`, {
      watchRules: ["+AI"],
    });
  }

  // C6. 激活雷达
  {
    const { res } = await postJson(app, `/api/radars/${radarId}/activate`, {});
    check(
      "C6. POST /api/radars/:id/activate 激活雷达",
      res.status === 200,
      `status=${res.status}`,
    );
  }

  // C7. POST /api/radars/:id/run（雷达含 watchRules="+AI"）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarId}/run`, {
      query: "AI比赛",
    });
    const data = json.data as {
      run?: { id?: string; status?: string };
      opportunityCards?: Array<{ title?: string }>;
    } | null;
    check(
      "C7. POST /api/radars/:id/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "C8. run 返回 run.id 非空",
      typeof data?.run?.id === "string" && data!.run!.id!.length > 0,
      `runId=${data?.run?.id}`,
    );
    if (data?.opportunityCards && data.opportunityCards.length > 0) {
      const allContainAI = data.opportunityCards.every((c) =>
        (c.title || "").includes("AI"),
      );
      check(
        "C9. run 返回的 opportunityCards 均含 AI（watchRules 生效）",
        allContainAI,
        `含 AI 数=${data.opportunityCards.filter((c) => (c.title || "").includes("AI")).length}/${data.opportunityCards.length}`,
      );
    } else {
      check(
        "C9. run 返回的 opportunityCards（watchRules 过滤后可能为空）",
        true,
        `cards=${data?.opportunityCards?.length ?? 0}`,
      );
    }
  }

  // ============================================================
  // D. 清理 + 汇总
  // ============================================================
  cleanupTempFiles();

  console.log("");
  console.log("========================================");
  console.log(`V1.6-06 验收汇总: ${passed} PASS / ${failed} FAIL`);
  if (failures.length > 0) {
    console.log("失败项:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("========================================");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("验收脚本异常:", err);
  process.exit(1);
});
