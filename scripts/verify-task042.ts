/**
 * Task 042 验收脚本：OPC/文创 Demo 数据 + loadDemoData 修复
 *
 * 运行：npx tsx scripts/verify-task042.ts
 *
 * 验证项（27 项 + 3 项回归）：
 *   1. 文件存在性检查（4 个新增）
 *   2. OPC Mock 数据检查（4 项）
 *   3. 文创 Mock 数据检查（4 项）
 *   4. loadDemoData 分发检查（3 项）
 *   5. Mock LLM 响应扩展检查（3 项）
 *   6. 三雷达 E2E 脚本检查（3 项）
 *   7. package.json 检查（2 项）
 *   8. API 集成检查（6 项）
 *   9. 回归测试（3 项）
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.PORT = "3994";
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
  check("T3 src/demo/opc-events.mock.json 存在", fileExists("src/demo/opc-events.mock.json"));
  check("T7 src/demo/cultural-events.mock.json 存在", fileExists("src/demo/cultural-events.mock.json"));
  check("scripts/verify-e2e-three-radars.ts 存在", fileExists("scripts/verify-e2e-three-radars.ts"));
  check("scripts/verify-task042.ts 存在", fileExists("scripts/verify-task042.ts"));
}

// ============================================================
// 2. OPC Mock 数据检查
// ============================================================

function checkOpcMockData(): void {
  section("2. OPC Mock 数据检查");
  const json = JSON.parse(readFile("src/demo/opc-events.mock.json")) as { radar_type: string; opportunities: Array<{ expected_level: string; deadline_status: string; title: string }> };

  check("OPC radar_type = opc_policy", json.radar_type === "opc_policy");
  check("T4 OPC Mock 5 条数据", json.opportunities.length === 5, `count=${json.opportunities.length}`);

  const levels = json.opportunities.map((o) => o.expected_level);
  check("T5 OPC Mock 含 S/A/B/C 等级",
    levels.includes("S") && levels.includes("A") && levels.includes("B") && levels.includes("C"),
    `levels=${levels.join(",")}`);

  const statuses = json.opportunities.map((o) => o.deadline_status);
  check("T6 OPC Mock 含 confirmed/rolling/expired",
    statuses.includes("confirmed") && statuses.includes("rolling") && statuses.includes("expired"),
    `statuses=${statuses.join(",")}`);
}

// ============================================================
// 3. 文创 Mock 数据检查
// ============================================================

function checkCulturalMockData(): void {
  section("3. 文创 Mock 数据检查");
  const json = JSON.parse(readFile("src/demo/cultural-events.mock.json")) as { radar_type: string; opportunities: Array<{ expected_level: string; deadline_status: string; title: string }> };

  check("文创 radar_type = cultural_heritage", json.radar_type === "cultural_heritage");
  check("T8 文创 Mock 5 条数据", json.opportunities.length === 5, `count=${json.opportunities.length}`);

  const levels = json.opportunities.map((o) => o.expected_level);
  check("T9 文创 Mock 含 S/A/B/C 等级",
    levels.includes("S") && levels.includes("A") && levels.includes("B") && levels.includes("C"),
    `levels=${levels.join(",")}`);

  const statuses = json.opportunities.map((o) => o.deadline_status);
  check("T10 文创 Mock 含 confirmed/rolling/unknown/expired",
    statuses.includes("confirmed") && statuses.includes("rolling") && statuses.includes("unknown") && statuses.includes("expired"),
    `statuses=${statuses.join(",")}`);
}

// ============================================================
// 4. loadDemoData 分发检查
// ============================================================

function checkLoadDemoData(): void {
  section("4. loadDemoData 分发检查");
  const ts = readFile("src/demo/index.ts");

  check("T11 index.ts 含 MOCK_FILE_MAP 或 radarType 分发", ts.includes("MOCK_FILE_MAP"));
  check("T12 index.ts 含 opc-events.mock.json", ts.includes("opc-events.mock.json"));
  check("T13 index.ts 含 cultural-events.mock.json", ts.includes("cultural-events.mock.json"));
}

// ============================================================
// 5. Mock LLM 响应扩展检查
// ============================================================

function checkLlmResponses(): void {
  section("5. Mock LLM 响应扩展检查");
  const json = JSON.parse(readFile("src/demo/llm-responses.mock.json")) as { ai_filter: { results: Array<{ title: string; relevant: boolean }> } };

  const titles = json.ai_filter.results.map((r) => r.title);
  const hasOpc = titles.some((t) => t.includes("高企") || t.includes("专精特新") || t.includes("科技型") || t.includes("数字化转型") || t.includes("旧政策"));
  const hasCultural = titles.some((t) => t.includes("非遗") || t.includes("文创") || t.includes("传统工艺"));

  check("T14 llm-responses 含 OPC 精筛结果", hasOpc, `titles=${titles.join(",")}`);
  check("T15 llm-responses 含文创精筛结果", hasCultural, `titles=${titles.join(",")}`);
  check("llm-responses 含 15 条精筛结果（3 雷达 × 5）", json.ai_filter.results.length === 15, `count=${json.ai_filter.results.length}`);
}

// ============================================================
// 6. 三雷达 E2E 脚本检查
// ============================================================

function checkThreeRadarsScript(): void {
  section("6. 三雷达 E2E 脚本检查");
  const ts = readFile("scripts/verify-e2e-three-radars.ts");

  check("T16 verify-e2e-three-radars.ts 存在", fileExists("scripts/verify-e2e-three-radars.ts"));
  check("T17 含三类雷达",
    ts.includes("ai_competition") && ts.includes("opc_policy") && ts.includes("cultural_heritage"));
  check("含数据不混淆验证（forbiddenKeywords）", ts.includes("forbiddenKeywords"));
}

// ============================================================
// 7. package.json 检查
// ============================================================

function checkPackageJson(): void {
  section("7. package.json 检查");
  const pkg = JSON.parse(readFile("package.json"));

  check("T20 scripts 含 verify:task042", typeof pkg.scripts?.["verify:task042"] === "string");
  check("scripts 含 verify:e2e-three-radars", typeof pkg.scripts?.["verify:e2e-three-radars"] === "string");
}

// ============================================================
// 8. API 集成检查
// ============================================================

async function checkApiIntegration(): Promise<void> {
  section("8. API 集成检查");

  const { createApp } = await import("../src/api/app");
  const { serve } = await import("@hono/node-server");
  const app = createApp();
  const port = 3994;
  const server = serve({ fetch: app.fetch, port });

  // Task 042: 通过 spec.opportunity_scope.primary_opportunity_types 推断雷达类型
  // ScoredOpportunity 的标题在 search_result.title，不是顶层 title
  type Opp = { search_result?: { title?: string } };

  // OPC 雷达 spec：primary_opportunity_types 含"政策补贴"触发 opc_policy 推断
  const opcSpec = {
    opportunity_scope: { primary_opportunity_types: ["政策补贴"] },
    keyword_strategy: { core_keywords_zh: [], core_keywords_en: [] },
    filter_rules: { must_exclude: [] },
    region_scope: { excluded_regions: [] },
  };

  // 文创雷达 spec：primary_opportunity_types 含"文创非遗"触发 cultural_heritage 推断
  const culturalSpec = {
    opportunity_scope: { primary_opportunity_types: ["文创非遗"] },
    keyword_strategy: { core_keywords_zh: [], core_keywords_en: [] },
    filter_rules: { must_exclude: [] },
    region_scope: { excluded_regions: [] },
  };

  try {
    // T24 OPC POST /api/search
    const resOpc = await fetch(`http://localhost:${port}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enable_content_fetch: false, spec: opcSpec }),
    });
    const opcJson = (await resOpc.json()) as { success?: boolean; data?: { opportunities?: Opp[] }; error?: { message?: string } };
    check("T24 OPC POST /api/search 返回 200", resOpc.status === 200, `status=${resOpc.status}`);
    check("T24.1 OPC search success=true", opcJson.success === true, opcJson.error?.message ?? "");

    const opcOpps = opcJson.data?.opportunities ?? [];
    const opcTitles = opcOpps.map((o) => o.search_result?.title || "").join(" | ");
    const opcHasPolicy = opcOpps.some((o) => {
      const t = o.search_result?.title || "";
      return t.includes("政策") || t.includes("补贴") || t.includes("申报") || t.includes("认定") || t.includes("高企") || t.includes("专精特新") || t.includes("科技型") || t.includes("数字化转型");
    });
    check("T25 OPC 搜索结果为政策类", opcHasPolicy, `titles=${opcTitles.slice(0, 150)}`);

    // T26 文创 POST /api/search
    const resCultural = await fetch(`http://localhost:${port}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enable_content_fetch: false, spec: culturalSpec }),
    });
    const culturalJson = (await resCultural.json()) as { success?: boolean; data?: { opportunities?: Opp[] }; error?: { message?: string } };
    check("T26 文创 POST /api/search 返回 200", resCultural.status === 200, `status=${resCultural.status}`);
    check("T26.1 文创 search success=true", culturalJson.success === true, culturalJson.error?.message ?? "");

    const culturalOpps = culturalJson.data?.opportunities ?? [];
    const culturalTitles = culturalOpps.map((o) => o.search_result?.title || "").join(" | ");
    const culturalHasHeritage = culturalOpps.some((o) => {
      const t = o.search_result?.title || "";
      return t.includes("非遗") || t.includes("文创") || t.includes("文化") || t.includes("传承") || t.includes("工艺");
    });
    check("T27 文创搜索结果为文创类", culturalHasHeritage, `titles=${culturalTitles.slice(0, 150)}`);

    // 验证数据不混淆：OPC 不含 AI 比赛关键词
    const opcHasAiContest = opcOpps.some((o) => {
      const t = o.search_result?.title || "";
      return t.includes("AI 比赛") || t.includes("黑客松") || t.includes("挑战杯");
    });
    check("OPC 数据不混淆（不含 AI 比赛关键词）", !opcHasAiContest, `titles=${opcTitles.slice(0, 100)}`);

    // 验证数据不混淆：文创不含 AI 比赛关键词
    const culturalHasAiContest = culturalOpps.some((o) => {
      const t = o.search_result?.title || "";
      return t.includes("AI 比赛") || t.includes("黑客松") || t.includes("挑战杯");
    });
    check("文创数据不混淆（不含 AI 比赛关键词）", !culturalHasAiContest, `titles=${culturalTitles.slice(0, 100)}`);
  } finally {
    server.close();
  }
}

// ============================================================
// 9. 回归测试
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
  section("9. 回归测试");
  runRegressionTest("verify-e2e-ai-events.ts", "T21 verify-e2e-ai-events");
  runRegressionTest("verify-task041.ts", "T22 verify-task041");
  runRegressionTest("verify-task040.ts", "T23 verify-task040");
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 042 验收检查：OPC/文创 Demo 数据 + loadDemoData 修复 ===\n");

  checkFileExistence();
  checkOpcMockData();
  checkCulturalMockData();
  checkLoadDemoData();
  checkLlmResponses();
  checkThreeRadarsScript();
  checkPackageJson();
  await checkApiIntegration();
  if (process.env.SKIP_REGRESSION === "1") {
    console.log("\n--- 跳过回归测试（SKIP_REGRESSION=1） ---");
  } else {
    checkRegression();
  }

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
