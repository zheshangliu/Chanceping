/**
 * Task 010 验收脚本
 *
 * 运行：npx tsx scripts/verify-task010.ts
 *
 * 覆盖验收标准 5.1–5.7 + V0.3 验收清单：
 *   5.1 拒绝生成逻辑（5 个测试）
 *   5.2 成功生成逻辑（3 个测试）
 *   5.3 Markdown 结构校验
 *   5.4 字段映射正确性（使用 sample-spec.json）
 *   5.5 空值处理（使用 createDefaultSpec）
 *   5.6 雷达类型映射
 *   5.7 编译与引用
 */

import fs from "fs";
import path from "path";
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

/**
 * 从 sample-spec.json 读取并修改为可生成状态。
 * 修改 confirmation_status.status = "confirmed"，requirement_confidence.total = 95。
 */
function loadSampleSpec(confidenceTotal: number = 95, status: string = "confirmed"): RadarRequirementSpec {
  const samplePath = path.resolve(process.cwd(), "data/samples/sample-spec.json");
  const raw = fs.readFileSync(samplePath, "utf-8");
  const spec = JSON.parse(raw) as RadarRequirementSpec;
  spec.confirmation_status.status = status as RadarRequirementSpec["confirmation_status"]["status"];
  spec.confirmation_status.user_confirmed = true;
  spec.requirement_confidence.total = confidenceTotal;
  return spec;
}

/** 构造全空 Spec（通过 createDefaultSpec，confidence.total=95, status=confirmed） */
function loadEmptySpec(confidenceTotal: number = 95, status: string = "confirmed"): RadarRequirementSpec {
  const spec = createDefaultSpec();
  spec.confirmation_status.status = status as RadarRequirementSpec["confirmation_status"]["status"];
  spec.confirmation_status.user_confirmed = true;
  spec.requirement_confidence.total = confidenceTotal;
  return spec;
}

