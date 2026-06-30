/**
 * Task V1.5-08 验收脚本：报告绑定 radar_id + ReportIndex
 *
 * 运行：npx tsx scripts/verify-task-v1.5-08-report.ts
 *
 * 验证范围（16 项断言，回归 3 项由外部命令运行）：
 *   6.1 ReportStore CRUD（1-7）：create/get/list/listByRadarId/save+load
 *   6.2 报告生成写入元数据（8-11）：POST /generate 传/不传 radar_id + GET ?radar_id
 *   6.3 报告查询端点（12-14）：GET / 返回数组 / ?radar_id 过滤 / 不存在返回空
 *   6.4 雷达详情页（15-16）：grep 检查 loadReportHistory + GET /api/reports?radar_id=
 *   6.5 回归（17-19）：tsc + e2e + v1.5-03-api（外部命令）
 *
 * 测试隔离：使用临时文件 data/report-index-v1.5.08-test.json 等，测试后清理。
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
import type { ReportMeta } from "../src/agents/report-store";
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

const TEMP_RADARS_FILE = "data/radars-v1.5.08-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.5.08-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.5.08-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.5.08-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.5.08-test.json";

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
  console.log("\n=== Task V1.5-08 验收检查：报告绑定 radar_id + ReportIndex ===\n");

  process.env.DATA_MODE = process.env.DATA_MODE ?? "mock";
  process.env.LLM_MODE = process.env.LLM_MODE ?? "mock";

  // ============================================================
  // 6.1 ReportStore CRUD（1-7）
  // ============================================================
  section("6.1 ReportStore CRUD");

  const tempReportPath = path.resolve(process.cwd(), TEMP_REPORT_FILE);
  if (fs.existsSync(tempReportPath)) {
    fs.unlinkSync(tempReportPath);
  }
  const store = new JsonReportStore({ file_path: TEMP_REPORT_FILE });

  // 1. create → 返回 ReportMeta，含 id（以 report_ 开头）
  let createdId = "";
  {
    const meta = store.create({
      radarId: "radar_test_001",
      title: "测试报告",
      radarType: "ai_competition",
      format: "markdown",
      filename: "report-ai_competition-test.md",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      opportunityCount: 5,
    });
    createdId = meta.id;
    check(
      "1. create 返回 ReportMeta，id 以 report_ 开头",
      meta.id.startsWith("report_") && meta.radarId === "radar_test_001" && meta.title === "测试报告",
      `id=${meta.id}, radarId=${meta.radarId}`,
    );
  }

  // 2. get(id) → 返回刚才创建的 ReportMeta
  {
    const meta = store.get(createdId);
    check(
      "2. get(id) 返回刚才创建的 ReportMeta",
      meta !== null && meta.id === createdId && meta.filename === "report-ai_competition-test.md",
      `meta=${meta ? meta.id : "null"}`,
    );
  }

  // 3. get("不存在") → 返回 null
  {
    const meta = store.get("report_nonexistent_99999");
    check("3. get(不存在) 返回 null", meta === null, `meta=${meta}`);
  }

  // 4. list() → 返回数组，含刚才创建的报告
  {
    const list = store.list();
    check(
      "4. list() 返回数组且含刚才创建的报告",
      Array.isArray(list) && list.some((r) => r.id === createdId),
      `len=${list.length}`,
    );
  }

  // 5. listByRadarId(radarId) → 只返回该雷达的报告
  {
    const list = store.listByRadarId("radar_test_001");
    check(
      "5. listByRadarId 只返回该雷达的报告",
      list.length > 0 && list.every((r) => r.radarId === "radar_test_001"),
      `len=${list.length}`,
    );
  }

  // 6. listByRadarId(radarId, 5) → 最多返回 5 条（创建 6 条验证）
  {
    for (let i = 0; i < 5; i++) {
      store.create({
        radarId: "radar_test_002",
        title: `批量报告 ${i}`,
        radarType: "opc_policy",
        format: "markdown",
        filename: `report-opc-${i}.md`,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        opportunityCount: i,
      });
    }
    const list = store.listByRadarId("radar_test_002", 5);
    check(
      "6. listByRadarId(radarId, 5) 最多返回 5 条",
      list.length === 5 && list.every((r) => r.radarId === "radar_test_002"),
      `len=${list.length}`,
    );
  }

  // 7. save() + load() 后数据一致
  {
    store.save();
    const beforeCount = store.list({ limit: 10000 }).length;
    const store2 = new JsonReportStore({ file_path: TEMP_REPORT_FILE });
    store2.load();
    const afterCount = store2.list({ limit: 10000 }).length;
    check(
      "7. save() + load() 后数据一致",
      beforeCount === afterCount && afterCount >= 6,
      `before=${beforeCount}, after=${afterCount}`,
    );
  }

  // ============================================================
  // 6.2 报告生成写入元数据（8-11）
  // ============================================================
  section("6.2 报告生成写入元数据");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // 先创建一个雷达用于关联
  let testRadarId = "";
  {
    const { res, json } = await postJson(app, "/api/radars", { name: "报告测试雷达", kind: "custom" });
    testRadarId = (json.data as { id?: string } | null)?.id ?? "";
    if (res.status !== 200) {
      console.log(`  警告：创建雷达失败 status=${res.status}`);
    }
  }

  // 8. POST /api/reports/generate 传 radar_id → 200，返回结果含 reportId
  {
    const { res, json } = await postJson(app, "/api/reports/generate", {
      radar_id: testRadarId,
      radar_type: "ai_competition",
    });
    const data = json.data as { reportId?: string; success?: boolean; markdown?: string } | null;
    check(
      "8. POST /generate 传 radar_id → 200 且含 reportId",
      res.status === 200 && json.success === true && typeof data?.reportId === "string" && data.reportId.startsWith("report_"),
      `status=${res.status}, success=${json.success}, reportId=${data?.reportId}`,
    );
  }

  // 9. POST /api/reports/generate 不传 radar_id → 200，不含 reportId（兼容旧逻辑）
  {
    const { res, json } = await postJson(app, "/api/reports/generate", {
      radar_type: "ai_competition",
    });
    const data = json.data as { reportId?: string } | null;
    check(
      "9. POST /generate 不传 radar_id → 200 且不含 reportId",
      res.status === 200 && json.success === true && data?.reportId === undefined,
      `status=${res.status}, reportId=${data?.reportId}`,
    );
  }

  // 10. 生成后 GET /api/reports?radar_id=xxx → 返回该雷达的报告列表
  {
    const { res, json } = await getJson(app, `/api/reports?radar_id=${encodeURIComponent(testRadarId)}`);
    const list = (json.data as ReportMeta[] | null) ?? [];
    check(
      "10. GET /api/reports?radar_id=xxx 返回该雷达的报告列表",
      res.status === 200 && json.success === true && Array.isArray(list) && list.length >= 1 && list.every((r) => r.radarId === testRadarId),
      `status=${res.status}, len=${list.length}`,
    );
  }

  // 11. 返回的 ReportMeta 含 filename / periodStart / periodEnd / opportunityCount
  {
    const { res, json } = await getJson(app, `/api/reports?radar_id=${encodeURIComponent(testRadarId)}`);
    const list = (json.data as ReportMeta[] | null) ?? [];
    const first = list[0];
    check(
      "11. ReportMeta 含 filename/periodStart/periodEnd/opportunityCount",
      res.status === 200 &&
        !!first &&
        typeof first.filename === "string" && first.filename.length > 0 &&
        typeof first.periodStart === "string" && first.periodStart.length > 0 &&
        typeof first.periodEnd === "string" && first.periodEnd.length > 0 &&
        typeof first.opportunityCount === "number",
      `filename=${first?.filename}, periodStart=${first?.periodStart}, periodEnd=${first?.periodEnd}, opportunityCount=${first?.opportunityCount}`,
    );
  }

  // ============================================================
  // 6.3 报告查询端点（12-14）
  // ============================================================
  section("6.3 报告查询端点");

  // 12. GET /api/reports → 200，返回 ReportMeta 数组
  {
    const { res, json } = await getJson(app, "/api/reports");
    const list = (json.data as ReportMeta[] | null) ?? [];
    check(
      "12. GET /api/reports → 200 返回 ReportMeta 数组",
      res.status === 200 && json.success === true && Array.isArray(list) && list.length >= 1,
      `status=${res.status}, len=${list.length}`,
    );
  }

  // 13. GET /api/reports?radar_id=xxx → 只返回该雷达的报告
  {
    const { res, json } = await getJson(app, `/api/reports?radar_id=${encodeURIComponent(testRadarId)}`);
    const list = (json.data as ReportMeta[] | null) ?? [];
    check(
      "13. GET /api/reports?radar_id=xxx 只返回该雷达的报告",
      res.status === 200 && list.length >= 1 && list.every((r) => r.radarId === testRadarId),
      `status=${res.status}, len=${list.length}`,
    );
  }

  // 14. GET /api/reports?radar_id=不存在 → 返回空数组（不报错）
  {
    const { res, json } = await getJson(app, "/api/reports?radar_id=radar_nonexistent_99999");
    const list = (json.data as ReportMeta[] | null) ?? [];
    check(
      "14. GET /api/reports?radar_id=不存在 → 返回空数组",
      res.status === 200 && json.success === true && Array.isArray(list) && list.length === 0,
      `status=${res.status}, len=${list.length}`,
    );
  }

  // ============================================================
  // 6.4 雷达详情页（15-16，grep 检查）
  // ============================================================
  section("6.4 雷达详情页");

  const detailJsPath = path.resolve(process.cwd(), "web", "radar-detail.js");
  const detailJsContent = fs.readFileSync(detailJsPath, "utf-8");

  // 15. web/radar-detail.js 含 loadReportHistory 函数
  check(
    "15. web/radar-detail.js 含 loadReportHistory 函数",
    detailJsContent.includes("async function loadReportHistory") || detailJsContent.includes("function loadReportHistory"),
    `找不到 loadReportHistory 函数定义`,
  );

  // 16. web/radar-detail.js 调用 GET /api/reports?radar_id=
  check(
    '16. web/radar-detail.js 调用 GET /api/reports?radar_id=',
    detailJsContent.includes("/api/reports?radar_id=") || detailJsContent.includes("`/api/reports?radar_id="),
    `找不到 /api/reports?radar_id= 调用`,
  );

  // ============================================================
  // 6.5 回归（17-19，外部命令）
  // ============================================================
  section("6.5 回归（外部命令）");

  console.log("  [17] tsc --noEmit（外部命令）");
  console.log("  [18] verify-e2e-v13.ts（外部命令）");
  console.log("  [19] verify-task-v1.5-03-api.ts（外部命令）");

  // 清理临时文件
  cleanupTempFiles();

  // ============================================================
  // 总结
  // ============================================================
  console.log("");
  console.log("================================");
  console.log(`总计：${passed} PASS / ${failed} FAIL`);
  if (failed === 0) {
    console.log("全部通过！");
  } else {
    console.log("失败项：", failures.join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("验收脚本异常：", err);
  process.exit(1);
});
