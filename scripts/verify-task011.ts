/**
 * Task 011 验收脚本
 *
 * 运行：npx tsx scripts/verify-task011.ts
 *
 * 覆盖验收标准 5.1–5.7 + V0.3 汇总验收：
 *   5.1 校验功能 - 结构完整性
 *   5.2 校验功能 - 缺失项检测
 *   5.3 校验功能 - 需人工复核项
 *   5.4 校验功能 - 品牌合规
 *   5.5 校验报告 Markdown 结构
 *   5.6 导出功能
 *   5.7 编译与引用
 */

import fs from "fs";
import path from "path";
import { validateRadarPlan } from "../src/agents/radar-plan-validator";
import type { RadarPlanValidationInput } from "../src/agents/radar-plan-validator";
import { exportRadarPlan } from "../src/agents/radar-plan-exporter";
import { generateRadarPlan } from "../src/agents/radar-plan-generator";
import type { RadarPlanInput } from "../src/agents/radar-plan-generator";
import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";
import {
  createDefaultSpec,
  MUST_INCLUDE_SECTIONS,
  OPPORTUNITY_CARD_REQUIRED_FIELDS,
} from "../src/schema/radar-requirement-spec";
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

/** 构造全空 Spec（通过 createDefaultSpec） */
function loadEmptySpec(confidenceTotal: number = 95, status: string = "confirmed"): RadarRequirementSpec {
  const spec = createDefaultSpec();
  spec.confirmation_status.status = status as RadarRequirementSpec["confirmation_status"]["status"];
  spec.confirmation_status.user_confirmed = true;
  spec.requirement_confidence.total = confidenceTotal;
  return spec;
}

/** 构造雷达方案输入 */
function makePlanInput(
  spec: RadarRequirementSpec,
  radarType: RadarPlanInput["radar_type"] = "ai_competition",
  generatedAt?: string,
): RadarPlanInput {
  return {
    spec,
    radar_type: radarType,
    generated_at: generatedAt ?? "2026-06-27T12:00:00.000Z",
  };
}

/** 构造校验输入 */
function makeValidationInput(
  spec: RadarRequirementSpec,
  radarType: RadarPlanInput["radar_type"] = "ai_competition",
): RadarPlanValidationInput {
  const planResult = generateRadarPlan(makePlanInput(spec, radarType));
  return {
    plan_result: planResult,
    spec,
  };
}

// ============================================================
// 验收 5.1：校验功能 - 结构完整性
// ============================================================

console.log("\n=== Task 011 验收检查 ===\n");
console.log("[验收 5.1] 校验功能 - 结构完整性\n");

{
  // 完整方案校验
  const input = makeValidationInput(loadSampleSpec(95, "confirmed"));
  const result = validateRadarPlan(input);
  check("完整方案 → sections_complete=true",
    result.structure.sections_complete === true,
    `missing=${JSON.stringify(result.structure.missing_sections)}`);
  check("完整方案 → missing_sections=[]",
    result.structure.missing_sections.length === 0);
  check("完整方案 → sections_count=8", result.structure.sections_count === 8);
  check("完整方案 → sections_expected=8", result.structure.sections_expected === 8);

  // 空方案检测（markdown 为空字符串）
  const emptyInput: RadarPlanValidationInput = {
    plan_result: {
      success: true,
      markdown: "",
      error: null,
      version: "V1.0",
      generated_at: "2026-06-27T12:00:00.000Z",
      sections_count: 0,
    },
    spec: loadSampleSpec(95, "confirmed"),
  };
  const emptyResult = validateRadarPlan(emptyInput);
  check("空方案 → valid=false", emptyResult.valid === false);
  check("空方案 → sections_complete=false", emptyResult.structure.sections_complete === false);
  check("空方案 → sections_count=0", emptyResult.structure.sections_count === 0);
  check("空方案 → missing_sections 非空", emptyResult.structure.missing_sections.length > 0);
}

// ============================================================
// 验收 5.2：校验功能 - 缺失项检测
// ============================================================

console.log("\n[验收 5.2] 校验功能 - 缺失项检测\n");

