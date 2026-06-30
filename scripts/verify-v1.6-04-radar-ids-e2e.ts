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
/**
/**
 * Task V1.6-04 验/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/rad/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 */**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 */**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?rad/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "..//**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType }/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { Radar/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import type { ApiResponse } from "../src/api/types";

// ============================================================
// 测试框架
// ============================================================

let passed = 0;
let/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import type { ApiResponse } from "../src/api/types";

// ============================================================
// 测试框架
// ============================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
    console.log(`  FAIL  ${name}${detail/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1./**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1.6.04-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1.6.04-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.6.04-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.6.04-test.json";
const TEMP_WATCH_FILE/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1.6.04-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.6.04-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.6.04-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.6.04-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.6.04/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1.6.04-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.6.04-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.6.04-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.6.04-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.6.04-test.json";

function cleanupTempFiles(): void {
  for (const f of [TEMP_RADARS_FILE, TEMP_RUNS_FILE, TEMP_STORE_FILE/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
      }/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
// ============================================================

/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
// ============================================================

function createTestContext(): AppContext {
  cleanupTempFiles();

  const modelRouter = new ModelRouter();
  const store = new LocalFileStore({ file_path: TEMP_STORE_FILE });
  store.load();
  const starManager = new StarManager/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
// ============================================================

function createTestContext(): AppContext {
  cleanupTempFiles();

  const modelRouter = new ModelRouter();
  const store = new LocalFileStore({ file_path: TEMP_STORE_FILE });
  store.load();
  const starManager = new StarManager(store);
  const watchStore = new LocalWatchStore({ file_path: TEMP_WATCH_FILE });
  const radarStore = new JsonRadarStore({ file_path: TEMP_RADARS_FILE });
  const/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  const radarRegistry = new RadarRegistry(radarStore/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
  const reportStore = new JsonReportStore({ file_path: TEMP_REPORT/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
  const reportStore = new JsonReportStore({ file_path: TEMP_REPORT_FILE });

  return {
    llmAdapter: modelRouter,
    store,
    starManager,
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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
// 辅助：解析响应/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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
    return/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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
    throw/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
async function postJson(
  app: ReturnType<typeof createApp>,
  url: string,
  body: unknown,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json"/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, {/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason:/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  ///**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await post/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type:/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活//**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string"/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/rad/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?:/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status ===/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?./**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3./**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // =================================================/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys =/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length},/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) ||/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) || e.radarId === radarIdA,
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) || e.radarId === radarIdA,
    );
    const withB = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdB) || e.radarId === radarIdB,
    );
    const overlap = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) && (e.radarIds ?? []).includes(radarIdB),
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) || e.radarId === radarIdA,
    );
    const withB = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdB) || e.radarId === radarIdB,
    );
    const overlap = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) && (e.radarIds ?? []).includes(radarIdB),
    );

    check(
      "5.1 存在被雷达A和雷达B同时命/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) || e.radarId === radarIdA,
    );
    const withB = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdB) || e.radarId === radarIdB,
    );
    const overlap = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) && (e.radarIds ?? []).includes(radarIdB),
    );

    check(
      "5.1 存在被雷达A和雷达B同时命中的机会（radarIds 含两者）",
/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) || e.radarId === radarIdA,
    );
    const withB = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdB) || e.radarId === radarIdB,
    );
    const overlap = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) && (e.radarIds ?? []).includes(radarIdB),
    );

    check(
      "5.1 存在被雷达A和雷达B同时命中的机会（radarIds 含两者）",
      overlap.length > 0,
      `overlap=${overlap.length}, withA=${withA.length}, withB=${withB.length}`,
    );

    // 回退断言：若无交集（/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) || e.radarId === radarIdA,
    );
    const withB = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdB) || e.radarId === radarIdB,
    );
    const overlap = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) && (e.radarIds ?? []).includes(radarIdB),
    );

    check(
      "5.1 存在被雷达A和雷达B同时命中的机会（radarIds 含两者）",
      overlap.length > 0,
      `overlap=${overlap.length}, withA=${withA.length}, withB=${withB.length}`,
    );

    // 回退断言：若无交集（mock 数据差异），至少每个雷达自身的机会都/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
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
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
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
  radarRegistry.initialize(); // 初始化 3 个内置雷达
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

/** POST 请求辅助 */
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

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) || e.radarId === radarIdA,
    );
    const withB = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdB) || e.radarId === radarIdB,
    );
    const overlap = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) && (e.radarIds ?? []).includes(radarIdB),
    );

    check(
      "5.1 存在被雷达A和雷达B同时命中的机会（radarIds 含两者）",
      overlap.length > 0,
      `overlap=${overlap.length}, withA=${withA.length}, withB=${withB.length}`,
    );

    // 回退断言：若无交集（mock 数据差异），至少每个雷达自身的机会都带对应 radarId
    if (overlap.length === 0) {
      check(
        "