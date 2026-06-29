/**
 * Task 047 验收脚本：报告增强 + D 级 + 阈值统一（Task D 产出）
 *
 * 运行：npx tsx scripts/verify-task047.ts
 *
 * 验证项（≥18 项）：
 *   1. 报告 stats 含 d_count / source_count / evidence_count（3 项）
 *   2. D 级机会进入排除章节（1 项）
 *   3. 报告含来源索引章节（3 项）
 *   4. 来源索引排序 + 待复核字段（2 项）
 *   5. 无 sourceCandidates 时不报错（1 项）
 *   6. P0 阈值统一验证（3 项）
 *   7. i18n 文案验证（4 项）
 *   8. 拒绝/空场景验证（2 项）
 *   9. 回归测试（2 项，可通过 SKIP_REGRESSION=1 跳过）
 *
 * 遵循 IDE 交付规范调整声明：
 *   - 红线 1：tsc 附完整输出
 *   - 红线 2：PASS 正则取最后一个匹配（matchAll）
 *   - 红线 5：回归测试范围与任务书一致
 *   - 红线 4：optionalDependencies 类型声明（不引入新依赖）
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

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
// 测试数据构造
// ============================================================

import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import type { SourceCandidate } from "../src/schema/source-candidate";
import type { EvidenceItem } from "../src/schema/evidence-item";

/** 构造已确认的高确认度 Spec */
function makeConfirmedSpec(): RadarRequirementSpec {
  const { createDefaultSpec } = require("../src/schema/radar-requirement-spec") as {
    createDefaultSpec: () => RadarRequirementSpec;
  };
  const spec = createDefaultSpec();
  spec.requirement_confidence.total = 95;
  spec.confirmation_status.status = "confirmed";
  spec.confirmation_status.user_confirmed = true;
  spec.confirmation_status.confirmed_at = "2026-06-01";
  return spec;
}

/** 构造测试 OpportunityCard */
function makeOpp(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    title: "测试机会",
    type: "AI 比赛",
    organizer: "教育部",
    region: "广州",
    deadline: "2099-12-31",
    reward_or_value: "10万元",
    eligibility: "AI 团队",
    materials_required: "",
    match_reason: "测试",
    next_action: "测试",
    official_source_url: "https://gov.cn/test",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 80,
    visible_level: "A",
    status: "new",
    ...overrides,
  };
}

/** 构造测试 SourceCandidate */
function makeSource(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    sourceId: "src_test_1",
    url: "https://gov.cn/test",
    mediaName: "教育部",
    sourceType: "government",
    confidenceGrade: "A1",
    verificationStatus: "verified",
    isOfficial: true,
    retrievedAt: "2026-06-15T00:00:00Z",
    ...overrides,
  };
}

/** 构造测试 EvidenceItem */
function makeEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidenceId: "ev_test_1",
    sourceId: "src_test_1",
    field: "deadline",
    value: "2026-07-15",
    evidenceText: "截止日期：2026-07-15",
    confidence: 0.4,
    needsReview: true,
    ...overrides,
  };
}

// ============================================================
// 1-8. 报告增强验证
// ============================================================

