/**
 * Task V1.5-05 验收脚本：AI 生成器
 *
 * 运行：npx tsx scripts/verify-task-v1.5-05-generator.ts
 *
 * 验证范围（17 项断言，回归 4 项由外部命令运行）：
 *   6.1 RadarSpecValidator（1-3）：完整/缺1字段/缺2字段
 *   6.2 RadarSpecCompiler（4-6）：custom 编译/keywords 来源/固定类型委托
 *   6.3 RadarGenerator（7-11）：Mock 生成/spec 非空/suggestedName/completeness/extractedInfo
 *   6.4 API 端点（12-15）：POST /generate 200/无 description 400/spec 含 keywords/completeness 是数字
 *   6.5 前端（16-17）：radars.js 含 AI 生成函数/调用 POST /api/radars/generate
 *   6.6 回归（18-21）：tsc + verify-e2e-v13 + verify-task-v1.5-03-api + verify-task-v1.5-04-ui（外部命令）
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
import { validateRadarSpec } from "../src/schema/radar-spec-validator";
import { RadarSpecCompiler } from "../src/agents/radar-spec-compiler";
import { RadarGenerator } from "../src/agents/radar-generator";
import { createDefaultSpec } from "../src/schema/radar-requirement-spec";
import { createDefaultScoringRules } from "../src/schema/scoring-rules";
import type { ExtractedRequirementInfo } from "../src/schema/extracted-requirement-info";
import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";

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

const TEMP_RADARS_FILE = "data/radars-v1.5.05-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.5.05-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.5.05-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.5.05-test.txt";

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
// 构造测试用 Spec / Info
// ============================================================

/** 构造完整 Spec（10 字段全部满足） */
function buildFullSpec(): RadarRequirementSpec {
  const base = createDefaultSpec();
  return {
    ...base,
    keyword_strategy: {
      ...base.keyword_strategy,
      core_keywords_zh: ["RPA", "自动化", "比赛"],
    },
    region_scope: {
      ...base.region_scope,
      primary_regions: ["全国"],
    },
    // scoring_rules 用默认（含 weights + visible_level_mapping，已满足校验）
    scoring_rules: createDefaultScoringRules(),
  };
}

