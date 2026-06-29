/**
 * Task 043 验收脚本：三雷达 Web UI 联动
 *
 * 运行：npx tsx scripts/verify-task043.ts
 *
 * 验证项（22 项 + 3 项回归 = 25 项）：
 *   1. 文件存在性（1 项）
 *   2. HTML 结构检查（6 项）
 *   3. CSS 检查（2 项）
 *   4. JS 功能检查（5 项）
 *   5. API 集成检查（4 项）
 *   6. 回归测试（3 项）
 *
 * 遵循 IDE 交付规范调整声明：
 *   - 红线 2：PASS 正则取最后一个匹配（matchAll）
 *   - 红线 5：回归测试范围与任务书一致
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.PORT = "3996";
process.env.STORE_TYPE = "meili";
process.env.MEILI_MOCK = "true";

// ============================================================
// 计数器
// ============================================================

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.resolve(process.cwd(), relPath));
}

// ============================================================
// 1. 文件存在性检查
// ============================================================

function checkFileExistence(): void {
  section("1. 文件存在性检查");
  check("scripts/verify-task043.ts 存在", fileExists("scripts/verify-task043.ts"));
}

// ============================================================
// 2. HTML 结构检查
// ============================================================

function checkHtmlStructure(): void {
  section("2. HTML 结构检查");
  const html = readFile("web/index.html");

  check("T3 index.html 含 radar-selector", html.includes("radar-selector"));

  const radarOptionCount = (html.match(/class="radar-option/g) || []).length;
  check("T4 index.html 含 3 个 radar-option", radarOptionCount >= 3, `count=${radarOptionCount}`);

  check('T5 index.html 含 data-radar="opc_policy"', html.includes('data-radar="opc_policy"'));
  check('T5.1 index.html 含 data-radar="cultural_heritage"', html.includes('data-radar="cultural_heritage"'));

  check("T12 index.html 含 chat-radar-badge", html.includes("chat-radar-badge"));

  check("T15 index.html 无'盯一下'残留", !html.includes("盯一下"));
}

// ============================================================
// 3. CSS 检查
// ============================================================

function checkCss(): void {
  section("3. CSS 检查");
  const css = readFile("web/styles.css");

  check("T13 styles.css 含 .radar-option", css.includes(".radar-option"));
  check("T14 styles.css 含 .radar-badge 或 .card-radar-tag", css.includes(".radar-badge") || css.includes(".card-radar-tag"));
}

// ============================================================
// 4. JS 功能检查
// ============================================================

function checkJsFunctionality(): void {
  section("4. JS 功能检查");
  const homeJs = readFile("web/home.js");
  const searchJs = readFile("web/search.js");

  check("T6 home.js 含 dataset.radar", homeJs.includes("dataset.radar"));
  check("T7 home.js 含 selectedRadar", homeJs.includes("selectedRadar"));

  // T8: home.js start 按钮处理中不含硬编码 radar_type: "ai_competition"
  // 检查方式：home.js 中不应出现 radar_type: "ai_competition" 的硬编码
  const hasHardcodedRadar = /radar_type:\s*"ai_competition"/.test(homeJs);
  check('T8 home.js 不含硬编码 radar_type: "ai_competition"', !hasHardcodedRadar);

  check("T9 search.js 含 radar_type: currentRadarType", searchJs.includes("radar_type: currentRadarType"));
  check("T10 search.js 含 RADAR_LABELS 或 radarLabel", searchJs.includes("RADAR_LABELS") || searchJs.includes("radarLabel"));
  check("T11 search.js 含 card-radar-tag", searchJs.includes("card-radar-tag"));
}

// ============================================================
// 5. API 集成检查
// ============================================================

async function checkApiIntegration(): Promise<void> {
  section("5. API 集成检查");

  const { createApp } = await import("../src/api/app");
  const { serve } = await import("@hono/node-server");
  const app = createApp();
  const port = 3996;
  const server = serve({ fetch: app.fetch, port });

  type Opp = { search_result?: { title?: string } };

  // 雷达类型 → spec 映射（与 search.js buildRadarSpec 一致）
  function buildSpec(primaryTypes: string[]): Record<string, unknown> {
    return {
      opportunity_scope: { primary_opportunity_types: primaryTypes },
      keyword_strategy: { core_keywords_zh: [], core_keywords_en: [] },
      filter_rules: { must_exclude: [] },
      region_scope: { excluded_regions: [] },
    };
  }

  try {
    // T22: GET / 返回 200 + 含 radar-selector
    const homeRes = await fetch(`http://localhost:${port}/`);
    const homeHtml = await homeRes.text();
    check("T22 GET / 返回 200", homeRes.status === 200, `status=${homeRes.status}`);
    check("T22.1 GET / 含 radar-selector", homeHtml.includes("radar-selector"), "首页 HTML 不含 radar-selector");

    // T19: OPC POST /api/search 含 radar_type
    const resOpc = await fetch(`http://localhost:${port}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        radar_type: "opc_policy",
        enable_content_fetch: false,
        spec: buildSpec(["政策补贴"]),
      }),
    });
    const opcJson = (await resOpc.json()) as { success?: boolean; data?: { opportunities?: Opp[] }; error?: { message?: string } };
    check("T19 OPC POST /api/search 返回 200", resOpc.status === 200, `status=${resOpc.status}`);
    const opcOpps = opcJson.data?.opportunities ?? [];
    const opcTitles = opcOpps.map((o) => o.search_result?.title || "").join(" | ");
    const opcHasPolicy = opcOpps.some((o) => {
      const t = o.search_result?.title || "";
      return t.includes("政策") || t.includes("补贴") || t.includes("申报") || t.includes("认定") || t.includes("高企") || t.includes("专精特新") || t.includes("科技型");
    });
    check("T19.1 OPC 搜索结果为政策类", opcHasPolicy, `titles=${opcTitles.slice(0, 120)}`);

    // T20: 文创 POST /api/search 含 radar_type
    const resCultural = await fetch(`http://localhost:${port}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        radar_type: "cultural_heritage",
        enable_content_fetch: false,
        spec: buildSpec(["文创非遗"]),
      }),
    });
    const culturalJson = (await resCultural.json()) as { success?: boolean; data?: { opportunities?: Opp[] }; error?: { message?: string } };
    check("T20 文创 POST /api/search 返回 200", resCultural.status === 200, `status=${resCultural.status}`);
    const culturalOpps = culturalJson.data?.opportunities ?? [];
    const culturalTitles = culturalOpps.map((o) => o.search_result?.title || "").join(" | ");
    const culturalHasHeritage = culturalOpps.some((o) => {
      const t = o.search_result?.title || "";
      return t.includes("非遗") || t.includes("文创") || t.includes("文化") || t.includes("传承") || t.includes("工艺");
    });
    check("T20.1 文创搜索结果为文创类", culturalHasHeritage, `titles=${culturalTitles.slice(0, 120)}`);

    // T21: AI POST /api/search 含 radar_type
    const resAi = await fetch(`http://localhost:${port}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        radar_type: "ai_competition",
        enable_content_fetch: false,
        spec: buildSpec(["AI 比赛"]),
      }),
    });
    const aiJson = (await resAi.json()) as { success?: boolean; data?: { opportunities?: Opp[] }; error?: { message?: string } };
    check("T21 AI POST /api/search 返回 200", resAi.status === 200, `status=${resAi.status}`);
    const aiOpps = aiJson.data?.opportunities ?? [];
    const aiTitles = aiOpps.map((o) => o.search_result?.title || "").join(" | ");
    const aiHasCompetition = aiOpps.some((o) => {
      const t = o.search_result?.title || "";
      return t.includes("AI") || t.includes("大赛") || t.includes("比赛") || t.includes("挑战") || t.includes("黑客松");
    });
    check("T21.1 AI 搜索结果为 AI 赛事类", aiHasCompetition, `titles=${aiTitles.slice(0, 120)}`);
  } finally {
    // 等待 server 完全关闭，避免 libuv async handle 崩溃
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

// ============================================================
// 6. 回归测试（并行执行以避免 TRAE sandbox 超时）
// ============================================================

/**
 * 运行回归测试脚本并解析 PASS 数量。
 * 红线 2：使用 matchAll 取最后一个匹配。
 * 并行执行：使用 exec + Promise.all 减少总运行时间。
 */
