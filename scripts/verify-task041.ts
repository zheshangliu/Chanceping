/**
 * Task 041 验收脚本：演示脚本 + Demo Mode + 浏览器 E2E
 *
 * 运行：npx tsx scripts/verify-task041.ts
 *
 * 验证项（28 项 + 2 项回归）：
 *   1. 文件存在性检查（4 个新增）
 *   2. 演示剧本检查（6 项）
 *   3. Demo Mode 启动脚本检查（4 项）
 *   4. 浏览器 E2E 脚本检查（8 项）
 *   5. UI 标识检查（2 项）
 *   6. package.json 检查（3 项）
 *   7. API 集成检查（3 项）
 *   8. 回归测试（2 项）
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

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

// ============================================================
// 文件读取辅助
// ============================================================

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
  check("T3 docs/演示剧本.md 存在", fileExists("docs/演示剧本.md"));
  check("T8 scripts/demo-start.ts 存在", fileExists("scripts/demo-start.ts"));
  check("T10 scripts/verify-e2e-web-demo.ts 存在", fileExists("scripts/verify-e2e-web-demo.ts"));
  check("scripts/verify-task041.ts 存在", fileExists("scripts/verify-task041.ts"));
}

// ============================================================
// 2. 演示剧本检查
// ============================================================

function checkDemoScript(): void {
  section("2. 演示剧本检查");
  const md = readFile("docs/演示剧本.md");

  check("T4 含'3 分钟'", md.includes("3 分钟"));
  check("T5 含 7 个时间点（0:00 / 0:30 / 1:00 / 1:30 / 2:00 / 2:30 / 3:00）",
    md.includes("0:00") && md.includes("0:30") && md.includes("1:00") &&
    md.includes("1:30") && md.includes("2:00") && md.includes("2:30") && md.includes("3:00"));
  check("含 Demo Mode 或 Demo 模式", md.includes("Demo Mode") || md.includes("Demo 模式"));
  check("含'AI 比赛'（演示用例）", md.includes("AI 比赛"));
  check("T6 含 Star 或 收藏", md.includes("Star") || md.includes("收藏"));
  check("T7 含 报告 或 导出", md.includes("报告") || md.includes("导出"));
}

// ============================================================
// 3. Demo Mode 启动脚本检查
// ============================================================

function checkDemoStartScript(): void {
  section("3. Demo Mode 启动脚本检查");
  const ts = readFile("scripts/demo-start.ts");

  check("T9 含 DATA_MODE=mock", ts.includes('DATA_MODE') && ts.includes('"mock"'));
  check("含 LLM_MODE=mock", ts.includes('LLM_MODE') && ts.includes('"mock"'));
  check("含 DEMO_MODE=true", ts.includes('DEMO_MODE') && ts.includes('"true"'));
  check("含 server（启动服务器）", ts.includes("server"));
}

// ============================================================
// 4. 浏览器 E2E 脚本检查
// ============================================================

function checkE2EScript(): void {
  section("4. 浏览器 E2E 脚本检查");
  const ts = readFile("scripts/verify-e2e-web-demo.ts");

  check("T11 含 puppeteer", ts.includes("puppeteer"));
  check("T12 含 TOTAL_STEPS=7 或 7 步", ts.includes("TOTAL_STEPS = 7") || ts.includes("7/7") || (ts.match(/步骤 \d\/7/g) || []).length >= 7);
  check("T13 含 #home-input", ts.includes("#home-input"));
  check("T14 含 #start-search-btn", ts.includes("#start-search-btn"));
  check("T15 含 .star-btn", ts.includes(".star-btn"));
  check("T16 含 #btn-generate-report", ts.includes("#btn-generate-report"));
  check("T17 含 screenshot", ts.includes("screenshot"));
  check("含 puppeteer 降级处理（try-catch 或 PUPPETEER_SKIP）",
    ts.includes("PUPPETEER_SKIP") || ts.includes("catch"));
}

// ============================================================
// 5. UI 标识检查
// ============================================================

function checkUIBadge(): void {
  section("5. UI 标识检查");
  const html = readFile("web/index.html");
  const css = readFile("web/styles.css");
  const homeJs = readFile("web/home.js");

  check("T18 index.html 含 demo-badge", html.includes("demo-badge"));
  check("T19 styles.css 含 .demo-badge", css.includes(".demo-badge"));
  check("home.js 含 URL 参数 ?demo 检查", homeJs.includes("demo") && homeJs.includes("URLSearchParams"));
}

// ============================================================
// 6. package.json 检查
// ============================================================

function checkPackageJson(): void {
  section("6. package.json 检查");
  const pkg = readFile("package.json");
  const pkgJson = JSON.parse(pkg);

  check("T20 scripts 含 demo", typeof pkgJson.scripts?.demo === "string");
  check("T21 scripts 含 verify:e2e-web-demo", typeof pkgJson.scripts?.["verify:e2e-web-demo"] === "string");
  check("T22 scripts 含 verify:task041", typeof pkgJson.scripts?.["verify:task041"] === "string");
}

// ============================================================
// 7. API 集成检查（Mock 模式）
// ============================================================

async function checkApiIntegration(): Promise<void> {
  section("7. API 集成检查（Mock 模式）");

  const { createApp } = await import("../src/api/app");
  const { serve } = await import("@hono/node-server");
  const app = createApp();

  const port = 3996;
  const server = serve({ fetch: app.fetch, port });

  try {
    // T26 GET / 返回 200 + 含 home-input
    const resHome = await fetch(`http://localhost:${port}/?demo=true`);
    const htmlContent = await resHome.text();
    check("T26 GET /?demo=true 返回 200", resHome.status === 200, `status=${resHome.status}`);
    check("T26.1 含 home-input", htmlContent.includes('id="home-input"'));
    check("含 demo-badge", htmlContent.includes('demo-badge'));

    // T27 POST /api/chat 返回 200
    const resChat = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我想找 AI 比赛", radar_type: "ai_competition" }),
    });
    const chatJson = (await resChat.json()) as { success?: boolean; error?: { message?: string } };
    check("T27 POST /api/chat 返回 200", resChat.status === 200, `status=${resChat.status}`);
    check("T27.1 POST /api/chat success=true", chatJson.success === true, chatJson.error?.message ?? "");

    // T28 POST /api/search 返回 200 + opportunities
    const resSearch = await fetch(`http://localhost:${port}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enable_content_fetch: false }),
    });
    const searchJson = (await resSearch.json()) as { success?: boolean; data?: { opportunities?: unknown[] }; error?: { message?: string } };
    check("T28 POST /api/search 返回 200", resSearch.status === 200, `status=${resSearch.status}`);
    check("T28.1 POST /api/search success=true", searchJson.success === true, searchJson.error?.message ?? "");
    check("T28.2 含 opportunities 数组", Array.isArray(searchJson.data?.opportunities));
  } finally {
    server.close();
  }
}

// ============================================================
// 8. 回归测试
// ============================================================

function runRegressionTest(scriptName: string, label: string): void {
  try {
    execSync(`npx.cmd tsx scripts/${scriptName}`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 300000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    check(`${label} 回归通过`, true);
  } catch (err) {
    check(`${label} 回归通过`, false, (err as Error).message.slice(0, 200));
  }
}

function checkRegression(): void {
  section("8. 回归测试");
  runRegressionTest("verify-e2e-ai-events.ts", "T24 verify-e2e-ai-events");
  runRegressionTest("verify-task040.ts", "T25 verify-task040");
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 041 验收检查：演示脚本 + Demo Mode + 浏览器 E2E ===\n");

  checkFileExistence();
  checkDemoScript();
  checkDemoStartScript();
  checkE2EScript();
  checkUIBadge();
  checkPackageJson();
  await checkApiIntegration();
  checkRegression();

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  if (failed > 0) {
    console.log("\n❌ 存在失败项，请修复后重试");
    process.exit(1);
  } else {
    console.log("\n✓ 全部通过");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("执行失败：", err);
  process.exit(1);
});
