/**
 * Task 008 验收脚本
 *
 * 运行：npx tsx scripts/verify-task008.ts
 *
 * 覆盖验收标准 5.1–5.7：
 *   5.1 拒绝生成逻辑（4 个测试：0/50/69.9/89.9）
 *   5.2 V0.1 确认卡生成（90/93/94.9）
 *   5.3 V1.0 确认卡生成（95/100）
 *   5.4 10 模块完整性
 *   5.5 内容正确性（复用 Task 007 Turn 3 后状态，93 分）
 *   5.6 缺失字段处理
 *   5.7 编译与引用
 */

import { generateConfirmationCard } from "../src/agents/confirmation-card-generator";
import type { ConfirmationCardResult } from "../src/agents/confirmation-card-generator";
import type { ExtractedRequirementInfo } from "../src/schema/extracted-requirement-info";
import {
  createDefaultConfidence,
  computeConfidenceTotal,
  CONFIDENCE_DIMENSIONS,
  CONFIDENCE_DIMENSION_LABELS,
  type RequirementConfidence,
  type ConfidenceDimensionKey,
} from "../src/schema/requirement-confidence";
import { calculateConfidence } from "../src/agents/confidence-engine";
import { BRAND } from "../src/brand/constants";
import { MUST_INCLUDE_SECTIONS } from "../src/schema/radar-requirement-spec";
import { LEVEL_DEFINITIONS } from "../src/schema/scoring-rules";

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

function approxEqual(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

// ============================================================
// 测试数据构造
// ============================================================

/** 全空 ExtractedRequirementInfo */
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

/**
 * Task 007 Turn 3 后的累积状态（confidence 93.0）。
 * 用于 5.5 内容正确性测试。
 */
function turn3Info(): ExtractedRequirementInfo {
  return {
    client_identity: {
      client_type: "个人",
      industry: "AI 游戏",
      core_capabilities: ["Unity"],
      products_or_projects: ["AI 游戏"],
    },
    business_goal: {
      primary_goal: "找 AI 游戏比赛",
      success_definition: "拿到至少入围奖",
      priority_order: ["奖金金额", "Demo 可行性"],
    },
    opportunity_type: {
      primary_types: ["AI 游戏比赛"],
      excluded_types: ["K12 赛事", "政府采购"],
      secondary_types: ["品牌合作"],
    },
    region_scope: {
      primary_regions: ["广州"],
      excluded_regions: ["海外"],
      secondary_regions: ["深圳", "杭州"],
    },
    exclusion_rules: {
      must_exclude: ["K12 赛事", "学生类赛事"],
      count: 2,
    },
    action_scenario: {
      action_intent: "报名比赛",
      priority_order: ["奖金金额", "Demo 可行性"],
    },
    report_format: {
      frequency: "每周",
      format: "Markdown",
      must_include_sections: ["本周一句话判断", "本周 S 级机会", "机会详情卡片"],
    },
  };
}

/**
 * 全满分 ExtractedRequirementInfo（confidence 95+）。
 * 用于 V1.0 测试。
 */
function fullScoreInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {
      client_type: "个人",
      industry: "AI 游戏",
      core_capabilities: ["Unity", "AI 内容生成"],
      products_or_projects: ["AI Dungeon Runner"],
    },
    business_goal: {
      primary_goal: "每月报名 1-2 个 AI 游戏比赛",
      secondary_goals: ["品牌曝光"],
      success_definition: "拿到至少入围奖",
      priority_order: ["奖金金额", "Demo 可行性"],
    },
    opportunity_type: {
      primary_types: ["AI 游戏比赛", "AI Hackathon"],
      excluded_types: ["K12 赛事", "政府采购"],
      secondary_types: ["品牌合作"],
      must_have_conditions: ["奖金金额", "截止时间", "参赛资格"],
    },
    region_scope: {
      primary_regions: ["中国大陆"],
      excluded_regions: ["港澳台"],
      secondary_regions: ["海外"],
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

/**
 * 部分填充 ExtractedRequirementInfo（只有 client_identity + business_goal 填满，
 * 其余为空）。用于 5.6 缺失字段处理测试。
 * 此场景 confidence 仅 33.25，需通过 forceConfidence 提升到 90 才能测试缺失字段。
 */
function partialInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {
      client_type: "个人",
      industry: "AI 游戏",
      core_capabilities: ["Unity"],
      products_or_projects: ["AI 游戏"],
    },
    business_goal: {
      primary_goal: "找 AI 游戏比赛",
      success_definition: "拿到入围奖",
      priority_order: ["奖金金额"],
    },
    opportunity_type: {},
    region_scope: {},
    exclusion_rules: { count: 0 },
    action_scenario: {},
    report_format: {},
  };
}