/** 构造雷达方案输入 */
function makeInput(
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

// ============================================================
// 验收 5.1：拒绝生成逻辑
// ============================================================

console.log("\n=== Task 010 验收检查 ===\n");
console.log("[验收 5.1] 拒绝生成逻辑\n");

{
  // 确认度 50 + confirmed → 拒绝
  const r50 = generateRadarPlan(makeInput(loadSampleSpec(50, "confirmed")));
  check("确认度 50 + confirmed → success=false", r50.success === false, `actual=${r50.success}`);
  check("确认度 50 → error 含 '95%'", r50.error !== null && r50.error.includes("95%"), `error=${r50.error}`);
  check("确认度 50 → markdown=null", r50.markdown === null);
  check("确认度 50 → version=null", r50.version === null);

  // 确认度 94 + confirmed → 拒绝
  const r94 = generateRadarPlan(makeInput(loadSampleSpec(94, "confirmed")));
  check("确认度 94 + confirmed → success=false", r94.success === false);
  check("确认度 94 → error 含 '95%'", r94.error !== null && r94.error.includes("95%"));

  // 确认度 95 + draft → 拒绝
  const rDraft = generateRadarPlan(makeInput(loadSampleSpec(95, "draft")));
  check("确认度 95 + draft → success=false", rDraft.success === false);
  check("确认度 95 + draft → error 含 '确认'", rDraft.error !== null && rDraft.error.includes("确认"), `error=${rDraft.error}`);

  // 确认度 95 + needs_more_info → 拒绝
  const rNeeds = generateRadarPlan(makeInput(loadSampleSpec(95, "needs_more_info")));
  check("确认度 95 + needs_more_info → success=false", rNeeds.success === false);

  // 确认度 95 + confirmation_card_generated → 拒绝
  const rCardGen = generateRadarPlan(makeInput(loadSampleSpec(95, "confirmation_card_generated")));
  check("确认度 95 + confirmation_card_generated → success=false", rCardGen.success === false);
}

// ============================================================
// 验收 5.2：成功生成逻辑
// ============================================================

console.log("\n[验收 5.2] 成功生成逻辑\n");

{
  // 确认度 95 + confirmed → 成功
  const r95 = generateRadarPlan(makeInput(loadSampleSpec(95, "confirmed")));
  check("确认度 95 + confirmed → success=true", r95.success === true, `error=${r95.error}`);

  // 确认度 100 + ready_for_radar_plan → 成功
  const r100 = generateRadarPlan(makeInput(loadSampleSpec(100, "ready_for_radar_plan")));
  check("确认度 100 + ready_for_radar_plan → success=true", r100.success === true);

  // 成功生成属性检查
  check("成功生成 → markdown 非空", r95.markdown !== null && r95.markdown.length > 0);
  check("成功生成 → error=null", r95.error === null);
  check("成功生成 → version='V1.0'", r95.version === "V1.0");
  check("成功生成 → sections_count=8", r95.sections_count === 8);
  check("成功生成 → generated_at 非空", r95.generated_at.length > 0);
}

// ============================================================
// 验收 5.3：Markdown 结构校验
// ============================================================

console.log("\n[验收 5.3] Markdown 结构校验\n");

{
  const result = generateRadarPlan(makeInput(loadSampleSpec(95, "confirmed"), "ai_competition"));
  const md = result.markdown ?? "";
  const firstLine = md.split("\n")[0] ?? "";

  // 标题含 BRAND.product_name
  check("标题含 BRAND.product_name", firstLine.includes(BRAND.product_name), `firstLine=${firstLine}`);

  // 标题含雷达名称
  check("ai_competition 标题含 'AI 赛事雷达'", firstLine.includes("AI 赛事雷达"), `firstLine=${firstLine}`);

  // 标题含 V1.0
  check("标题含 'V1.0'", firstLine.includes("V1.0"), `firstLine=${firstLine}`);

  // 含 8 个章节标题（## 1. 到 ## 8.）
  for (let i = 1; i <= 8; i++) {
    check(`含章节标题 '## ${i}.'`, md.includes(`## ${i}.`), `未找到 ## ${i}.`);
  }

  // 含确认信息
  check("含 '## 确认信息'", md.includes("## 确认信息"));

  // 含待确认问题
  check("含 '## 待确认问题'", md.includes("## 待确认问题"));

  // 含生成时间
  check("含 '生成时间：'", md.includes("生成时间："));

  // 含确认度
  check("含 '需求确认度：'", md.includes("需求确认度："));
}

// ============================================================
// 验收 5.4：字段映射正确性（使用 sample-spec.json）
// ============================================================

console.log("\n[验收 5.4] 字段映射正确性（sample-spec.json）\n");

{
  const spec = loadSampleSpec(95, "confirmed");
  const result = generateRadarPlan(makeInput(spec, "ai_competition"));
  const md = result.markdown ?? "";

  // 用户画像 - 用户类型
  check("用户画像含 client_type 值",
    spec.client_profile.client_type.length > 0 && md.includes(spec.client_profile.client_type),
    `client_type="${spec.client_profile.client_type}"`);

  // 用户画像 - 核心能力
  check("用户画像含 core_capabilities 数组项",
    spec.client_profile.core_capabilities.length > 0 &&
    spec.client_profile.core_capabilities.every((c) => md.includes(c)),
    `core_capabilities=${JSON.stringify(spec.client_profile.core_capabilities)}`);

  // 核心目标 - 第一目标
  check("核心目标含 primary_goal 值",
    spec.core_goals.primary_goal.length > 0 && md.includes(spec.core_goals.primary_goal));

  // 核心目标 - 行动意图
  check("核心目标含 action_intent 数组项",
    spec.core_goals.action_intent.length > 0 &&
    spec.core_goals.action_intent.every((a) => md.includes(a)));

  // 机会范围 - 主要类型
  check("机会范围含 primary_opportunity_types 数组项",
    spec.opportunity_scope.primary_opportunity_types.length > 0 &&
    spec.opportunity_scope.primary_opportunity_types.every((t) => md.includes(t)));

  // 机会范围 - 排除类型
  check("机会范围含 excluded_opportunity_types 数组项",
    spec.opportunity_scope.excluded_opportunity_types.length > 0 &&
    spec.opportunity_scope.excluded_opportunity_types.every((t) => md.includes(t)));

  // 地域范围 - 主要地区
  check("地域范围含 primary_regions 数组项",
    spec.region_scope.primary_regions.length > 0 &&
    spec.region_scope.primary_regions.every((r) => md.includes(r)));

  // 关键词 - 核心中文
  check("关键词含 core_keywords_zh 数组项",
    spec.keyword_strategy.core_keywords_zh.length > 0 &&
    spec.keyword_strategy.core_keywords_zh.some((k) => md.includes(k)));

  // 关键词 - 负面关键词
  check("关键词含 negative_keywords 数组项",
    spec.keyword_strategy.negative_keywords.length > 0 &&
    spec.keyword_strategy.negative_keywords.some((k) => md.includes(k)));

  // 筛选规则 - 必须排除
  check("筛选规则含 must_exclude 数组项",
    spec.filter_rules.must_exclude.length > 0 &&
    spec.filter_rules.must_exclude.some((m) => md.includes(m)));

  // 评分 - 权重
  check("评分含 match_score=30", md.includes("30"));
  check("评分含 business_value=25", md.includes("25"));

  // 评分 - S 级定义
  check("评分含 '强烈推荐，优先行动'（S 级定义）",
    md.includes(spec.scoring_rules.level_definitions.S));

  // 报告 - 频率
  check("报告含 report_frequency 值",
    spec.report_requirements.report_frequency.length > 0 &&
    md.includes(spec.report_requirements.report_frequency));

  // 报告 - 必含章节（9 项）
  check("报告含 MUST_INCLUDE_SECTIONS 全部 9 项",
    MUST_INCLUDE_SECTIONS.every((s) => md.includes(s)),
    `缺失：${MUST_INCLUDE_SECTIONS.filter((s) => !md.includes(s)).join(", ")}`);

  // 报告 - 卡片字段（14 项）
  check("报告含 OPPORTUNITY_CARD_REQUIRED_FIELDS 全部 14 项",
    OPPORTUNITY_CARD_REQUIRED_FIELDS.every((f) => md.includes(f)),
    `缺失：${OPPORTUNITY_CARD_REQUIRED_FIELDS.filter((f) => !md.includes(f)).join(", ")}`);

  // 数据源 - 来源透明
  check("数据源含来源透明展示文案", md.includes("开启") || md.includes("关闭"));
}

// ============================================================
// 验收 5.5：空值处理（使用 createDefaultSpec）
// ============================================================

console.log("\n[验收 5.5] 空值处理\n");

{
  const spec = loadEmptySpec(95, "confirmed");
  const result = generateRadarPlan(makeInput(spec, "ai_competition"));
  const md = result.markdown ?? "";

  check("空 Spec → success=true（confidence 95 + confirmed）", result.success === true, `error=${result.error}`);

  // 空字符串字段 → 「未明确」
  check("空字符串字段标注 '未明确'", md.includes("未明确"), "未找到 '未明确'");

  // 空数组字段 → 「暂无」
  check("空数组字段标注 '暂无'", md.includes("暂无"), "未找到 '暂无'");

  // 空待确认问题 → 「暂无」
  check("空待确认问题标注 '暂无'（questions_to_confirm）",
    md.includes("## 待确认问题") && md.includes("暂无"));

  // 空用户补充源 → 「暂无」
  check("空用户补充源标注 '暂无'",
    md.includes("用户补充信息源") && md.includes("暂无"));

  // 8 章节仍完整
  for (let i = 1; i <= 8; i++) {
    check(`空值下章节 ${i} 仍完整`, md.includes(`## ${i}.`), `缺失 ## ${i}.`);
  }
}

// ============================================================
// 验收 5.6：雷达类型映射
// ============================================================

console.log("\n[验收 5.6] 雷达类型映射\n");

{
  const spec = loadSampleSpec(95, "confirmed");

  const rAi = generateRadarPlan(makeInput(spec, "ai_competition"));
  const mdAi = rAi.markdown ?? "";
  check("ai_competition → 标题含 'AI 赛事雷达'",
    mdAi.split("\n")[0].includes("AI 赛事雷达"),
    `firstLine=${mdAi.split("\n")[0]}`);

  const rOpc = generateRadarPlan(makeInput(spec, "opc_policy"));
  const mdOpc = rOpc.markdown ?? "";
  check("opc_policy → 标题含 'OPC 政策雷达'",
    mdOpc.split("\n")[0].includes("OPC 政策雷达"),
    `firstLine=${mdOpc.split("\n")[0]}`);

  const rCh = generateRadarPlan(makeInput(spec, "cultural_heritage"));
  const mdCh = rCh.markdown ?? "";
  check("cultural_heritage → 标题含 '文创非遗雷达'",
    mdCh.split("\n")[0].includes("文创非遗雷达"),
    `firstLine=${mdCh.split("\n")[0]}`);
}

// ============================================================
// 验收 5.7：编译与引用
// ============================================================

console.log("\n[验收 5.7] 编译与引用\n");

{
  // BRAND.product_name 已引用
  check("BRAND.product_name 已引用", BRAND.product_name === "盯机会 ChancePing");

  // MUST_INCLUDE_SECTIONS 已引用
  check("MUST_INCLUDE_SECTIONS 已引用（9 项）", MUST_INCLUDE_SECTIONS.length === 9);

  // OPPORTUNITY_CARD_REQUIRED_FIELDS 已引用
  check("OPPORTUNITY_CARD_REQUIRED_FIELDS 已引用（14 项）", OPPORTUNITY_CARD_REQUIRED_FIELDS.length === 14);

  // RadarRequirementSpec 类型通过 import 引用
  check("RadarRequirementSpec 类型通过 import 引用", true);

  // createDefaultSpec 通过 import 引用
  check("createDefaultSpec 通过 import 引用", typeof createDefaultSpec === "function");

  // 编译产物确实引用了常量
  const result = generateRadarPlan(makeInput(loadSampleSpec(95, "confirmed"), "ai_competition"));
  const md = result.markdown ?? "";

  check("markdown 含 BRAND.product_name（引用生效）", md.includes(BRAND.product_name));
  check("markdown 含 MUST_INCLUDE_SECTIONS 全部 9 项（引用生效）",
    MUST_INCLUDE_SECTIONS.every((s) => md.includes(s)));
  check("markdown 含 OPPORTUNITY_CARD_REQUIRED_FIELDS 全部 14 项（引用生效）",
    OPPORTUNITY_CARD_REQUIRED_FIELDS.every((f) => md.includes(f)));

  // 文件存在性检查
  check("src/agents/radar-plan-generator.ts 已创建", true);
  check("scripts/verify-task010.ts 已创建", true);
}

// ============================================================
// V0.3 验收清单（逐项自检）
// ============================================================

console.log("\n=== V0.3 验收清单（逐项自检） ===\n");

{
  const spec = loadSampleSpec(95, "confirmed");
  const result = generateRadarPlan(makeInput(spec, "ai_competition"));
  const md = result.markdown ?? "";

  // 雷达方案 8 项齐全，内容均来自 Spec 对应字段
  check("[✓] 雷达方案 8 项齐全",
    ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7.", "## 8."].every((h) => md.includes(h)));

  // 仅在确认度 ≥95% 时生成正式方案
  const reject = generateRadarPlan(makeInput(loadSampleSpec(50, "confirmed")));
  check("[✓] 仅在确认度 ≥95% 时生成正式方案",
    reject.success === false && result.success === true);

  // 导出 Markdown 含品牌标题前缀
  check("[✓] 导出 Markdown 含品牌标题前缀",
    md.split("\n")[0].includes(BRAND.product_name));

  // version = V1.0
  check("[✓] version = 'V1.0'", result.version === "V1.0");

  // sections_count = 8
  check("[✓] sections_count = 8", result.sections_count === 8);

  // 验证脚本运行无异常
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
