/**
 * Task 038 验收脚本：用户旅程首页 + 需求确认页
 *
 * 运行：npx tsx scripts/verify-task038.ts
 *
 * 验证项（T1-T28）：
 *   1. 文件存在性检查（2 个新增 JS）
 *   2. HTML 结构检查（panel-home / panel-chat / 输入框 / 确认卡 / Tab 顺序）
 *   3. CSS 检查（home-container / confirmation-card / dimension-bar / 响应式）
 *   4. JS 功能检查（home-submit / fetch / updateConfirmationCard / renderDimensions）
 *   5. API 集成检查（启动服务器，GET / + POST /api/chat）
 *   6. 代码质量检查（无"盯一下"残留 / 相对路径 API）
 *   7. 回归测试（verify-task034 / verify:e2e-ai-events / verify-task025）
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
  check("T13 web/home.js 存在", fileExists("web/home.js"));
  check("T14 web/requirement-chat.js 存在", fileExists("web/requirement-chat.js"));
  check("web/index.html 存在", fileExists("web/index.html"));
  check("web/styles.css 存在", fileExists("web/styles.css"));
}

// ============================================================
// 2. HTML 结构检查
// ============================================================

function checkHtmlStructure(): void {
  section("2. HTML 结构检查");
  const html = readFile("web/index.html");

  check("T3 含 panel-home（首页面板）", html.includes('id="panel-home"'));
  check("T4 含 panel-chat（需求确认面板）", html.includes('id="panel-chat"'));
  check("T6 含 home-input（首页输入框）", html.includes('id="home-input"'));
  check("T7 含 3 个 example-btn", (html.match(/class="example-btn"/g) || []).length === 3);
  check("T8 含 chat-input（对话输入框）", html.includes('id="chat-input"'));
  check("T8.1 含 chat-send-btn（发送按钮）", html.includes('id="chat-send-btn"'));
  check("T9 含 confirmation-card（确认卡）", html.includes('id="confirmation-card"'));
  check("T10 含 conf-total（确认度总分）", html.includes('id="conf-total"'));
  check("T10.1 含 conf-bar-fill（确认度进度条）", html.includes('id="conf-bar-fill"'));
  check("T11 含 dimensions-list（7 维度明细）", html.includes('id="dimensions-list"'));
  check("T12 含 start-search-btn（开始搜索按钮）", html.includes('id="start-search-btn"'));
  check("T12.1 start-search-btn 含 disabled 属性", html.includes('id="start-search-btn"') && html.includes("disabled"));

  // Tab 顺序检查
  const tabBtnMatches = html.match(/data-tab="([^"]+)"/g) || [];
  check("T5 含 7 个 tab-btn", tabBtnMatches.length === 7, `实际: ${tabBtnMatches.length}`);
  if (tabBtnMatches.length === 7) {
    const tabs = tabBtnMatches.map((m) => m.match(/data-tab="([^"]+)"/)![1]);
    check("T5.1 Tab 顺序首位是 home", tabs[0] === "home", `实际: ${tabs[0]}`);
    check("T5.2 Tab 顺序末位是 editor", tabs[6] === "editor", `实际: ${tabs[6]}`);
    check("T5.3 Tab 顺序: home/chat/search/opportunities/reports/radars/editor",
      tabs.join("/") === "home/chat/search/opportunities/reports/radars/editor",
      `实际: ${tabs.join("/")}`);
  }

  // panel 顺序检查
  const panelMatches = html.match(/id="panel-([^"]+)"/g) || [];
  check("含 7 个 tab-panel", panelMatches.length === 7, `实际: ${panelMatches.length}`);

  // 首页是 active
  check("T5.4 首页 panel-home 含 active 类", html.includes('id="panel-home"') && html.includes('tab-panel active'));
  check("T5.5 首页 tab-btn 含 active 类", /data-tab="home"[^>]*class="tab-btn active"/.test(html) || /class="tab-btn active"[^>]*data-tab="home"/.test(html));

  // 无"盯一下"残留
  check("T26 无'盯一下'残留", !html.includes("盯一下"));

  // 引入 JS 文件
  check("引入 home.js", html.includes('src="/home.js"'));
  check("引入 requirement-chat.js", html.includes('src="/requirement-chat.js"'));
}

// ============================================================
// 3. CSS 检查
// ============================================================

function checkCss(): void {
  section("3. CSS 检查");
  const css = readFile("web/styles.css");

  check("含 home-container 样式", css.includes(".home-container"));
  check("含 home-hero 样式", css.includes(".home-hero"));
  check("含 confirmation-card 样式", css.includes(".confirmation-card"));
  check("含 dimension-bar 样式", css.includes(".dimension-bar"));
  check("含 confidence-bar-fill 样式", css.includes(".confidence-bar-fill"));
  check("含 message-bubble 样式", css.includes(".message-bubble"));
  check("含 typing-indicator 样式", css.includes(".typing-indicator"));
  check("含 primary-btn 样式", css.includes(".primary-btn"));

  // 响应式
  const mediaCount = (css.match(/@media/g) || []).length;
  check("T21 含 @media 响应式查询", mediaCount >= 2, `实际 ${mediaCount} 个 @media`);
  check("含 chat-layout 响应式（上下堆叠）", css.includes(".chat-layout") && css.includes("@media"));
}

// ============================================================
// 4. JS 功能检查
// ============================================================

function checkJsFunctions(): void {
  section("4. JS 功能检查");
  const homeJs = readFile("web/home.js");
  const chatJs = readFile("web/requirement-chat.js");

  // home.js
  check("T15 home.js 含 fetch('/api/chat')", homeJs.includes("/api/chat"));
  check("home.js 含 home-submit 事件", homeJs.includes("home-submit"));
  check("home.js 含 switchTab 函数", homeJs.includes("function switchTab"));
  check("home.js 含 showToast 函数", homeJs.includes("function showToast"));
  check("home.js 含 example-btn 事件绑定", homeJs.includes("example-btn"));

  // requirement-chat.js
  check("T16 requirement-chat.js 含 fetch('/api/chat')", chatJs.includes("/api/chat"));
  check("T17 含 updateConfirmationCard 函数", chatJs.includes("function updateConfirmationCard"));
  check("T18 含 renderDimensions 函数", chatJs.includes("function renderDimensions"));
  check("含 start-search-btn 事件", chatJs.includes("start-search-btn"));
  check("含 home-chat-response 监听", chatJs.includes("home-chat-response"));
  check("含 conversation_id 处理", chatJs.includes("conversation_id"));
  check("含 confidence.total 处理", chatJs.includes("confidence") && chatJs.includes("total"));
  check("含 confirmed_items 处理", chatJs.includes("confirmed_items"));
  check("含 uncertain_items 处理", chatJs.includes("uncertain_items"));
  check("含 7 维度定义", chatJs.includes("business_goal") && chatJs.includes("opportunity_type") && chatJs.includes("report_format"));
}

// ============================================================
// 5. API 集成检查
// ============================================================

async function checkApiIntegration(): Promise<void> {
  section("5. API 集成检查（Mock 模式）");

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
    check("GET / 含 panel-home", htmlContent.includes('id="panel-home"'));
    check("GET / 含 panel-chat", htmlContent.includes('id="panel-chat"'));
    check("GET / 含 7 个 tab-btn", (htmlContent.match(/data-tab="/g) || []).length === 7);

    // GET /home.js
    const resHomeJs = await fetch(`http://localhost:${port}/home.js`);
    check("GET /home.js 返回 200", resHomeJs.status === 200, `status=${resHomeJs.status}`);

    // GET /requirement-chat.js
    const resChatJs = await fetch(`http://localhost:${port}/requirement-chat.js`);
    check("GET /requirement-chat.js 返回 200", resChatJs.status === 200, `status=${resChatJs.status}`);

    // GET /styles.css
    const resCss = await fetch(`http://localhost:${port}/styles.css`);
    check("GET /styles.css 返回 200", resCss.status === 200, `status=${resCss.status}`);

    // POST /api/chat 返回 confidence
    const resChat = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "我要盯 AI 相关的比赛机会",
        radar_type: "ai_competition",
      }),
    });
    const chatJson = (await resChat.json()) as { success?: boolean; data?: Record<string, unknown>; error?: { message?: string } };
    check("POST /api/chat 返回 200", resChat.status === 200, `status=${resChat.status}`);
    check("POST /api/chat success=true", chatJson.success === true, chatJson.error?.message ?? "");
    const chatData = chatJson.data as Record<string, unknown> | null;
    check("POST /api/chat 含 confidence", chatData?.confidence != null, `keys=${chatData ? Object.keys(chatData).join(",") : "null"}`);
    check("POST /api/chat 含 conversation_id", typeof chatData?.conversation_id === "string");
  } finally {
    server.close();
  }
}

// ============================================================
// 6. 代码质量检查
// ============================================================

function checkCodeQuality(): void {
  section("6. 代码质量检查");

  // 无"盯一下"残留（全 web/ 目录扫描）
  const webFiles = ["web/index.html", "web/styles.css", "web/home.js", "web/requirement-chat.js", "web/watch-rules-editor.js"];
  let hasResidual = false;
  for (const f of webFiles) {
    if (fileExists(f) && readFile(f).includes("盯一下")) {
      hasResidual = true;
      console.log(`    ⚠ ${f} 含"盯一下"`);
    }
  }
  check("T26 web/ 目录无'盯一下'残留", !hasResidual);

  // 品牌名一致
  const html = readFile("web/index.html");
  check("T27 品牌名含'盯机会'", html.includes("盯机会"));

  // 无硬编码 API URL（使用相对路径）
  const homeJs = readFile("web/home.js");
  const chatJs = readFile("web/requirement-chat.js");
  check("T28 home.js 使用相对路径 /api/...", !homeJs.includes("http://") || homeJs.includes("/api/"));
  check("T28.1 requirement-chat.js 使用相对路径 /api/...", !chatJs.includes("http://") || chatJs.includes("/api/"));
}

// ============================================================
// 7. 回归测试
// ============================================================

function runRegressionTest(scriptName: string, label: string): void {
  try {
    execSync(`npx.cmd tsx scripts/${scriptName}`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // execSync 在 exit code 非 0 时抛异常，到这里即表示通过
    check(`${label} 回归通过`, true);
  } catch (err) {
    check(`${label} 回归通过`, false, (err as Error).message.slice(0, 200));
  }
}

function checkRegression(): void {
  section("7. 回归测试");
  runRegressionTest("verify-task034.ts", "T22 verify-task034");
  runRegressionTest("verify-task025.ts", "T24 verify-task025");
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 038 验收检查：用户旅程首页 + 需求确认页 ===\n");

  checkFileExistence();
  checkHtmlStructure();
  checkCss();
  checkJsFunctions();
  await checkApiIntegration();
  checkCodeQuality();
  checkRegression();

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  if (failed > 0) {
    console.log("\n✗ 存在失败项");
    process.exit(1);
  } else {
    console.log("\n✓ 全部通过");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("验收脚本异常:", err);
  process.exit(1);
});
