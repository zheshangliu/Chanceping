/**
 * Task V1.5-04 验收脚本：最简 UI
 *
 * 运行：npx tsx scripts/verify-task-v1.5-04-ui.ts
 *
 * 验证范围（19 项断言）：
 *   6.1 文件存在性（1-2）
 *   6.2 HTML 元素（3-6）
 *   6.3 JS 函数存在性 + API 调用（7-14）
 *   6.4 CSS 样式（15-16）
 *   6.5 API 集成 - Hono app.request 测试（17-18）
 *   6.6 回归 tsc（19）；其余回归由外部命令运行
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

const TEMP_RADARS_FILE = "data/radars-v1.5.04-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.5.04-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.5.04-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.5.04-test.txt";

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
// 读取文件内容辅助
// ============================================================

function readFileText(relPath: string): string {
  const abs = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf-8");
}

function fileExists(relPath: string): boolean {
  const abs = path.resolve(process.cwd(), relPath);
  return fs.existsSync(abs);
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
  console.log("\n=== Task V1.5-04 验收检查：最简 UI ===\n");

  // 确保 mock 模式
  process.env.DATA_MODE = process.env.DATA_MODE ?? "mock";
  process.env.LLM_MODE = process.env.LLM_MODE ?? "mock";

  // ============================================================
  // 6.1 文件存在性（1-2）
  // ============================================================
  section("6.1 文件存在性");

  check("1. web/radars.js 存在", fileExists("web/radars.js"));
  check("2. web/radar-detail.js 存在", fileExists("web/radar-detail.js"));

  // ============================================================
  // 6.2 HTML 元素（3-6）
  // ============================================================
  section("6.2 HTML 元素");

  const indexHtml = readFileText("web/index.html");
  check("3. index.html 含 data-tab=\"radars\"（导航 Tab）", indexHtml.includes('data-tab="radars"'));
  check("4. index.html 含 id=\"panel-radars\"（内容面板）", indexHtml.includes('id="panel-radars"'));
  check("5. index.html 引入 radars.js", indexHtml.includes("/radars.js"));
  check("6. index.html 引入 radar-detail.js", indexHtml.includes("/radar-detail.js"));

  // ============================================================
  // 6.3 JS 函数存在性 + API 调用（7-14）
  // ============================================================
  section("6.3 JS 函数存在性 + API 调用");

  const radarsJs = readFileText("web/radars.js");
  const radarDetailJs = readFileText("web/radar-detail.js");

  check("7. radars.js 含 loadRadarList 函数", /function\s+loadRadarList\b|loadRadarList\s*=\s*async function|window\.loadRadarList\s*=/.test(radarsJs) && radarsJs.includes("loadRadarList"));
  check("8. radars.js 含 renderRadarCards 函数", radarsJs.includes("renderRadarCards") && /function\s+renderRadarCards|renderRadarCards\s*=/.test(radarsJs));
  check("9. radars.js 含 openCreateModal 或 submitCreate 函数", radarsJs.includes("openCreateModal") || radarsJs.includes("submitCreate"));
  check("10. radars.js 调用 GET /api/radars", radarsJs.includes("fetch(\"/api/radars\")") || radarsJs.includes("fetch('/api/radars')"));
  check("11. radars.js 调用 POST /api/radars", /fetch\(["'`]\/api\/radars["'`],\s*\{\s*method:\s*["'`]POST/.test(radarsJs));

  check("12. radar-detail.js 含 loadRadarDetail 函数", radarDetailJs.includes("loadRadarDetail") && /function\s+loadRadarDetail|loadRadarDetail\s*=/.test(radarDetailJs));
  check("13. radar-detail.js 含 runRadar 函数", radarDetailJs.includes("runRadar") && /function\s+runRadar|runRadar\s*=/.test(radarDetailJs));
  check("14. radar-detail.js 调用 POST /api/radars/:id/run", /fetch\(`\/api\/radars\/\$\{[^}]+\}\/run`/.test(radarDetailJs) || /\/api\/radars\/.+\/run/.test(radarDetailJs));

  // ============================================================
  // 6.4 CSS 样式（15-16）
  // ============================================================
  section("6.4 CSS 样式");

  const stylesCss = readFileText("web/styles.css");
  check("15. styles.css 含 .radar-card 样式", stylesCss.includes(".radar-card"));
  // 状态颜色：draft/active/paused/archived 对应颜色
  const hasDraftColor = stylesCss.includes("status-draft") && (stylesCss.includes("#888") || /status-draft[^}]*background/.test(stylesCss));
  const hasActiveColor = stylesCss.includes("status-active") && /status-active[^}]*background/.test(stylesCss);
  const hasPausedColor = stylesCss.includes("status-paused") && /status-paused[^}]*background/.test(stylesCss);
  const hasArchivedColor = stylesCss.includes("status-archived") && /status-archived[^}]*background/.test(stylesCss);
  check(
    "16. styles.css 含状态颜色（draft/active/paused/archived）",
    hasDraftColor && hasActiveColor && hasPausedColor && hasArchivedColor,
    `draft=${hasDraftColor} active=${hasActiveColor} paused=${hasPausedColor} archived=${hasArchivedColor}`,
  );

  // ============================================================
  // 6.5 API 集成 - Hono app.request 测试（17-18）
  // ============================================================
  section("6.5 API 集成");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // 17. GET /api/radars 返回的雷达数据能被 radars.js 正确渲染（字段名匹配）
  {
    const res = await app.request("/api/radars", { method: "GET" });
    const json = await parseResponse(res);
    check("17. GET /api/radars 返回 200", res.status === 200, `status=${res.status}`);
    check("17.1 success=true", json.success === true);
    const radars = (json.data as Array<Record<string, unknown>>) || [];
    check("17.2 返回数组", Array.isArray(radars) && radars.length > 0, `len=${radars.length}`);

    // radars.js 渲染依赖的字段：id / name / kind / status / isBuiltin / providerRouting / lastRunAt / lastRunStatus
    const sample = radars[0] || {};
    const hasId = "id" in sample;
    const hasName = "name" in sample;
    const hasKind = "kind" in sample;
    const hasStatus = "status" in sample;
    const hasIsBuiltin = "isBuiltin" in sample;
    check(
      "17.3 雷达字段匹配 radars.js 渲染需求（id/name/kind/status/isBuiltin）",
      hasId && hasName && hasKind && hasStatus && hasIsBuiltin,
      `id=${hasId} name=${hasName} kind=${hasKind} status=${hasStatus} isBuiltin=${hasIsBuiltin}`,
    );
  }

  // 18. POST /api/radars/:id/run 返回的 opportunities 含 radarId
  {
    // 先创建一个自定义雷达并激活
    const createRes = await app.request("/api/radars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "UI 测试雷达", kind: "custom" }),
    });
    const createJson = await parseResponse(createRes);
    const radarId = (createJson.data as { id?: string })?.id ?? "";

    const activateRes = await app.request(`/api/radars/${radarId}/activate`, { method: "POST" });
    check("18. 激活雷达返回 200", activateRes.status === 200, `status=${activateRes.status}`);

    const runRes = await app.request(`/api/radars/${radarId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const runJson = await parseResponse(runRes);
    check("18.1 POST /api/radars/:id/run 返回 200", runRes.status === 200, `status=${runRes.status}, msg=${runJson.error?.message}`);

    const data = runJson.data as { opportunities?: Array<{ radarId?: string }> } | null;
    const opportunities = data?.opportunities ?? [];
    check(
      "18.2 返回的 opportunities 含 radarId",
      opportunities.length > 0 && opportunities.every((o) => o.radarId === radarId),
      `len=${opportunities.length}, missing=${opportunities.filter((o) => !o.radarId).length}`,
    );
  }

  // ============================================================
  // 6.6 回归 - tsc（19）；其余回归由外部命令运行
  // ============================================================
  section("6.6 回归 - tsc 由外部命令运行（此处跳过，回归脚本：verify-e2e-v13.ts + verify-task-v1.5-03-api.ts）");

  // 清理临时文件
  cleanupTempFiles();

  // ============================================================
  // 总结
  // ============================================================
  console.log("");
  console.log("=== 验收结果（V1.5-04 UI 部分 1-18）===");
  console.log(`PASS: ${passed} / FAIL: ${failed}`);
  if (failures.length > 0) {
    console.log("失败项：");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("验收脚本执行失败：", err);
  cleanupTempFiles();
  process.exit(1);
});