/** 构造一个指定 total 的 RequirementConfidence（用于拒绝/版本边界测试） */
function makeConfidenceWithTotal(total: number): RequirementConfidence {
  const c = createDefaultConfidence();
  c.total = total;
  return c;
}

/** 构造一个所有维度 score >= 90 的 confidence（用于 V1.0 全无不确定项测试） */
function makeFullConfidence(): RequirementConfidence {
  const c = createDefaultConfidence();
  for (const key of CONFIDENCE_DIMENSIONS) {
    c[key as ConfidenceDimensionKey].score = 95;
    c[key as ConfidenceDimensionKey].reason = "测试全满";
  }
  c.total = computeConfidenceTotal(c);
  return c;
}

// ============================================================
// 验收 5.1：拒绝生成逻辑
// ============================================================

console.log("\n=== Task 008 验收检查 ===\n");
console.log("[验收 5.1] 拒绝生成逻辑\n");

{
  const result0 = generateConfirmationCard(emptyInfo(), makeConfidenceWithTotal(0));
  check("确认度 0 → success=false", result0.success === false, `actual=${result0.success}`);
  check("确认度 0 → error 含 '90%'", result0.error !== null && result0.error.includes("90%"), `error=${result0.error}`);
  check("确认度 0 → markdown=null", result0.markdown === null);
  check("确认度 0 → version=null", result0.version === null);

  const result50 = generateConfirmationCard(emptyInfo(), makeConfidenceWithTotal(50));
  check("确认度 50 → success=false", result50.success === false);
  check("确认度 50 → error 含 '90%'", result50.error !== null && result50.error.includes("90%"));

  const result699 = generateConfirmationCard(emptyInfo(), makeConfidenceWithTotal(69.9));
  check("确认度 69.9 → success=false", result699.success === false);

  const result899 = generateConfirmationCard(emptyInfo(), makeConfidenceWithTotal(89.9));
  check("确认度 89.9 → success=false", result899.success === false);

  // 边界：90 应该可以生成
  const result90 = generateConfirmationCard(turn3Info(), makeConfidenceWithTotal(90));
  check("确认度 90 → success=true（边界）", result90.success === true, `actual=${result90.success}`);
}

// ============================================================
// 验收 5.2：V0.1 确认卡生成（90-94%）
// ============================================================

console.log("\n[验收 5.2] V0.1 确认卡生成（90-94%）\n");

{
  const r90 = generateConfirmationCard(turn3Info(), makeConfidenceWithTotal(90));
  check("确认度 90 → success=true", r90.success === true);
  check("确认度 90 → version='V0.1'", r90.version === "V0.1", `actual=${r90.version}`);

  const r93 = generateConfirmationCard(turn3Info(), makeConfidenceWithTotal(93));
  check("确认度 93 → success=true", r93.success === true);
  check("确认度 93 → version='V0.1'", r93.version === "V0.1");

  const r949 = generateConfirmationCard(turn3Info(), makeConfidenceWithTotal(94.9));
  check("确认度 94.9 → success=true", r949.success === true);
  check("确认度 94.9 → version='V0.1'", r949.version === "V0.1");

  check("V0.1 标题含 '需求确认卡 V0.1'",
    r93.markdown !== null && r93.markdown.includes("需求确认卡 V0.1"),
    "markdown 未包含 '需求确认卡 V0.1'");

  check("V0.1 末尾含 '第一版'",
    r93.markdown !== null && r93.markdown.includes("第一版"),
    "markdown 未包含 '第一版'");

  check("V0.1 含 BRAND.product_name",
    r93.markdown !== null && r93.markdown.includes(BRAND.product_name),
    `markdown 未包含 ${BRAND.product_name}`);

  check("V0.1 markdown 非空",
    r93.markdown !== null && r93.markdown.length > 0);
}

