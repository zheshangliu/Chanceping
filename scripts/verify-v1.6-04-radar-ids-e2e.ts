/**
 * Task V1.6-04 验收脚本:radarIds 端到端验证
 *
 * 运行:npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证范围(9 项断言):
 *   1. 两雷达搜到同一机会(POST /api/radars/A/run + /B/run 都返回机会 X)
 *   2. 机会库全局唯一(GET /api/opportunities 机会 X 只出现一次)
 *   3. radarIds 多归属(ctx.store.get(key).radarIds 含 ["A", "B"])
 *   4. 按雷达 A 筛选(GET /api/opportunities?radar_id=A 返回机会 X)
 *   5. 按雷达 B 筛选(GET /api/opportunities?radar_id=B 返回机会 X)
 *   6. 按雷达 A 报告(POST /api/reports/generate { radar_id: "A" } 成功 + reportId)
 *   7. 按雷达 B 报告(POST /api/reports/generate { radar_id: "B" } 成功 + reportId)
 *   8. 报告查询 A(GET /api/reports?radar_id=A 返回该雷达报告)
 *   9. 报告查询 B(GET /api/reports?radar_id=B 返回该雷达报告)
 *
 * 测试隔离:使用临时文件 data/*-v1.6.04-test.json,测试后清理。
 * Mock 模式:DATA_MODE=mock + LLM_MODE=mock,两 custom 雷达均推断为 ai_competition 加载相同 demo 数据。
 */

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore, computeDedupKey } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { ReportMeta } from "../src/agents/report-store";
import type { ApiResponse, RadarRunResult } from "../src/api/types";
import type { OpportunityCard } from "../src/schema/opportunity-card";

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

const TEMP_RADARS_FILE = "data/radars-v1.6.04-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.6.04-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.6.04-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.6.04-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.6.04-test.json";

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

// ============================================================
// 创建测试用 AppContext
// ============================================================

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
// 辅助:解析响应
// ============================================================

async function parseResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

async function postJson(app: ReturnType<typeof createApp>, url: string, body: unknown): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: await parseResponse(res) };
}