async function checkReportEnhancement(): Promise<void> {
  section("1. 报告 stats 新字段");

  const { generateRadarReport } = await import("../src/agents/radar-report-generator");
  const spec = makeConfirmedSpec();

  // stats 含 d_count
  {
    const result = generateRadarReport({
      spec,
      opportunities: [makeOpp({ visible_level: "D", backend_score: 30 })],
      radar_type: "ai_competition",
      period_start: "2026-06-01",
      period_end: "2026-06-07",
    });
    check("T1 stats 含 d_count", typeof result.stats.d_count === "number", `d_count=${result.stats.d_count}`);
    check("T2 stats 含 source_count", typeof result.stats.source_count === "number", `source_count=${result.stats.source_count}`);
    check("T3 stats 含 evidence_count", typeof result.stats.evidence_count === "number", `evidence_count=${result.stats.evidence_count}`);
    check("T3.1 D 级机会 d_count=1", result.stats.d_count === 1, `d_count=${result.stats.d_count}`);
  }

  section("2. D 级机会进入排除章节");

  // D 级机会进入排除章节
  {
    const result = generateRadarReport({
      spec,
      opportunities: [makeOpp({ title: "D 级测试", visible_level: "D", backend_score: 30 })],
      radar_type: "ai_competition",
      period_start: "2026-06-01",
      period_end: "2026-06-07",
    });
    const md = result.markdown ?? "";
    check("T4 D 级机会进入排除章节（第 7 章）",
      md.includes("D 级测试") && md.includes("不建议投入"),
      `markdown 含 D 级测试=${md.includes("D 级测试")}`);
  }

  section("3. 报告含来源索引章节");

  // 报告含来源索引章节
  {
    const result = generateRadarReport({
      spec,
      opportunities: [makeOpp()],
      radar_type: "ai_competition",
      period_start: "2026-06-01",
      period_end: "2026-06-07",
      sourceCandidates: [makeSource()],
      evidenceItems: [],
    });
    const md = result.markdown ?? "";
    check("T5 报告含'来源索引'章节（当传入 sourceCandidates）",
      md.includes("来源索引") || md.includes("8.5"),
      `md includes sourceIndex=${md.includes("来源索引")}`);
    check("T5.1 来源索引含来源 URL",
      md.includes("gov.cn/test"), `md includes gov.cn/test=${md.includes("gov.cn/test")}`);
    check("T5.2 stats.source_count = 1",
      result.stats.source_count === 1, `source_count=${result.stats.source_count}`);
  }

  section("4. 来源索引排序 + 待复核字段");

  // 来源索引按可信度等级排序
  {
    const sources = [
      makeSource({ sourceId: "src_e5", url: "https://unknown.com/test", mediaName: "未知", sourceType: "unknown", confidenceGrade: "E5", isOfficial: false }),
      makeSource({ sourceId: "src_a1", url: "https://gov.cn/test", mediaName: "教育部", sourceType: "government", confidenceGrade: "A1", isOfficial: true }),
    ];
    const result = generateRadarReport({
      spec,
      opportunities: [makeOpp()],
      radar_type: "ai_competition",
      period_start: "2026-06-01",
      period_end: "2026-06-07",
      sourceCandidates: sources,
      evidenceItems: [],
    });
    const md = result.markdown ?? "";
    // A1（教育部）应排在 E5（未知）之前
    const idxA1 = md.indexOf("教育部");
    const idxE5 = md.indexOf("未知");
    check("T6 来源索引按可信度等级排序（A1 在 E5 前）",
      idxA1 >= 0 && idxE5 >= 0 && idxA1 < idxE5,
      `idxA1=${idxA1}, idxE5=${idxE5}`);
  }

  // 来源索引含待复核字段
  {
    const result = generateRadarReport({
      spec,
      opportunities: [makeOpp()],
      radar_type: "ai_competition",
      period_start: "2026-06-01",
      period_end: "2026-06-07",
      sourceCandidates: [makeSource()],
      evidenceItems: [makeEvidence({ needsReview: true })],
    });
    const md = result.markdown ?? "";
    check("T7 来源索引含待复核字段",
      md.includes("待复核") || md.includes("人工复核"),
      `md includes 待复核=${md.includes("待复核")}`);
  }

  section("5. 无 sourceCandidates 时不报错");

  // 无 sourceCandidates 时报告不报错
  {
    const result = generateRadarReport({
      spec,
      opportunities: [makeOpp()],
      radar_type: "ai_competition",
      period_start: "2026-06-01",
      period_end: "2026-06-07",
    });
    check("T8 无 sourceCandidates 时报告成功生成",
      result.success === true && result.markdown !== null, `success=${result.success}`);
    check("T8.1 stats.source_count = 0",
      result.stats.source_count === 0, `source_count=${result.stats.source_count}`);
  }
}

// ============================================================
// 6. P0 阈值统一验证
// ============================================================

async function checkP0Thresholds(): Promise<void> {
  section("6. P0 阈值统一");

  const { createDefaultSpec } = await import("../src/schema/radar-requirement-spec");
  const spec = createDefaultSpec();

  check('T9 visible_level_mapping["S"] = "90-100"',
    spec.scoring_rules.visible_level_mapping["S"] === "90-100",
    `value=${spec.scoring_rules.visible_level_mapping["S"]}`);
  check('T10 visible_level_mapping["D"] = "0-49"',
    spec.scoring_rules.visible_level_mapping["D"] === "0-49",
    `value=${spec.scoring_rules.visible_level_mapping["D"]}`);
  check('T11 level_definitions["D"] = "不推荐"',
    spec.scoring_rules.level_definitions["D"] === "不推荐",
    `value=${spec.scoring_rules.level_definitions["D"]}`);
}

// ============================================================
// 7. i18n 文案验证
// ============================================================

async function checkI18nMessages(): Promise<void> {
  section("7. i18n 文案");

  const { t } = await import("../src/i18n/locales");

  check('T12 t("opportunity.level.D") = "不推荐"',
    t("opportunity.level.D") === "不推荐", `value=${t("opportunity.level.D")}`);
  check('T13 t("opportunity.sourceBadge.official") = "官方"',
    t("opportunity.sourceBadge.official") === "官方", `value=${t("opportunity.sourceBadge.official")}`);
  check('T14 t("opportunity.decision.attack") = "立即行动"',
    t("opportunity.decision.attack") === "立即行动", `value=${t("opportunity.decision.attack")}`);
  check('T15 t("report.section.sourceIndex") = "8.5 来源索引"',
    t("report.section.sourceIndex") === "8.5 来源索引", `value=${t("report.section.sourceIndex")}`);
}

