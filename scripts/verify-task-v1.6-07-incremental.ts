/**
 * Task V1.6-07 验收脚本：增量标签接入机会库
 *
 * 运行：npx tsx scripts/verify-task-v1.6-07-incremental.ts
 *
 * 验证目标：
 *   - StoreEntry 含 contentHash/changeRatio/incremental 字段
 *   - OpportunityCard 含 ai_analysis 字段
 *   - OpportunityStore 接口含 getByDedupKey 方法
 *   - LocalFileStore.add/addBatch 计算 contentHash/changeRatio/incremental
 *   - 新内容 changeRatio=1.0, incremental=false
 *   - 相同内容再次入库 changeRatio=0, incremental=true
 *   - SearchOrchestrator 复用 incremental=true 的 AI 分析（ai_filter_skipped > 0）
 *   - 同一机会第二次运行时 AI 调用次数减少
 *
 * 测试隔离：使用临时文件 data/*-v1.6.07-test.json，测试后清理。
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
import type { StoreEntry, OpportunityStore } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import { SearchOrchestrator } from "../src/search/orchestrator";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import type { ApiResponse } from "../src/api/types";
import { hashContent } from "../src/search/incremental-tagger";

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

const TEMP_RADARS_FILE = "data/radars-v1.6.07-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.6.07-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.6.07-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.6.07-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.6.07-test.json";

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
// 辅助：构造测试用 OpportunityCard
// ============================================================

function makeCard(title: string, url: string, matchReason: string = "AI 赛事匹配"): OpportunityCard {
  return {
    title,
    type: "AI 赛事",
    organizer: "测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: matchReason,
    next_action: "立即报名",
    official_source_url: url,
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
    ai_analysis: "AI 精筛通过：相关度 80",
  };
}

// ============================================================
// 构造最小 spec（用于 SearchOrchestrator 直测）
// ============================================================

function makeSpec(): import("../src/schema/radar-requirement-spec").RadarRequirementSpec {
  return {
    product_name: "ChancePing",
    product_category: "机会雷达",
    client_profile: {
      client_name: "V1.6.07 测试",
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
  console.log("\n=== V1.6-07 增量标签接入验证 ===\n");

  // ============================================================
  // A. 静态检查：源文件含增量标签接入点
  // ============================================================
  section("A. 静态检查：源文件含增量标签接入点");

  const cardSchemaSrc = fs.readFileSync("src/schema/opportunity-card.ts", "utf-8");
  check(
    "A1. opportunity-card.ts 含 ai_analysis?: string",
    /ai_analysis\?\s*:\s*string/.test(cardSchemaSrc),
  );

  const storeSrc = fs.readFileSync("src/agents/opportunity-store.ts", "utf-8");
  check(
    "A2. opportunity-store.ts StoreEntry 含 contentHash?: string",
    /contentHash\?\s*:\s*string/.test(storeSrc),
  );
  check(
    "A3. opportunity-store.ts StoreEntry 含 changeRatio?: number",
    /changeRatio\?\s*:\s*number/.test(storeSrc),
  );
  check(
    "A4. opportunity-store.ts StoreEntry 含 incremental?: boolean",
    /incremental\?\s*:\s*boolean/.test(storeSrc),
  );
  check(
    "A5. opportunity-store.ts OpportunityStore 接口含 getByDedupKey",
    /getByDedupKey\s*\(\s*dedup_key\s*:\s*string\s*\)/.test(storeSrc),
  );
  check(
    "A6. opportunity-store.ts 引入 hashContent/computeChangeRatio",
    /import\s*\{[^}]*hashContent[^}]*\}\s*from\s*["']\.\.\/search\/incremental-tagger["']/.test(storeSrc),
  );
  check(
    "A7. opportunity-store.ts add() 调用 computeIncrementalTag",
    /computeIncrementalTag/.test(storeSrc),
  );

  const orchestratorSrc = fs.readFileSync("src/search/orchestrator.ts", "utf-8");
  check(
    "A8. orchestrator.ts 配置含 opportunityStore?: OpportunityStore",
    /opportunityStore\?\s*:\s*OpportunityStore/.test(orchestratorSrc),
  );
  check(
    "A9. orchestrator.ts 结果含 ai_filter_skipped?: number",
    /ai_filter_skipped\?\s*:\s*number/.test(orchestratorSrc),
  );
  check(
    "A10. orchestrator.ts 调用 computeDedupKey",
    /computeDedupKey/.test(orchestratorSrc),
  );
  check(
    "A11. orchestrator.ts 调用 opportunityStore.getByDedupKey",
    /opportunityStore\.getByDedupKey/.test(orchestratorSrc),
  );
  check(
    "A12. orchestrator.ts 写入 card.ai_analysis",
    /card\.ai_analysis\s*=/.test(orchestratorSrc),
  );

  const radarsRouteSrc = fs.readFileSync("src/api/routes/radars.ts", "utf-8");
  check(
    "A13. radars.ts 传入 opportunityStore: ctx.store",
    /opportunityStore:\s*ctx\.store/.test(radarsRouteSrc),
  );

  const triggersSrc = fs.readFileSync("src/scheduler/triggers.ts", "utf-8");
  check(
    "A14. triggers.ts 传入 opportunityStore: ctx.store",
    /opportunityStore:\s*ctx\.store/.test(triggersSrc),
  );

  // ============================================================
  // B. 功能测试：LocalFileStore 增量标签计算
  // ============================================================
  section("B. 功能测试：LocalFileStore 增量标签计算");

  const ctx = createTestContext();
  const store = ctx.store;

  // B1. 新内容入库：contentHash 计算 + changeRatio=1.0 + incremental=false
  let entry1: StoreEntry;
  {
    const card = makeCard("测试机会A", "https://test-v1.6.07.example/a");
    entry1 = store.add(card, "ai_competition", "radar_test_1");
    check(
      "B1. 新内容入库后 contentHash 非空（SHA-256 64 字符）",
      typeof entry1.contentHash === "string" && entry1.contentHash.length === 64,
      `contentHash=${entry1.contentHash}`,
    );
    check(
      "B2. 新内容 changeRatio = 1.0",
      entry1.changeRatio === 1.0,
      `changeRatio=${entry1.changeRatio}`,
    );
    check(
      "B3. 新内容 incremental = false",
      entry1.incremental === false,
      `incremental=${entry1.incremental}`,
    );
    // 验证 contentHash 是 title + match_reason + url 的 SHA-256
    const expectedHash = hashContent([card.title, card.match_reason, card.official_source_url].join("\n"));
    check(
      "B4. contentHash 等于 title+match_reason+url 的 SHA-256",
      entry1.contentHash === expectedHash,
      `actual=${entry1.contentHash}, expected=${expectedHash}`,
    );
  }

  // B2. 相同内容再次入库：changeRatio=0 + incremental=true
  {
    const card = makeCard("测试机会A", "https://test-v1.6.07.example/a");
    const entry = store.add(card, "ai_competition", "radar_test_2");
    check(
      "B5. 相同内容再次入库 changeRatio = 0",
      entry.changeRatio === 0,
      `changeRatio=${entry.changeRatio}`,
    );
    check(
      "B6. 相同内容再次入库 incremental = true",
      entry.incremental === true,
      `incremental=${entry.incremental}`,
    );
    check(
      "B7. 相同内容 contentHash 不变",
      entry.contentHash === entry1.contentHash,
      `new=${entry.contentHash}, old=${entry1.contentHash}`,
    );
  }

  // B3. 内容变化再次入库：changeRatio > 0 + incremental=false
  {
    const card = makeCard("测试机会A（已更新）", "https://test-v1.6.07.example/a", "新的匹配理由");
    const entry = store.add(card, "ai_competition", "radar_test_3");
    check(
      "B8. 内容变化后 changeRatio > 0",
      typeof entry.changeRatio === "number" && entry.changeRatio > 0,
      `changeRatio=${entry.changeRatio}`,
    );
    check(
      "B9. 内容变化后 incremental = false",
      entry.incremental === false,
      `incremental=${entry.incremental}`,
    );
    check(
      "B10. 内容变化后 contentHash 改变",
      entry.contentHash !== entry1.contentHash,
      `new=${entry.contentHash}, old=${entry1.contentHash}`,
    );
  }

  // B4. getByDedupKey 方法
  {
    const retrieved = store.getByDedupKey(entry1.dedup_key);
    check(
      "B11. getByDedupKey 返回已存在条目",
      retrieved !== undefined && retrieved.dedup_key === entry1.dedup_key,
      `retrieved=${retrieved ? "存在" : "undefined"}`,
    );
    const notFound = store.getByDedupKey("nonexistent_key_99999");
    check(
      "B12. getByDedupKey 不存在时返回 undefined",
      notFound === undefined,
      `notFound=${notFound === undefined ? "undefined" : "存在"}`,
    );
  }

  // B5. addBatch 增量标签
  {
    const cards = [
      makeCard("批量机会1", "https://test-v1.6.07.example/batch1"),
      makeCard("批量机会2", "https://test-v1.6.07.example/batch2"),
    ];
    const entries = store.addBatch(cards, "ai_competition", "radar_batch_1");
    check(
      "B13. addBatch 返回条目均含 contentHash",
      entries.every((e) => typeof e.contentHash === "string" && e.contentHash.length === 64),
      `hashCount=${entries.filter((e) => typeof e.contentHash === "string" && e.contentHash.length === 64).length}/${entries.length}`,
    );
    check(
      "B14. addBatch 新内容 changeRatio = 1.0",
      entries.every((e) => e.changeRatio === 1.0),
      `changeRatios=${entries.map((e) => e.changeRatio).join(",")}`,
    );
    check(
      "B15. addBatch 新内容 incremental = false",
      entries.every((e) => e.incremental === false),
      `incrementals=${entries.map((e) => e.incremental).join(",")}`,
    );

    // 再次 addBatch 相同内容 → incremental=true
    const entries2 = store.addBatch(cards, "ai_competition", "radar_batch_2");
    check(
      "B16. addBatch 相同内容再次入库 incremental = true",
      entries2.every((e) => e.incremental === true),
      `incrementals=${entries2.map((e) => e.incremental).join(",")}`,
    );
    check(
      "B17. addBatch 相同内容再次入库 changeRatio = 0",
      entries2.every((e) => e.changeRatio === 0),
      `changeRatios=${entries2.map((e) => e.changeRatio).join(",")}`,
    );
  }

  // ============================================================
  // C. 功能测试：SearchOrchestrator 增量复用
  // ============================================================
  section("C. 功能测试：SearchOrchestrator 增量复用");

  // C1. 不传 opportunityStore：行为不变（ai_filter_skipped=0）
  {
    const orch = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
    });
    const result = await orch.search(makeSpec());
    check(
      "C1. 不传 opportunityStore 时 ai_filter_skipped = 0",
      (result.ai_filter_skipped ?? 0) === 0,
      `skipped=${result.ai_filter_skipped}`,
    );
    check(
      "C2. 不传 opportunityStore 时 ai_filter_executed > 0（全量精筛）",
      (result.ai_filter_executed ?? 0) > 0,
      `executed=${result.ai_filter_executed}`,
    );
  }

  // C2. 传 opportunityStore 但首次运行（store 为空）：全量 AI 精筛
  // 使用全新空 store 避免污染
  const freshStoreFile = "data/opportunity-store-v1.6.07-fresh-test.json";
  const freshStore = new LocalFileStore({ file_path: freshStoreFile });
  freshStore.load();
  {
    const abs = path.resolve(process.cwd(), freshStoreFile);
    if (fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch { /* ignore */ }
    }
    freshStore.load(); // 重新加载空
    const orch = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
      opportunityStore: freshStore,
    });
    const result = await orch.search(makeSpec());

    check(
      "C3. 首次运行（store 空）ai_filter_skipped = 0",
      (result.ai_filter_skipped ?? 0) === 0,
      `skipped=${result.ai_filter_skipped}`,
    );
    check(
      "C4. 首次运行 ai_filter_executed > 0",
      (result.ai_filter_executed ?? 0) > 0,
      `executed=${result.ai_filter_executed}`,
    );
    check(
      "C5. 首次运行返回 opportunityCards 含 ai_analysis",
      (result.opportunityCards ?? []).length > 0 &&
        result.opportunityCards!.every((c) => typeof c.ai_analysis === "string" && c.ai_analysis!.length > 0),
      `cards with ai_analysis=${(result.opportunityCards ?? []).filter((c) => typeof c.ai_analysis === "string" && c.ai_analysis!.length > 0).length}/${(result.opportunityCards ?? []).length}`,
    );

    // 把首次结果入库到 freshStore，模拟第一次运行后的状态
    if (result.opportunityCards && result.opportunityCards.length > 0) {
      freshStore.addBatch(result.opportunityCards, "ai_competition", "radar_first_run");
    }
    const firstRunExecuted = result.ai_filter_executed ?? 0;

    // C3. 第二次运行：相同内容，store 中已有且 incremental=true → 跳过 AI 精筛
    const orch2 = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      mockContent: true,
      dataMode: "mock",
      opportunityStore: freshStore,
    });
    const result2 = await orch2.search(makeSpec());
    check(
      "C6. 第二次运行 ai_filter_skipped > 0（incremental=true 命中缓存）",
      (result2.ai_filter_skipped ?? 0) > 0,
      `skipped=${result2.ai_filter_skipped}`,
    );
    check(
      "C7. 第二次运行 ai_filter_executed < 第一次运行",
      (result2.ai_filter_executed ?? 0) < firstRunExecuted,
      `second=${result2.ai_filter_executed}, first=${firstRunExecuted}`,
    );
    check(
      "C8. 第二次运行 ai_filter_skipped + ai_filter_executed = rule_passed",
      (result2.ai_filter_skipped ?? 0) + (result2.ai_filter_executed ?? 0) === result2.total_rule_passed,
      `skipped=${result2.ai_filter_skipped}, executed=${result2.ai_filter_executed}, rule_passed=${result2.total_rule_passed}`,
    );
  }
  // 清理 freshStore 文件
  {
    const abs = path.resolve(process.cwd(), freshStoreFile);
    if (fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch { /* ignore */ }
    }
  }

  // ============================================================
  // D. 端到端测试：API 路径（POST /api/radars/:id/run）
  // ============================================================
  section("D. 端到端测试：API 路径");

  const app = createApp(ctx);

  // D1. 创建并激活雷达
  let radarId = "";
  {
    const res = await app.request("/api/radars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "V1.6.07 测试雷达", kind: "custom" }),
    });
    const json = await res.json() as ApiResponse;
    const radar = json.data as { id?: string } | null;
    radarId = radar?.id ?? "";
    check(
      "D1. POST /api/radars 创建雷达成功",
      res.status === 200 && typeof radarId === "string" && radarId.startsWith("radar_"),
      `status=${res.status}, id=${radarId}`,
    );
  }
  {
    const res = await app.request(`/api/radars/${radarId}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    check(
      "D2. POST /api/radars/:id/activate 激活雷达",
      res.status === 200,
      `status=${res.status}`,
    );
  }

  // D2. 第一次运行
  {
    const res = await app.request(`/api/radars/${radarId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "AI比赛" }),
    });
    const json = await res.json() as ApiResponse;
    check(
      "D3. 第一次 POST /api/radars/:id/run 返回 200",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
  }

  // D3. 第二次运行（相同内容，验证 incremental=true 不报错）
  {
    const res = await app.request(`/api/radars/${radarId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "AI比赛" }),
    });
    const json = await res.json() as ApiResponse;
    check(
      "D4. 第二次 POST /api/radars/:id/run 返回 200（incremental 复用）",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
  }

  // D4. 验证 store 中条目含增量标签字段
  {
    const allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "D5. 机会库条目均含 contentHash",
      allEntries.length > 0 && allEntries.every((e) => typeof e.contentHash === "string" && e.contentHash!.length === 64),
      `withHash=${allEntries.filter((e) => typeof e.contentHash === "string" && e.contentHash!.length === 64).length}/${allEntries.length}`,
    );
    check(
      "D6. 机会库条目含 changeRatio（数字）",
      allEntries.every((e) => typeof e.changeRatio === "number"),
      `withRatio=${allEntries.filter((e) => typeof e.changeRatio === "number").length}/${allEntries.length}`,
    );
    check(
      "D7. 机会库条目含 incremental（布尔）",
      allEntries.every((e) => typeof e.incremental === "boolean"),
      `withIncremental=${allEntries.filter((e) => typeof e.incremental === "boolean").length}/${allEntries.length}`,
    );
    // 第二次运行后，相同内容应标记为 incremental=true
    const incrementalCount = allEntries.filter((e) => e.incremental === true).length;
    check(
      "D8. 第二次运行后存在 incremental=true 的条目",
      incrementalCount > 0,
      `incrementalCount=${incrementalCount}`,
    );
    // 验证 card.ai_analysis 已存储
    const withAiAnalysis = allEntries.filter((e) => typeof e.card.ai_analysis === "string" && e.card.ai_analysis!.length > 0);
    check(
      "D9. 机会库条目 card.ai_analysis 已存储",
      withAiAnalysis.length > 0,
      `withAiAnalysis=${withAiAnalysis.length}/${allEntries.length}`,
    );
  }

  // ============================================================
  // E. 清理 + 汇总
  // ============================================================
  cleanupTempFiles();
  // 清理 freshStore 文件
  {
    const abs = path.resolve(process.cwd(), freshStoreFile);
    if (fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch { /* ignore */ }
    }
  }

  console.log("");
  console.log("========================================");
  console.log(`V1.6-07 验收汇总: ${passed} PASS / ${failed} FAIL`);
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