async function getJson(app: ReturnType<typeof createApp>, url: string): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task V1.6-04 验收检查:radarIds 端到端验证 ===\n");

  process.env.DATA_MODE = process.env.DATA_MODE ?? "mock";
  process.env.LLM_MODE = process.env.LLM_MODE ?? "mock";

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 准备:创建两个 custom 雷达并激活
  // ============================================================
  section("准备:创建并激活两个 custom 雷达");

  // 直接通过 registry 创建(绕过 API 配额检查:免费用户仅 1 个自定义雷达)
  const radarA = ctx.radarRegistry.createCustomRadar({ name: "雷达A-测试", kind: "custom" });
  const radarB = ctx.radarRegistry.createCustomRadar({ name: "雷达B-测试", kind: "custom" });
  ctx.radarStore.save();
  const radarIdA = radarA.id;
  const radarIdB = radarB.id;

  check("准备.1 创建雷达 A 成功", !!radarIdA, `id=${radarIdA}`);
  check("准备.2 创建雷达 B 成功", !!radarIdB, `id=${radarIdB}`);

  // 激活雷达 A
  {
    const { res } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    check("准备.3 激活雷达 A 成功", res.status === 200, `status=${res.status}`);
  }

  // 激活雷达 B
  {
    const { res } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    check("准备.4 激活雷达 B 成功", res.status === 200, `status=${res.status}`);
  }

  if (!radarIdA || !radarIdB) {
    console.log("\n准备阶段失败,无法继续后续断言。");
    console.log(`\n结果: ${passed} PASS / ${failed} FAIL`);
    process.exit(1);
  }

  // ============================================================
  // 断言 1:两雷达搜到同一机会
  // ============================================================
  section("断言 1:两雷达搜到同一机会");

  let firstDedupKey = "";
  let firstCardTitle = "";

  // 雷达 A 运行
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as RadarRunResult | null;
    const cards = data?.opportunityCards ?? [];
    if (cards.length > 0) {
      firstDedupKey = computeDedupKey(cards[0].title, cards[0].official_source_url, cards[0].guid);
      firstCardTitle = cards[0].title ?? "";
    }
    check(
      "1a. 雷达 A 运行返回至少 1 个机会",
      res.status === 200 && json.success === true && cards.length > 0,
      `status=${res.status}, cards=${cards.length}`,
    );
  }

  // 雷达 B 运行(相同 query,期望命中同一机会)
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI比赛" });
    const data = json.data as RadarRunResult | null;
    const cards = data?.opportunityCards ?? [];
    const bKeys = cards.map((c) => computeDedupKey(c.title, c.official_source_url, c.guid));
    const bHasSameCard = cards.length > 0 && !!firstDedupKey && bKeys.includes(firstDedupKey);
    check(
      "1b. 雷达 B 运行返回同一机会(dedup_key 相同)",
      res.status === 200 && json.success === true && bHasSameCard,
      `status=${res.status}, cards=${cards.length}, firstDedupKey=${firstDedupKey}, bKeys=${bKeys.join(",")}`,
    );
  }

  // ============================================================
  // 断言 2:机会库全局唯一
  // ============================================================
  section("断言 2:机会库全局唯一");

  {
    const { res, json } = await getJson(app, "/api/opportunities?page_size=10000");
    const data = json.data as { entries?: Array<{ dedup_key: string }> } | null;
    const entries = data?.entries ?? [];
    const matchingEntries = entries.filter((e) => e.dedup_key === firstDedupKey);
    check(
      "2. 机会库中该机会只出现一次",
      res.status === 200 && matchingEntries.length === 1,
      `status=${res.status}, matchingCount=${matchingEntries.length}, total=${entries.length}`,
    );
  }

  // ============================================================
  // 断言 3:radarIds 多归属
  // ============================================================
  section("断言 3:radarIds 多归属");

  {
    const entry = ctx.store.get(firstDedupKey);
    const radarIds = entry?.radarIds ?? [];
    const hasA = radarIds.includes(radarIdA);
    const hasB = radarIds.includes(radarIdB);
    check(
      "3. StoreEntry.radarIds 含 [radarIdA, radarIdB]",
      !!entry && hasA && hasB,
      `entry=${entry ? "存在" : "null"}, radarIds=${JSON.stringify(radarIds)}, A=${radarIdA}, B=${radarIdB}`,
    );
  }

  // ============================================================
  // 断言 4:按雷达 A 筛选
  // ============================================================
  section("断言 4:按雷达 A 筛选");

  {
    const { res, json } = await getJson(app, `/api/opportunities?radar_id=${encodeURIComponent(radarIdA)}&page_size=10000`);
    const data = json.data as { entries?: Array<{ dedup_key: string }> } | null;
    const entries = data?.entries ?? [];
    const hasCard = entries.some((e) => e.dedup_key === firstDedupKey);
    check(
      "4. GET /api/opportunities?radar_id=A 返回该机会",
      res.status === 200 && hasCard,
      `status=${res.status}, entries=${entries.length}, hasCard=${hasCard}`,
    );
  }

  // ============================================================
  // 断言 5:按雷达 B 筛选
  // ============================================================
  section("断言 5:按雷达 B 筛选");

  {
    const { res, json } = await getJson(app, `/api/opportunities?radar_id=${encodeURIComponent(radarIdB)}&page_size=10000`);
    const data = json.data as { entries?: Array<{ dedup_key: string }> } | null;
    const entries = data?.entries ?? [];
    const hasCard = entries.some((e) => e.dedup_key === firstDedupKey);
    check(
      "5. GET /api/opportunities?radar_id=B 返回该机会",
      res.status === 200 && hasCard,
      `status=${res.status}, entries=${entries.length}, hasCard=${hasCard}`,
    );
  }

  // ============================================================
  // 断言 6:按雷达 A 生成报告
  // ============================================================
  section("断言 6:按雷达 A 生成报告");

  let reportIdA = "";

  // 取雷达 A 的机会卡片作为报告输入
  const entryA = ctx.store.get(firstDedupKey);
  const opportunitiesForReport: OpportunityCard[] = entryA ? [entryA.card] : [];

  {
    const { res, json } = await postJson(app, "/api/reports/generate", {
      radar_id: radarIdA,
      radar_type: "ai_competition",
      opportunities: opportunitiesForReport,
    });
    const data = json.data as { reportId?: string; success?: boolean; markdown?: string } | null;
    reportIdA = data?.reportId ?? "";
    check(
      "6. POST /api/reports/generate { radar_id: A } 成功且含 reportId",
      res.status === 200 && json.success === true && typeof reportIdA === "string" && reportIdA.startsWith("report_"),
      `status=${res.status}, success=${json.success}, reportId=${reportIdA}`,
    );
  }

  // ============================================================
  // 断言 7:按雷达 B 生成报告
  // ============================================================
  section("断言 7:按雷达 B 生成报告");

  let reportIdB = "";

  {
    const { res, json } = await postJson(app, "/api/reports/generate", {
      radar_id: radarIdB,
      radar_type: "ai_competition",
      opportunities: opportunitiesForReport,
    });
    const data = json.data as { reportId?: string; success?: boolean; markdown?: string } | null;
    reportIdB = data?.reportId ?? "";
    check(
      "7. POST /api/reports/generate { radar_id: B } 成功且含 reportId",
      res.status === 200 && json.success === true && typeof reportIdB === "string" && reportIdB.startsWith("report_"),
      `status=${res.status}, success=${json.success}, reportId=${reportIdB}`,
    );
  }

  // ============================================================
  // 断言 8:报告查询 A
  // ============================================================
  section("断言 8:报告查询 A");

  {
    const { res, json } = await getJson(app, `/api/reports?radar_id=${encodeURIComponent(radarIdA)}`);
    const list = (json.data as ReportMeta[] | null) ?? [];
    const hasReportA = list.some((r) => r.id === reportIdA && r.radarId === radarIdA);
    check(
      "8. GET /api/reports?radar_id=A 返回雷达 A 的报告",
      res.status === 200 && json.success === true && Array.isArray(list) && hasReportA,
      `status=${res.status}, len=${list.length}, hasReportA=${hasReportA}`,
    );
  }

  // ============================================================
  // 断言 9:报告查询 B
  // ============================================================
  section("断言 9:报告查询 B");

  {
    const { res, json } = await getJson(app, `/api/reports?radar_id=${encodeURIComponent(radarIdB)}`);
    const list = (json.data as ReportMeta[] | null) ?? [];
    const hasReportB = list.some((r) => r.id === reportIdB && r.radarId === radarIdB);
    check(
      "9. GET /api/reports?radar_id=B 返回雷达 B 的报告",
      res.status === 200 && json.success === true && Array.isArray(list) && hasReportB,
      `status=${res.status}, len=${list.length}, hasReportB=${hasReportB}`,
    );
  }

  // ============================================================
  // 清理
  // ============================================================
  cleanupTempFiles();

  // ============================================================
  // 结果汇总
  // ============================================================
  console.log("");
  console.log("=== 结果汇总 ===");
  console.log(`  PASS: ${passed}`);
  console.log(`  FAIL: ${failed}`);
  if (failures.length > 0) {
    console.log("  失败项:");
    for (const f of failures) {
      console.log(`    - ${f}`);
    }
  }
  console.log("");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n脚本异常退出:", err);
  process.exit(1);
});