// ============================================================
// 8. 拒绝/空场景验证
// ============================================================

async function checkEdgeCases(): Promise<void> {
  section("8. 拒绝/空场景");

  const { generateRadarReport } = await import("../src/agents/radar-report-generator");

  // 确认度 < 95% 拒绝生成报告
  {
    const { createDefaultSpec } = await import("../src/schema/radar-requirement-spec");
    const spec = createDefaultSpec(); // total=0
    const result = generateRadarReport({
      spec,
      opportunities: [],
      radar_type: "ai_competition",
      period_start: "2026-06-01",
      period_end: "2026-06-07",
    });
    check("T16 确认度 < 95% 拒绝生成报告",
      result.success === false && result.error !== null, `success=${result.success}`);
    check("T16.1 拒绝时 stats 含 d_count/source_count/evidence_count",
      typeof result.stats.d_count === "number" &&
      typeof result.stats.source_count === "number" &&
      typeof result.stats.evidence_count === "number",
      `d=${result.stats.d_count}, src=${result.stats.source_count}, ev=${result.stats.evidence_count}`);
  }

  // 空机会生成"本周暂无机会"报告
  {
    const result = generateRadarReport({
      spec: makeConfirmedSpec(),
      opportunities: [],
      radar_type: "ai_competition",
      period_start: "2026-06-01",
      period_end: "2026-06-07",
    });
    check("T17 空机会生成报告成功",
      result.success === true && result.markdown !== null, `success=${result.success}`);
    check("T17.1 空机会报告 stats.total_opportunities=0",
      result.stats.total_opportunities === 0, `total=${result.stats.total_opportunities}`);
  }
}

// ============================================================
// 9. 回归测试（spawnSync 同步执行，避免 libuv async handle 崩溃）
// ============================================================

function runRegressionTestSync(scriptName: string, label: string, expectedPass: number): void {
  const result = spawnSync("npx.cmd", ["tsx", `scripts/${scriptName}`], {
    cwd: process.cwd(),
    timeout: 180000,
    env: { ...process.env, SKIP_REGRESSION: "1" },
    encoding: "utf-8",
    shell: true,
  });

  const output = (result.stdout || "") + (result.stderr || "");
  // 红线 2：使用 matchAll 取最后一个匹配
  const allMatches = output.matchAll(/(\d+)\s*PASS/gi);
  const matches = [...allMatches];
  const passNum = matches.length > 0 ? parseInt(matches[matches.length - 1][1], 10) : 0;
  const success = passNum >= expectedPass;
  check(`${label} 回归通过（${passNum}/${expectedPass} PASS）`, success,
    `passNum=${passNum}, exit=${result.status}, signal=${result.signal}`);

  // 写入结果文件
  const resultLine = `${label}: ${success ? "PASS" : "FAIL"} (${passNum}/${expectedPass})\n`;
  fs.appendFileSync(path.resolve(process.cwd(), "verify-task047-result.log"), resultLine, "utf-8");
}

function checkRegression(): void {
  section("9. 回归测试");

  // 清理旧的结果文件
  const resultFile = path.resolve(process.cwd(), "verify-task047-result.log");
  try { fs.unlinkSync(resultFile); } catch { /* ignore */ }

  runRegressionTestSync("verify-e2e-ai-events.ts", "T18 verify-e2e-ai-events", 13);
  runRegressionTestSync("verify-task040.ts", "T19 verify-task040", 75);
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 047 验收检查：报告增强 + D 级 + 阈值统一 ===\n");

  await checkReportEnhancement();
  await checkP0Thresholds();
  await checkI18nMessages();
  await checkEdgeCases();

  if (process.env.SKIP_REGRESSION === "1") {
    console.log("\n--- 跳过回归测试（SKIP_REGRESSION=1） ---");
  } else {
    checkRegression();
  }

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  const resultLog = `Task 047 验收结果: ${passed} PASS / ${failed} FAIL\n`;
  fs.writeFileSync(path.resolve(process.cwd(), "verify-task047-result.log"), resultLog, "utf-8");

  if (failed > 0) {
    console.log("\n❌ 存在失败项，请修复后重试");
    process.exitCode = 1;
  } else {
    console.log("\n✓ 全部通过");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error("执行失败：", err);
  process.exitCode = 1;
});