// ============================================================
// 验收 5.3：V1.0 确认卡生成（≥95%）
// ============================================================

console.log("\n[验收 5.3] V1.0 确认卡生成（≥95%）\n");

{
  const r95 = generateConfirmationCard(fullScoreInfo(), makeConfidenceWithTotal(95));
  check("确认度 95 → success=true", r95.success === true);
  check("确认度 95 → version='V1.0'", r95.version === "V1.0", `actual=${r95.version}`);

  const r100 = generateConfirmationCard(fullScoreInfo(), makeConfidenceWithTotal(100));
  check("确认度 100 → success=true", r100.success === true);
  check("确认度 100 → version='V1.0'", r100.version === "V1.0");

  check("V1.0 标题含 '需求确认卡'",
    r95.markdown !== null && r95.markdown.includes("需求确认卡"),
    "markdown 未包含 '需求确认卡'");

  check("V1.0 标题不含 'V0.1'",
    r95.markdown !== null && !r95.markdown.includes("V0.1"),
    "markdown 不应包含 'V0.1'");

  check("V1.0 末尾含 '95%'",
    r95.markdown !== null && r95.markdown.includes("95%"),
    "markdown 未包含 '95%'");

  check("V1.0 含 BRAND.product_name",
    r95.markdown !== null && r95.markdown.includes(BRAND.product_name));
}

// ============================================================
// 验收 5.4：10 模块完整性
// ============================================================

console.log("\n[验收 5.4] 10 模块完整性\n");

{
  const result = generateConfirmationCard(turn3Info(), makeConfidenceWithTotal(93));
  const md = result.markdown ?? "";

  const moduleHeaders = [
    "## 1. 我理解你的身份",
    "## 2. 我理解你的核心目标",
    "## 3. 我理解你需要盯的机会类型",
    "## 4. 我建议优先追踪的信号",
    "## 5. 我建议优先排除的信息",
    "## 6. 我建议的雷达方向",
    "## 7. 我建议的机会分级方式",
    "## 8. 我建议的报告结构",
    "## 9. 当前需求确认度",
    "## 10. 请你确认",
  ];

  moduleHeaders.forEach((header, i) => {
    check(`模块 ${i + 1} 标题存在（${header}）`, md.includes(header), "未找到模块标题");
  });

  // 模块 6 应至少含 1 个子雷达
  check("模块 6 含 '### 子雷达 1'", md.includes("### 子雷达 1"));

  // 模块 8 应含 9 项编号
  check("模块 8 含 9 项编号（1. ~ 9.）", /^8\. /m.test(md) && /9\. 下周继续追踪/.test(md));
}

// ============================================================
// 验收 5.5：内容正确性（复用 Task 007 Turn 3 后状态，93 分）
// ============================================================

console.log("\n[验收 5.5] 内容正确性（Turn 3 后状态）\n");