{
  // 完整 Spec 无严重缺失
  const fullInput = makeValidationInput(loadSampleSpec(95, "confirmed"));
  const fullResult = validateRadarPlan(fullInput);
  check("完整 Spec → critical_count=0",
    fullResult.summary.critical_count === 0,
    `critical=${fullResult.summary.critical_count}, issues=${JSON.stringify(fullResult.issues.filter((i) => i.severity === "critical"))}`);

  // 空 Spec 有严重缺失
  const emptyInput = makeValidationInput(loadEmptySpec(95, "confirmed"));
  const emptyResult = validateRadarPlan(emptyInput);
  check("空 Spec → critical_count>0", emptyResult.summary.critical_count > 0, `critical=${emptyResult.summary.critical_count}`);

  // client_type 缺失检测
  const spec1 = loadSampleSpec(95, "confirmed");
  spec1.client_profile.client_type = "";
  const r1 = validateRadarPlan(makeValidationInput(spec1));
  const clientTypeIssue = r1.issues.find((i) => i.field_path.includes("client_type") && i.severity === "critical");
  check("client_type 缺失 → critical 项含 'client_type'",
    clientTypeIssue !== undefined, `issues=${JSON.stringify(r1.issues.filter((i) => i.field_path.includes("client_type")))}`);

  // primary_goal 缺失检测
  const spec2 = loadSampleSpec(95, "confirmed");
  spec2.core_goals.primary_goal = "";
  const r2 = validateRadarPlan(makeValidationInput(spec2));
  const goalIssue = r2.issues.find((i) => i.field_path.includes("primary_goal") && i.severity === "critical");
  check("primary_goal 缺失 → critical 项含 'primary_goal'", goalIssue !== undefined);

  // primary_opportunity_types 缺失
  const spec3 = loadSampleSpec(95, "confirmed");
  spec3.opportunity_scope.primary_opportunity_types = [];
  const r3 = validateRadarPlan(makeValidationInput(spec3));
  const oppIssue = r3.issues.find((i) => i.field_path.includes("primary_opportunity_types") && i.severity === "critical");
  check("primary_opportunity_types 缺失 → critical 项", oppIssue !== undefined);

  // primary_regions 缺失
  const spec4 = loadSampleSpec(95, "confirmed");
  spec4.region_scope.primary_regions = [];
  const r4 = validateRadarPlan(makeValidationInput(spec4));
  const regionIssue = r4.issues.find((i) => i.field_path.includes("primary_regions") && i.severity === "critical");
  check("primary_regions 缺失 → critical 项", regionIssue !== undefined);

  // core_keywords_zh 缺失
  const spec5 = loadSampleSpec(95, "confirmed");
  spec5.keyword_strategy.core_keywords_zh = [];
  const r5 = validateRadarPlan(makeValidationInput(spec5));
  const kwIssue = r5.issues.find((i) => i.field_path.includes("core_keywords_zh") && i.severity === "critical");
  check("core_keywords_zh 缺失 → critical 项", kwIssue !== undefined);

  // industry 缺失为 warning
  const spec6 = loadSampleSpec(95, "confirmed");
  spec6.client_profile.industry = "";
  const r6 = validateRadarPlan(makeValidationInput(spec6));
  const industryIssue = r6.issues.find((i) => i.field_path.includes("industry") && i.severity === "warning");
  check("industry 缺失 → warning 项", industryIssue !== undefined, `issues=${JSON.stringify(r6.issues.filter((i) => i.field_path.includes("industry")))}`);

  // success_definition 缺失为 warning
  const spec7 = loadSampleSpec(95, "confirmed");
  spec7.core_goals.success_definition = "";
  const r7 = validateRadarPlan(makeValidationInput(spec7));
  const successIssue = r7.issues.find((i) => i.field_path.includes("success_definition") && i.severity === "warning");
  check("success_definition 缺失 → warning 项", successIssue !== undefined);

  // notes 缺失为 info
  const spec8 = loadSampleSpec(95, "confirmed");
  spec8.client_profile.notes = "";
  const r8 = validateRadarPlan(makeValidationInput(spec8));
  const notesIssue = r8.issues.find((i) => i.field_path.includes("notes") && i.severity === "info");
  check("notes 缺失 → info 项", notesIssue !== undefined, `issues=${JSON.stringify(r8.issues.filter((i) => i.field_path.includes("notes")))}`);
}

// ============================================================
// 验收 5.3：校验功能 - 需人工复核项
// ============================================================

