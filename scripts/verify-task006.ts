/**
 * Task 006 验收脚本
 *
 * 运行：npx tsx scripts/verify-task006.ts
 * 覆盖验收标准 5.1–5.6：
 *   5.1 维度打分正确性（7 维度 × 3 档 = 21 个测试）
 *   5.2 总分计算正确性（4 个测试）
 *   5.3 分支判断正确性（10 个测试）
 *   5.4 确认度变化对比（3 个测试）
 *   5.5 reason 质量
 *   5.6 编译与引用
 */

import fs from "fs";
import path from "path";
import {
  calculateConfidence,
  getConfidenceBranch,
  calculateConfidenceDelta,
  type ConfidenceBranch,
} from "../src/agents/confidence-engine";
import type { ExtractedRequirementInfo } from "../src/schema/extracted-requirement-info";
import {
  computeConfidenceTotal,
  createDefaultConfidence,
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_DIMENSIONS,
  type RequirementConfidence,
} from "../src/schema/requirement-confidence";
import { CONFIDENCE_CALCULATION_SPEC } from "../src/schema/confidence-calculation-spec";

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

/** 全空输入（所有字段未填充） */
function emptyInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {},
    business_goal: {},
    opportunity_type: {},
    region_scope: {},
    exclusion_rules: { count: 0 },
    action_scenario: {},
    report_format: {},
  };
}

/** 全满输入（所有维度字段齐全） */
function fullInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {
      client_type: "个人",
      industry: "AI 游戏",
      core_capabilities: ["Unity", "AI 内容生成"],
      products_or_projects: ["AI Dungeon Runner"],
    },
    business_goal: {
      primary_goal: "每月报名 1–2 个 AI 游戏比赛",
      success_definition: "拿到至少入围奖",
      priority_order: ["奖金金额", "Demo 可行性"],
    },
    opportunity_type: {
      primary_types: ["AI 游戏比赛", "AI Hackathon"],
      excluded_types: ["少儿 / K12 赛事", "政府采购"],
      secondary_types: ["品牌合作"],
    },
    region_scope: {
      primary_regions: ["中国大陆"],
      excluded_regions: ["港澳台"],
      secondary_regions: ["海外（英语地区）"],
    },
    exclusion_rules: {
      must_exclude: ["K12", "政府采购", "招投标", "纯广告"],
      low_priority_signals: ["信息不完整"],
      count: 4,
    },
    action_scenario: {
      action_intent: "报名比赛、准备材料、发布内容",
      priority_order: ["报名", "准备材料", "发布内容"],
    },
    report_format: {
      frequency: "每周",
      format: "markdown",
      must_include_sections: ["本周一句话判断", "S 级机会", "行动建议"],
    },
  };
}

/** 仅 client_identity + business_goal 填满，其余为空 */
function partialInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {
      client_type: "个人",
      industry: "AI 游戏",
      core_capabilities: ["Unity"],
      products_or_projects: ["AI Dungeon Runner"],
    },
    business_goal: {
      primary_goal: "每月报名 1–2 个 AI 游戏比赛",
      success_definition: "拿到至少入围奖",
      priority_order: ["奖金金额", "Demo 可行性"],
    },
    opportunity_type: {},
    region_scope: {},
    exclusion_rules: { count: 0 },
    action_scenario: {},
    report_format: {},
  };
}

/** 构造一个指定总分的 RequirementConfidence（用于 delta 测试） */
function makeConfidence(scores: Partial<Record<string, number>>): RequirementConfidence {
  const c = createDefaultConfidence();
  for (const key of CONFIDENCE_DIMENSIONS) {
    if (scores[key] !== undefined) {
      c[key].score = scores[key]!;
      c[key].reason = "测试 reason";
    }
  }
  c.total = computeConfidenceTotal(c);
  return c;
}

// ============================================================
// 验收 5.1：维度打分正确性（7 维度 × 3 档 = 21 个测试）
// ============================================================