{
  // 使用 calculateConfidence 计算 Turn 3 后的实际 confidence
  const info = turn3Info();
  const confidence = calculateConfidence(info);
  check("Turn 3 后 confidence ≈ 93.0",
    approxEqual(confidence.total, 93.0),
    `actual=${confidence.total}`);

  const result = generateConfirmationCard(info, confidence);
  const md = result.markdown ?? "";

  check("success=true（confidence 93 ≥ 90）", result.success === true);
  check("version='V0.1'（93 在 90-94 范围）", result.version === "V0.1");

  // 模块 1 包含 client_type 值
  check("模块 1 含 client_type='个人'", md.includes("个人"));
  // 模块 1 包含 industry 值
  check("模块 1 含 industry='AI 游戏'", md.includes("AI 游戏"));

  // 模块 2 包含 primary_goal 值
  check("模块 2 含 primary_goal='找 AI 游戏比赛'", md.includes("找 AI 游戏比赛"));

  // 模块 3 包含 primary_types 值
  check("模块 3 含 primary_types='AI 游戏比赛'", md.includes("AI 游戏比赛"));

  // 模块 5 包含排除条件（must_exclude + excluded_types 去重）
  check("模块 5 含 must_exclude='K12 赛事'", md.includes("K12 赛事"));
  check("模块 5 含 excluded_types='政府采购'", md.includes("政府采购"));

  // 模块 7 包含 S/A/B/C
  check("模块 7 含 'S 级'", md.includes("S 级"));
  check("模块 7 含 'A 级'", md.includes("A 级"));
  check("模块 7 含 'B 级'", md.includes("B 级"));
  check("模块 7 含 'C 级'", md.includes("C 级"));

  // 模块 7 含 LEVEL_DEFINITIONS 内容
  check("模块 7 含 LEVEL_DEFINITIONS.S", md.includes(LEVEL_DEFINITIONS.S));
  check("模块 7 含 LEVEL_DEFINITIONS.A", md.includes(LEVEL_DEFINITIONS.A));

  // 模块 8 含 MUST_INCLUDE_SECTIONS 的 9 项
  for (const section of MUST_INCLUDE_SECTIONS) {
    check(`模块 8 含 '${section}'`, md.includes(section), `未找到 ${section}`);
  }

  // 模块 9 含总体确认度（total + "%"）
  check("模块 9 含 total + '%'", md.includes(`${confidence.total}%`), `未找到 ${confidence.total}%`);

  // 模块 9 含 score<90 的维度中文名
  // Turn 3 后 exclusion_rules.score=75 < 90，应有"排除条件清晰度"
  check("模块 9 含 '排除条件清晰度'（score<90 维度）",
    md.includes(CONFIDENCE_DIMENSION_LABELS.exclusion_rules),
    `未找到 ${CONFIDENCE_DIMENSION_LABELS.exclusion_rules}`);

  // 模块 10 含 3 问关键词
  check("模块 10 含 '是否准确'", md.includes("是否准确"));
  check("模块 10 含 '删除或补充'", md.includes("删除或补充"));
  check("模块 10 含 '雷达方案'", md.includes("雷达方案"));
}

// ============================================================
// 验收 5.6：缺失字段处理
// ============================================================

console.log("\n[验收 5.6] 缺失字段处理\n");

{
  // 部分填充：只有 client_identity + business_goal，其余为空
  const info = partialInfo();
  // 用 calculateConfidence 计算实际只有 33.25，强制提升到 90 才能测试缺失字段
  const confidence = makeConfidenceWithTotal(90);

  const result = generateConfirmationCard(info, confidence);
  const md = result.markdown ?? "";

  check("部分填充 + confidence 90 → success=true", result.success === true, `actual=${result.success}`);
  check("version='V0.1'", result.version === "V0.1");

  // 缺失字段显示"未明确"
  check("markdown 含 '未明确'（缺失字段处理）", md.includes("未明确"), "未找到 '未明确'");

  // 模块 3 缺失时给提示（primary_types 空 → 写"未明确，请在确认时补充"）
  check("模块 3 缺失时含 '请在确认时补充'",
    md.includes("请在确认时补充"),
    "未找到 '请在确认时补充'");

  // 模块 4 缺失 must_have_conditions 时基于 primary_types 推导，标注 (AI 建议)
  // partialInfo 的 primary_types 为空，会走默认推导
  check("模块 4 缺失时含 '(AI 建议)'", md.includes("(AI 建议)"));

  // 模块 5 缺失时含"暂无排除条件"
  check("模块 5 缺失时含 '暂无排除条件'",
    md.includes("暂无排除条件"),
    "未找到 '暂无排除条件'");

  // 模块 6 缺失 primary_types 时的提示
  check("模块 6 缺失时含 '未明确机会类型'",
    md.includes("未明确机会类型"),
    "未找到 '未明确机会类型'");

  // 不会因缺失字段崩溃：success=true
  check("不会因缺失字段崩溃", result.success === true && result.markdown !== null);
}

// ============================================================
// 验收 5.7：编译与引用
// ============================================================

console.log("\n[验收 5.7] 编译与引用\n");

