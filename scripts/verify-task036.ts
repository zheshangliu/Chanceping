/**
 * Task 036 验收脚本：Demo 数据模式与 LLM Mock 定义
 *
 * 来源：Task 036 第 7 节验收标准。
 *
 * 18 项验收（T1-T18）：
 *   T1  tsc 编译            npx tsc --noEmit exit 0
 *   T2  precheck            npm run precheck exit 0
 *   T3  data-mode.ts 存在   含 DATA_MODE + LLM_MODE 切换逻辑
 *   T4  Mock 数据存在       ai-events.mock.json 含 5 条机会
 *   T5  Recorded 数据存在   ai-events.recorded.json 含 5 条机会 + 来源字段
 *   T6  LLM 响应存在        llm-responses.mock.json 含确认卡 + 精筛结果
 *   T7  MockLlmAdapter 存在 实现 LLMAdapter 接口
 *   T8  DATA_MODE=mock      加载 Mock 数据
 *   T9  DATA_MODE=recorded  加载 Recorded 数据
 *   T10 LLM_MODE=mock       返回 MockLlmAdapter
 *   T11 Mock 数据质量       每条机会有 title/url/snippet/deadline_status
 *   T12 Mock 数据等级覆盖   5 条覆盖 S/A/B/C
 *   T13 deadline_status 覆盖 至少含 confirmed + rolling
 *   T14 Recorded 来源字段   每条含 recorded_at/query/provider/verification_status
 *   T15 Mock LLM 响应       确认卡含 7 维度，精筛含 5 条结果
 *   T16 package.json 脚本   npm run verify:task036 可执行
 *   T17 verify-task034 回归 100 PASS / 0 FAIL
 *   T18 precheck            exit 0（与 T2 合并）
 *
 * 运行：npx tsx scripts/verify-task036.ts
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { getDataMode, getLlmMode, isMockData, isRecordedData, isMockLlm } from "../src/demo/data-mode";
import {
  loadDemoOpportunities,
  loadMockLlmResponses,
  type DemoOpportunity,
} from "../src/demo";
import { MockLlmAdapter } from "../src/demo/mock-llm-adapter";
import { createAdapter } from "../src/agents/model-router";

// ============================================================
// 测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];
let sectionCount = 1;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passCount++;
  } else {
    console.log(`  FAIL  ${message}`);
    failCount++;
    failures.push(message);
  }
}

function section(title: string): void {
  console.log(`\n[验收 ${sectionCount}] ${title}\n`);
  sectionCount++;
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.resolve(process.cwd(), relativePath));
}

function readFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) return "";
  return fs.readFileSync(fullPath, "utf-8");
}

function runCommand(cmd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// 环境变量备份/恢复工具
const envBackup: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined): void {
  if (!(key in envBackup)) {
    envBackup[key] = process.env[key];
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
function restoreEnv(): void {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ============================================================
// T1: tsc 编译
// ============================================================

function checkTsc(): void {
  section("T1: tsc 编译（npx tsc --noEmit）");
  console.log("  运行中... (可能需要 10-30 秒)");
  const result = runCommand("npx", ["tsc", "--noEmit"]);
  assert(result.status === 0, "T1: npx tsc --noEmit exit 0");
  if (result.status !== 0) {
    console.log(`  --- tsc stderr ---\n${result.stderr.slice(0, 500)}\n  --- end ---`);
  }
}

// ============================================================
// T2/T18: precheck
// ============================================================

function checkPrecheck(): void {
  section("T2/T18: precheck（npm run precheck）");
  console.log("  运行中... (可能需要 20-60 秒)");
  const result = runCommand("npm", ["run", "precheck"]);
  assert(result.status === 0, "T2: npm run precheck exit 0");
  assert(result.status === 0, "T18: precheck exit 0（与 T2 合并）");
  if (result.status !== 0) {
    console.log(`  --- precheck stderr ---\n${result.stderr.slice(0, 500)}\n  --- end ---`);
  }
}

// ============================================================
// T3-T7: 文件存在性检查
// ============================================================

function checkFilesExist(): void {
  section("T3-T7: 文件存在性检查");

  // T3: data-mode.ts
  const dataModeExists = fileExists("src/demo/data-mode.ts");
  assert(dataModeExists, "T3: src/demo/data-mode.ts 存在");
  if (dataModeExists) {
    const content = readFile("src/demo/data-mode.ts");
    assert(content.includes("DataMode"), "T3: data-mode.ts 含 DataMode 类型");
    assert(content.includes("LlmMode"), "T3: data-mode.ts 含 LlmMode 类型");
    assert(content.includes("getDataMode"), "T3: data-mode.ts 含 getDataMode 函数");
    assert(content.includes("getLlmMode"), "T3: data-mode.ts 含 getLlmMode 函数");
  }

  // T4: ai-events.mock.json
  const mockExists = fileExists("src/demo/ai-events.mock.json");
  assert(mockExists, "T4: src/demo/ai-events.mock.json 存在");
  if (mockExists) {
    const data = JSON.parse(readFile("src/demo/ai-events.mock.json"));
    assert(Array.isArray(data.opportunities) && data.opportunities.length === 5, "T4: Mock 数据含 5 条机会");
  }

  // T5: ai-events.recorded.json
  const recordedExists = fileExists("src/demo/ai-events.recorded.json");
  assert(recordedExists, "T5: src/demo/ai-events.recorded.json 存在");
  if (recordedExists) {
    const data = JSON.parse(readFile("src/demo/ai-events.recorded.json"));
    assert(Array.isArray(data.opportunities) && data.opportunities.length === 5, "T5: Recorded 数据含 5 条机会");
  }

  // T6: llm-responses.mock.json
  const llmRespExists = fileExists("src/demo/llm-responses.mock.json");
  assert(llmRespExists, "T6: src/demo/llm-responses.mock.json 存在");
  if (llmRespExists) {
    const data = JSON.parse(readFile("src/demo/llm-responses.mock.json"));
    assert(!!data.requirement_confirmation, "T6: 含 requirement_confirmation");
    assert(!!data.ai_filter, "T6: 含 ai_filter");
  }

  // T7: mock-llm-adapter.ts
  const adapterExists = fileExists("src/demo/mock-llm-adapter.ts");
  assert(adapterExists, "T7: src/demo/mock-llm-adapter.ts 存在");
  if (adapterExists) {
    const content = readFile("src/demo/mock-llm-adapter.ts");
    assert(content.includes("class MockLlmAdapter"), "T7: 含 MockLlmAdapter 类");
    assert(content.includes("implements LLMAdapter"), "T7: 实现 LLMAdapter 接口");
  }
}

// ============================================================
// T8-T10: 模式切换逻辑
// ============================================================

function checkModeSwitch(): void {
  section("T8-T10: 模式切换逻辑");

  // T8: DATA_MODE=mock 时加载 Mock 数据
  setEnv("DATA_MODE", "mock");
  assert(getDataMode() === "mock", "T8: DATA_MODE=mock 时 getDataMode() === 'mock'");
  assert(isMockData() === true, "T8: DATA_MODE=mock 时 isMockData() === true");
  let mockData: DemoOpportunity[] = [];
  try {
    mockData = loadDemoOpportunities("ai_competition", "mock");
    assert(mockData.length === 5, "T8: loadDemoOpportunities(mode=mock) 返回 5 条");
    assert(mockData[0].title.includes("AI 创新大赛"), "T8: Mock 数据首条标题正确");
  } catch (err) {
    assert(false, `T8: 加载 Mock 数据失败: ${(err as Error).message}`);
  }

  // T9: DATA_MODE=recorded 时加载 Recorded 数据
  setEnv("DATA_MODE", "recorded");
  assert(getDataMode() === "recorded", "T9: DATA_MODE=recorded 时 getDataMode() === 'recorded'");
  assert(isRecordedData() === true, "T9: DATA_MODE=recorded 时 isRecordedData() === true");
  try {
    const recordedData = loadDemoOpportunities("ai_competition", "recorded");
    assert(recordedData.length === 5, "T9: loadDemoOpportunities(mode=recorded) 返回 5 条");
    assert(recordedData[0].title.includes("录制"), "T9: Recorded 数据首条标题含'录制'标记");
  } catch (err) {
    assert(false, `T9: 加载 Recorded 数据失败: ${(err as Error).message}`);
  }

  // T10: LLM_MODE=mock 时返回 MockLlmAdapter
  setEnv("LLM_MODE", "mock");
  assert(getLlmMode() === "mock", "T10: LLM_MODE=mock 时 getLlmMode() === 'mock'");
  assert(isMockLlm() === true, "T10: LLM_MODE=mock 时 isMockLlm() === true");
  try {
    const adapter = createAdapter();
    assert(adapter instanceof MockLlmAdapter, "T10: createAdapter() 返回 MockLlmAdapter 实例");
  } catch (err) {
    assert(false, `T10: createAdapter() 失败: ${(err as Error).message}`);
  }

  // 恢复环境变量
  restoreEnv();
}

// ============================================================
// T11-T13: Mock 数据质量
// ============================================================

function checkMockDataQuality(): void {
  section("T11-T13: Mock 数据质量");

  let mockData: DemoOpportunity[] = [];
  try {
    mockData = loadDemoOpportunities("ai_competition", "mock");
  } catch (err) {
    assert(false, `T11: 加载 Mock 数据失败: ${(err as Error).message}`);
    return;
  }

  // T11: 每条机会有 title/url/snippet/deadline_status
  let allFieldsOk = true;
  for (const opp of mockData) {
    if (!opp.title || !opp.url || !opp.snippet || !opp.deadline_status) {
      allFieldsOk = false;
      console.log(`  --- 缺失字段: ${opp.title || "(无标题)"} ---`);
    }
  }
  assert(allFieldsOk, "T11: 每条机会含 title/url/snippet/deadline_status");

  // T12: 5 条覆盖 S/A/B/C 不同等级
  const levels = new Set(mockData.map((o) => o.expected_level));
  assert(levels.has("S"), "T12: 含 S 级");
  assert(levels.has("A"), "T12: 含 A 级");
  assert(levels.has("B"), "T12: 含 B 级");
  assert(levels.has("C"), "T12: 含 C 级");
  assert(levels.size >= 4, `T12: 覆盖 S/A/B/C 四个等级（实际 ${levels.size} 个）`);

  // T13: deadline_status 覆盖 confirmed + rolling
  const statuses = new Set(mockData.map((o) => o.deadline_status));
  assert(statuses.has("confirmed"), "T13: 含 confirmed 状态");
  assert(statuses.has("rolling"), "T13: 含 rolling 状态");
  assert(statuses.size >= 2, `T13: 至少含 confirmed + rolling（实际 ${statuses.size} 个）`);
}

// ============================================================
// T14: Recorded 来源字段
// ============================================================

function checkRecordedSourceFields(): void {
  section("T14: Recorded 数据来源字段");

  let recordedData: DemoOpportunity[] = [];
  try {
    recordedData = loadDemoOpportunities("ai_competition", "recorded");
  } catch (err) {
    assert(false, `T14: 加载 Recorded 数据失败: ${(err as Error).message}`);
    return;
  }

  const requiredFields = ["recorded_at", "query", "provider", "verification_status"] as const;
  let allFieldsOk = true;
  for (const opp of recordedData) {
    for (const field of requiredFields) {
      const value = opp[field as keyof DemoOpportunity];
      if (!value) {
        allFieldsOk = false;
        console.log(`  --- 缺失字段 ${field}: ${opp.title || "(无标题)"} ---`);
      }
    }
  }
  assert(allFieldsOk, "T14: 每条 Recorded 数据含 recorded_at/query/provider/verification_status");
}

// ============================================================
// T15: Mock LLM 响应完整性
// ============================================================

function checkMockLlmResponses(): void {
  section("T15: Mock LLM 响应完整性");

  let responses;
  try {
    responses = loadMockLlmResponses();
  } catch (err) {
    assert(false, `T15: 加载 Mock LLM 响应失败: ${(err as Error).message}`);
    return;
  }

  // 确认卡含 7 维度置信度
  const card = responses.requirement_confirmation.confirmation_card;
  assert(!!card.dimensions, "T15: 确认卡含 dimensions 字段");
  const dimensions = card.dimensions;
  const requiredDimensions = [
    "client_identity",
    "business_goal",
    "opportunity_type",
    "region_scope",
    "exclusion_rules",
    "action_scenario",
    "report_format",
  ];
  let dimOk = true;
  for (const dim of requiredDimensions) {
    if (!dimensions[dim as keyof typeof dimensions]) {
      dimOk = false;
      console.log(`  --- 缺失维度: ${dim} ---`);
    }
  }
  assert(dimOk, "T15: 确认卡含 7 维度置信度（client_identity 等）");

  // 精筛含 5 条结果
  const filterResults = responses.ai_filter.results;
  assert(Array.isArray(filterResults) && filterResults.length === 5, "T15: 精筛含 5 条结果");

  // 精筛结果含 relevant + not relevant
  const relevantCount = filterResults.filter((r: { relevant: boolean }) => r.relevant).length;
  const notRelevantCount = filterResults.filter((r: { relevant: boolean }) => !r.relevant).length;
  assert(relevantCount > 0 && notRelevantCount > 0, `T15: 精筛含 relevant(${relevantCount}) + not relevant(${notRelevantCount})`);

  // 验证 MockLlmAdapter 能根据消息内容返回对应响应（同步验证：检查类定义）
  const adapter = new MockLlmAdapter();
  assert(typeof adapter.chat === "function", "T15: MockLlmAdapter 实例含 chat 方法");
}

// ============================================================
// T16: package.json 脚本
// ============================================================

function checkPackageJsonScript(): void {
  section("T16: package.json 脚本（verify:task036）");

  const pkgContent = readFile("package.json");
  assert(pkgContent.includes('"verify:task036"'), "T16: package.json 含 verify:task036 脚本");
  assert(pkgContent.includes("tsx scripts/verify-task036.ts"), "T16: verify:task036 指向 verify-task036.ts");

  // 验证脚本文件存在
  assert(fileExists("scripts/verify-task036.ts"), "T16: scripts/verify-task036.ts 文件存在");
}

// ============================================================
// T17: verify-task034 回归
// ============================================================

function checkTask034Regression(): void {
  section("T17: verify-task034 回归（100 PASS / 0 FAIL）");
  console.log("  运行中... (可能需要 60-120 秒)");
  const result = runCommand("npx", ["tsx", "scripts/verify-task034.ts"]);
  const output = result.stdout + result.stderr;

  // 解析 PASS / FAIL 计数
  const passMatch = output.match(/(\d+)\s*PASS/i) || output.match(/PASS[:\s]+(\d+)/i);
  const failMatch = output.match(/(\d+)\s*FAIL/i) || output.match(/FAIL[:\s]+(\d+)/i);
  const passNum = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failNum = failMatch ? parseInt(failMatch[1], 10) : -1;

  assert(result.status === 0, `T17: verify-task034 exit 0（实际 exit ${result.status}）`);
  assert(passNum >= 100, `T17: verify-task034 PASS >= 100（实际 ${passNum}）`);
  assert(failNum === 0, `T17: verify-task034 FAIL === 0（实际 ${failNum}）`);

  if (result.status !== 0 || failNum > 0) {
    console.log(`  --- verify-task034 输出（尾部 500 字符）---\n${output.slice(-500)}\n  --- end ---`);
  }
}

// ============================================================
// 主流程
// ============================================================

async function main(): Promise<void> {
  console.log("====================================");
  console.log("Task 036 验收脚本");
  console.log("Demo 数据模式与 LLM Mock 定义");
  console.log("====================================");

  // 先运行文件检查 + 逻辑验证（快）
  checkFilesExist();
  checkModeSwitch();
  checkMockDataQuality();
  checkRecordedSourceFields();
  checkMockLlmResponses();
  checkPackageJsonScript();

  // 再运行慢的命令验证
  checkTsc();
  checkPrecheck();
  checkTask034Regression();

  // 汇总
  console.log("\n====================================");
  console.log("验收汇总");
  console.log("====================================");
  console.log(`  PASS:  ${passCount}`);
  console.log(`  FAIL:  ${failCount}`);
  if (failures.length > 0) {
    console.log("\n失败项：");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }
  console.log("====================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("验收脚本异常退出:", err);
  process.exit(1);
});
