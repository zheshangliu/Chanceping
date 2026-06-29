/**
 * Task 039 验收脚本：搜索结果页 + 机会卡片 + Star + 反馈字段
 *
 * 运行：npx tsx scripts/verify-task039.ts
 *
 * 验证项（T1-T34）：
 *   1. 文件存在性检查（3 个新增）
 *   2. HTML 结构检查（search-results / search-status-bar / search.js 引入）
 *   3. CSS 检查（level-badge / score-bar-fill / star-btn / feedback-btn / card-detail）
 *   4. JS 功能检查（chat-search-start / fetch / toCard / renderCard / PATCH feedback）
 *   5. 后端类型检查（feedback.ts 9 枚举 + ActionIntent + ActionStatusType）
 *   6. API 路由检查（PATCH /feedback + card.feedback 赋值）
 *   7. API 集成检查（Mock 模式，启动服务器）
 *   8. 回归测试（verify-task034 / verify-task038）
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.PORT = "3997";
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
  check("T10 web/search.js 存在", fileExists("web/search.js"));
  check("T17 src/schema/feedback.ts 存在", fileExists("src/schema/feedback.ts"));
  check("scripts/verify-task039.ts 存在", fileExists("scripts/verify-task039.ts"));
}

// ============================================================
// 2. HTML 结构检查
// ============================================================

function checkHtmlStructure(): void {
  section("2. HTML 结构检查");
  const html = readFile("web/index.html");

  check("T3 含 search-results（搜索结果容器）", html.includes('id="search-results"'));
  check("T4 含 search-status-bar（搜索状态栏）", html.includes('id="search-status-bar"'));
  check("引入 search.js", html.includes('src="/search.js"'));
  check("T24 无'盯一下'残留", !html.includes("盯一下"));
  check("T25 品牌名含'盯机会'", html.includes("盯机会"));
}

// ============================================================
// 3. CSS 检查
// ============================================================

function checkCss(): void {
  section("3. CSS 检查");
  const css = readFile("web/styles.css");

  check("T5 含 level-badge 样式", css.includes(".level-badge"));
  check("T6 含 score-bar-fill 样式", css.includes(".score-bar-fill"));
  check("T7 含 star-btn 样式", css.includes(".star-btn"));
  check("T8 含 feedback-btn 样式", css.includes(".feedback-btn"));
  check("T9 含 card-detail 样式", css.includes(".card-detail"));
  check("含 opp-card 样式", css.includes(".opp-card"));
  check("含 search-container 样式", css.includes(".search-container"));
  check("含 @media 响应式查询", (css.match(/@media/g) || []).length >= 3);
}

// ============================================================
// 4. JS 功能检查
// ============================================================

function checkJsFunctions(): void {
  section("4. JS 功能检查");
  const searchJs = readFile("web/search.js");

  check("T11 含 chat-search-start 事件监听", searchJs.includes("chat-search-start"));
  check("T12 含 fetch('/api/search')", searchJs.includes("/api/search"));
  check("T13 含 fetch('/api/opportunities')", searchJs.includes("/api/opportunities"));
  check("T14 含 /star（Star API）", searchJs.includes("/star"));
  check("T15 含 toCard 函数", searchJs.includes("function toCard"));
  check("T16 含 renderCard 函数", searchJs.includes("function renderCard"));
  check("含 PATCH /feedback（反馈提交）", searchJs.includes("/feedback") && searchJs.includes("PATCH"));
  check("含 5 个评分维度（fit/intent/evidence/urgency/effort_cost）",
    searchJs.includes("fit") && searchJs.includes("intent") && searchJs.includes("evidence") &&
    searchJs.includes("urgency") && searchJs.includes("effort_cost"));
  check("含 9 个反馈枚举", searchJs.includes("useful") && searchJs.includes("not_useful") &&
    searchJs.includes("wrong_match") && searchJs.includes("already_expired") &&
    searchJs.includes("low_value") && searchJs.includes("too_hard") &&
    searchJs.includes("duplicate") && searchJs.includes("no_official_link") &&
    searchJs.includes("bad_deadline"));
  check("含行动意图枚举", searchJs.includes("intend_to_apply") && searchJs.includes("considering") && searchJs.includes("not_interested"));
}

// ============================================================
// 5. 后端类型检查
// ============================================================

function checkBackendTypes(): void {
  section("5. 后端类型检查");
  const feedbackTs = readFile("src/schema/feedback.ts");
  const cardTs = readFile("src/schema/opportunity-card.ts");

  check("T18 feedback.ts 含 FeedbackEvaluation 类型", feedbackTs.includes("FeedbackEvaluation"));
  check("T18.1 含 9 个枚举值",
    feedbackTs.includes("useful") && feedbackTs.includes("not_useful") &&
    feedbackTs.includes("wrong_match") && feedbackTs.includes("already_expired") &&
    feedbackTs.includes("low_value") && feedbackTs.includes("too_hard") &&
    feedbackTs.includes("duplicate") && feedbackTs.includes("no_official_link") &&
    feedbackTs.includes("bad_deadline"));
  check("T19 feedback.ts 含 ActionIntent 接口", feedbackTs.includes("interface ActionIntent"));
  check("T19.1 feedback.ts 含 ActionStatusType 类型", feedbackTs.includes("ActionStatusType"));
  check("含 4 个行动进度枚举",
    feedbackTs.includes("not_started") && feedbackTs.includes("preparing") &&
    feedbackTs.includes("submitted") && feedbackTs.includes("abandoned"));
  check("T20 opportunity-card.ts 含 feedback? 字段", cardTs.includes("feedback?:"));
  check("T20.1 opportunity-card.ts 含 action_intent? 字段", cardTs.includes("action_intent?:"));
}

// ============================================================
// 6. API 路由检查
// ============================================================

function checkApiRoutes(): void {
  section("6. API 路由检查");
  const oppTs = readFile("src/api/routes/opportunities.ts");

  check("T21 opportunities.ts 含 PATCH 方法", oppTs.includes("app.patch"));
  check("T21.1 含 /feedback 路由", oppTs.includes("/feedback"));
  check("T22 含 card.feedback 赋值", oppTs.includes("updates.feedback"));
  check("T23 含 card.action_intent 赋值", oppTs.includes("updates.action_intent"));
}

// ============================================================
// 7. API 集成检查（启动服务器，Mock 模式）
// ============================================================

async function checkApiIntegration(): Promise<void> {
  section("7. API 集成检查（Mock 模式）");

  const { createApp } = await import("../src/api/app");
  const { serve } = await import("@hono/node-server");
  const app = createApp();

  const port = 3997;
  const server = serve({ fetch: app.fetch, port });

  try {
    // GET / 返回 HTML
    const resHome = await fetch(`http://localhost:${port}/`);
    const htmlContent = await resHome.text();
    check("GET / 返回 200", resHome.status === 200, `status=${resHome.status}`);
    check("GET / 含 search-results", htmlContent.includes('id="search-results"'));

    // GET /search.js
    const resSearchJs = await fetch(`http://localhost:${port}/search.js`);
    check("GET /search.js 返回 200", resSearchJs.status === 200, `status=${resSearchJs.status}`);

    // T30 POST /api/search 返回 200 + opportunities
    const resSearch = await fetch(`http://localhost:${port}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enable_content_fetch: false }),
    });
    const searchJson = (await resSearch.json()) as { success?: boolean; data?: { opportunities?: unknown[] }; error?: { message?: string } };
    check("T30 POST /api/search 返回 200", resSearch.status === 200, `status=${resSearch.status}`);
    check("T30.1 POST /api/search success=true", searchJson.success === true, searchJson.error?.message ?? "");
    check("T30.2 POST /api/search 含 opportunities 数组", Array.isArray(searchJson.data?.opportunities));

    // T31 POST /api/opportunities 入库
    const card = {
      title: "Task039 测试机会",
      type: "AI 赛事",
      organizer: "测试主办方",
      region: "全国",
      deadline: "2026-12-31",
      reward_or_value: "奖金 10 万",
      eligibility: "公司/团队",
      materials_required: "商业计划书",
      match_reason: "测试匹配",
      next_action: "立即报名",
      official_source_url: "https://example.com/task039-test",
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
    check("T31 POST /api/opportunities 返回 200", resAdd.status === 200, `status=${resAdd.status}`);
    check("T31.1 入库 success=true", addJson.success === true, addJson.error?.message ?? "");
    const dedupKey = addJson.data?.dedup_key ?? "";
    check("T31.2 含 dedup_key", typeof dedupKey === "string" && dedupKey.length > 0);

    // T32 POST /api/opportunities/:key/star
    const resStar = await fetch(`http://localhost:${port}/api/opportunities/${dedupKey}/star`, {
      method: "POST",
    });
    const starJson = (await resStar.json()) as { success?: boolean; error?: { message?: string } };
    check("T32 POST /:key/star 返回 200", resStar.status === 200, `status=${resStar.status}, msg=${starJson.error?.message}`);
    check("T32.1 Star success=true", starJson.success === true, starJson.error?.message ?? "");

    // T33 PATCH /api/opportunities/:key/feedback（feedback）
    const resFeedback = await fetch(`http://localhost:${port}/api/opportunities/${dedupKey}/feedback`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedback: { evaluation: "useful", note: "测试反馈" },
      }),
    });
    const feedbackJson = (await resFeedback.json()) as { success?: boolean; data?: { card?: { feedback?: { evaluation?: string } } }; error?: { message?: string } };
    check("T33 PATCH /:key/feedback 返回 200", resFeedback.status === 200, `status=${resFeedback.status}`);
    check("T33.1 PATCH success=true", feedbackJson.success === true, feedbackJson.error?.message ?? "");
    check("T33.2 返回含 feedback", feedbackJson.data?.card?.feedback?.evaluation === "useful", `eval=${feedbackJson.data?.card?.feedback?.evaluation}`);

    // T34 PATCH 含 action_intent
    const resAction = await fetch(`http://localhost:${port}/api/opportunities/${dedupKey}/feedback`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action_intent: { intent: "intend_to_apply", status: "preparing", next_action_date: "2026-07-15" },
      }),
    });
    const actionJson = (await resAction.json()) as { success?: boolean; data?: { card?: { action_intent?: { intent?: string; status?: string } } }; error?: { message?: string } };
    check("T34 PATCH 含 action_intent 返回 200", resAction.status === 200, `status=${resAction.status}`);
    check("T34.1 PATCH action success=true", actionJson.success === true, actionJson.error?.message ?? "");
    check("T34.2 返回含 action_intent", actionJson.data?.card?.action_intent?.intent === "intend_to_apply", `intent=${actionJson.data?.card?.action_intent?.intent}`);
    check("T34.3 action_intent.status=preparing", actionJson.data?.card?.action_intent?.status === "preparing");
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
      timeout: 180000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    check(`${label} 回归通过`, true);
  } catch (err) {
    check(`${label} 回归通过`, false, (err as Error).message.slice(0, 200));
  }
}

function checkRegression(): void {
  section("8. 回归测试");
  runRegressionTest("verify-task034.ts", "T26 verify-task034");
  runRegressionTest("verify-task038.ts", "T28 verify-task038");
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 039 验收检查：搜索结果页 + 机会卡片 + Star + 反馈字段 ===\n");

  checkFileExistence();
  checkHtmlStructure();
  checkCss();
  checkJsFunctions();
  checkBackendTypes();
  checkApiRoutes();
  await checkApiIntegration();
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
