/**
 * Task 040 验收脚本：机会库 Tab + 报告 Tab + 页面内截止提醒
 *
 * 运行：npx tsx scripts/verify-task040.ts
 *
 * 验证项：
 *   1. 文件存在性检查（3 个新增）
 *   2. HTML 结构检查（panel-opportunities + panel-reports + 脚本引入）
 *   3. CSS 检查（opp-item / reminder-section / filter-bar / report-preview）
 *   4. JS 功能检查（opportunities.js + reports.js 关键函数 + fetch）
 *   5. 后端路由检查（sort_by / sort_order / expiring_soon / batchAutoTransition / store.update）
 *   6. API 集成检查（Mock 模式，启动服务器）
 *   7. 回归测试（verify-task034 / e2e-ai-events / task038 / task039）
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.PORT = "3998";
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
  check("T17 web/opportunities.js 存在", fileExists("web/opportunities.js"));
  check("T23 web/reports.js 存在", fileExists("web/reports.js"));
  check("scripts/verify-task040.ts 存在", fileExists("scripts/verify-task040.ts"));
}

// ============================================================
// 2. HTML 结构检查
// ============================================================

function checkHtmlStructure(): void {
  section("2. HTML 结构检查");
  const html = readFile("web/index.html");

  check("T3 含 opp-list（机会列表容器）", html.includes('id="opp-list"'));
  check("T4 含 opp-stats-bar（统计概览）", html.includes('id="opp-stats-bar"'));
  check("T5 含 reminder-section（截止提醒区）", html.includes('id="reminder-section"'));
  check("T6 含 filter-radar（筛选栏）", html.includes('id="filter-radar"'));
  check("T7 含 sort-by（排序栏）", html.includes('id="sort-by"'));
  check("T8 含 opp-pagination（分页）", html.includes('id="opp-pagination"'));
  check("T9 含 report-preview（报告预览）", html.includes('id="report-preview"'));
  check("T10 含 btn-generate-report（生成按钮）", html.includes('id="btn-generate-report"'));
  check("T11 含 export-btn（导出按钮）", html.includes("export-btn"));
  check("T12 含 report-history-list（历史报告）", html.includes('id="report-history-list"'));
  check("引入 opportunities.js", html.includes('src="/opportunities.js"'));
  check("引入 reports.js", html.includes('src="/reports.js"'));
  check("T34 无'盯一下'残留", !html.includes("盯一下"));
  check("T35 品牌名含'盯机会'", html.includes("盯机会"));
}

// ============================================================
// 3. CSS 检查
// ============================================================

function checkCss(): void {
  section("3. CSS 检查");
  const css = readFile("web/styles.css");

  check("T13 含 .opp-item 样式", css.includes(".opp-item"));
  check("T14 含 .reminder-section 样式", css.includes(".reminder-section"));
  check("T15 含 .filter-bar 样式", css.includes(".filter-bar"));
  check("T16 含 .report-preview 样式", css.includes(".report-preview"));
  check("含 @media 响应式查询", (css.match(/@media/g) || []).length >= 4);
  check("含 .opp-library-container 样式", css.includes(".opp-library-container"));
  check("含 .reports-container 样式", css.includes(".reports-container"));
  check("含 .reminder-urgent 样式", css.includes(".reminder-urgent"));
}

// ============================================================
// 4. JS 功能检查
// ============================================================

function checkJsFunctions(): void {
  section("4. JS 功能检查");
  const oppJs = readFile("web/opportunities.js");
  const reportJs = readFile("web/reports.js");

  // opportunities.js
  check("T18 含 fetch /api/opportunities", oppJs.includes("/api/opportunities"));
  check("T19 含 /api/reminders", oppJs.includes("/api/reminders"));
  check("T20 含 /stats（统计）", oppJs.includes("/stats"));
  check("T21 含 /star（Star 操作）", oppJs.includes("/star"));
  check("T22 含 DELETE（删除/取消收藏）", oppJs.includes("DELETE"));
  check("含 tab-switched 事件监听", oppJs.includes("tab-switched"));
  check("含 loadOpportunities 函数", oppJs.includes("loadOpportunities"));
  check("含 refreshReminders 函数", oppJs.includes("refreshReminders"));

  // reports.js
  check("T24 含 /api/reports/generate", reportJs.includes("/api/reports/generate"));
  check("T25 含 /api/reports/export", reportJs.includes("/api/reports/export"));
  check("T26 含 /export/list（历史）", reportJs.includes("/export/list"));
  check("T27 含 renderMarkdown 函数", reportJs.includes("renderMarkdown"));
  check("T28 含 exportReport 函数", reportJs.includes("exportReport"));
  check("含 loadHistory 函数", reportJs.includes("loadHistory"));
}

// ============================================================
// 5. 后端路由检查
// ============================================================

function checkBackendRoutes(): void {
  section("5. 后端路由检查");
  const oppTs = readFile("src/api/routes/opportunities.ts");

  check("T29 含 sort_by 参数", oppTs.includes("sort_by"));
  check("T30 含 sort_order 参数", oppTs.includes("sort_order"));
  check("T31 含 expiring_soon 参数", oppTs.includes("expiring_soon"));
  check("T32 含 batchAutoTransition（自动过期）", oppTs.includes("batchAutoTransition"));
  check("T33 含 store.update（回写状态）", oppTs.includes("store.update"));
  check("含 deadline_from 参数", oppTs.includes("deadline_from"));
  check("含 deadline_to 参数", oppTs.includes("deadline_to"));

  // web-ui.ts 路由检查
  const webUiTs = readFile("src/api/routes/web-ui.ts");
  check("web-ui.ts 含 /opportunities.js 路由", webUiTs.includes("/opportunities.js"));
  check("web-ui.ts 含 /reports.js 路由", webUiTs.includes("/reports.js"));

  // home.js switchTab 派发事件
  const homeJs = readFile("web/home.js");
  check("home.js switchTab 派发 tab-switched 事件", homeJs.includes("tab-switched"));
}

// ============================================================
// 6. API 集成检查（启动服务器，Mock 模式）
// ============================================================

async function checkApiIntegration(): Promise<void> {
  section("6. API 集成检查");

  const { createApp } = await import("../src/api/app");
  const { serve } = await import("@hono/node-server");
  const app = createApp();

  const port = 3998;
  const server = serve({ fetch: app.fetch, port });

  try {
    // GET / 返回 HTML
    const resHome = await fetch(`http://localhost:${port}/`);
    const htmlContent = await resHome.text();
    check("GET / 返回 200", resHome.status === 200, `status=${resHome.status}`);
    check("GET / 含 opp-list", htmlContent.includes('id="opp-list"'));
    check("GET / 含 report-preview", htmlContent.includes('id="report-preview"'));

    // GET /opportunities.js
    const resOppJs = await fetch(`http://localhost:${port}/opportunities.js`);
    check("T48 GET /opportunities.js 返回 200", resOppJs.status === 200, `status=${resOppJs.status}`);

    // GET /reports.js
    const resReportJs = await fetch(`http://localhost:${port}/reports.js`);
    check("T49 GET /reports.js 返回 200", resReportJs.status === 200, `status=${resReportJs.status}`);

    // 先入库一条带截止日期的测试数据（用于 reminders + reports）
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5); // 5 天后截止（soon 级别）
    const deadline = futureDate.toISOString().slice(0, 10);
    const card = {
      title: "Task040 测试机会",
      type: "AI 赛事",
      organizer: "测试主办方",
      region: "全国",
      deadline,
      reward_or_value: "奖金 10 万",
      eligibility: "公司/团队",
      materials_required: "商业计划书",
      match_reason: "测试匹配",
      next_action: "立即报名",
      official_source_url: "https://example.com/task040-test",
      application_url: "",
      contact_info: "",
      risk_note: "",
      backend_score: 80,
      visible_level: "A",
      status: "new",
    };
    const resAdd = await fetch(`http://localhost:${port}/api/opportunities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card, radar_type: "ai_competition" }),
    });
    const addJson = (await resAdd.json()) as { success?: boolean; data?: { dedup_key?: string }; error?: { message?: string } };
    check("入库测试数据返回 200", resAdd.status === 200, `status=${resAdd.status}`);
    check("入库 success=true", addJson.success === true, addJson.error?.message ?? "");

    // T40 GET /api/opportunities 返回 200 + entries
    const resList = await fetch(`http://localhost:${port}/api/opportunities`);
    const listJson = (await resList.json()) as { success?: boolean; data?: { entries?: unknown[] }; error?: { message?: string } };
    check("T40 GET /api/opportunities 返回 200", resList.status === 200, `status=${resList.status}`);
    check("T40.1 含 entries 数组", Array.isArray(listJson.data?.entries), listJson.error?.message ?? "");

    // T41 GET /api/opportunities?sort_by=deadline
    const resSort = await fetch(`http://localhost:${port}/api/opportunities?sort_by=deadline&sort_order=asc`);
    const sortJson = (await resSort.json()) as { success?: boolean; error?: { message?: string } };
    check("T41 GET ?sort_by=deadline 返回 200", resSort.status === 200, `status=${resSort.status}`);
    check("T41.1 sort_by success=true", sortJson.success === true, sortJson.error?.message ?? "");

    // T42 GET /api/opportunities?expiring_soon=true
    const resExpiring = await fetch(`http://localhost:${port}/api/opportunities?expiring_soon=true`);
    const expiringJson = (await resExpiring.json()) as { success?: boolean; error?: { message?: string } };
    check("T42 GET ?expiring_soon=true 返回 200", resExpiring.status === 200, `status=${resExpiring.status}`);
    check("T42.1 expiring_soon success=true", expiringJson.success === true, expiringJson.error?.message ?? "");

    // T43 GET /api/opportunities/stats
    const resStats = await fetch(`http://localhost:${port}/api/opportunities/stats`);
    const statsJson = (await resStats.json()) as { success?: boolean; data?: { total?: number }; error?: { message?: string } };
    check("T43 GET /stats 返回 200", resStats.status === 200, `status=${resStats.status}`);
    check("T43.1 含 total 字段", typeof statsJson.data?.total === "number", statsJson.error?.message ?? "");

    // T44 GET /api/reminders
    const resReminders = await fetch(`http://localhost:${port}/api/reminders`);
    const remindersJson = (await resReminders.json()) as { success?: boolean; data?: { summary?: unknown }; error?: { message?: string } };
    check("T44 GET /api/reminders 返回 200", resReminders.status === 200, `status=${resReminders.status}`);
    check("T44.1 含 summary 字段", remindersJson.data?.summary != null, remindersJson.error?.message ?? "");

    // T45 POST /api/reports/generate
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 7);
    const resGenerate = await fetch(`http://localhost:${port}/api/reports/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        radar_type: "ai_competition",
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
      }),
    });
    const generateJson = (await resGenerate.json()) as { success?: boolean; data?: { markdown?: string }; error?: { message?: string } };
    check("T45 POST /reports/generate 返回 200", resGenerate.status === 200, `status=${resGenerate.status}`);
    check("T45.1 含 markdown 字段", typeof generateJson.data?.markdown === "string" && generateJson.data.markdown.length > 0, generateJson.error?.message ?? "");

    // T46 POST /api/reports/export?format=markdown
    const resExport = await fetch(`http://localhost:${port}/api/reports/export?format=markdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        radar_type: "ai_competition",
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
      }),
    });
    check("T46 POST /reports/export?format=markdown 返回 200", resExport.status === 200, `status=${resExport.status}`);
    const exportContent = await resExport.text();
    check("T46.1 导出内容非空", exportContent.length > 0);

    // T47 GET /api/reports/export/list
    const resHistory = await fetch(`http://localhost:${port}/api/reports/export/list`);
    const historyJson = (await resHistory.json()) as { success?: boolean; data?: { files?: unknown[] }; error?: { message?: string } };
    check("T47 GET /export/list 返回 200", resHistory.status === 200, `status=${resHistory.status}`);
    check("T47.1 含 files 数组", Array.isArray(historyJson.data?.files), historyJson.error?.message ?? "");
  } finally {
    server.close();
  }
}

// ============================================================
// 7. 回归测试
// ============================================================

function runRegressionTest(scriptName: string, label: string): void {
  try {
    execSync(`npx.cmd tsx scripts/${scriptName}`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 240000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    check(`${label} 回归通过`, true);
  } catch (err) {
    check(`${label} 回归通过`, false, (err as Error).message.slice(0, 200));
  }
}

function checkRegression(): void {
  section("7. 回归测试");
  runRegressionTest("verify-task034.ts", "T36 verify-task034");
  runRegressionTest("verify-task038.ts", "T38 verify-task038");
  runRegressionTest("verify-task039.ts", "T39 verify-task039");
}

// ============================================================
// 主流程
// ============================================================

(async () => {
  console.log("Task 040 验收脚本启动（Mock 模式）");
  console.log("========================================");

  checkFileExistence();
  checkHtmlStructure();
  checkCss();
  checkJsFunctions();
  checkBackendRoutes();
  await checkApiIntegration();
  checkRegression();

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  if (failed > 0) {
    console.log("✗ 存在失败项");
    process.exit(1);
  } else {
    console.log("✓ 全部通过");
    process.exit(0);
  }
})();