/** 构造测试用 ExtractedRequirementInfo */
function buildTestInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {
      client_type: "个人",
      industry: "信息技术",
      business_type: "自动化",
      core_capabilities: ["RPA 开发"],
      products_or_projects: [],
      company_stage: "",
      regions: ["全国"],
      notes: "",
    },
    business_goal: {
      primary_goal: "盯 RPA 比赛",
      secondary_goals: [],
      success_definition: "及时获取比赛信息",
      priority_order: ["奖金"],
    },
    opportunity_type: {
      primary_types: ["RPA", "自动化", "比赛"],
      secondary_types: ["机器人流程自动化"],
      excluded_types: [],
      must_have_conditions: [],
    },
    region_scope: {
      primary_regions: ["全国"],
      secondary_regions: [],
      excluded_regions: [],
      overseas_allowed: false,
      global_allowed: false,
    },
    exclusion_rules: {
      must_exclude: ["已过期", "需付费"],
      low_priority_signals: [],
      count: 2,
    },
    action_scenario: {
      action_intent: "报名比赛",
      priority_order: ["奖金"],
    },
    report_format: {
      frequency: "每周",
      format: "markdown",
      must_include_sections: [],
    },
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task V1.5-05 验收检查：AI 生成器 ===\n");

  // 确保 mock 模式
  process.env.DATA_MODE = process.env.DATA_MODE ?? "mock";
  process.env.LLM_MODE = process.env.LLM_MODE ?? "mock";

  // ============================================================
  // 6.1 RadarSpecValidator（1-3）
  // ============================================================
  section("6.1 RadarSpecValidator");

  // 1. 传入完整 Spec → completeness=100, passed=true
  {
    const fullSpec = buildFullSpec();
    const result = validateRadarSpec(fullSpec);
    check(
      "1. 完整 Spec → completeness=100, passed=true",
      result.completeness === 100 && result.passed === true,
      `completeness=${result.completeness}, passed=${result.passed}, missing=${JSON.stringify(result.missingFields)}`,
    );
  }

  // 2. 传入缺 keywords 的 Spec → completeness=90, missingFields 含 "keywords"
  {
    const specMissingKeywords = buildFullSpec();
    specMissingKeywords.keyword_strategy = {
      ...specMissingKeywords.keyword_strategy,
      core_keywords_zh: [],
    };
    const result = validateRadarSpec(specMissingKeywords);
    check(
      "2. 缺 keywords → completeness=90, missingFields 含 keywords",
      result.completeness === 90 && result.missingFields.includes("keywords"),
      `completeness=${result.completeness}, missing=${JSON.stringify(result.missingFields)}`,
    );
  }

  // 3. 传入缺 2 个字段的 Spec → completeness=80, passed=false
  {
    const specMissingTwo = buildFullSpec();
    specMissingTwo.keyword_strategy = {
      ...specMissingTwo.keyword_strategy,
      core_keywords_zh: [],
    };
    specMissingTwo.region_scope = {
      ...specMissingTwo.region_scope,
      primary_regions: [],
    };
    const result = validateRadarSpec(specMissingTwo);
    check(
      "3. 缺 2 字段 → completeness=80, passed=false",
      result.completeness === 80 && result.passed === false && result.missingFields.length >= 2,
      `completeness=${result.completeness}, passed=${result.passed}, missing=${JSON.stringify(result.missingFields)}`,
    );
  }

  // ============================================================
  // 6.2 RadarSpecCompiler（4-6）
  // ============================================================
  section("6.2 RadarSpecCompiler");

  const compiler = new RadarSpecCompiler();
  const testInfo = buildTestInfo();

  // 4. compile(info, "custom") → 返回 RadarRequirementSpec
  {
    const spec = compiler.compile(testInfo, "custom");
    check(
      "4. compile(info, custom) 返回 RadarRequirementSpec",
      spec !== null && spec !== undefined && typeof spec === "object" && Array.isArray(spec.keyword_strategy?.core_keywords_zh),
      `spec=${spec ? "object" : "null"}`,
    );
  }

  // 5. 返回的 spec.keywords 从 info.opportunity_type.primary_types 取
  {
    const spec = compiler.compile(testInfo, "custom");
    const expectedKeywords: string[] = testInfo.opportunity_type?.primary_types ?? [];
    const actualKeywords = spec.keyword_strategy?.core_keywords_zh ?? [];
    check(
      "5. spec.keywords 从 info.opportunity_type.primary_types 取",
      Array.isArray(actualKeywords) &&
        expectedKeywords.length > 0 &&
        expectedKeywords.every((k) => actualKeywords.includes(k)),
      `expected=${JSON.stringify(expectedKeywords)}, actual=${JSON.stringify(actualKeywords)}`,
    );
  }

  // 6. compile(info, "ai_competition") → 委托给原 SpecCompiler（结果非空 + product_name 正确）
  {
    const spec = compiler.compile(testInfo, "ai_competition");
    const hasProductName = typeof spec.product_name === "string" && spec.product_name.length > 0;
    const hasKeywords = Array.isArray(spec.keyword_strategy?.core_keywords_zh);
    check(
      "6. compile(info, ai_competition) 委托原 SpecCompiler（非空 + product_name 正确）",
      spec !== null && spec !== undefined && hasProductName && hasKeywords,
      `product_name=${spec.product_name}, hasKeywords=${hasKeywords}`,
    );
  }

  // ============================================================
  // 6.3 RadarGenerator（7-11）
  // ============================================================
  section("6.3 RadarGenerator（Mock 模式）");

  // 使用 Mock LLM 适配器（ModelRouter 在 LLM_MODE=mock 下返回 mock）
  const generator = new RadarGenerator(new ModelRouter());

  // 7. Mock 模式 generate("我要盯 RPA 相关的比赛") → 返回 RadarGenerateResult
  let genResult: Awaited<ReturnType<typeof generator.generate>> | null = null;
  try {
    genResult = await generator.generate("我要盯 RPA 相关的比赛");
    check(
      "7. Mock generate 返回 RadarGenerateResult",
      genResult !== null && genResult !== undefined && typeof genResult === "object",
      `result=${genResult ? "object" : "null"}`,
    );
  } catch (err) {
    check("7. Mock generate 返回 RadarGenerateResult", false, `异常: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 8. 返回的 spec 非空
  {
    const spec = genResult?.spec;
    check(
      "8. 返回的 spec 非空",
      spec !== null && spec !== undefined && typeof spec === "object" && Array.isArray(spec.keyword_strategy?.core_keywords_zh),
      `spec=${spec ? "object" : "null"}`,
    );
  }

  // 9. 返回的 suggestedName 非空(≤20 字)
  {
    const name = genResult?.suggestedName ?? "";
    check(
      "9. suggestedName 非空(≤20 字)",
      typeof name === "string" && name.length > 0 && name.length <= 20,
      `name="${name}", len=${name.length}`,
    );
  }

  // 10. 返回的 completeness ≥ 90
  {
    const completeness = genResult?.completeness ?? 0;
    check(
      "10. completeness ≥ 90（Mock 预设完整数据）",
      typeof completeness === "number" && completeness >= 90,
      `completeness=${completeness}`,
    );
  }

  // 11. 返回的 extractedInfo 非空
  {
    const info = genResult?.extractedInfo;
    const hasPrimaryTypes = Array.isArray(info?.opportunity_type?.primary_types) && (info?.opportunity_type?.primary_types?.length ?? 0) > 0;
    check(
      "11. extractedInfo 非空",
      info !== null && info !== undefined && typeof info === "object" && hasPrimaryTypes,
      `info=${info ? "object" : "null"}, hasPrimaryTypes=${hasPrimaryTypes}`,
    );
  }

  // ============================================================
  // 6.4 API 端点（12-15）
  // ============================================================
  section("6.4 API 端点");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // 12. POST /api/radars/generate 传 description → 200
  {
    const res = await app.request("/api/radars/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "我要盯 RPA 相关的比赛" }),
    });
    const json = await parseResponse(res);
    check(
      "12. POST /api/radars/generate 传 description → 200",
      res.status === 200 && json.success === true,
      `status=${res.status}, success=${json.success}, msg=${json.error?.message ?? ""}`,
    );

    // 14. 返回的 spec 含 keywords 数组
    const data = json.data as { spec?: { keyword_strategy?: { core_keywords_zh?: unknown[] } } } | null;
    const keywords = data?.spec?.keyword_strategy?.core_keywords_zh;
    check(
      "14. 返回的 spec 含 keywords 数组",
      Array.isArray(keywords) && keywords.length > 0,
      `keywords=${JSON.stringify(keywords)}`,
    );

    // 15. 返回的 completeness 是数字
    const completeness = (json.data as { completeness?: unknown } | null)?.completeness;
    check(
      "15. 返回的 completeness 是数字",
      typeof completeness === "number" && !Number.isNaN(completeness),
      `completeness=${completeness} (${typeof completeness})`,
    );
  }

  // 13. POST /api/radars/generate 不传 description → 400
  {
    const res = await app.request("/api/radars/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await parseResponse(res);
    check(
      "13. 不传 description → 400",
      res.status === 400 && json.success === false,
      `status=${res.status}, success=${json.success}`,
    );
  }

  // ============================================================
  // 6.5 前端（16-17）
  // ============================================================
  section("6.5 前端");

  const radarsJs = readFileText("web/radars.js");
  const indexHtml = readFileText("web/index.html");

  // 16. web/radars.js 含"AI 生成"相关函数
  {
    const hasOpenGenerateModal = radarsJs.includes("openGenerateModal");
    const hasSubmitGenerate = radarsJs.includes("submitGenerate");
    const hasRenderGenerateResult = radarsJs.includes("renderGenerateResult");
    const hasAiGenerateButton = indexHtml.includes('id="btn-ai-generate"');
    check(
      "16. radars.js 含 AI 生成函数 + index.html 含 AI 生成按钮",
      hasOpenGenerateModal && hasSubmitGenerate && hasRenderGenerateResult && hasAiGenerateButton,
      `openGenerateModal=${hasOpenGenerateModal}, submitGenerate=${hasSubmitGenerate}, renderGenerateResult=${hasRenderGenerateResult}, btn-ai-generate=${hasAiGenerateButton}`,
    );
  }

  // 17. web/radars.js 调用 POST /api/radars/generate
  {
    const callsGenerate = /fetch\(["'`]\/api\/radars\/generate["'`],\s*\{\s*method:\s*["'`]POST/.test(radarsJs);
    check(
      "17. radars.js 调用 POST /api/radars/generate",
      callsGenerate,
      `callsGenerate=${callsGenerate}`,
    );
  }

  // ============================================================
  // 6.6 回归（18-21）—— 由外部命令运行
  // ============================================================
  section("6.6 回归 - 由外部命令运行");
  console.log("  (跳过) 18. tsc --noEmit              -> 外部命令: npx tsc --noEmit");
  console.log("  (跳过) 19. verify-e2e-v13.ts         -> 外部命令: npx tsx scripts/verify-e2e-v13.ts");
  console.log("  (跳过) 20. verify-task-v1.5-03-api.ts -> 外部命令: npx tsx scripts/verify-task-v1.5-03-api.ts");
  console.log("  (跳过) 21. verify-task-v1.5-04-ui.ts  -> 外部命令: npx tsx scripts/verify-task-v1.5-04-ui.ts");

  // 清理临时文件
  cleanupTempFiles();

  // ============================================================
  // 总结
  // ============================================================
  console.log("");
  console.log("=== 验收结果（V1.5-05 AI 生成器 1-17）===");
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
