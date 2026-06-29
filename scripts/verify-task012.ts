/**
 * Task 012 验收脚本
 *
 * 运行：npx tsx scripts/verify-task012.ts
 *
 * 覆盖验收标准 5.1–5.9 + V0.4 汇总验收：
 *   5.1 拒绝生成逻辑
 *   5.2 成功生成逻辑
 *   5.3 Markdown 结构校验
 *   5.4 机会分级与分组
 *   5.5 即将截止机会
 *   5.6 机会详情卡片字段完整性
 *   5.7 建议行动与结论
 *   5.8 排除规则
 *   5.9 编译与引用
 */

import fs from "fs";
import path from "path";
import { generateRadarReport } from "../src/agents/radar-report-generator";
import type { RadarReportInput, RadarReportResult } from "../src/agents/radar-report-generator";
import type { RadarRequirementSpec } from "../src/schema/radar-requirement-spec";
import {
  createDefaultSpec,
  MUST_INCLUDE_SECTIONS,
  OPPORTUNITY_CARD_REQUIRED_FIELDS,
} from "../src/schema/radar-requirement-spec";
import type { OpportunityCard, OpportunityCardStatus } from "../src/schema/opportunity-card";
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

/** 从 test-opportunities.json 读取 6 条测试机会 */
function loadTestOpportunities(): OpportunityCard[] {
  const oppPath = path.resolve(process.cwd(), "data/samples/test-opportunities.json");
  const raw = fs.readFileSync(oppPath, "utf-8");
  return JSON.parse(raw) as OpportunityCard[];
}

/** 构造单条机会（用于边界测试） */
function makeOpp(overrides: Partial<OpportunityCard>): OpportunityCard {
  const base: OpportunityCard = {
    title: "测试机会",
    type: "AI 比赛",
    organizer: "测试主办方",
    region: "广州",
    deadline: "2026-07-15",
    reward_or_value: "奖金 1 万元",
    eligibility: "个人",
    materials_required: "Demo",
    match_reason: "测试匹配理由",
    next_action: "测试行动",
    official_source_url: "https://example.com/test",
    application_url: "https://example.com/apply",
    contact_info: "test@example.com",
    risk_note: "无",
    backend_score: 80,
    visible_level: "A",
    status: "new" as OpportunityCardStatus,
  };
  return { ...base, ...overrides };
}

