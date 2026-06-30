/**
 * Task V1.6-03 验收脚本：reportId/run_id 强校验
 *
 * 运行：npx tsx scripts/verify-task-v1.6-03-report-validation.ts
 *
 * 验证范围（7 项断言，回归由外部命令运行）：
 *   7.1 只传 run_id → 反查 radarId，创建 ReportMeta，回写 reportId
 *   7.2 只传 radar_id → 创建 ReportMeta，不回写 reportId
 *   7.3 同时传一致的 → 创建 ReportMeta + 回写 reportId
 *   7.4 同时传不一致的 → 400，错误消息含两个 radarId
 *   7.5 传不存在的 run_id → 400，错误消息含 run_id
 *   7.6 都不传 → 不创建 ReportMeta，正常生成报告（向后兼容）
 *   7.7 /export 端点同样适用校验（传不存在的 run_id → 400）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.03-test.json，测试后清理。
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

const TEMP_RADARS_FILE = "data/radars-v1.6.03-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.6.03-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.6.03-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.6.03-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.6.03-test.json";

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

/** 解析响应 */
async function parseResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

// ============================================================
// 主测试
// ============================================================

async function main(): Promise<void> {
  console.log("Task V1.6-03 验收：reportId/run_id 强校验");
  console.log("================================");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 准备：创建雷达 + 激活 + 运行 → 得到 radar_id 和两个 run_id
  // ============================================================
  section("准备：创建雷达 + 激活 + 运行");

  let radarId: string | undefined;
  let runId1: string | undefined;
  let runId2: string | undefined;

  // 创建自定义雷达
  {
    const res = await app.request("/api/radars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "V1.6-03 测试雷达", kind: "custom" }),
    });
    const json = await parseResponse(res);
    const radar = json.data as { id?: string } | null;
    radarId = radar?.id;
    check("0.1 创建自定义雷达", res.status === 200 && typeof radarId === "string", `status=${res.status}, id=${radarId}`);
  }

  // 激活雷达
  {
    const res = await app.request(`/api/radars/${radarId}/activate`, { method: "POST" });
    const json = await parseResponse(res);
    const radar = json.data as { status?: string } | null;
    check("0.2 激活雷达", res.status === 200 && radar?.status === "active", `status=${res.status}`);
  }

  // 运行雷达第一次 → runId1
  {
    const res = await app.request(`/api/radars/${radarId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "AI比赛" }),
    });
    const json = await parseResponse(res);
    const data = json.data as { run?: { id?: string } } | null;
    runId1 = data?.run?.id;
    check("0.3 运行雷达（第一次）→ runId1", res.status === 200 && typeof runId1 === "string", `status=${res.status}, runId1=${runId1}`);
  }

  // 运行雷达第二次 → runId2
  {
    const res = await app.request(`/api/radars/${radarId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "AI赛事" }),
    });
    const json = await parseResponse(res);
    const data = json.data as { run?: { id?: string } } | null;
    runId2 = data?.run?.id;
    check("0.4 运行雷达（第二次）→ runId2", res.status === 200 && typeof runId2 === "string", `status=${res.status}, runId2=${runId2}`);
  }

  // ============================================================
  // 7.1 只传 run_id → 反查 radarId，创建 ReportMeta，回写 reportId
  // ============================================================
  section("7.1 只传 run_id → 反查 radarId");

  let reportId1: string | undefined;
  {
    const res = await app.request("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId1 }),
    });
    const json = await parseResponse(res);
    const data = json.data as { reportId?: string } | null;
    reportId1 = data?.reportId;
    const okStatus = res.status === 200;
    const hasReportId = typeof reportId1 === "string" && reportId1.length > 0;
    check(
      "1. POST /generate { run_id } → 200 且含 reportId",
      okStatus && hasReportId,
      `status=${res.status}, reportId=${reportId1}`,
    );

    // 检查 ReportMeta.radarId === radarId（反查）
    const meta = reportId1 ? ctx.reportStore.get(reportId1) : null;
    check(
      "1.1 ReportMeta.radarId === radarId（反查成功）",
      meta !== null && meta.radarId === radarId,
      `meta.radarId=${meta?.radarId}, expected=${radarId}`,
    );

    // 检查 RadarRun.reportId 已回写
    const run = runId1 ? ctx.radarRunStore.get(runId1) : null;
    check(
      "1.2 RadarRun.reportId 已回写",
      run !== null && run.reportId === reportId1,
      `run.reportId=${run?.reportId}, expected=${reportId1}`,
    );
  }

  // ============================================================
  // 7.2 只传 radar_id → 创建 ReportMeta，不回写 reportId
  // ============================================================
  section("7.2 只传 radar_id → 不回写 reportId");

  let reportId2: string | undefined;
  {
    const res = await app.request("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ radar_id: radarId }),
    });
    const json = await parseResponse(res);
    const data = json.data as { reportId?: string } | null;
    reportId2 = data?.reportId;
    const okStatus = res.status === 200;
    const hasReportId = typeof reportId2 === "string" && reportId2.length > 0;
    check(
      "2. POST /generate { radar_id } → 200 且含 reportId",
      okStatus && hasReportId,
      `status=${res.status}, reportId=${reportId2}`,
    );

    // 检查 runId2 的 reportId 未被回写（仍为 undefined）
    const run = runId2 ? ctx.radarRunStore.get(runId2) : null;
    check(
      "2.1 RadarRun.reportId 未回写（runId2 仍无 reportId）",
      run !== null && run.reportId === undefined,
      `run.reportId=${run?.reportId}`,
    );
  }

  // ============================================================
  // 7.3 同时传一致的 → 创建 ReportMeta + 回写 reportId
  // ============================================================
  section("7.3 同时传一致的 → 创建 + 回写");

  let reportId3: string | undefined;
  {
    const res = await app.request("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ radar_id: radarId, run_id: runId2 }),
    });
    const json = await parseResponse(res);
    const data = json.data as { reportId?: string } | null;
    reportId3 = data?.reportId;
    const okStatus = res.status === 200;
    const hasReportId = typeof reportId3 === "string" && reportId3.length > 0;
    check(
      "3. POST /generate { radar_id, run_id 一致 } → 200 且含 reportId",
      okStatus && hasReportId,
      `status=${res.status}, reportId=${reportId3}`,
    );

    // 检查 runId2 的 reportId 已回写为 reportId3
    const run = runId2 ? ctx.radarRunStore.get(runId2) : null;
    check(
      "3.1 RadarRun.reportId 已回写（runId2.reportId === reportId3）",
      run !== null && run.reportId === reportId3,
      `run.reportId=${run?.reportId}, expected=${reportId3}`,
    );
  }

  // ============================================================
  // 7.4 同时传不一致的 → 400，错误消息含两个 radarId
  // ============================================================
  section("7.4 同时传不一致的 → 400");

  {
    const res = await app.request("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ radar_id: "wrong_radar_id", run_id: runId1 }),
    });
    const json = await parseResponse(res);
    const errorMsg = json.error?.message ?? "";
    check(
      "4. POST /generate { radar_id, run_id 不一致 } → 400 BAD_REQUEST",
      res.status === 400 && json.success === false && json.error?.code === "BAD_REQUEST",
      `status=${res.status}, code=${json.error?.code}`,
    );
    check(
      "4.1 错误消息含两个 radarId（wrong_radar_id 和真实的）",
      errorMsg.includes("wrong_radar_id") && errorMsg.includes(radarId ?? ""),
      `message=${errorMsg}`,
    );
  }

  // ============================================================
  // 7.5 传不存在的 run_id → 400，错误消息含 run_id
  // ============================================================
  section("7.5 传不存在的 run_id → 400");

  {
    const nonexistentRunId = "run_nonexistent_99999";
    const res = await app.request("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: nonexistentRunId }),
    });
    const json = await parseResponse(res);
    const errorMsg = json.error?.message ?? "";
    check(
      "5. POST /generate { run_id 不存在 } → 400 BAD_REQUEST",
      res.status === 400 && json.success === false && json.error?.code === "BAD_REQUEST",
      `status=${res.status}, code=${json.error?.code}`,
    );
    check(
      "5.1 错误消息含 run_id",
      errorMsg.includes(nonexistentRunId),
      `message=${errorMsg}`,
    );
  }

  // ============================================================
  // 7.6 都不传 → 不创建 ReportMeta，正常生成报告（向后兼容）
  // ============================================================
  section("7.6 都不传 → 向后兼容");

  {
    const reportsBefore = ctx.reportStore.list().length;
    const res = await app.request("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await parseResponse(res);
    const data = json.data as { reportId?: string } | null;
    const reportsAfter = ctx.reportStore.list().length;
    check(
      "6. POST /generate {} → 200 正常生成报告",
      res.status === 200 && json.success === true,
      `status=${res.status}, success=${json.success}`,
    );
    check(
      "6.1 不创建 ReportMeta（reportId 为 undefined）",
      data?.reportId === undefined,
      `reportId=${data?.reportId}`,
    );
    check(
      "6.2 ReportStore 数量不变",
      reportsAfter === reportsBefore,
      `before=${reportsBefore}, after=${reportsAfter}`,
    );
  }

  // ============================================================
  // 7.7 /export 端点同样适用校验（传不存在的 run_id → 400）
  // ============================================================
  section("7.7 /export 端点校验");

  {
    const nonexistentRunId = "run_nonexistent_export_99999";
    const res = await app.request("/api/reports/export?format=markdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: nonexistentRunId }),
    });
    const json = await parseResponse(res);
    const errorMsg = json.error?.message ?? "";
    check(
      "7. POST /export { run_id 不存在 } → 400 BAD_REQUEST",
      res.status === 400 && json.success === false && json.error?.code === "BAD_REQUEST",
      `status=${res.status}, code=${json.error?.code}`,
    );
    check(
      "7.1 错误消息含 run_id",
      errorMsg.includes(nonexistentRunId),
      `message=${errorMsg}`,
    );
  }

  // 清理
  cleanupTempFiles();

  // ============================================================
  // 汇总
  // ============================================================
  console.log("");
  console.log("================================");
  console.log(`总计：${passed} PASS / ${failed} FAIL`);
  if (failed > 0) {
    console.log("失败项：");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  } else {
    console.log("全部通过！");
  }
}

main().catch((err) => {
  console.error("验收脚本异常:", err);
  process.exit(1);
});