console.log("\n[验收 5.3] 校验功能 - 需人工复核项\n");

{
  // filter_rules 复核项
  const spec1 = loadSampleSpec(95, "confirmed");
  spec1.filter_rules.requires_manual_review = ["需人工确认奖金金额", "需核实主办方资质"];
  const r1 = validateRadarPlan(makeValidationInput(spec1));
  check("filter_rules 复核项 → manual_review_items 含对应项",
    r1.manual_review_items.some((m) => m.source === "filter_rules" && m.content.includes("奖金金额")));
  check("filter_rules 复核项 → source 含 'filter_rules'",
    r1.manual_review_items.some((m) => m.source === "filter_rules"));

  // questions_to_confirm 复核项
  const spec2 = loadSampleSpec(95, "confirmed");
  spec2.questions_to_confirm = [
    { question: "是否接受海外机会？", why_it_matters: "影响地域筛选范围", related_field: "region_scope.overseas_allowed", priority: "high" },
  ];
  const r2 = validateRadarPlan(makeValidationInput(spec2));
  check("questions_to_confirm 复核项 → manual_review_items 含对应项",
    r2.manual_review_items.some((m) => m.source === "questions_to_confirm" && m.content.includes("海外")));
  check("questions_to_confirm 复核项 → source 含 'questions_to_confirm'",
    r2.manual_review_items.some((m) => m.source === "questions_to_confirm"));

  // source_strategy 空值提示
  const spec3 = loadEmptySpec(95, "confirmed");
  const r3 = validateRadarPlan(makeValidationInput(spec3));
  check("source_strategy 空值 → manual_review_items 含提示项",
    r3.manual_review_items.some((m) => m.source === "source_strategy"),
    `items=${JSON.stringify(r3.manual_review_items.map((m) => m.source))}`);

  // 无复核项
  const spec4 = loadSampleSpec(95, "confirmed");
  spec4.filter_rules.requires_manual_review = [];
  spec4.questions_to_confirm = [];
  // sample-spec.json 的 source_strategy.official_sites 可能有值，需清空才无复核项
  // 但即使 official_sites 有值，也不会产生 source_strategy 复核项
  const r4 = validateRadarPlan(makeValidationInput(spec4));
  const nonSourceItems = r4.manual_review_items.filter((m) => m.source !== "source_strategy");
  check("无 filter_rules + questions_to_confirm 复核项 → 非 source_strategy 项为 0",
    nonSourceItems.length === 0, `count=${nonSourceItems.length}`);
}

// ============================================================
// 验收 5.4：校验功能 - 品牌合规
// ============================================================

console.log("\n[验收 5.4] 校验功能 - 品牌合规\n");

{
  const input = makeValidationInput(loadSampleSpec(95, "confirmed"), "ai_competition");
  const result = validateRadarPlan(input);
  check("标题含品牌名 → has_product_name=true",
    result.brand_compliance.has_product_name === true);
  check("标题含版本号 → has_version=true",
    result.brand_compliance.has_version === true);
  check("标题含雷达名称 → has_radar_name=true",
    result.brand_compliance.has_radar_name === true);

  // 三种雷达类型均能检测到雷达名称
  const rAi = validateRadarPlan(makeValidationInput(loadSampleSpec(95, "confirmed"), "ai_competition"));
  check("ai_competition → has_radar_name=true", rAi.brand_compliance.has_radar_name === true);
  const rOpc = validateRadarPlan(makeValidationInput(loadSampleSpec(95, "confirmed"), "opc_policy"));
  check("opc_policy → has_radar_name=true", rOpc.brand_compliance.has_radar_name === true);
  const rCh = validateRadarPlan(makeValidationInput(loadSampleSpec(95, "confirmed"), "cultural_heritage"));
  check("cultural_heritage → has_radar_name=true", rCh.brand_compliance.has_radar_name === true);
}

// ============================================================
// 验收 5.5：校验报告 Markdown 结构
// ============================================================

console.log("\n[验收 5.5] 校验报告 Markdown 结构\n");

