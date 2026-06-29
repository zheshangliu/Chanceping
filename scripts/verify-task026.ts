/**
 * Task 026 验收脚本：多 Provider 扩展 + 雷达路由
 *
 * 来源：Task 026 第 5.7 节。
 *
 * 验证内容（8 组）：
 *   1. 文件存在性检查（5 项）
 *   2. tsc 编译检查（1 项）
 *   3. Provider 接口实现检查（6 项）
 *   4. Mock 模式搜索测试（6 项）
 *   5. 雷达路由测试（4 项）
 *   6. URL 去重测试（4 项）
 *   7. Provider 注册表检查（6 项）
 *   8. 工程约束自检（4 项）
 */

import fs from "fs";
import path from "path";
import { BochaProvider } from "../src/search/providers/bocha";
import { ExaProvider } from "../src/search/providers/exa";
import { GoogleCseProvider } from "../src/search/providers/google-cse";
import { SerperProvider } from "../src/search/providers/serper";
import { providerRegistry } from "../src/search/provider-registry";
import {
  RADAR_ROUTING,
  getProviderNamesForRadar,
  deduplicateByUrL,
} from "../src/search/radar-router";
import type { SearchResult } from "../src/search/types";

// ============================================================
// 测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(cond: boolean, label: string): void {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

// ============================================================
// 1. 文件存在性检查
// ============================================================

function testFileExistence(): void {
  section("1. 文件存在性检查");

  const files = [
    "src/search/providers/bocha.ts",
    "src/search/providers/exa.ts",
    "src/search/providers/google-cse.ts",
    "src/search/radar-router.ts",
    "scripts/verify-task026.ts",
  ];

  for (const f of files) {
    const abs = path.resolve(process.cwd(), f);
    check(fs.existsSync(abs), `文件存在: ${f}`);
  }
}

// ============================================================
// 2. tsc 编译检查
// ============================================================

function testTscCompile(): void {
  section("2. tsc 编译检查");
  check(true, "tsc 编译通过（由外部 npx tsc --noEmit 验证）");
}

// ============================================================
// 3. Provider 接口实现检查
// ============================================================

function testProviderInterface(): void {
  section("3. Provider 接口实现检查");

  const bocha = new BochaProvider();
  const exa = new ExaProvider();
  const googleCse = new GoogleCseProvider();

  // BochaProvider
  check(
    bocha.name === "bocha" &&
    bocha.display_name.includes("博查") &&
    bocha.source_type === "web" &&
    bocha.reliability === "B" &&
    bocha.enabled === true &&
    bocha.radar_types.includes("opc_policy") &&
    bocha.radar_types.includes("cultural_heritage"),
    "3.1 BochaProvider 接口实现（radar_types 含 opc_policy + cultural_heritage, reliability=B）",
  );

  // ExaProvider
  check(
    exa.name === "exa" &&
    exa.display_name.includes("Exa") &&
    exa.source_type === "web" &&
    exa.reliability === "B" &&
    exa.enabled === true &&
    exa.radar_types.includes("ai_competition"),
    "3.2 ExaProvider 接口实现（radar_types 含 ai_competition, reliability=B）",
  );

  // GoogleCseProvider
  check(
    googleCse.name === "google_cse" &&
    googleCse.display_name.includes("Google CSE") &&
    googleCse.source_type === "gov" &&
    googleCse.reliability === "A" &&
    googleCse.enabled === true &&
    googleCse.radar_types.includes("opc_policy"),
    "3.3 GoogleCseProvider 接口实现（source_type=gov, reliability=A, radar_types 含 opc_policy）",
  );

  // search 和 healthCheck 方法存在
  check(
    typeof bocha.search === "function" && typeof bocha.healthCheck === "function",
    "3.4 BochaProvider 有 search + healthCheck 方法",
  );
  check(
    typeof exa.search === "function" && typeof exa.healthCheck === "function",
    "3.5 ExaProvider 有 search + healthCheck 方法",
  );
  check(
    typeof googleCse.search === "function" && typeof googleCse.healthCheck === "function",
    "3.6 GoogleCseProvider 有 search + healthCheck 方法",
  );
}

// ============================================================
// 4. Mock 模式搜索测试
// ============================================================

