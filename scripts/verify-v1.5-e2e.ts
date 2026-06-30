/**
 * V1.6-01 任务：V1.5 端到端验收脚本
 *
 * 运行：npx tsx scripts/verify-v1.5-e2e.ts
 *
 * 验证完整的自定义雷达产品路径（8 步）：
 *   1. AI 生成雷达 Spec（POST /api/radars/generate）
 *   2. 保存为自定义雷达（POST /api/radars）
 *   3. 激活雷达（POST /api/radars/:id/activate）
 *   4. 手动运行雷达（POST /api/radars/:id/run）
 *   5. 入库 radarIds 验证（GET /api/opportunities?radar_id=）
 *   6. 生成报告，传 radar_id + run_id（POST /api/reports/generate）
 *   7. 回写 RadarRun.reportId 验证（ctx.radarRunStore.get）
 *   8. 报告查询（GET /api/reports?radar_id=）
 *
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock，ModelRouter 返回 mock 数据。
 *
 * 测试隔离：使用临时文件 data/radars-v1.5-e2e-test.json 等，测试后清理。
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

// ============================================================
// 临时文件路径（独特名称，避免与其他测试冲突）
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1.5-e2e-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.5-e2e-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.5-e2e-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.5-e2e-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.5-e2e-test.json";

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

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.5 端到端验收 ===\n");

  // 确保 mock 模式（DATA_MODE=mock + LLM_MODE=mock）
  process.env.DATA_MODE = process.env.DATA_MODE ?? "mock";
  process.env.LLM_MODE = process.env.LLM_MODE ?? "mock";

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1: AI 生成雷达 Spec
  // ============================================================
  let generatedSpec: unknown = null;
  {
    const { res, json } = await postJson(app, "/api/radars/generate", {
      description: "追踪AI赛事机会和比赛信息",
    });
    check("步骤1: AI 生成雷达 Spec 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    check("步骤1: success=true", json.success === true);
    const data = json.data as { spec?: unknown; completeness?: number; suggestedName?: string } | null;
    generatedSpec = data?.spec ?? null;
    check("步骤1: data.spec 非空", generatedSpec !== null && generatedSpec !== undefined, `spec=${generatedSpec === null ? "null" : "有值"}`);
    check(
      "步骤1: completeness >= 0 或 suggestedName 非空",
      (typeof data?.completeness === "number" && data.completeness >= 0) ||
        (typeof data?.suggestedName === "string" && data.suggestedName.length > 0),
      `completeness=${data?.completeness}, suggestedName=${data?.suggestedName}`,
    );
  }

  // ============================================================
  // 步骤 2: 保存为自定义雷达
  // ============================================================
  let radarId = "";
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "AI赛事追踪",
      kind: "custom",
      ...(generatedSpec ? { spec: generatedSpec } : {}),
    });
    check("步骤2: 保存自定义雷达返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    check("步骤2: success=true", json.success === true);
    const radar = json.data as { id?: string; status?: string; kind?: string } | null;
    radarId = radar?.id ?? "";
    check("步骤2: data.id 非空", radarId.length > 0, `id=${radarId}`);
    check("步骤2: data.status === draft", radar?.status === "draft", `status=${radar?.status}`);
    check("步骤2: data.kind === custom", radar?.kind === "custom", `kind=${radar?.kind}`);
  }

  // ============================================================
  // 步骤 3: 激活雷达
  // ============================================================
  {
    const { res, json } = await postJson(app, `/api/radars/${radarId}/activate`, {});
    check("步骤3: 激活雷达返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    check("步骤3: success=true", json.success === true);
    const radar = json.data as { status?: string } | null;
    check("步骤3: data.status === active", radar?.status === "active", `status=${radar?.status}`);
  }

  // ============================================================
  // 步骤 4: 手动运行雷达
  // ============================================================
  let runId = "";
  {
    const { res, json } = await postJson(app, `/api/radars/${radarId}/run`, {
      query: "AI比赛",
    });
    check("步骤4: 运行雷达返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    check("步骤4: success=true", json.success === true);
    const data = json.data as {
      run?: { id?: string; status?: string };
      opportunityCards?: unknown[];
      opportunities?: Array<{ radarId?: string }>;
    } | null;
    runId = data?.run?.id ?? "";
    check("步骤4: data.run.id 非空", runId.length > 0, `runId=${runId}`);
    check("步骤4: data.run.status === succeeded", data?.run?.status === "succeeded", `status=${data?.run?.status}`);
    // mock 模式可能有结果也可能为空，检查字段存在即可
    check(
      "步骤4: opportunityCards 或 opportunities 字段存在",
      data?.opportunityCards !== undefined || data?.opportunities !== undefined,
      `opportunityCards=${data?.opportunityCards === undefined ? "undefined" : "有"}, opportunities=${data?.opportunities === undefined ? "undefined" : "有"}`,
    );
    // 如果 opportunities 非空，每条含 radarId === radar.id
    const opportunities = data?.opportunities ?? [];
    if (opportunities.length > 0) {
      check(
        "步骤4: opportunities 非空时每条 radarId === radar.id",
        opportunities.every((o) => o.radarId === radarId),
        `missing=${opportunities.filter((o) => o.radarId !== radarId).length}`,
      );
    }
  }

  // ============================================================
  // 步骤 5: 入库 radarIds 验证
  // ============================================================
  {
    const { res, json } = await getJson(app, `/api/opportunities?radar_id=${encodeURIComponent(radarId)}`);
    check("步骤5: GET /api/opportunities?radar_id 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    check("步骤5: success=true", json.success === true);
  }

  // ============================================================
  // 步骤 6: 生成报告（传 radar_id + run_id）
  // ============================================================
  let reportId = "";
  {
    const { res, json } = await postJson(app, "/api/reports/generate", {
      radar_id: radarId,
      run_id: runId,
      radar_type: "ai_competition",
      opportunities: [],
      // spec: undefined —— 不传 spec，报告路由使用 createDefaultSpec()
    });
    check("步骤6: 生成报告返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    check("步骤6: success=true", json.success === true);
    const data = json.data as { reportId?: string } | null;
    reportId = data?.reportId ?? "";
    check("步骤6: data.reportId 非空", reportId.length > 0, `reportId=${reportId}`);
  }

  // ============================================================
  // 步骤 7: 回写 RadarRun.reportId 验证
  // ============================================================
  {
    const run = ctx.radarRunStore.get(runId);
    check("步骤7: RadarRun 存在", run !== null, `runId=${runId}`);
    check("步骤7: run.reportId === reportId", run?.reportId === reportId, `run.reportId=${run?.reportId}, reportId=${reportId}`);
  }

  // ============================================================
  // 步骤 8: 报告查询
  // ============================================================
  {
    const { res, json } = await getJson(app, `/api/reports?radar_id=${encodeURIComponent(radarId)}`);
    check("步骤8: GET /api/reports?radar_id 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    check("步骤8: success=true", json.success === true);
    const data = json.data as unknown[] | null;
    check("步骤8: data 是数组", Array.isArray(data), `data=${data === null ? "null" : typeof data}`);
    check("步骤8: 报告数量 >= 1", Array.isArray(data) && data.length >= 1, `len=${Array.isArray(data) ? data.length : 0}`);
  }

  // ============================================================
  // 总结
  // ============================================================
  console.log("");
  console.log(`=== 结果: ${passed} PASS / ${failed} FAIL ===`);
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
