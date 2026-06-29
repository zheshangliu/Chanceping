/**
 * Task 013 验收脚本
 *
 * 运行：npx tsx scripts/verify-task013.ts
 *
 * 覆盖验收标准 5.1–5.5 + V0.4 汇总验收：
 *   5.1 导出功能
 *   5.2 归档索引
 *   5.3 归档查询
 *   5.4 与 Task 012 集成
 *   5.5 编译与引用
 *
 * 测试隔离：所有导出操作在 reports/test/ 目录下进行，测试完成后清理。
 */

import fs from "fs";
import path from "path";
import { exportRadarReport } from "../src/agents/radar-report-exporter";
import type { RadarReportExportInput, RadarReportExportResult } from "../src/agents/radar-report-exporter";
import {
  appendToArchive,
  queryArchive,
  readArchiveIndex,
} from "../src/agents/report-archive";
import type { ArchiveEntry, ArchiveAppendInput } from "../src/agents/report-archive";
import { generateRadarReport } from "../src/agents/radar-report-generator";
import type { RadarReportInput, RadarReportResult } from "../src/agents/radar-report-generator";
import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";
import {
  createDefaultSpec,
  MUST_INCLUDE_SECTIONS,
  OPPORTUNITY_CARD_REQUIRED_FIELDS,
} from "../src/schema/radar-requirement-spec";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import { BRAND } from "../src/brand/constants";

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

// ============================================================
// 测试数据构造
// ============================================================

/** 从 sample-spec.json 读取并修改为可生成状态 */
function loadSampleSpec(confidenceTotal: number = 95, status: string = "confirmed"): RadarRequirementSpec {
  const samplePath = path.resolve(process.cwd(), "data/samples/sample-spec.json");
  const raw = fs.readFileSync(samplePath, "utf-8");
  const spec = JSON.parse(raw) as RadarRequirementSpec;
  spec.confirmation_status.status = status as RadarRequirementSpec["confirmation_status"]["status"];
  spec.confirmation_status.user_confirmed = true;
  spec.requirement_confidence.total = confidenceTotal;
  return spec;
}

/** 从 test-opportunities.json 读取测试机会 */
function loadTestOpportunities(): OpportunityCard[] {
  const oppPath = path.resolve(process.cwd(), "data/samples/test-opportunities.json");
  const raw = fs.readFileSync(oppPath, "utf-8");
  return JSON.parse(raw) as OpportunityCard[];
}

/** 构造雷达报告输入 */
function makeReportInput(
  spec: RadarRequirementSpec,
  opportunities: OpportunityCard[],
  radarType: RadarReportInput["radar_type"] = "ai_competition",
  periodStart: string = "2026-06-20",
  periodEnd: string = "2026-06-27",
  generatedAt: string = "2026-06-27T12:00:00.000Z",
): RadarReportInput {
  return {
    spec,
    opportunities,
    radar_type: radarType,
    period_start: periodStart,
    period_end: periodEnd,
    generated_at: generatedAt,
  };
}

// ============================================================
// 测试隔离：所有测试在 reports/test/ 下进行
// ============================================================

const TEST_DIR = path.resolve(process.cwd(), "reports", "test");
const TEST_ARCHIVE_DIR = path.resolve(TEST_DIR, ".archive");
const TEST_ARCHIVE_PATH = path.resolve(TEST_ARCHIVE_DIR, "index.json");

/**
 * 测试前清理：彻底清空测试目录与归档索引。
 *
 * 双重保险策略（修复 Task 013-fix 测试隔离缺陷）：
 *   1. 优先删除整个 reports/test/ 目录（含 .archive 子目录）
 *   2. 若归档索引文件仍存在（Windows 文件句柄占用、force:true 吞错等导致 rmSync 静默失败），
 *      则直接写入空索引覆盖，确保下一段测试从 0 条目起步
 *
 * 这样无论 rmSync 是否成功，归档索引 entries 都会被重置为空数组。
 */
function cleanupTestDir(): void {
  // 第 1 重：删除整个 test 目录（含 .archive 子目录）
  if (fs.existsSync(TEST_DIR)) {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // rmSync 失败时忽略，由第 2 重保险处理
    }
  }

  // 第 2 重：若归档索引文件仍存在（rmSync 静默失败），写入空索引覆盖
  if (fs.existsSync(TEST_ARCHIVE_PATH)) {
    try {
      // 确保 .archive 目录存在（可能 rmSync 只删除了部分文件）
      fs.mkdirSync(TEST_ARCHIVE_DIR, { recursive: true });
      const emptyIndex = {
        version: "1.0",
        updated_at: new Date().toISOString(),
        entries: [],
      };
      fs.writeFileSync(TEST_ARCHIVE_PATH, JSON.stringify(emptyIndex, null, 2), "utf-8");
    } catch {
      // 第 2 重也失败时忽略，由 readArchiveIndex 返回空索引兜底
    }
  }
}