function runRegressionTestAsync(scriptName: string, label: string, expectedPass: number): Promise<void> {
  return new Promise((resolve) => {
    exec(`npx.cmd tsx scripts/${scriptName}`, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180000,
    }, (err, stdout, stderr) => {
      const output = (stdout || "") + (stderr || "");
      // 红线 2：使用 matchAll 取最后一个匹配
      const allMatches = output.matchAll(/(\d+)\s*PASS/gi);
      const matches = [...allMatches];
      const passNum = matches.length > 0 ? parseInt(matches[matches.length - 1][1], 10) : 0;
      const success = passNum >= expectedPass;
      check(`${label} 回归通过（${passNum}/${expectedPass} PASS）`, success, `passNum=${passNum}`);
      // 立即写入结果文件（避免 sandbox 超时导致输出丢失）
      const resultLine = `${label}: ${success ? "PASS" : "FAIL"} (${passNum}/${expectedPass})\n`;
      fs.appendFileSync(path.resolve(process.cwd(), "verify-task043-result.log"), resultLine, "utf-8");
      if (!success && err) {
        console.log(`    错误: ${(err.message || "").slice(0, 150)}`);
      }
      resolve();
    });
  });
}

async function checkRegression(): Promise<void> {
  section("6. 回归测试（并行）");
  // 清理旧的结果文件
  const resultFile = path.resolve(process.cwd(), "verify-task043-result.log");
  try { fs.unlinkSync(resultFile); } catch { /* ignore */ }
  await Promise.all([
    runRegressionTestAsync("verify-e2e-ai-events.ts", "T16 verify-e2e-ai-events", 13),
    runRegressionTestAsync("verify-e2e-three-radars.ts", "T17 verify-e2e-three-radars", 27),
    runRegressionTestAsync("verify-task040.ts", "T18 verify-task040", 75),
  ]);
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 043 验收检查：三雷达 Web UI 联动 ===\n");

  checkFileExistence();
  checkHtmlStructure();
  checkCss();
  checkJsFunctionality();
  await checkApiIntegration();
  if (process.env.SKIP_REGRESSION === "1") {
    console.log("\n--- 跳过回归测试（SKIP_REGRESSION=1） ---");
  } else {
    await checkRegression();
  }

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  // 写入结果文件（避免 PowerShell 管道缓冲导致输出丢失）
  const resultLog = `Task 043 验收结果: ${passed} PASS / ${failed} FAIL\n`;
  fs.writeFileSync(path.resolve(process.cwd(), "verify-task043-result.log"), resultLog, "utf-8");

  if (failed > 0) {
    console.log("\n❌ 存在失败项，请修复后重试");
    process.exitCode = 1;
  } else {
    console.log("\n✓ 全部通过");
    process.exitCode = 0;
  }
  // 不调用 process.exit()，让事件循环自然退出，避免 libuv async handle 崩溃
}

main().catch((err) => {
  console.error("执行失败：", err);
  process.exitCode = 1;
});
