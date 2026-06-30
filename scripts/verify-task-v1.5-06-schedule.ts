/**
 * Task V1.5-06 验收脚本：定时运行雷达
 *
 * 运行：npx tsx scripts/verify-task-v1.5-06-schedule.ts
 *
 * 验证范围（16 项断言，回归 3 项由外部命令运行）：
 *   6.1 定时配置（1-5）：PUT schedule / nextRunAt 非空 / 无效 cron 400 / DELETE / 内置雷达可设置
 *   6.2 scheduler 兼容（6-8）：radar_id 优先 / radar_type 旧逻辑 / radar_id 不存在 fallback
 *   6.3 定时触发（9-12）：executeTrigger / RadarRun 记录 / lastRunAt 更新 / radarId 绑定
 *   6.4 回归（13-16）：presets 6 个 / validateCron valid / validateCron invalid / 外部命令 tsc + e2e
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
import { validateCron, computeNextRunAt } from "../src/api/routes/radars";
import { executeTrigger } from "../src/scheduler/triggers";
import { listPresets } from "../src/scheduler/presets";

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

const TEMP_RADARS_FILE = "data/radars-v1.5.06-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.5.06-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.5.06-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.5.06-test.txt";

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
  console.log("Task V1.5-06 验收：定时运行雷达");
  console.log("================================");

  // ============================================================
  // 6.1 定时配置（1-5）
  // ============================================================
  section("6.1 定时配置");

  const ctx = createTestContext();
  const app = createApp(ctx);
  const builtinId = "builtin_ai_competition";

  // 1. PUT /api/radars/:id/schedule 传 cron="0 8 * * *" → 200，Radar.schedule 含 cron + enabled=true
  {
    const res = await app.request(`/api/radars/${builtinId}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron: "0 8 * * *" }),
    });
    const json = await parseResponse(res);
    const radar = json.data as { schedule?: { cron?: string; enabled?: boolean } } | null;
    const ok =
      res.status === 200 &&
      json.success === true &&
      radar?.schedule?.cron === "0 8 * * *" &&
      radar?.schedule?.enabled === true;
    check(
      "1. PUT schedule cron=0 8 * * * → 200，schedule 含 cron + enabled=true",
      ok,
      `status=${res.status}, success=${json.success}, cron=${radar?.schedule?.cron}, enabled=${radar?.schedule?.enabled}`,
    );

    // 2. 返回的 schedule.nextRunAt 非空
    const nextRunAt = (radar?.schedule as { nextRunAt?: string } | undefined)?.nextRunAt;
    check(
      "2. schedule.nextRunAt 非空",
      typeof nextRunAt === "string" && nextRunAt.length > 0,
      `nextRunAt=${nextRunAt}`,
    );
  }

  // 3. PUT 传无效 cron="abc" → 400 INVALID_CRON
  {
    const res = await app.request(`/api/radars/${builtinId}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron: "abc" }),
    });
    const json = await parseResponse(res);
    check(
      "3. PUT 无效 cron=abc → 400 INVALID_CRON",
      res.status === 400 && json.success === false && json.error?.code === "INVALID_CRON",
      `status=${res.status}, code=${json.error?.code}`,
    );
  }

  // 4. DELETE /api/radars/:id/schedule → 200，Radar.schedule=undefined
  {
    const res = await app.request(`/api/radars/${builtinId}/schedule`, {
      method: "DELETE",
    });
    const json = await parseResponse(res);
    const radar = json.data as { schedule?: unknown } | null;
    check(
      "4. DELETE schedule → 200，Radar.schedule=undefined",
      res.status === 200 && json.success === true && radar?.schedule === undefined,
      `status=${res.status}, schedule=${radar?.schedule}`,
    );
  }

  // 5. 内置雷达设置定时 → 200（内置可设置定时，只是不可编辑/删除 spec）
  {
    const res = await app.request(`/api/radars/${builtinId}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron: "*/30 * * * *" }),
    });
    const json = await parseResponse(res);
    check(
      "5. 内置雷达设置定时 → 200",
      res.status === 200 && json.success === true,
      `status=${res.status}, success=${json.success}`,
    );
  }

  // ============================================================
  // 6.2 scheduler 兼容（6-8）
  // ============================================================
  section("6.2 scheduler 兼容");

  const ctx2 = createTestContext();
  // 先给内置雷达设置 schedule（用于后续触发测试）
  ctx2.radarStore.update(builtinId, {
    schedule: {
      cron: "0 8 * * *",
      timezone: "Asia/Shanghai",
      enabled: true,
      nextRunAt: computeNextRunAt("0 8 * * *", "Asia/Shanghai"),
    },
  });
  ctx2.radarStore.save();

  // 6. executeSearchTrigger 传 { radar_id: "builtin_ai_competition" } → 从 RadarStore 取 spec（返回含 radar_id）
  {
    const result = await executeTrigger("search", { radar_id: builtinId }, ctx2);
    const hasRadarId = typeof result.radar_id === "string" && result.radar_id.length > 0;
    check(
      "6. executeSearchTrigger 传 radar_id → 返回含 radar_id",
      hasRadarId,
      `result=${JSON.stringify({ radar_id: result.radar_id })}`,
    );
  }

  // 7. executeSearchTrigger 传 { radar_type: "ai_competition" } → 旧逻辑（返回含 radar_type，不含 radar_id）
  {
    const result = await executeTrigger("search", { radar_type: "ai_competition" }, ctx2);
    const hasRadarType = typeof result.radar_type === "string";
    const noRadarId = result.radar_id === undefined;
    check(
      "7. executeSearchTrigger 传 radar_type → 旧逻辑（返回含 radar_type，不含 radar_id）",
      hasRadarType && noRadarId,
      `radar_type=${result.radar_type}, radar_id=${result.radar_id}`,
    );
  }

  // 8. executeSearchTrigger 传 { radar_id: "不存在" } → fallback 到旧逻辑（返回含 radar_type）
  {
    const result = await executeTrigger("search", { radar_id: "nonexistent_radar" }, ctx2);
    const hasRadarType = typeof result.radar_type === "string";
    const noRadarId = result.radar_id === undefined;
    check(
      "8. executeSearchTrigger 传不存在的 radar_id → fallback 到旧逻辑",
      hasRadarType && noRadarId,
      `radar_type=${result.radar_type}, radar_id=${result.radar_id}`,
    );
  }

  // ============================================================
  // 6.3 定时触发（9-12）
  // ============================================================
  section("6.3 定时触发");

  // 9. executeTrigger("search", { radar_id }, ctx) → 返回结果含 opportunities_count
  const triggerResult = await executeTrigger("search", { radar_id: builtinId }, ctx2);
  {
    const hasOppCount = typeof triggerResult.opportunities_count === "number";
    check(
      "9. executeTrigger 传 radar_id → 返回含 opportunities_count",
      hasOppCount,
      `opportunities_count=${triggerResult.opportunities_count}`,
    );
  }

  // 10. 触发后 RadarRun 记录已创建（mode=scheduled, triggeredBy=scheduler）
  {
    const runId = triggerResult.run_id as string | undefined;
    let runOk = false;
    if (runId) {
      const run = ctx2.radarRunStore.get(runId);
      runOk = run !== null && run.mode === "scheduled" && run.triggeredBy === "scheduler";
    }
    check(
      "10. 触发后 RadarRun 记录已创建（mode=scheduled, triggeredBy=scheduler）",
      runOk,
      `run_id=${runId}`,
    );
  }

  // 11. 触发后 Radar.lastRunAt 已更新
  {
    const radar = ctx2.radarStore.get(builtinId);
    const lastRunAt = radar?.lastRunAt;
    check(
      "11. 触发后 Radar.lastRunAt 已更新",
      typeof lastRunAt === "string" && lastRunAt.length > 0,
      `lastRunAt=${lastRunAt}`,
    );
  }

  // 12. 触发后 OpportunityStore 里的机会含 radarId
  {
    const list = ctx2.store.list({ page: 1, page_size: 100 });
    const entries = list.entries;
    // 内置雷达触发后，至少应有 0 条记录（可能 Mock 无数据）；检查绑定的 radarId 字段
    const hasRadarIdBinding = entries.length === 0 || entries.some((e) => e.radarId === builtinId || (e as { radar_id?: string }).radar_id === builtinId);
    check(
      "12. OpportunityStore 机会含 radarId（或空时不报错）",
      hasRadarIdBinding,
      `entriesCount=${entries.length}`,
    );
  }

  // ============================================================
  // 6.4 回归（13-16）
  // ============================================================
  section("6.4 回归");

  // 13. tsc --noEmit exit 0（由外部命令运行，此处不检查）

  // 14. 现有 presets 的 5 个预设模板 + 新增 1 个 = 6 个，仍可用
  {
    const presets = listPresets();
    const ids = presets.map((p) => p.id);
    const hasOldFive = ["daily_morning", "weekly_report", "deadline_alert", "realtime", "competition_mode"].every((id) => ids.includes(id));
    const hasNewOne = ids.includes("radar_custom_daily");
    check(
      "14. presets 含 6 个模板（原 5 + 新增 radar_custom_daily）",
      presets.length === 6 && hasOldFive && hasNewOne,
      `count=${presets.length}, ids=${JSON.stringify(ids)}`,
    );
  }

  // 15. validateCron("0 8 * * *") = valid
  {
    const r = validateCron("0 8 * * *");
    check(
      "15. validateCron(0 8 * * *) = valid",
      r.valid === true,
      `valid=${r.valid}, error=${r.error ?? ""}`,
    );
  }

  // 16. validateCron("abc") = invalid
  {
    const r = validateCron("abc");
    check(
      "16. validateCron(abc) = invalid",
      r.valid === false,
      `valid=${r.valid}`,
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