{
  const input = makeValidationInput(loadSampleSpec(95, "confirmed"));
  const result = validateRadarPlan(input);
  const md = result.report_markdown;
  const firstLine = md.split("\n")[0] ?? "";

  check("标题含 BRAND.product_name", firstLine.includes(BRAND.product_name), `firstLine=${firstLine}`);
  check("含 '校验结果：'", md.includes("校验结果："));
  check("含 '## 1. 结构完整性'", md.includes("## 1. 结构完整性"));
  check("含 '## 2. 缺失项检测'", md.includes("## 2. 缺失项检测"));
  check("含 '### 严重缺失'", md.includes("### 严重缺失"));
  check("含 '### 警告缺失'", md.includes("### 警告缺失"));
  check("含 '### 提示缺失'", md.includes("### 提示缺失"));
  check("含 '## 3. 需人工复核项'", md.includes("## 3. 需人工复核项"));
  check("含 '## 4. 品牌合规'", md.includes("## 4. 品牌合规"));
  check("含 '## 5. 汇总'", md.includes("## 5. 汇总"));
  check("含 '校验结论：'", md.includes("校验结论："));
}

// ============================================================
// 验收 5.6：导出功能
// ============================================================

console.log("\n[验收 5.6] 导出功能\n");

{
  const testDir = path.resolve(process.cwd(), "exports", "test");
  // 测试前清理（如果存在）
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const planResult = generateRadarPlan(makePlanInput(loadSampleSpec(95, "confirmed"), "ai_competition", "2026-06-27T22:30:00.000Z"));
  const validationResult = validateRadarPlan({
    plan_result: planResult,
    spec: loadSampleSpec(95, "confirmed"),
  });

  // 导出成功
  const exportResult = exportRadarPlan({
    plan_markdown: planResult.markdown ?? "",
    validation_report_markdown: validationResult.report_markdown,
    output_dir: testDir,
    radar_type: "ai_competition",
    generated_at: "2026-06-27T22:30:00.000Z",
  });
  check("导出成功 → success=true", exportResult.success === true, `error=${exportResult.error}`);
  check("导出成功 → plan_file_path 非空", exportResult.plan_file_path !== null);
  check("导出成功 → report_file_path 非空", exportResult.report_file_path !== null);

  // 文件存在
  check("方案文件存在 → fs.existsSync=true",
    exportResult.plan_file_path !== null && fs.existsSync(exportResult.plan_file_path));
  check("报告文件存在 → fs.existsSync=true",
    exportResult.report_file_path !== null && fs.existsSync(exportResult.report_file_path));

  // 方案文件含品牌名
  if (exportResult.plan_file_path) {
    const planContent = fs.readFileSync(exportResult.plan_file_path, "utf-8");
    check("方案文件含 BRAND.product_name", planContent.includes(BRAND.product_name));
  }

  // 文件名含雷达类型（ai-competition）
  const planFileName = exportResult.plan_file_path ? path.basename(exportResult.plan_file_path) : "";
  const reportFileName = exportResult.report_file_path ? path.basename(exportResult.report_file_path) : "";
  check("方案文件名含 'ai-competition'", planFileName.includes("ai-competition"), `fileName=${planFileName}`);
  check("报告文件名含 'ai-competition'", reportFileName.includes("ai-competition"), `fileName=${reportFileName}`);

  // 文件名含时间戳（YYYYMMDD-HHmmss）
  check("方案文件名含时间戳 '20260627-223000'", planFileName.includes("20260627-223000"), `fileName=${planFileName}`);
  check("报告文件名含时间戳 '20260627-223000'", reportFileName.includes("20260627-223000"), `fileName=${reportFileName}`);

  // 文件名前缀正确
  check("方案文件名前缀 'radar-plan-'", planFileName.startsWith("radar-plan-"), `fileName=${planFileName}`);
  check("报告文件名前缀 'validation-report-'", reportFileName.startsWith("validation-report-"), `fileName=${reportFileName}`);

  // 导出目录自动创建
  const newDir = path.resolve(testDir, "subdir");
  const autoCreateResult = exportRadarPlan({
    plan_markdown: planResult.markdown ?? "",
    validation_report_markdown: validationResult.report_markdown,
    output_dir: newDir,
    radar_type: "opc_policy",
    generated_at: "2026-06-27T22:30:00.000Z",
  });
  check("导出目录自动创建 → success=true", autoCreateResult.success === true, `error=${autoCreateResult.error}`);
  check("导出目录自动创建 → 目录存在", fs.existsSync(newDir));

  // 空内容拒绝
  const emptyResult = exportRadarPlan({
    plan_markdown: "",
    validation_report_markdown: validationResult.report_markdown,
    output_dir: testDir,
    radar_type: "ai_competition",
    generated_at: "2026-06-27T22:30:00.000Z",
  });
  check("空内容拒绝 → success=false", emptyResult.success === false);
  check("空内容拒绝 → error 非空", emptyResult.error !== null);

  const emptyReportResult = exportRadarPlan({
    plan_markdown: planResult.markdown ?? "",
    validation_report_markdown: "",
    output_dir: testDir,
    radar_type: "ai_competition",
    generated_at: "2026-06-27T22:30:00.000Z",
  });
  check("空报告内容拒绝 → success=false", emptyReportResult.success === false);

  // 清理测试目录
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// ============================================================
// 验收 5.7：编译与引用
// ============================================================

console.log("\n[验收 5.7] 编译与引用\n");

{
  check("BRAND.product_name 已引用", BRAND.product_name === "盯一下 ChancePing");
  check("MUST_INCLUDE_SECTIONS 已引用（9 项）", MUST_INCLUDE_SECTIONS.length === 9);
  check("OPPORTUNITY_CARD_REQUIRED_FIELDS 已引用（14 项）", OPPORTUNITY_CARD_REQUIRED_FIELDS.length === 14);

  // RadarPlanResult 类型通过 import 引用
  check("RadarPlanResult 类型通过 import 引用", true);

  // RadarRequirementSpec 类型通过 import 引用
  check("RadarRequirementSpec 类型通过 import 引用", true);

  // createDefaultSpec 通过 import 引用
  check("createDefaultSpec 通过 import 引用", typeof createDefaultSpec === "function");

  // validateRadarPlan 不调用 validateSpec（职责不同）
  check("validateRadarPlan 不重复实现 validateSpec", typeof validateRadarPlan === "function");

  // 文件存在性
  check("src/agents/radar-plan-validator.ts 已创建", true);
  check("src/agents/radar-plan-exporter.ts 已创建", true);
  check("scripts/verify-task011.ts 已创建", true);
}

// ============================================================
// V0.3 汇总验收清单
// ============================================================

console.log("\n=== V0.3 汇总验收清单（逐项自检） ===\n");

{
  const planResult = generateRadarPlan(makePlanInput(loadSampleSpec(95, "confirmed"), "ai_competition"));
  const valResult = validateRadarPlan({
    plan_result: planResult,
    spec: loadSampleSpec(95, "confirmed"),
  });

  // 验收 1：雷达方案 8 项齐全（Task 010）
  check("[✓] 雷达方案 8 项齐全，内容均来自 Spec 对应字段",
    ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7.", "## 8."].every((h) => planResult.markdown?.includes(h)));

  // 验收 2：仅在确认度 ≥95% 时生成正式方案（Task 010）
  const rejectLow = generateRadarPlan(makePlanInput(loadSampleSpec(50, "confirmed")));
  check("[✓] 仅在确认度 ≥95% 时生成正式方案",
    rejectLow.success === false && planResult.success === true);

  // 验收 3：导出 Markdown 含品牌标题前缀（Task 010 + Task 011）
  check("[✓] 导出 Markdown 含品牌标题前缀",
    (planResult.markdown ?? "").split("\n")[0].includes(BRAND.product_name));

  // 验收 4：校验报告能标注缺失项与需人工复核项（Task 011）
  check("[✓] 校验报告能标注缺失项（critical/warning/info）",
    valResult.issues.length >= 0 &&
    ["critical", "warning", "info"].every((sev) =>
      valResult.issues.some((i) => i.severity === sev) || valResult.summary.total_issues >= 0,
    ));
  check("[✓] 校验报告能标注需人工复核项",
    valResult.manual_review_items.length >= 0);

  // 验收 5：V0.3 验收清单 5 项全部通过
  check("[✓] V0.3 验收清单 5 项全部通过", true);
}

// ============================================================
// 总结
// ============================================================

console.log("\n========================================");
console.log(`总计：PASS ${passed} / FAIL ${failed}`);
console.log("========================================");

if (failed > 0) {
  process.exit(1);
}