console.log("\n=== Task 006 验收检查 ===\n");
console.log("[验收 5.1] 维度打分正确性（7 维度 × 3 档）\n");

// --- client_identity ---
console.log("  -- client_identity --");
{
  const empty = calculateConfidence(emptyInfo());
  check("client_identity 空 → score=0", empty.client_identity.score === 0, `got ${empty.client_identity.score}`);
  check("client_identity 空 → reason 含「尚未获取」", empty.client_identity.reason.includes("尚未获取"));

  const partial = calculateConfidence({
    ...emptyInfo(),
    client_identity: { client_type: "个人", industry: "AI 游戏" },
  });
  check("client_identity 2 字段 → score=75", partial.client_identity.score === 75, `got ${partial.client_identity.score}`);
  check("client_identity 2 字段 → reason 含「个人」+「AI 游戏」",
    partial.client_identity.reason.includes("个人") && partial.client_identity.reason.includes("AI 游戏"),
    partial.client_identity.reason);

  const full = calculateConfidence({
    ...emptyInfo(),
    client_identity: {
      client_type: "个人", industry: "AI 游戏",
      core_capabilities: ["Unity", "AI"], products_or_projects: ["AI 游戏 Demo"],
    },
  });
  check("client_identity 4 字段 → score=95", full.client_identity.score === 95, `got ${full.client_identity.score}`);
  check("client_identity 4 字段 → reason 含「身份清晰」", full.client_identity.reason.includes("身份清晰"));
}

// --- business_goal ---
console.log("  -- business_goal --");
{
  const empty = calculateConfidence(emptyInfo());
  check("business_goal 空 → score=0", empty.business_goal.score === 0);
  check("business_goal 空 → reason 含「完全不明」", empty.business_goal.reason.includes("完全不明"));

  const partial = calculateConfidence({
    ...emptyInfo(),
    business_goal: { primary_goal: "报名比赛" },
  });
  check("business_goal 1 字段 → score=55", partial.business_goal.score === 55, `got ${partial.business_goal.score}`);
  check("business_goal 1 字段 → reason 含「报名比赛」", partial.business_goal.reason.includes("报名比赛"));

  const full = calculateConfidence({
    ...emptyInfo(),
    business_goal: {
      primary_goal: "报名比赛", success_definition: "入围",
      priority_order: ["奖金", "曝光"],
    },
  });
  check("business_goal 3 字段 → score=95", full.business_goal.score === 95, `got ${full.business_goal.score}`);
  check("business_goal 3 字段 → reason 含「目标完整」", full.business_goal.reason.includes("目标完整"));
}

// --- opportunity_type ---
console.log("  -- opportunity_type --");
{
  const empty = calculateConfidence(emptyInfo());
  check("opportunity_type 空 → score=0", empty.opportunity_type.score === 0);

  const partial = calculateConfidence({
    ...emptyInfo(),
    opportunity_type: { primary_types: ["AI 游戏比赛"] },
  });
  check("opportunity_type 1 字段 → score=55", partial.opportunity_type.score === 55, `got ${partial.opportunity_type.score}`);

  const full = calculateConfidence({
    ...emptyInfo(),
    opportunity_type: {
      primary_types: ["AI 游戏比赛"], excluded_types: ["K12"], secondary_types: ["品牌合作"],
    },
  });
  check("opportunity_type 3 字段 → score=95", full.opportunity_type.score === 95, `got ${full.opportunity_type.score}`);
  check("opportunity_type 3 字段 → reason 含「类型完整」", full.opportunity_type.reason.includes("类型完整"));
}

// --- region_scope ---
console.log("  -- region_scope --");
{
  const empty = calculateConfidence(emptyInfo());
  check("region_scope 空 → score=0", empty.region_scope.score === 0);

  const partial = calculateConfidence({
    ...emptyInfo(),
    region_scope: { primary_regions: ["广州"] },
  });
  check("region_scope 1 字段 → score=55", partial.region_scope.score === 55, `got ${partial.region_scope.score}`);

  const full = calculateConfidence({
    ...emptyInfo(),
    region_scope: {
      primary_regions: ["广州"], excluded_regions: ["港澳台"], secondary_regions: ["海外"],
    },
  });
  check("region_scope 3 字段 → score=95", full.region_scope.score === 95, `got ${full.region_scope.score}`);
  check("region_scope 3 字段 → reason 含「范围完整」", full.region_scope.reason.includes("范围完整"));
}

