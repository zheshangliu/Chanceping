/**
 * Task V1.5-07 验收脚本：雷达数量限制
 *
 * 运行：npx tsx scripts/verify-task-v1.5-07-quota.ts
 *
 * 验证范围（16 项断言，回归 3 项由外部命令运行）：
 *   6.1 配额常量（1-4）：free/basic/pro/enterprise
 *   6.2 getCurrentUser（5-6）：userId=demo_user / plan=free
 *   6.3 RadarQuotaChecker（7-10）：初始 allowed / 创建后 not allowed / 归档后 allowed / 内置不计入
 *   6.4 API 端点（11-13）：第1次 POST 200 / 第2次 POST 403 / 归档后 POST 200
 *   6.5 回归（14-16）：tsc + e2e + v1.5-03-api（外部命令）
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
import type { ApiResponse } from "../src/api/types";
import { RADAR_QUOTA, getCurrentUser } from "../src/agents/user-context";
import { RadarQuotaChecker } from "../src/agents/radar-quota";

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

const TEMP_RADARS_FILE = "data/radars-v1.5.07-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.5.07-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.5.07-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.5.07-test.txt";

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

  return {
    llmAdapter: modelRouter,
    store,
    starManager,
    watchStore,
    conversations: new Map(),
    radarStore,
    radarRunStore,
    radarRegistry,
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

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task V1.5-07 验收检查：雷达数量限制 ===\n");

  process.env.DATA_MODE = process.env.DATA_MODE ?? "mock";
  process.env.LLM_MODE = process.env.LLM_MODE ?? "mock";

  // ============================================================
  // 6.1 配额常量（1-4）
  // ============================================================
  section("6.1 配额常量");

  check("1. RADAR_QUOTA.free = 1", RADAR_QUOTA.free === 1, `actual=${RADAR_QUOTA.free}`);
  check("2. RADAR_QUOTA.basic = 3", RADAR_QUOTA.basic === 3, `actual=${RADAR_QUOTA.basic}`);
  check("3. RADAR_QUOTA.pro = 10", RADAR_QUOTA.pro === 10, `actual=${RADAR_QUOTA.pro}`);
  check("4. RADAR_QUOTA.enterprise = 50", RADAR_QUOTA.enterprise === 50, `actual=${RADAR_QUOTA.enterprise}`);

  // ============================================================
  // 6.2 getCurrentUser（5-6）
  // ============================================================
  section("6.2 getCurrentUser");

  const user = getCurrentUser();
  check("5. getCurrentUser().userId = demo_user", user.userId === "demo_user", `actual=${user.userId}`);
  check("6. getCurrentUser().plan = free", user.plan === "free", `actual=${user.plan}`);

  // ============================================================
  // 6.3 RadarQuotaChecker（7-10）
  // ============================================================
  section("6.3 RadarQuotaChecker");

  const ctx = createTestContext();

  // 7. 初始状态（0 个自定义雷达）→ allowed=true, current=0, quota=1
  {
    const checker = new RadarQuotaChecker(ctx.radarStore);
    const result = checker.check(user);
    check(
      "7. 初始状态 allowed=true, current=0, quota=1",
      result.allowed === true && result.current === 0 && result.quota === 1,
      `allowed=${result.allowed}, current=${result.current}, quota=${result.quota}`,
    );
  }

  // 8. 创建 1 个自定义雷达后 → allowed=false, current=1, quota=1
  let createdRadarId: string | null = null;
  {
    const created = ctx.radarRegistry.createCustomRadar({
      name: "配额测试雷达",
      kind: "custom",
    });
    createdRadarId = created.id;
    ctx.radarStore.save();

    const checker = new RadarQuotaChecker(ctx.radarStore);
    const result = checker.check(user);
    check(
      "8. 创建 1 个后 allowed=false, current=1, quota=1",
      result.allowed === false && result.current === 1 && result.quota === 1,
      `allowed=${result.allowed}, current=${result.current}, quota=${result.quota}`,
    );
  }

  // 9. 归档该雷达后 → allowed=true, current=0（归档不计入）
  {
    ctx.radarRegistry.archiveRadar(createdRadarId!);
    ctx.radarStore.save();

    const checker = new RadarQuotaChecker(ctx.radarStore);
    const result = checker.check(user);
    check(
      "9. 归档后 allowed=true, current=0",
      result.allowed === true && result.current === 0,
      `allowed=${result.allowed}, current=${result.current}`,
    );
  }

  // 10. 内置雷达不计入配额（有 3 个内置，仍 allowed=true）
  {
    const checker = new RadarQuotaChecker(ctx.radarStore);
    const result = checker.check(user);
    const builtinCount = ctx.radarStore.list({ isBuiltin: true }).length;
    check(
      "10. 内置雷达不计入配额（3 个内置仍 allowed=true）",
      result.allowed === true && result.current === 0 && builtinCount === 3,
      `allowed=${result.allowed}, current=${result.current}, builtinCount=${builtinCount}`,
    );
  }

  // ============================================================
  // 6.4 API 端点（11-13）
  // ============================================================
  section("6.4 API 端点");

  // 使用新的干净 context（已含 3 个内置雷达，0 个自定义）
  const ctx2 = createTestContext();
  const app = createApp(ctx2);

  // 11. 第 1 次 POST /api/radars 创建自定义雷达 → 200
  let firstRadarId: string | null = null;
  {
    const res = await app.request("/api/radars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "第一个雷达", kind: "custom" }),
    });
    const json = await parseResponse(res);
    firstRadarId = (json.data as { id?: string } | null)?.id ?? null;
    check(
      "11. 第 1 次 POST /api/radars 创建自定义雷达 → 200",
      res.status === 200 && json.success === true,
      `status=${res.status}, success=${json.success}`,
    );
  }

  // 12. 第 2 次 POST /api/radars 创建自定义雷达 → 403 RADAR_QUOTA_EXCEEDED
  {
    const res = await app.request("/api/radars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "第二个雷达", kind: "custom" }),
    });
    const json = await parseResponse(res);
    check(
      "12. 第 2 次 POST /api/radars → 403 RADAR_QUOTA_EXCEEDED",
      res.status === 403 && json.success === false && json.error?.code === "RADAR_QUOTA_EXCEEDED",
      `status=${res.status}, success=${json.success}, code=${json.error?.code}`,
    );
  }

  // 13. 归档第 1 个后，再次 POST /api/radars → 200（配额释放）
  {
    const delRes = await app.request(`/api/radars/${firstRadarId}`, { method: "DELETE" });
    const delJson = await parseResponse(delRes);
    check(
      "13a. 归档第 1 个雷达 → 200",
      delRes.status === 200 && delJson.success === true,
      `status=${delRes.status}`,
    );

    const res = await app.request("/api/radars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "替换雷达", kind: "custom" }),
    });
    const json = await parseResponse(res);
    check(
      "13b. 归档后再次 POST /api/radars → 200（配额释放）",
      res.status === 200 && json.success === true,
      `status=${res.status}, success=${json.success}`,
    );
  }

  // ============================================================
  // 6.5 回归（14-16，外部命令）
  // ============================================================
  section("6.5 回归（外部命令）");

  console.log("  [14] tsc --noEmit（外部命令）");
  console.log("  [15] verify-e2e-v13.ts（外部命令）");
  console.log("  [16] verify-task-v1.5-03-api.ts（外部命令）");

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