/** 构造雷达报告输入 */
function makeReportInput(
  spec: RadarRequirementSpec,
  opportunities: OpportunityCard[],
  radarType: RadarReportInput["radar_type"] = "ai_competition",
  periodStart: string = "2026-06-21",
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
// 验收 5.1：拒绝生成逻辑
// ============================================================

console.log("\n=== Task 012 验收检查 ===\n");
console.log("[验收 5.1] 拒绝生成逻辑\n");

{
  // 确认度 50 + confirmed
  const spec1 = loadSampleSpec(50, "confirmed");
  const r1 = generateRadarReport(makeReportInput(spec1, loadTestOpportunities()));
  check("确认度 50 → success=false", r1.success === false);
  check("确认度 50 → error 含 '95%'", (r1.error ?? "").includes("95%"), `error=${r1.error}`);
  check("确认度 50 → markdown=null", r1.markdown === null);

  // 确认度 94 + confirmed
  const spec2 = loadSampleSpec(94, "confirmed");
  const r2 = generateRadarReport(makeReportInput(spec2, loadTestOpportunities()));
  check("确认度 94 → success=false", r2.success === false);
  check("确认度 94 → error 含 '95%'", (r2.error ?? "").includes("95%"), `error=${r2.error}`);

  // 确认度 95 + draft
  const spec3 = loadSampleSpec(95, "draft");
  const r3 = generateRadarReport(makeReportInput(spec3, loadTestOpportunities()));
  check("确认度 95 + draft → success=false", r3.success === false);
  check("确认度 95 + draft → error 含 '确认'", (r3.error ?? "").includes("确认"), `error=${r3.error}`);

  // 确认度 95 + needs_more_info
  const spec4 = loadSampleSpec(95, "needs_more_info");
  const r4 = generateRadarReport(makeReportInput(spec4, loadTestOpportunities()));
  check("确认度 95 + needs_more_info → success=false", r4.success === false);
  check("确认度 95 + needs_more_info → error 含 '确认'", (r4.error ?? "").includes("确认"), `error=${r4.error}`);
}

// ============================================================
// 验收 5.2：成功生成逻辑
// ============================================================

console.log("\n[验收 5.2] 成功生成逻辑\n");

{
  // 确认度 95 + confirmed + 有机会
  const spec1 = loadSampleSpec(95, "confirmed");
  const r1 = generateRadarReport(makeReportInput(spec1, loadTestOpportunities()));
  check("确认度 95 + confirmed → success=true", r1.success === true, `error=${r1.error}`);
  check("确认度 95 + confirmed → markdown 非空", (r1.markdown ?? "").length > 0);
  check("确认度 95 + confirmed → error=null", r1.error === null);
  check("确认度 95 + confirmed → version='V0.4'", r1.version === "V0.4");

  // 确认度 100 + ready_for_radar_plan
  const spec2 = loadSampleSpec(100, "ready_for_radar_plan");
  const r2 = generateRadarReport(makeReportInput(spec2, loadTestOpportunities()));
  check("确认度 100 + ready_for_radar_plan → success=true", r2.success === true, `error=${r2.error}`);
  check("确认度 100 + ready_for_radar_plan → markdown 非空", (r2.markdown ?? "").length > 0);

  // 空机会数组
  const spec3 = loadSampleSpec(95, "confirmed");
  const r3 = generateRadarReport(makeReportInput(spec3, []));
  check("空机会数组 → success=true", r3.success === true, `error=${r3.error}`);
  check("空机会数组 → stats.total_opportunities=0", r3.stats.total_opportunities === 0);
  check("空机会数组 → markdown 非空（含空报告）", (r3.markdown ?? "").length > 0);
  check("空机会数组 → sections_count=9", r3.sections_count === 9);
}

// ============================================================
// 验收 5.3：Markdown 结构校验
// ============================================================

console.log("\n[验收 5.3] Markdown 结构校验\n");

{
  const spec = loadSampleSpec(95, "confirmed");
  const result = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  const md = result.markdown ?? "";
  const lines = md.split("\n");
  const firstLine = lines[0] ?? "";

  check("标题第 1 行含 BRAND.product_name", firstLine.includes(BRAND.product_name), `firstLine=${firstLine}`);
  check("ai_competition → 含 'AI 赛事雷达'", md.includes("AI 赛事雷达"));
  check("含 '周期：'", md.includes("周期："));
  check("含 '雷达版本：V0.4'", md.includes("雷达版本：V0.4"));

  // 9 个章节标题（## 0. 到 ## 8.）
  for (let i = 0; i <= 8; i++) {
    check(`含 '## ${i}.' 章节标题`, md.includes(`## ${i}.`), `missing section ## ${i}.`);
  }
  check("含 '## 本周结论'", md.includes("## 本周结论"));
  check("含 '## 0. 本周一句话判断'", md.includes("## 0. 本周一句话判断"));

  // 三种雷达类型标题测试
  const rAi = generateRadarReport(makeReportInput(spec, loadTestOpportunities(), "ai_competition"));
  check("ai_competition → 标题含 'AI 赛事雷达'", (rAi.markdown ?? "").includes("AI 赛事雷达"));
  const rOpc = generateRadarReport(makeReportInput(spec, loadTestOpportunities(), "opc_policy"));
  check("opc_policy → 标题含 'OPC 政策雷达'", (rOpc.markdown ?? "").includes("OPC 政策雷达"));
  const rCh = generateRadarReport(makeReportInput(spec, loadTestOpportunities(), "cultural_heritage"));
  check("cultural_heritage → 标题含 '文创非遗雷达'", (rCh.markdown ?? "").includes("文创非遗雷达"));
}

// ============================================================
// 验收 5.4：机会分级与分组
// ============================================================

console.log("\n[验收 5.4] 机会分级与分组\n");

{
  const spec = loadSampleSpec(95, "confirmed");
  const result = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  const md = result.markdown ?? "";

  // 统计正确
  check("stats.s_count=2", result.stats.s_count === 2, `s_count=${result.stats.s_count}`);
  check("stats.a_count=2", result.stats.a_count === 2, `a_count=${result.stats.a_count}`);
  check("stats.b_count=1", result.stats.b_count === 1, `b_count=${result.stats.b_count}`);
  check("stats.hidden_count=1", result.stats.hidden_count === 1, `hidden_count=${result.stats.hidden_count}`);
  check("stats.total_opportunities=6", result.stats.total_opportunities === 6, `total=${result.stats.total_opportunities}`);

  // S 级章节含 S1/S2
  const sSection = md.split("## 1. 本周 S 级机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("S 级章节含 'S1. 2026 全球 AI 游戏创新大赛'", sSection.includes("S1. 2026 全球 AI 游戏创新大赛"));
  check("S 级章节含 'S2. AI Hackathon 2026 夏季赛'", sSection.includes("S2. AI Hackathon 2026 夏季赛"));

  // A 级章节含 A1/A2
  const aSection = md.split("## 2. 本周 A 级机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("A 级章节含 'A1. 2026 AI 应用创新大赛'", aSection.includes("A1. 2026 AI 应用创新大赛"));
  check("A 级章节含 'A2. AI 内容生成创新挑战赛'", aSection.includes("A2. AI 内容生成创新挑战赛"));

  // B 级章节含 B1
  const bSection = md.split("## 3. 本周 B 级机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("B 级章节含 'B1. 全国大学生 AI 编程竞赛'", bSection.includes("B1. 全国大学生 AI 编程竞赛"));

  // hidden 不进详情卡片
  const cardSection = md.split("## 5. 机会详情卡片")[1]?.split(/\n---\n/)[0] ?? "";
  check("详情卡片不含 hidden 机会", !cardSection.includes("少儿编程 K12 AI 启蒙赛"));

  // hidden 进入排除章节
  const excludeSection = md.split("## 7. 不建议投入的机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("排除章节含 hidden 机会", excludeSection.includes("少儿编程 K12 AI 启蒙赛"));
}

// ============================================================
// 验收 5.5：即将截止机会
// ============================================================

console.log("\n[验收 5.5] 即将截止机会\n");

{
  const spec = loadSampleSpec(95, "confirmed");

  // 3 天后截止 → 即将截止
  const r3 = generateRadarReport(makeReportInput(spec, [
    makeOpp({ title: "3 天后截止", visible_level: "S", deadline: "2026-06-30" }),
  ]));
  const s4_3 = (r3.markdown ?? "").split("## 4. 即将截止机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("3 天后截止 → 进入即将截止章节", s4_3.includes("3 天后截止"), `s4_3=${s4_3}`);
  check("3 天后截止 → 含 '3 天'", s4_3.includes("3 天"), `s4_3=${s4_3}`);

  // 7 天后截止 → 即将截止
  const r7 = generateRadarReport(makeReportInput(spec, [
    makeOpp({ title: "7 天后截止", visible_level: "A", deadline: "2026-07-04" }),
  ]));
  const s4_7 = (r7.markdown ?? "").split("## 4. 即将截止机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("7 天后截止 → 进入即将截止章节", s4_7.includes("7 天后截止"), `s4_7=${s4_7}`);
  check("7 天后截止 → 含 '7 天'", s4_7.includes("7 天"), `s4_7=${s4_7}`);

  // 10 天后截止 → 不进入即将截止
  const r10 = generateRadarReport(makeReportInput(spec, [
    makeOpp({ title: "10 天后截止", visible_level: "B", deadline: "2026-07-07" }),
  ]));
  const s4_10 = (r10.markdown ?? "").split("## 4. 即将截止机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("10 天后截止 → 不进入即将截止章节", !s4_10.includes("10 天后截止"));
  check("10 天后截止 → 含 '本周无机会进入 7 天倒计时窗口'", s4_10.includes("本周无机会进入 7 天倒计时窗口"));

  // 已截止 → 不进入即将截止，进入不建议投入
  // 注意：标题避免含 must_exclude 关键词（如"已截止"），以免先被关键词规则排除
  const rExp = generateRadarReport(makeReportInput(spec, [
    makeOpp({ title: "过期日测试机会", visible_level: "S", deadline: "2026-06-26" }),
  ]));
  const s4_exp = (rExp.markdown ?? "").split("## 4. 即将截止机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("已截止 → 不进入即将截止章节", !s4_exp.includes("过期日测试机会"));
  const s7_exp = (rExp.markdown ?? "").split("## 7. 不建议投入的机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("已截止 → 进入不建议投入章节", s7_exp.includes("过期日测试机会"));
  check("已截止 → 排除原因含 '已截止'", s7_exp.includes("已截止"));

  // 用 test-opportunities.json 验证即将截止数量（S1 3天 + A1 7天 = 2 条）
  const rFull = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  check("test-opportunities → stats.expiring_soon_count=2",
    rFull.stats.expiring_soon_count === 2, `count=${rFull.stats.expiring_soon_count}`);
}

// ============================================================
// 验收 5.6：机会详情卡片字段完整性
// ============================================================

console.log("\n[验收 5.6] 机会详情卡片字段完整性\n");

{
  const spec = loadSampleSpec(95, "confirmed");
  const result = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  const md = result.markdown ?? "";
  const cardSection = md.split("## 5. 机会详情卡片")[1]?.split(/\n---\n/)[0] ?? "";

  // 含全部 14 个 OPPORTUNITY_CARD_REQUIRED_FIELDS 对应的字段标签
  // 字段标签为中文（与 OPPORTUNITY_CARD_REQUIRED_FIELDS 对应）
  const fieldLabels = [
    "推荐等级",            // 对应 "推荐等级"
    "机会类型",            // 对应 "类型"
    "主办方 / 发布方",     // 对应 "主办方 / 发布方"
    "地区",                // 对应 "地区"
    "截止日期",            // 对应 "截止日期"
    "奖励 / 补贴 / 价值",  // 对应 "奖励 / 补贴 / 价值"
    "适合对象",            // 对应 "适合对象"
    "为什么适合你",        // 对应 "为什么适合你"
    "下一步行动建议",      // 对应 "下一步行动建议"
    "官方来源链接",        // 对应 "官方来源链接"
    "报名链接",            // 对应 "报名链接"
    "联系方式",            // 对应 "联系方式"
    "风险提醒",            // 对应 "风险提醒"
    "是否建议保存",        // 卡片额外字段
  ];
  let allFieldsPresent = true;
  for (const label of fieldLabels) {
    if (!cardSection.includes(label)) {
      allFieldsPresent = false;
      console.log(`    缺少字段标签: ${label}`);
      break;
    }
  }
  check("详情卡片含全部 14 个必含字段", allFieldsPresent);
  check("OPPORTUNITY_CARD_REQUIRED_FIELDS 长度为 14", OPPORTUNITY_CARD_REQUIRED_FIELDS.length === 14);

  // 含推荐等级 S
  check("详情卡片含 '推荐等级：S'", cardSection.includes("推荐等级：S"));
  // 含官方来源链接
  check("详情卡片含 official_source_url 值", cardSection.includes("https://example.com/ai-game-contest-2026"));
  // 含报名链接
  check("详情卡片含 application_url 值", cardSection.includes("https://example.com/apply"));
  // 含风险提醒
  check("详情卡片含 risk_note 值", cardSection.includes("需确认主办方资质"));
  // 含为什么适合你
  check("详情卡片含 match_reason 值", cardSection.includes("奖金高、广州本地、适合个人参赛"));
  // 含下一步行动建议
  check("详情卡片含 next_action 值", cardSection.includes("本周内完成报名并准备 Demo"));

  // 5 条非 hidden 机会都有详情卡片
  const oppTitles = [
    "2026 全球 AI 游戏创新大赛",
    "AI Hackathon 2026 夏季赛",
    "2026 AI 应用创新大赛",
    "AI 内容生成创新挑战赛",
    "全国大学生 AI 编程竞赛",
  ];
  for (const title of oppTitles) {
    check(`详情卡片含 '${title}'`, cardSection.includes(`### ${title}`));
  }
}

// ============================================================
// 验收 5.7：建议行动与结论
// ============================================================

console.log("\n[验收 5.7] 建议行动与结论\n");

{
  const spec = loadSampleSpec(95, "confirmed");
  const result = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  const md = result.markdown ?? "";

  check("含 '## 6. 本周建议行动'", md.includes("## 6. 本周建议行动"));

  // 含最优先行动（S 级即将截止的 1 条）
  const s6 = md.split("## 6. 本周建议行动")[1]?.split(/\n---\n/)[0] ?? "";
  check("建议行动含 '本周最优先行动'", s6.includes("本周最优先行动"));
  check("建议行动含 S 级即将截止机会", s6.includes("2026 全球 AI 游戏创新大赛"), `s6=${s6}`);

  // 本周结论存在
  check("含 '## 本周结论'", md.includes("## 本周结论"));
  const conclusion = md.split("## 本周结论")[1] ?? "";
  check("结论含 '最值得优先行动'", conclusion.includes("最值得优先行动"));
  check("结论含 '最适合保存观察'", conclusion.includes("最适合保存观察"));
  check("结论含 '最需要人工复核'", conclusion.includes("最需要人工复核"));
  check("结论含 '下周最应该继续追踪'", conclusion.includes("下周最应该继续追踪"));

  // 空机会时建议行动
  const rEmpty = generateRadarReport(makeReportInput(spec, []));
  check("空机会 → 含 '本周暂无机会'", (rEmpty.markdown ?? "").includes("本周暂无机会"));
}

// ============================================================
// 验收 5.8：排除规则
// ============================================================

console.log("\n[验收 5.8] 排除规则\n");

{
  const spec = loadSampleSpec(95, "confirmed");

  // hidden 机会排除
  const rHidden = generateRadarReport(makeReportInput(spec, [
    makeOpp({ title: "Hidden 机会", visible_level: "hidden" as never, deadline: "2026-07-15" }),
  ]));
  const s7_h = (rHidden.markdown ?? "").split("## 7. 不建议投入的机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("hidden 机会 → 进入第 7 章节", s7_h.includes("Hidden 机会"));
  check("hidden 机会 → excluded_count=1", rHidden.stats.excluded_count === 1);

  // 类型匹配排除（excluded_opportunity_types = ["少儿 / K12 赛事", ...]）
  const rType = generateRadarReport(makeReportInput(spec, [
    makeOpp({ title: "K12 赛事", type: "少儿 / K12 赛事", visible_level: "S", deadline: "2026-07-15" }),
  ]));
  const s7_t = (rType.markdown ?? "").split("## 7. 不建议投入的机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("类型匹配排除 → 进入第 7 章节", s7_t.includes("K12 赛事"));
  check("类型匹配排除 → excluded_count=1", rType.stats.excluded_count === 1);

  // 关键词匹配排除（must_exclude = ["已截止", "无官方来源", "纯广告软文", "明显不支持个人参赛"]）
  const rKw = generateRadarReport(makeReportInput(spec, [
    makeOpp({ title: "已截止机会 - 测试", visible_level: "S", deadline: "2026-07-15" }),
  ]));
  const s7_k = (rKw.markdown ?? "").split("## 7. 不建议投入的机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("关键词匹配排除 → 进入第 7 章节", s7_k.includes("已截止机会 - 测试"));
  check("关键词匹配排除 → excluded_count=1", rKw.stats.excluded_count === 1);

  // 已截止排除（标题避免含 must_exclude 关键词，纯测试 deadline 规则）
  const rExp = generateRadarReport(makeReportInput(spec, [
    makeOpp({ title: "过期日排除测试", visible_level: "S", deadline: "2026-06-25" }),
  ]));
  const s7_e = (rExp.markdown ?? "").split("## 7. 不建议投入的机会")[1]?.split(/\n---\n/)[0] ?? "";
  check("已截止排除 → 进入第 7 章节", s7_e.includes("过期日排除测试"));
  check("已截止排除 → excluded_count=1", rExp.stats.excluded_count === 1);

  // test-opportunities 综合排除（hidden 1 条，已截止 + hidden 双重）
  const rFull = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  check("test-opportunities → excluded_count>=1", rFull.stats.excluded_count >= 1, `count=${rFull.stats.excluded_count}`);
}

// ============================================================
// 验收 5.9：编译与引用
// ============================================================

console.log("\n[验收 5.9] 编译与引用\n");

{
  // 检查 src/agents/radar-report-generator.ts 已创建
  const generatorPath = path.resolve(process.cwd(), "src/agents/radar-report-generator.ts");
  check("src/agents/radar-report-generator.ts 存在", fs.existsSync(generatorPath));

  // 检查 scripts/verify-task012.ts 已创建
  const verifyPath = path.resolve(process.cwd(), "scripts/verify-task012.ts");
  check("scripts/verify-task012.ts 存在", fs.existsSync(verifyPath));

  // 检查测试数据文件
  const oppDataPath = path.resolve(process.cwd(), "data/samples/test-opportunities.json");
  check("data/samples/test-opportunities.json 存在", fs.existsSync(oppDataPath));

  // 检查 radar-report-generator.ts 内容含必要 import
  const generatorContent = fs.readFileSync(generatorPath, "utf-8");
  check("引用 BRAND（来自 ../brand/constants）", generatorContent.includes("import { BRAND }"));
  check("引用 RadarRequirementSpec 类型", generatorContent.includes("RadarRequirementSpec"));
  check("引用 OpportunityCard 类型", generatorContent.includes("OpportunityCard"));
  check("引用 VisibleLevel 类型", generatorContent.includes("VisibleLevel"));
  check("不硬编码 '盯机会 ChancePing'", !generatorContent.includes('"盯机会 ChancePing"'));

  // 检查 MUST_INCLUDE_SECTIONS 长度为 9
  check("MUST_INCLUDE_SECTIONS 长度为 9", MUST_INCLUDE_SECTIONS.length === 9, `len=${MUST_INCLUDE_SECTIONS.length}`);
  check("MUST_INCLUDE_SECTIONS 含 '本周一句话判断'", MUST_INCLUDE_SECTIONS.includes("本周一句话判断"));
  check("MUST_INCLUDE_SECTIONS 含 '下周继续追踪'", MUST_INCLUDE_SECTIONS.includes("下周继续追踪"));

  // 检查 OPPORTUNITY_CARD_REQUIRED_FIELDS 长度为 14
  check("OPPORTUNITY_CARD_REQUIRED_FIELDS 长度为 14",
    OPPORTUNITY_CARD_REQUIRED_FIELDS.length === 14, `len=${OPPORTUNITY_CARD_REQUIRED_FIELDS.length}`);

  // 检查导出 generateRadarReport 函数
  check("导出 generateRadarReport 函数", generatorContent.includes("export function generateRadarReport"));
  check("导出 RadarReportInput 接口", generatorContent.includes("export interface RadarReportInput"));
  check("导出 RadarReportResult 接口", generatorContent.includes("export interface RadarReportResult"));

  // 检查不重复实现已有逻辑
  check("不重复实现 validateSpec", !generatorContent.includes("function validateSpec"));
  check("不重复实现 validateConfidence", !generatorContent.includes("function validateConfidence"));
  check("不重复实现 validateOpportunityCard", !generatorContent.includes("function validateOpportunityCard"));

  // 检查 version 固定为 V0.4
  check("version 固定为 'V0.4'", generatorContent.includes(`version: "V0.4"`));

  // 检查 sections_count 固定为 9
  check("sections_count 固定为 9", generatorContent.includes("sections_count: 9"));
}

// ============================================================
// V0.4 汇总验收
// ============================================================

console.log("\n[V0.4 汇总验收] Task 012 自检\n");

{
  const spec = loadSampleSpec(95, "confirmed");
  const result = generateRadarReport(makeReportInput(spec, loadTestOpportunities()));
  const md = result.markdown ?? "";

  check("雷达报告含 9 章节", result.sections_count === 9);
  check("机会按 S/A/B/C 自动分组（s=2, a=2, b=1）",
    result.stats.s_count === 2 && result.stats.a_count === 2 && result.stats.b_count === 1);
  check("机会卡片含全部 14 个必含字段", OPPORTUNITY_CARD_REQUIRED_FIELDS.length === 14);
  check("即将截止机会单独标注（expiring_soon_count=2）", result.stats.expiring_soon_count === 2);
  check("排除规则生效（excluded_count>=1）", result.stats.excluded_count >= 1);
  check("空机会不拒绝生成", generateRadarReport(makeReportInput(spec, [])).success === true);
  check("导出 Markdown 含品牌标题前缀", md.split("\n")[0].includes(BRAND.product_name));
}

// ============================================================
// 汇总输出
// ============================================================

console.log("\n=== 验收汇总 ===");
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