// --- exclusion_rules ---
console.log("  -- exclusion_rules --");
{
  const empty = calculateConfidence(emptyInfo());
  check("exclusion_rules count=0 → score=0", empty.exclusion_rules.score === 0);
  check("exclusion_rules count=0 → reason 含「未提供」", empty.exclusion_rules.reason.includes("未提供"));

  const one = calculateConfidence({
    ...emptyInfo(),
    exclusion_rules: { must_exclude: ["K12"], count: 1 },
  });
  check("exclusion_rules count=1 → score=55", one.exclusion_rules.score === 55, `got ${one.exclusion_rules.score}`);

  const four = calculateConfidence({
    ...emptyInfo(),
    exclusion_rules: { must_exclude: ["K12", "政府采购", "招投标", "纯广告"], low_priority_signals: ["信息不完整"], count: 4 },
  });
  check("exclusion_rules count=4 → score=95", four.exclusion_rules.score === 95, `got ${four.exclusion_rules.score}`);
  check("exclusion_rules count=4 → reason 含「全面」", four.exclusion_rules.reason.includes("全面"));
}

// --- action_scenario ---
console.log("  -- action_scenario --");
{
  const empty = calculateConfidence(emptyInfo());
  check("action_scenario 空 → score=0", empty.action_scenario.score === 0);

  const partial = calculateConfidence({
    ...emptyInfo(),
    action_scenario: { action_intent: "报名比赛" },
  });
  check("action_scenario 1 字段 → score=55", partial.action_scenario.score === 55, `got ${partial.action_scenario.score}`);

  const full = calculateConfidence({
    ...emptyInfo(),
    action_scenario: { action_intent: "报名比赛", priority_order: ["报名", "准备材料"] },
  });
  check("action_scenario 2 字段(≥2 优先级) → score=95", full.action_scenario.score === 95, `got ${full.action_scenario.score}`);
  check("action_scenario 2 字段 → reason 含「场景清晰」", full.action_scenario.reason.includes("场景清晰"));
}

// --- report_format ---
console.log("  -- report_format --");
{
  const empty = calculateConfidence(emptyInfo());
  check("report_format 空 → score=0", empty.report_format.score === 0);

  const partial = calculateConfidence({
    ...emptyInfo(),
    report_format: { frequency: "每周" },
  });
  check("report_format 1 字段 → score=55", partial.report_format.score === 55, `got ${partial.report_format.score}`);

  const full = calculateConfidence({
    ...emptyInfo(),
    report_format: { frequency: "每周", format: "markdown", must_include_sections: ["S级机会", "行动建议"] },
  });
  check("report_format 3 字段 → score=95", full.report_format.score === 95, `got ${full.report_format.score}`);
  check("report_format 3 字段 → reason 含「形式完整」", full.report_format.reason.includes("形式完整"));
}

// ============================================================
// 验收 5.2：总分计算正确性（4 个测试）
// ============================================================

console.log("\n[验收 5.2] 总分计算正确性\n");

{
  const allEmpty = calculateConfidence(emptyInfo());
  check("全空输入 → total=0", allEmpty.total === 0, `got ${allEmpty.total}`);
}

{
  const allFull = calculateConfidence(fullInfo());
  check("全满输入 → total=95", allFull.total === 95, `got ${allFull.total}`);
}

{
  // sample-spec.json 的确认度数据 → 复现 Task 001 示例总分 88.25
  const samplePath = path.resolve(process.cwd(), "data/samples/sample-spec.json");
  const sample = JSON.parse(fs.readFileSync(samplePath, "utf-8"));
  const sampleConfidence = sample.requirement_confidence as RequirementConfidence;
  const recomputed = computeConfidenceTotal(sampleConfidence);
  check("sample-spec.json → computeConfidenceTotal=88.25", recomputed === 88.25, `got ${recomputed}`);
}