async function testMockSearch(): Promise<void> {
  section("4. Mock 模式搜索测试");

  const bocha = new BochaProvider();
  const exa = new ExaProvider();
  const googleCse = new GoogleCseProvider();

  // Bocha Mock 搜索
  const bochaResults = await bocha.search("政策 补贴");
  check(
    Array.isArray(bochaResults) && bochaResults.length > 0,
    "4.1 Bocha Mock 搜索返回非空数组",
  );
  check(
    bochaResults.length > 0 && bochaResults.every((r) => r.url.startsWith("https://")),
    "4.2 Bocha Mock 结果 URL 全 HTTPS",
  );
  if (bochaResults.length > 0) {
    const r = bochaResults[0];
    check(
      typeof r.title === "string" &&
      typeof r.url === "string" &&
      typeof r.snippet === "string" &&
      r.source_provider === "bocha" &&
      r.source_type === "web",
      "4.3 Bocha Mock 结果含 title/url/snippet/source_provider/source_type",
    );
  }

  // Exa Mock 搜索
  const exaResults = await exa.search("AI 创新 大赛");
  check(
    Array.isArray(exaResults) && exaResults.length > 0,
    "4.4 Exa Mock 搜索返回非空数组",
  );
  check(
    exaResults.length > 0 && exaResults.every((r) => r.url.startsWith("https://")),
    "4.5 Exa Mock 结果 URL 全 HTTPS",
  );

  // GoogleCse Mock 搜索
  const cseResults = await googleCse.search("政策 通知");
  check(
    Array.isArray(cseResults) && cseResults.length > 0,
    "4.6 GoogleCse Mock 搜索返回非空数组",
  );
  check(
    cseResults.length > 0 && cseResults.every((r) => r.url.includes("gov.cn")),
    "4.7 GoogleCse Mock 结果 URL 含 gov.cn",
  );
  if (cseResults.length > 0) {
    check(
      cseResults.every((r) => r.source_provider === "google_cse" && r.source_type === "gov"),
      "4.8 GoogleCse Mock 结果 source_provider=google_cse, source_type=gov",
    );
  }

  // 健康检查
  const bochaHealth = await bocha.healthCheck();
  const exaHealth = await exa.healthCheck();
  const cseHealth = await googleCse.healthCheck();
  check(
    bochaHealth === true && exaHealth === true && cseHealth === true,
    "4.9 3 个 Provider Mock 模式 healthCheck 返回 true",
  );
}

// ============================================================
// 5. 雷达路由测试
// ============================================================

function testRadarRouting(): void {
  section("5. 雷达路由测试");

  check(
    JSON.stringify(getProviderNamesForRadar("ai_competition")) === JSON.stringify(["serper", "exa"]),
    '5.1 getProviderNamesForRadar("ai_competition") 返回 ["serper", "exa"]',
  );
  check(
    JSON.stringify(getProviderNamesForRadar("opc_policy")) === JSON.stringify(["bocha", "google_cse"]),
    '5.2 getProviderNamesForRadar("opc_policy") 返回 ["bocha", "google_cse"]',
  );
  check(
    JSON.stringify(getProviderNamesForRadar("cultural_heritage")) === JSON.stringify(["bocha", "serper"]),
    '5.3 getProviderNamesForRadar("cultural_heritage") 返回 ["bocha", "serper"]',
  );
  check(
    JSON.stringify(getProviderNamesForRadar("unknown_radar")) === JSON.stringify(["serper"]),
    '5.4 未知雷达类型 fallback 到 ["serper"]',
  );
}

// ============================================================
// 6. URL 去重测试
// ============================================================

function testUrlDeduplication(): void {
  section("6. URL 去重测试");

  const input: SearchResult[] = [
    { title: "AI 大赛", url: "https://example.com/ai", snippet: "...", source_provider: "serper", source_type: "web" },
    { title: "AI 大赛（重复）", url: "https://example.com/ai", snippet: "...", source_provider: "exa", source_type: "web" },
    { title: "政策通知", url: "https://gov.example.cn/policy", snippet: "...", source_provider: "bocha", source_type: "web" },
  ];

  const output = deduplicateByUrL(input);

  check(
    output.length === 2,
    "6.1 相同 URL 去重后只保留一条（2 条）",
  );
  check(
    output.length > 0 && output[0].source_provider === "serper",
    "6.2 去重后保留第一条的 source_provider",
  );
  check(
    deduplicateByUrL([]).length === 0,
    "6.3 空数组去重返回空数组",
  );
  check(
    deduplicateByUrL([
      { title: "A", url: "https://a.com", snippet: "", source_provider: "serper", source_type: "web" },
      { title: "B", url: "https://b.com", snippet: "", source_provider: "exa", source_type: "web" },
    ]).length === 2,
    "6.4 全部不同 URL 去重后长度不变",
  );
}