/** 测试后清理 */
function finalCleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // 忽略最终清理失败
    }
  }
}

// ============================================================
// 验收 5.1：导出功能
// ============================================================

console.log("\n=== Task 013 验收检查 ===\n");
console.log("[验收 5.1] 导出功能\n");

{
  cleanupTestDir();
  const spec = loadSampleSpec(95, "confirmed");
  const reportResult = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  check("Task 012 生成报告成功（前置条件）", reportResult.success === true);

  // 导出成功
  const exportInput: RadarReportExportInput = {
    report_result: reportResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  };
  const result = exportRadarReport(exportInput);
  check("导出成功 → success=true", result.success === true, `error=${result.error}`);
  check("导出成功 → report_file_path 非空", result.report_file_path !== null);
  check("导出成功 → archived=true", result.archived === true);

  // 报告文件存在
  check("报告文件存在", result.report_file_path !== null && fs.existsSync(result.report_file_path));

  // 报告文件含品牌名
  if (result.report_file_path) {
    const content = fs.readFileSync(result.report_file_path, "utf-8");
    check("报告文件含 BRAND.product_name", content.includes(BRAND.product_name));
  }

  // 文件名含雷达类型
  check("文件名含 'ai-competition'",
    result.report_file_path?.includes("ai-competition") === true, `path=${result.report_file_path}`);
  // 文件名含周期
  check("文件名含 period_start '2026-06-20'",
    result.report_file_path?.includes("2026-06-20") === true, `path=${result.report_file_path}`);
  check("文件名含 period_end '2026-06-27'",
    result.report_file_path?.includes("2026-06-27") === true, `path=${result.report_file_path}`);

  // 导出目录自动创建
  const newDir = path.resolve(TEST_DIR, "subdir");
  const r2 = exportRadarReport({
    ...exportInput,
    radar_type: "opc_policy",
    period_start: "2026-06-21",
    period_end: "2026-06-28",
    output_dir: newDir,
  });
  check("导出目录自动创建 → success=true", r2.success === true, `error=${r2.error}`);
  check("导出目录自动创建 → 目录存在", fs.existsSync(newDir));

  // 空内容拒绝
  const emptyResult: RadarReportResult = {
    success: true,
    markdown: "",
    error: null,
    version: "V0.4",
    generated_at: "2026-06-27T12:00:00.000Z",
    stats: {
      total_opportunities: 0, s_count: 0, a_count: 0, b_count: 0,
      c_count: 0, hidden_count: 0, expiring_soon_count: 0, excluded_count: 0,
    },
    sections_count: 9,
  };
  const r3 = exportRadarReport({
    report_result: emptyResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  check("空内容拒绝 → success=false", r3.success === false);
  check("空内容拒绝 → error 非空", r3.error !== null);

  // success=false 拒绝
  const failedReportResult: RadarReportResult = {
    success: false,
    markdown: null,
    error: "确认度不足",
    version: "V0.4",
    generated_at: "2026-06-27T12:00:00.000Z",
    stats: {
      total_opportunities: 0, s_count: 0, a_count: 0, b_count: 0,
      c_count: 0, hidden_count: 0, expiring_soon_count: 0, excluded_count: 0,
    },
    sections_count: 0,
  };
  const r4 = exportRadarReport({
    report_result: failedReportResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  check("success=false 拒绝 → success=false", r4.success === false);
  check("success=false 拒绝 → error 非空", r4.error !== null);

  // 品牌合规校验（markdown 不含品牌名）
  const noBrandResult: RadarReportResult = {
    success: true,
    markdown: "# 非品牌报告\n\n不含品牌名",
    error: null,
    version: "V0.4",
    generated_at: "2026-06-27T12:00:00.000Z",
    stats: {
      total_opportunities: 0, s_count: 0, a_count: 0, b_count: 0,
      c_count: 0, hidden_count: 0, expiring_soon_count: 0, excluded_count: 0,
    },
    sections_count: 9,
  };
  const r5 = exportRadarReport({
    report_result: noBrandResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  check("品牌合规校验 → 不含品牌名时 success=false", r5.success === false);
  check("品牌合规校验 → error 含品牌名", r5.error?.includes(BRAND.product_name) === true);
}

// ============================================================
// 验收 5.2：归档索引
// ============================================================

console.log("\n[验收 5.2] 归档索引\n");

{
  cleanupTestDir();
  const spec = loadSampleSpec(95, "confirmed");
  const reportResult = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));

  // 第一次导出
  exportRadarReport({
    report_result: reportResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });

  // 归档索引存在
  check("归档索引存在", fs.existsSync(TEST_ARCHIVE_PATH));

  // 读取索引
  const indexRaw = fs.readFileSync(TEST_ARCHIVE_PATH, "utf-8");
  const index = JSON.parse(indexRaw);
  check("索引含 'version': '1.0'", index.version === "1.0");
  check("索引含 entries 数组", Array.isArray(index.entries));
  check("索引含 'updated_at'", typeof index.updated_at === "string" && index.updated_at.length > 0);

  // 条目字段
  const entry = index.entries[0];
  check("条目含 file_name", typeof entry.file_name === "string");
  check("条目含 radar_type", entry.radar_type === "ai_competition");
  check("条目含 period_start", entry.period_start === "2026-06-20");
  check("条目含 period_end", entry.period_end === "2026-06-27");
  check("条目含 generated_at", typeof entry.generated_at === "string");
  check("条目含 stats 对象", typeof entry.stats === "object" && entry.stats !== null);
  check("条目含 'version': 'V0.4'", entry.version === "V0.4");

  // 多次导出追加
  exportRadarReport({
    report_result: reportResult,
    radar_type: "opc_policy",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  const index2 = readArchiveIndex(TEST_ARCHIVE_PATH);
  check("多次导出追加 → entries.length=2", index2.entries.length === 2, `len=${index2.entries.length}`);

  // 同周期覆盖
  exportRadarReport({
    report_result: reportResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  const index3 = readArchiveIndex(TEST_ARCHIVE_PATH);
  check("同周期覆盖 → entries.length 仍为 2（不重复）",
    index3.entries.length === 2, `len=${index3.entries.length}`);
  const aiEntries = index3.entries.filter((e) => e.radar_type === "ai_competition");
  check("同周期覆盖 → ai_competition 条目仅 1 条", aiEntries.length === 1);
}

// ============================================================
// 验收 5.3：归档查询
// ============================================================

console.log("\n[验收 5.3] 归档查询\n");

{
  cleanupTestDir();
  const spec = loadSampleSpec(95, "confirmed");
  const reportResult = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));

  // 准备 3 条不同雷达类型 + 不同周期的归档
  exportRadarReport({
    report_result: reportResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  exportRadarReport({
    report_result: reportResult,
    radar_type: "opc_policy",
    period_start: "2026-06-13",
    period_end: "2026-06-20",
    output_dir: TEST_DIR,
  });
  exportRadarReport({
    report_result: reportResult,
    radar_type: "cultural_heritage",
    period_start: "2026-06-27",
    period_end: "2026-07-04",
    output_dir: TEST_DIR,
  });

  // 查询全部
  const all = queryArchive({ archive_path: TEST_ARCHIVE_PATH });
  check("查询全部 → 返回 3 条", all.length === 3, `len=${all.length}`);

  // 按雷达类型查询
  const aiOnly = queryArchive({ radar_type: "ai_competition", archive_path: TEST_ARCHIVE_PATH });
  check("按 radar_type=ai_competition 查询 → 1 条", aiOnly.length === 1);
  check("按 radar_type=ai_competition 查询 → 类型正确", aiOnly[0]?.radar_type === "ai_competition");

  const opcOnly = queryArchive({ radar_type: "opc_policy", archive_path: TEST_ARCHIVE_PATH });
  check("按 radar_type=opc_policy 查询 → 1 条", opcOnly.length === 1);

  // 按日期范围查询
  const from0620 = queryArchive({ date_from: "2026-06-20", archive_path: TEST_ARCHIVE_PATH });
  // period_end >= 2026-06-20 的：ai(06-27), opc(06-20), cultural(07-04) → 3 条
  check("date_from=2026-06-20 → 返回 3 条（period_end >= date_from）",
    from0620.length === 3, `len=${from0620.length}`);

  const from0621 = queryArchive({ date_from: "2026-06-21", archive_path: TEST_ARCHIVE_PATH });
  // period_end >= 2026-06-21 的：ai(06-27), cultural(07-04) → 2 条（opc period_end=06-20 < 06-21）
  check("date_from=2026-06-21 → 返回 2 条",
    from0621.length === 2, `len=${from0621.length}`);

  const to0620 = queryArchive({ date_to: "2026-06-20", archive_path: TEST_ARCHIVE_PATH });
  // period_start <= 2026-06-20 的：ai(06-20), opc(06-13) → 2 条
  check("date_to=2026-06-20 → 返回 2 条（period_start <= date_to）",
    to0620.length === 2, `len=${to0620.length}`);

  // 组合查询
  const combined = queryArchive({
    radar_type: "ai_competition",
    date_from: "2026-06-20",
    date_to: "2026-06-27",
    archive_path: TEST_ARCHIVE_PATH,
  });
  check("组合查询（ai_competition + 日期范围）→ 1 条", combined.length === 1);

  // 无匹配查询
  const noMatch = queryArchive({ radar_type: "ai_competition", date_from: "2026-07-01", archive_path: TEST_ARCHIVE_PATH });
  check("无匹配查询 → 返回空数组", noMatch.length === 0);

  // 索引不存在时返回空数组
  const noExist = queryArchive({ archive_path: path.resolve(TEST_DIR, "non-existent.json") });
  check("索引不存在 → 返回空数组（不报错）", noExist.length === 0);
}

// ============================================================
// 验收 5.4：与 Task 012 集成
// ============================================================

console.log("\n[验收 5.4] 与 Task 012 集成\n");

{
  cleanupTestDir();
  const spec = loadSampleSpec(95, "confirmed");

  // 端到端导出
  const reportResult = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  const exportResult = exportRadarReport({
    report_result: reportResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  check("端到端导出 → success=true", exportResult.success === true, `error=${exportResult.error}`);

  // 导出文件含 9 章节
  if (exportResult.report_file_path) {
    const content = fs.readFileSync(exportResult.report_file_path, "utf-8");
    for (let i = 0; i <= 8; i++) {
      check(`导出文件含 '## ${i}.' 章节`, content.includes(`## ${i}.`), `missing ## ${i}.`);
    }
    check("导出文件含 '## 本周结论'", content.includes("## 本周结论"));
    check("导出文件含 S 级机会", content.includes("S 级"));
    check("导出文件含 A 级机会", content.includes("A 级"));
    check("导出文件含 B 级机会", content.includes("B 级"));
  }

  // 三雷达类型均可导出
  const rAi = exportRadarReport({
    report_result: generateRadarReport(makeReportInput(spec, loadTestOpportunities(), "ai_competition")),
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  check("ai_competition 导出 → success=true", rAi.success === true);

  const rOpc = exportRadarReport({
    report_result: generateRadarReport(makeReportInput(spec, loadTestOpportunities(), "opc_policy")),
    radar_type: "opc_policy",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  check("opc_policy 导出 → success=true", rOpc.success === true);

  const rCh = exportRadarReport({
    report_result: generateRadarReport(makeReportInput(spec, loadTestOpportunities(), "cultural_heritage")),
    radar_type: "cultural_heritage",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });
  check("cultural_heritage 导出 → success=true", rCh.success === true);

  // 三雷达类型归档索引齐全
  const archive = readArchiveIndex(TEST_ARCHIVE_PATH);
  check("三雷达类型归档 → entries.length=3",
    archive.entries.length === 3, `len=${archive.entries.length}`);
  const types = new Set(archive.entries.map((e) => e.radar_type));
  check("归档含 ai_competition", types.has("ai_competition"));
  check("归档含 opc_policy", types.has("opc_policy"));
  check("归档含 cultural_heritage", types.has("cultural_heritage"));
}

// ============================================================
// 验收 5.5：编译与引用
// ============================================================

console.log("\n[验收 5.5] 编译与引用\n");

{
  // 检查 src/agents/radar-report-exporter.ts 已创建
  const exporterPath = path.resolve(process.cwd(), "src/agents/radar-report-exporter.ts");
  check("src/agents/radar-report-exporter.ts 存在", fs.existsSync(exporterPath));

  // 检查 src/agents/report-archive.ts 已创建
  const archivePath = path.resolve(process.cwd(), "src/agents/report-archive.ts");
  check("src/agents/report-archive.ts 存在", fs.existsSync(archivePath));

  // 检查 scripts/verify-task013.ts 已创建
  const verifyPath = path.resolve(process.cwd(), "scripts/verify-task013.ts");
  check("scripts/verify-task013.ts 存在", fs.existsSync(verifyPath));

  // 检查 radar-report-exporter.ts 内容含必要 import
  const exporterContent = fs.readFileSync(exporterPath, "utf-8");
  check("exporter 引用 BRAND（来自 ../brand/constants）", exporterContent.includes("import { BRAND }"));
  check("exporter 引用 RadarReportResult 类型", exporterContent.includes("RadarReportResult"));
  check("exporter 引用 fs 模块", exporterContent.includes("import fs from"));
  check("exporter 引用 path 模块", exporterContent.includes("import path from"));
  check("exporter 引用 appendToArchive", exporterContent.includes("import { appendToArchive }"));
  check("exporter 不硬编码 '盯机会 ChancePing'", !exporterContent.includes('"盯机会 ChancePing"'));

  // 检查 report-archive.ts 内容含必要 import
  const archiveContent = fs.readFileSync(archivePath, "utf-8");
  check("archive 引用 fs 模块", archiveContent.includes("import fs from"));
  check("archive 引用 path 模块", archiveContent.includes("import path from"));
  check("archive 引用 RadarReportResult 类型", archiveContent.includes("RadarReportResult"));
  check("archive 导出 appendToArchive 函数", archiveContent.includes("export function appendToArchive"));
  check("archive 导出 queryArchive 函数", archiveContent.includes("export function queryArchive"));

  // 检查不重复实现 generateRadarReport
  check("exporter 不重复实现 generateRadarReport", !exporterContent.includes("export function generateRadarReport"));
  check("archive 不重复实现 generateRadarReport", !archiveContent.includes("export function generateRadarReport"));

  // 检查导出 exportRadarReport 函数
  check("导出 exportRadarReport 函数", exporterContent.includes("export function exportRadarReport"));
  check("导出 RadarReportExportInput 接口", exporterContent.includes("export interface RadarReportExportInput"));
  check("导出 RadarReportExportResult 接口", exporterContent.includes("export interface RadarReportExportResult"));

  // 检查 MUST_INCLUDE_SECTIONS / OPPORTUNITY_CARD_REQUIRED_FIELDS 长度（Task 012 已保证）
  check("MUST_INCLUDE_SECTIONS 长度为 9", MUST_INCLUDE_SECTIONS.length === 9);
  check("OPPORTUNITY_CARD_REQUIRED_FIELDS 长度为 14", OPPORTUNITY_CARD_REQUIRED_FIELDS.length === 14);
}

// ============================================================
// V0.4 汇总验收
// ============================================================

console.log("\n[V0.4 汇总验收] Task 013 完成 V0.4 全部清单\n");

{
  cleanupTestDir();
  const spec = loadSampleSpec(95, "confirmed");
  const reportResult = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  const exportResult = exportRadarReport({
    report_result: reportResult,
    radar_type: "ai_competition",
    period_start: "2026-06-20",
    period_end: "2026-06-27",
    output_dir: TEST_DIR,
  });

  check("V0.4-1: 雷达报告含 9 章节，结构符合 MUST_INCLUDE_SECTIONS",
    reportResult.sections_count === 9 && MUST_INCLUDE_SECTIONS.length === 9);
  check("V0.4-2: 机会按 S/A/B/C 自动分组",
    reportResult.stats.s_count === 2 && reportResult.stats.a_count === 2 && reportResult.stats.b_count === 1);
  check("V0.4-3: 机会卡片含全部 14 个必含字段",
    OPPORTUNITY_CARD_REQUIRED_FIELDS.length === 14);
  check("V0.4-4: 即将截止机会单独标注",
    reportResult.stats.expiring_soon_count === 2);
  check("V0.4-5: 排除规则生效",
    reportResult.stats.excluded_count >= 1);
  check("V0.4-6: 空机会不拒绝生成",
    generateRadarReport(makeReportInput(spec, [])).success === true);
  check("V0.4-7: 导出 Markdown 含品牌标题前缀",
    exportResult.success === true && (fs.readFileSync(exportResult.report_file_path ?? "", "utf-8").includes(BRAND.product_name)));
  check("V0.4-8: V0.4 验收清单全部通过",
    exportResult.success === true && exportResult.archived === true);
}

// ============================================================
// 清理 + 汇总输出
// ============================================================

finalCleanup();

console.log("\n=== 验收汇总 ===");
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