{
  // 部分填充：仅 client_identity=95 + business_goal=95，其余=0
  // 正确总分 = (95×15 + 95×20) / 100 = (1425+1900)/100 = 33.25
  const partial = calculateConfidence(partialInfo());
  check("部分填充(client_identity=95, business_goal=95) → total=33.25",
    partial.total === 33.25,
    `got ${partial.total} (期望 33.25，任务书 39.75 为算术笔误)`);
  check("部分填充 → client_identity.score=95", partial.client_identity.score === 95);
  check("部分填充 → business_goal.score=95", partial.business_goal.score === 95);
  check("部分填充 → 其余维度 score=0",
    partial.opportunity_type.score === 0 && partial.region_scope.score === 0 &&
    partial.exclusion_rules.score === 0 && partial.action_scenario.score === 0 &&
    partial.report_format.score === 0);
}

// ============================================================
// 验收 5.3：分支判断正确性（10 个测试）
// ============================================================

console.log("\n[验收 5.3] 分支判断正确性\n");

const branchCases: Array<[number, ConfidenceBranch]> = [
  [0, "needs_more_info"],
  [50, "needs_more_info"],
  [69.99, "needs_more_info"],
  [70, "continue_confirming"],
  [85, "continue_confirming"],
  [89.99, "continue_confirming"],
  [90, "can_generate_card_v01"],
  [94.99, "can_generate_card_v01"],
  [95, "can_generate_plan"],
  [100, "can_generate_plan"],
];

for (const [total, expected] of branchCases) {
  const actual = getConfidenceBranch(total);
  check(`getConfidenceBranch(${total}) = ${expected}`, actual === expected, `got ${actual}`);
}

// ============================================================
// 验收 5.4：确认度变化对比（3 个测试）
// ============================================================

console.log("\n[验收 5.4] 确认度变化对比\n");

{
  // previous.total=50, current.total=75 → total_delta=25, 至少 1 个维度 delta>0
  const prev = makeConfidence({ client_identity: 50, business_goal: 50, opportunity_type: 50, region_scope: 50, exclusion_rules: 50, action_scenario: 50, report_format: 50 });
  const curr = makeConfidence({ client_identity: 75, business_goal: 75, opportunity_type: 75, region_scope: 75, exclusion_rules: 75, action_scenario: 75, report_format: 75 });
  const delta = calculateConfidenceDelta(prev, curr);
  check("delta(50→75) → total_delta=25", delta.total_delta === 25, `got ${delta.total_delta}`);
  check("delta(50→75) → 至少 1 个维度 delta>0", delta.dimension_deltas.some((d) => d.delta > 0));
}

{
  // previous.total=80, current.total=80 → total_delta=0, 所有维度 delta=0
  const prev = makeConfidence({ client_identity: 80, business_goal: 80, opportunity_type: 80, region_scope: 80, exclusion_rules: 80, action_scenario: 80, report_format: 80 });
  const curr = makeConfidence({ client_identity: 80, business_goal: 80, opportunity_type: 80, region_scope: 80, exclusion_rules: 80, action_scenario: 80, report_format: 80 });
  const delta = calculateConfidenceDelta(prev, curr);
  check("delta(80→80) → total_delta=0", delta.total_delta === 0, `got ${delta.total_delta}`);
  check("delta(80→80) → 所有维度 delta=0", delta.dimension_deltas.every((d) => d.delta === 0));
}

{
  // previous.total=90, current.total=70 → total_delta=-20, 至少 1 个维度 delta<0
  const prev = makeConfidence({ client_identity: 90, business_goal: 90, opportunity_type: 90, region_scope: 90, exclusion_rules: 90, action_scenario: 90, report_format: 90 });
  const curr = makeConfidence({ client_identity: 70, business_goal: 70, opportunity_type: 70, region_scope: 70, exclusion_rules: 70, action_scenario: 70, report_format: 70 });
  const delta = calculateConfidenceDelta(prev, curr);
  check("delta(90→70) → total_delta=-20", delta.total_delta === -20, `got ${delta.total_delta}`);
  check("delta(90→70) → 至少 1 个维度 delta<0", delta.dimension_deltas.some((d) => d.delta < 0));
}