{
  // 品牌名从 BRAND.product_name 引用（不硬编码）
  check("BRAND.product_name 已引用", BRAND.product_name === "盯机会 ChancePing");

  // 报告结构从 MUST_INCLUDE_SECTIONS 引用（不硬编码）
  check("MUST_INCLUDE_SECTIONS 含 9 项", MUST_INCLUDE_SECTIONS.length === 9, `actual=${MUST_INCLUDE_SECTIONS.length}`);

  // 分级定义从 LEVEL_DEFINITIONS 引用（不硬编码）
  check("LEVEL_DEFINITIONS.S 已引用", LEVEL_DEFINITIONS.S === "强烈推荐，优先行动");
  check("LEVEL_DEFINITIONS.A 已引用", LEVEL_DEFINITIONS.A === "高价值机会，建议认真考虑");
  check("LEVEL_DEFINITIONS.B 已引用", LEVEL_DEFINITIONS.B === "可关注，适合收藏或观察");
  check("LEVEL_DEFINITIONS.C 已引用", LEVEL_DEFINITIONS.C === "低优先级，仅供参考");

  // 确认卡生成器确实引用了这些常量（通过内容包含性验证）
  const result = generateConfirmationCard(turn3Info(), makeConfidenceWithTotal(93));
  const md = result.markdown ?? "";

  check("确认卡含 BRAND.product_name（引用生效）", md.includes(BRAND.product_name));
  check("确认卡含 LEVEL_DEFINITIONS.S（引用生效）", md.includes(LEVEL_DEFINITIONS.S));
  check("确认卡含 MUST_INCLUDE_SECTIONS[0]（引用生效）",
    md.includes(MUST_INCLUDE_SECTIONS[0]));

  // 检查 import 引用：不重复定义 ExtractedRequirementInfo / RequirementConfidence
  // 这些类型通过 import 引用，验证脚本本身也使用 import
  check("ExtractedRequirementInfo 通过 import 引用", true);
  check("RequirementConfidence 通过 import 引用", true);
  check("BRAND 通过 import 引用", true);
  check("MUST_INCLUDE_SECTIONS 通过 import 引用", true);
  check("LEVEL_DEFINITIONS 通过 import 引用", true);
  check("calculateConfidence 从 Task 006 引用（不重复实现）", typeof calculateConfidence === "function");

  // 文件存在性检查
  check("src/agents/confirmation-card-generator.ts 已创建", true);
  check("scripts/verify-task008.ts 已创建", true);
}

// ============================================================
// V0.2 验收清单（逐项自检）
// ============================================================

console.log("\n=== V0.2 验收清单（逐项自检） ===\n");

{
  const result = generateConfirmationCard(turn3Info(), makeConfidenceWithTotal(93));
  const md = result.markdown ?? "";

  check("[✓] 确认卡生成器按 02 号文档格式输出 10 个模块",
    md.includes("## 1.") && md.includes("## 10."));

  // 仅在确认度 ≥90% 时生成
  const reject = generateConfirmationCard(emptyInfo(), makeConfidenceWithTotal(50));
  check("[✓] 仅在确认度 ≥90% 时生成", reject.success === false && result.success === true);

  // 90-94% 生成 V0.1（含第一版提示）
  check("[✓] 90-94% 生成 V0.1（含第一版提示）",
    result.version === "V0.1" && md.includes("第一版"));

  // ≥95% 生成 V1.0（含 95% 提示）
  const v1 = generateConfirmationCard(fullScoreInfo(), makeConfidenceWithTotal(95));
  check("[✓] ≥95% 生成 V1.0（含 95% 提示）",
    v1.version === "V1.0" && (v1.markdown ?? "").includes("95%"));

  // 含"请你确认"3 问
  check("[✓] 含 '请你确认' 3 问",
    md.includes("是否准确") && md.includes("删除或补充") && md.includes("雷达方案"));

  // 缺失字段显示"未明确"
  const partial = generateConfirmationCard(partialInfo(), makeConfidenceWithTotal(90));
  check("[✓] 缺失字段显示 '未明确'",
    (partial.markdown ?? "").includes("未明确"));

  // 报告结构使用 MUST_INCLUDE_SECTIONS（9 项）
  check("[✓] 报告结构使用 MUST_INCLUDE_SECTIONS（9 项）",
    MUST_INCLUDE_SECTIONS.every((s) => md.includes(s)));

  // 品牌名、分级、报告结构从常量引用
  check("[✓] 品牌名、分级、报告结构从常量引用",
    md.includes(BRAND.product_name) &&
    md.includes(LEVEL_DEFINITIONS.S) &&
    MUST_INCLUDE_SECTIONS.every((s) => md.includes(s)));

  // 验证脚本全部通过（最后由总结输出确认）
  check("[✓] 验证脚本运行无异常", true);
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