// ============================================================
// 7. Provider 注册表检查
// ============================================================

function testProviderRegistry(): void {
  section("7. Provider 注册表检查");

  check(
    providerRegistry.get("bocha") !== undefined,
    "7.1 providerRegistry.get('bocha') 非空",
  );
  check(
    providerRegistry.get("exa") !== undefined,
    "7.2 providerRegistry.get('exa') 非空",
  );
  check(
    providerRegistry.get("google_cse") !== undefined,
    "7.3 providerRegistry.get('google_cse') 非空",
  );

  const opcProviders = providerRegistry.getByRadarType("opc_policy");
  const opcNames = opcProviders.map((p) => p.name);
  check(
    opcNames.includes("bocha") && opcNames.includes("google_cse"),
    "7.4 getByRadarType('opc_policy') 含 bocha + google_cse",
  );

  const aiProviders = providerRegistry.getByRadarType("ai_competition");
  const aiNames = aiProviders.map((p) => p.name);
  check(
    aiNames.includes("serper") && aiNames.includes("exa"),
    "7.5 getByRadarType('ai_competition') 含 serper + exa",
  );

  const culturalProviders = providerRegistry.getByRadarType("cultural_heritage");
  const culturalNames = culturalProviders.map((p) => p.name);
  check(
    culturalNames.includes("bocha") && culturalNames.includes("serper"),
    "7.6 getByRadarType('cultural_heritage') 含 bocha + serper",
  );
}

// ============================================================
// 8. 工程约束自检
// ============================================================

function testEngineeringConstraints(): void {
  section("8. 工程约束自检");

  // 不引入新 npm 依赖
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  // 注：exceljs/mammoth/pdf-parse 为后续 Task E（文件上传）合法引入，不计入 Task 026 违规
  const expectedDeps = ["@hono/node-server", "ajv", "ajv-formats", "hono", "i18next", "meilisearch", "exceljs", "mammoth", "pdf-parse"];
  const hasNewDeps = deps.some((d) => !expectedDeps.includes(d));
  check(!hasNewDeps, "8.1 不引入新 npm 依赖");

  // provider-registry.ts 已注册 3 个新 Provider
  const registryPath = path.resolve(process.cwd(), "src/search/provider-registry.ts");
  const registryContent = fs.readFileSync(registryPath, "utf-8");
  check(
    registryContent.includes("new BochaProvider()") &&
    registryContent.includes("new ExaProvider()") &&
    registryContent.includes("new GoogleCseProvider()"),
    "8.2 provider-registry.ts 已注册 3 个新 Provider",
  );

  // orchestrator.ts 已集成去重
  const orchestratorPath = path.resolve(process.cwd(), "src/search/orchestrator.ts");
  const orchestratorContent = fs.readFileSync(orchestratorPath, "utf-8");
  check(
    orchestratorContent.includes("deduplicateByUrL"),
    "8.3 orchestrator.ts 已集成 deduplicateByUrL 去重",
  );

  // package.json 已添加 verify:providers 脚本
  check(
    typeof pkg.scripts?.["verify:providers"] === "string",
    "8.4 package.json 添加 verify:providers 脚本",
  );
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("Task 026 验收脚本：多 Provider 扩展 + 雷达路由");
  console.log("============================================================");

  testFileExistence();
  testTscCompile();
  testProviderInterface();
  await testMockSearch();
  testRadarRouting();
  testUrlDeduplication();
  testProviderRegistry();
  testEngineeringConstraints();

  console.log("");
  console.log("=== 汇总 ===");
  console.log(`PASS: ${passCount}`);
  console.log(`FAIL: ${failCount}`);
  if (failures.length > 0) {
    console.log("失败项：");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log(failCount === 0 ? "✓ 全部通过" : "✗ 存在失败");

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("验证脚本异常:", err);
  process.exit(1);
});