// ============================================================
// 验收 5.5：reason 质量
// ============================================================

console.log("\n[验收 5.5] reason 质量\n");

{
  const full = calculateConfidence(fullInfo());
  let allReasonsOk = true;
  let detail = "";
  for (const key of CONFIDENCE_DIMENSIONS) {
    const dim = full[key];
    if (dim.score > 0) {
      if (dim.reason.length < 10) {
        allReasonsOk = false;
        detail = `${key} reason 长度=${dim.reason.length}`;
        break;
      }
    }
  }
  check("全满输入：所有非 0 分维度 reason 非空且长度≥10", allReasonsOk, detail);
}

{
  const partial = calculateConfidence(partialInfo());
  let allReasonsOk = true;
  let detail = "";
  for (const key of CONFIDENCE_DIMENSIONS) {
    const dim = partial[key];
    if (dim.score > 0) {
      if (dim.reason.length < 10) {
        allReasonsOk = false;
        detail = `${key} reason 长度=${dim.reason.length}`;
        break;
      }
    }
  }
  check("部分输入：所有非 0 分维度 reason 非空且长度≥10", allReasonsOk, detail);
}

// ============================================================
// 验收 5.6：编译与引用
// ============================================================

console.log("\n[验收 5.6] 编译与引用\n");

{
  // 检查 weight 与 CONFIDENCE_WEIGHTS 一致
  const full = calculateConfidence(fullInfo());
  let weightsOk = true;
  let detail = "";
  for (const key of CONFIDENCE_DIMENSIONS) {
    if (full[key].weight !== CONFIDENCE_WEIGHTS[key]) {
      weightsOk = false;
      detail = `${key} weight=${full[key].weight} 期望=${CONFIDENCE_WEIGHTS[key]}`;
      break;
    }
  }
  check("各维度 weight 与 CONFIDENCE_WEIGHTS 一致", weightsOk, detail);
}

{
  // 检查 CONFIDENCE_CALCULATION_SPEC 长度=7（引用 Task 002）
  check("CONFIDENCE_CALCULATION_SPEC 长度=7（引用 Task 002）", CONFIDENCE_CALCULATION_SPEC.length === 7, `got ${CONFIDENCE_CALCULATION_SPEC.length}`);
}

{
  // 检查 calculateConfidence 返回的 total 与 computeConfidenceTotal 一致（复用 Task 001）
  const full = calculateConfidence(fullInfo());
  const recomputed = computeConfidenceTotal(full);
  check("calculateConfidence 的 total 与 computeConfidenceTotal 一致", full.total === recomputed, `${full.total} vs ${recomputed}`);
}

{
  // 检查 delta 结构完整性
  const prev = makeConfidence({ client_identity: 50 });
  const curr = makeConfidence({ client_identity: 75 });
  const delta = calculateConfidenceDelta(prev, curr);
  check("ConfidenceDelta 含 7 个维度", delta.dimension_deltas.length === 7, `got ${delta.dimension_deltas.length}`);
  check("ConfidenceDelta 每项含 dimension/label/previous_score/current_score/delta",
    delta.dimension_deltas.every((d) =>
      typeof d.dimension === "string" && typeof d.label === "string" &&
      typeof d.previous_score === "number" && typeof d.current_score === "number" && typeof d.delta === "number"));
}

// ============================================================
// 汇总
// ============================================================

console.log("\n=== 汇总 ===");
console.log(`PASS: ${passed}   FAIL: ${failed}`);
console.log("\n请另行执行：");
console.log("  npx tsc --noEmit   # TypeScript 编译无错误");
console.log("");

if (failed > 0) {
  process.exit(1);
}
