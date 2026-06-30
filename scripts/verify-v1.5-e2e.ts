/**
 * Task V1.6-01 验收脚本：V1.5 端到端验收
 *
 * 运行：npx tsx scripts/verify-v1.5-e2e.ts
 *
 * 验证完整自定义雷达产品路径：
 *   AI 生成 → 保存为自定义雷达 → 激活 → 手动运行 → 入库带 radarIds
 *   → 生成报告传 radar_id + run_id → 回写 RadarRun.reportId → 雷达详情页可看到机会与报告
 *
 * 8 步端到端流程 / 12 项断言。
 *
 * 测试隔离：使用临时文件 data/*-v1.5-e2e-test.json，测试后清理。
 */

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

const TEMP_RADARS_FILE = "data/radars-v1.5-e2e-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.5-e2e-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.5-e2e-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.5-e2e-test.txt";

function cleanupTempFiles(): void {
  for (const f of [TEMP_RADARS_FILE, TEMP_RUNS_FILE, TEMP_STORE_FILE, TEMP_WATCH_FILE]) {
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
  const reportStore = new JsonReportStore();

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

async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task V1.6-01 验收检查：V1.5 端到端 ===\n");

  // 确保 mock 模式
  process.env.DATA_MODE = process.env.DATA_MODE ?? "mock";
  process.env.LLM_MODE = process.env.LLM_MODE ?? "mock";

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1: AI 生成雷达 Spec
  // ============================================================
  section("步骤 1: AI 生成雷达 Spec");

  let suggestedName = "";
  let generatedSpec: unknown = null;
  {
    const { res, json } = await postJson(app, "/api/radars/generate", {
      description: "AI赛事追踪",
    });
    check("1. POST /api/radars/generate 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    const data = json.data as { spec?: unknown; suggestedName?: string; completeness?: number } | null;
    check("1.1 返回 spec 非空", data?.spec !== null && data?.spec !== undefined, "spec 为空");
    check("1.2 completeness >= 90", (data?.completeness ?? 0) >= 90, `completeness=${data?.completeness}`);
    check("1.3 suggestedName 非空", typeof data?.suggestedName === "string" && (data?.suggestedName?.length ?? 0) > 0, `suggestedName=${data?.suggestedName}`);
    suggestedName = data?.suggestedName ?? "AI赛事追踪雷达";
    generatedSpec = data?.spec ?? null;
  }

  // ============================================================
  // 步骤 2: 保存为自定义雷达
  // ============================================================
  section("步骤 2: 保存为自定义雷达");

  let radarId = "";
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: suggestedName,
      kind: "custom",
      ...(generatedSpec ? { spec: generatedSpec } : {}),
    });
    check("2. POST /api/radars 创建返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    const radar = json.data as { id?: string; status?: string; kind?: string } | null;
    radarId = radar?.id ?? "";
    check("2.1 返回 id 以 radar_ 开头", radarId.startsWith("radar_"), `id=${radarId}`);
    check("2.2 返回 status=draft", radar?.status === "draft", `status=${radar?.status}`);
    check("2.3 返回 kind=custom", radar?.kind === "custom", `kind=${radar?.kind}`);
  }

  // ============================================================
  // 步骤 3: 激活雷达
  // ============================================================
  section("步骤 3: 激活雷达");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarId}/activate`, {});
    check("3. POST /:id/activate 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    const radar = json.data as { status?: string } | null;
    check("3.1 status=active", radar?.status === "active", `status=${radar?.status}`);
  }

  // ============================================================
  // 步骤 4: 手动运行雷达
  // ============================================================
  section("步骤 4: 手动运行雷达");

  let runId = "";
  {
    const { res, json } = await postJson(app, `/api/radars/${radarId}/run`, {
      query: "AI比赛",
    });
    check("4. POST /:id/run 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);

    const data = json.data as {
      run?: { id?: string; status?: string };
      opportunityCards?: unknown[];
      opportunities?: Array<{ radarId?: string }>;
    } | null;

    runId = data?.run?.id ?? "";
    check("4.1 返回 run.id 非空", typeof runId === "string" && runId.length > 0, `runId=${runId}`);
    check("4.2 run.status=succeeded", data?.run?.status === "succeeded", `status=${data?.run?.status}`);

    const hasOpps = (data?.opportunityCards?.length ?? 0) > 0 || (data?.opportunities?.length ?? 0) > 0;
    check("4.3 返回 opportunityCards 或 opportunities 非空", hasOpps, `cards=${data?.opportunityCards?.length ?? 0}, opps=${data?.opportunities?.length ?? 0}`);

    // 4.4 返回的 opportunities 每条含 radarId === radar.id
    const opportunities = data?.opportunities ?? [];
    const allHaveRadarId = opportunities.length > 0 && opportunities.every((o) => o.radarId === radarId);
    check("4.4 opportunities 每条含 radarId === radar.id", allHaveRadarId, `total=${opportunities.length}, mismatch=${opportunities.filter((o) => o.radarId !== radarId).length}`);
  }

  // ============================================================
  // 步骤 5: 入库 radarIds 验证（直接查 store，绕过 API）
  // ============================================================
  section("步骤 5: 入库 radarIds 验证");

  {
    // V1.6-01 阶段：opportunities API 暂未支持 radar_id 参数（V1.6-04 修复）
    // 直接查 store 验证 radarIds 绑定
    const list = ctx.store.list({ radarId, page: 1, page_size: 100 });
    const entries = list.entries;
    check("5. store.list({ radarId }) 返回非空", entries.length > 0, `len=${entries.length}`);

    // 验证每条含 radarId 或 radarIds 含 radar.id
    const allBound = entries.every((e) => e.radarId === radarId || (e.radarIds && e.radarIds.includes(radarId)));
    check("5.1 每条 entry 含 radarId 或 radarIds 含 radar.id", allBound, `unbound=${entries.filter((e) => e.radarId !== radarId && !(e.radarIds && e.radarIds.includes(radarId))).length}`);
  }

  // ============================================================
  // 步骤 6: 生成报告（传 radar_id + run_id）
  // ============================================================
  section("步骤 6: 生成报告");

  let reportId = "";
  {
    // 从 store 取机会传给报告生成
    const storeList = ctx.store.list({ radarId, page: 1, page_size: 100 });
    const opportunities = storeList.entries.map((e) => e.card);

    const { res, json } = await postJson(app, "/api/reports/generate", {
      radar_id: radarId,
      run_id: runId,
      opportunities,
      ...(generatedSpec ? { spec: generatedSpec } : {}),
    });
    check("6. POST /reports/generate 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);

    const data = json.data as { success?: boolean; reportId?: string; markdown?: string } | null;
    reportId = data?.reportId ?? "";
    check("6.1 返回 reportId 非空", typeof reportId === "string" && reportId.length > 0, `reportId=${reportId}`);
  }

  // ============================================================
  // 步骤 7: 回写 RadarRun.reportId 验证
  // ============================================================
  section("步骤 7: 回写 RadarRun.reportId 验证");

  {
    const run = ctx.radarRunStore.get(runId);
    check("7. radarRunStore.get(run.id) 非空", run !== null, `runId=${runId}`);
    check("7.1 run.reportId === reportId", run?.reportId === reportId, `run.reportId=${run?.reportId}, expected=${reportId}`);
  }

  // ============================================================
  // 步骤 8: 雷达详情页可看到机会与报告
  // ============================================================
  section("步骤 8: 报告查询");

  {
    const { res, json } = await getJson(app, `/api/reports?radar_id=${radarId}`);
    check("8. GET /api/reports?radar_id= 返回 200", res.status === 200, `status=${res.status}`);

    const reports = (json.data as Array<{ id?: string }> | null) ?? [];
    const containsReport = reports.some((r) => r.id === reportId);
    check("8.1 返回列表含 reportId", containsReport, `total=${reports.length}, reportId=${reportId}`);
  }

  // ============================================================
  // 总结
  // ============================================================
  console.log("");
  console.log("=== 验收结果（V1.5 端到端 1-12）===");
  console.log(`PASS: ${passed} / FAIL: ${failed}`);
  if (failures.length > 0) {
    console.log("失败项：");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }

  // 清理临时文件
  cleanupTempFiles();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("验收脚本执行失败：", err);
  cleanupTempFiles();
  process.exit(1);
});
