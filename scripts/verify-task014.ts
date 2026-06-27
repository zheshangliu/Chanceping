/**
 * Task 014 验收脚本
 *
 * 运行：npx tsx scripts/verify-task014.ts
 *
 * 覆盖验收标准 5.1–5.9 + V0.5 汇总自检：
 *   5.1 类型与常量扩展
 *   5.2 状态机
 *   5.3 工厂函数
 *   5.4 状态更新
 *   5.5 完整性校验
 *   5.6 卡片渲染 - compact
 *   5.7 卡片渲染 - standard
 *   5.8 卡片渲染 - detail
 *   5.9 编译与引用
 */

import fs from "fs";
import path from "path";
import {
  CARD_STATUS_TRANSITIONS,
  CARD_STATUS_LABELS,
  CARD_PRIORITY_LABELS,
  CARD_SOURCE_LABELS,
  CARD_CRITICAL_FIELDS,
  CARD_OPTIONAL_FIELDS,
  isStatusTransitionValid,
} from "../src/schema/opportunity-card";
import type {
  OpportunityCard,
  OpportunityCardStatus,
  CardPriority,
  CardSource,
} from "../src/schema/opportunity-card";
import {
  renderCardCompact,
  renderCardStandard,
  renderCardDetail,
} from "../src/agents/card-template";
import {
  createOpportunityCard,
  createOpportunityCards,
  updateCardStatus,
  validateCardCompleteness,
} from "../src/agents/card-factory";
import type { CreateCardInput } from "../src/agents/card-factory";
import { scoreToLevel, LEVEL_DEFINITIONS } from "../src/schema/scoring-rules";
import { OPPORTUNITY_CARD_REQUIRED_FIELDS } from "../src/schema/radar-requirement-spec";

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

/** 构造完整卡片（所有字段有值） */
function makeFullCard(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    title: "2026 全球 AI 游戏创新大赛",
    type: "AI 游戏比赛",
    organizer: "广州市科技局",
    region: "广州",
    deadline: "2026-06-30",
    reward_or_value: "奖金 10 万元",
    eligibility: "个人 / 团队",
    materials_required: "Demo + 商业计划书",
    match_reason: "奖金高、广州本地、适合个人参赛",
    next_action: "本周内完成报名并准备 Demo",
    official_source_url: "https://example.com/ai-game-contest-2026",
    application_url: "https://example.com/apply",
    contact_info: "contact@example.com",
    risk_note: "需确认主办方资质",
    backend_score: 95,
    visible_level: "S",
    status: "new",
    ...overrides,
  };
}

/** 构造最小创建输入（仅必填字段） */
function makeMinimalInput(overrides: Partial<CreateCardInput> = {}): CreateCardInput {
  return {
    title: "测试机会",
    type: "AI 比赛",
    organizer: "测试主办方",
    official_source_url: "https://example.com/test",
    ...overrides,
  };
}

// ============================================================
// 验收 5.1：类型与常量扩展
// ============================================================

console.log("\n=== Task 014 验收检查 ===\n");
console.log("[验收 5.1] 类型与常量扩展\n");

{
  check("CARD_STATUS_TRANSITIONS 存在", typeof CARD_STATUS_TRANSITIONS === "object" && CARD_STATUS_TRANSITIONS !== null);
  check("CARD_STATUS_LABELS 存在", typeof CARD_STATUS_LABELS === "object" && CARD_STATUS_LABELS !== null);
  check("CARD_STATUS_LABELS 含 6 个状态", Object.keys(CARD_STATUS_LABELS).length === 6);
  check("CARD_PRIORITY_LABELS 存在", typeof CARD_PRIORITY_LABELS === "object" && CARD_PRIORITY_LABELS !== null);
  check("CARD_SOURCE_LABELS 存在", typeof CARD_SOURCE_LABELS === "object" && CARD_SOURCE_LABELS !== null);

  check("CARD_CRITICAL_FIELDS 含 6 项", CARD_CRITICAL_FIELDS.length === 6, `len=${CARD_CRITICAL_FIELDS.length}`);
  check("CARD_CRITICAL_FIELDS 含 'title'", CARD_CRITICAL_FIELDS.includes("title"));
  check("CARD_CRITICAL_FIELDS 含 'type'", CARD_CRITICAL_FIELDS.includes("type"));
  check("CARD_CRITICAL_FIELDS 含 'organizer'", CARD_CRITICAL_FIELDS.includes("organizer"));
  check("CARD_CRITICAL_FIELDS 含 'official_source_url'", CARD_CRITICAL_FIELDS.includes("official_source_url"));
  check("CARD_CRITICAL_FIELDS 含 'deadline'", CARD_CRITICAL_FIELDS.includes("deadline"));
  check("CARD_CRITICAL_FIELDS 含 'visible_level'", CARD_CRITICAL_FIELDS.includes("visible_level"));

  check("CARD_OPTIONAL_FIELDS 含 10 项", CARD_OPTIONAL_FIELDS.length === 10, `len=${CARD_OPTIONAL_FIELDS.length}`);

  check("isStatusTransitionValid 函数存在", typeof isStatusTransitionValid === "function");

  // OpportunityCard 现有 17 个字段不变（任务书 3.1 节实际列出 17 个字段）
  const sampleCard = makeFullCard();
  const fieldCount = Object.keys(sampleCard).length;
  check("OpportunityCard 含 17 个字段", fieldCount === 17, `count=${fieldCount}`);
}

// ============================================================
// 验收 5.2：状态机
// ============================================================

console.log("\n[验收 5.2] 状态机\n");

{
  check("new → viewed 合法", isStatusTransitionValid("new", "viewed") === true);
  check("new → saved 合法", isStatusTransitionValid("new", "saved") === true);
  check("new → applied 非法", isStatusTransitionValid("new", "applied") === false);
  check("viewed → applied 合法", isStatusTransitionValid("viewed", "applied") === true);
  check("saved → applied 合法", isStatusTransitionValid("saved", "applied") === true);
  check("applied → archived 合法", isStatusTransitionValid("applied", "archived") === true);
  check("archived → new 终态不可转出", isStatusTransitionValid("archived", "new") === false);
  check("dismissed → new 终态不可转出", isStatusTransitionValid("dismissed", "new") === false);
  check("archived → dismissed 终态不可转出", isStatusTransitionValid("archived", "dismissed") === false);
  check("new → new 自转非法", isStatusTransitionValid("new", "new") === false);
}

// ============================================================
// 验收 5.3：工厂函数
// ============================================================

console.log("\n[验收 5.3] 工厂函数\n");

{
  // 最小必填字段创建
  const card1 = createOpportunityCard(makeMinimalInput());
  check("最小必填字段创建 → 返回 OpportunityCard", typeof card1 === "object" && card1 !== null);
  check("最小必填字段创建 → title 正确", card1.title === "测试机会");

  // 可选字段默认值
  check("不传 deadline → deadline='未明确'", card1.deadline === "未明确");
  check("不传 contact_info → contact_info='未找到公开信息'", card1.contact_info === "未找到公开信息");
  check("不传 risk_note → risk_note='暂无'", card1.risk_note === "暂无");
  check("不传 application_url → application_url=''", card1.application_url === "");
  check("不传 region → region='未明确'", card1.region === "未明确");
  check("不传 match_reason → match_reason='未明确'", card1.match_reason === "未明确");

  // visible_level 默认计算（backend_score=50 → scoreToLevel(50)="C"）
  check("不传 visible_level, backend_score=50 → visible_level='C'", card1.visible_level === "C", `level=${card1.visible_level}`);

  // status 默认值
  check("不传 status → status='new'", card1.status === "new");

  // 必填字段缺失抛错
  let threw = false;
  try {
    createOpportunityCard({ ...makeMinimalInput(), title: "" });
  } catch {
    threw = true;
  }
  check("不传 title → 抛错", threw);

  threw = false;
  try {
    createOpportunityCard({ ...makeMinimalInput(), type: "" });
  } catch {
    threw = true;
  }
  check("不传 type → 抛错", threw);

  threw = false;
  try {
    createOpportunityCard({ ...makeMinimalInput(), organizer: "" });
  } catch {
    threw = true;
  }
  check("不传 organizer → 抛错", threw);

  threw = false;
  try {
    createOpportunityCard({ ...makeMinimalInput(), official_source_url: "" });
  } catch {
    threw = true;
  }
  check("不传 official_source_url → 抛错", threw);

  // visible_level 显式传入时不计算
  const card2 = createOpportunityCard({ ...makeMinimalInput(), backend_score: 95, visible_level: "A" });
  check("显式传 visible_level='A' → visible_level='A'", card2.visible_level === "A");

  // backend_score 高分但 visible_level 未传 → scoreToLevel(95)="S"
  const card3 = createOpportunityCard({ ...makeMinimalInput(), backend_score: 95 });
  check("backend_score=95, 不传 visible_level → visible_level='S'", card3.visible_level === "S", `level=${card3.visible_level}`);

  // 批量创建
  const cards = createOpportunityCards([
    makeMinimalInput({ title: "机会 1" }),
    makeMinimalInput({ title: "机会 2" }),
    makeMinimalInput({ title: "机会 3" }),
  ]);
  check("批量创建 3 个 → 返回 3 个卡片", cards.length === 3);
  check("批量创建 → 第 1 个 title 正确", cards[0].title === "机会 1");
  check("批量创建 → 第 3 个 title 正确", cards[2].title === "机会 3");
}

// ============================================================
// 验收 5.4：状态更新
// ============================================================

console.log("\n[验收 5.4] 状态更新\n");

{
  // 合法转换
  const card1 = makeFullCard({ status: "new" });
  const r1 = updateCardStatus(card1, "viewed");
  check("new → viewed 合法 → success=true", r1.success === true);
  check("new → viewed 合法 → card.status='viewed'", r1.card?.status === "viewed");
  check("new → viewed 合法 → error=null", r1.error === null);

  // 非法转换
  const card2 = makeFullCard({ status: "new" });
  const r2 = updateCardStatus(card2, "applied");
  check("new → applied 非法 → success=false", r2.success === false);
  check("new → applied 非法 → error 非空", r2.error !== null);
  check("new → applied 非法 → card=null", r2.card === null);

  // 终态转出
  const card3 = makeFullCard({ status: "archived" });
  const r3 = updateCardStatus(card3, "new");
  check("archived → new 终态 → success=false", r3.success === false);
  check("archived → new 终态 → error 非空", r3.error !== null);

  const card4 = makeFullCard({ status: "dismissed" });
  const r4 = updateCardStatus(card4, "saved");
  check("dismissed → saved 终态 → success=false", r4.success === false);
  check("dismissed → saved 终态 → error 非空", r4.error !== null);

  // 不可变性：原卡片不被修改
  check("状态更新不可变 → 原卡片 status 不变", card1.status === "new");
}

// ============================================================
// 验收 5.5：完整性校验
// ============================================================

console.log("\n[验收 5.5] 完整性校验\n");

{
  // 完整卡片
  const fullCard = makeFullCard();
  const r1 = validateCardCompleteness(fullCard);
  check("完整卡片 → valid=true", r1.valid === true);
  check("完整卡片 → critical_missing=[]", r1.critical_missing.length === 0, `missing=${JSON.stringify(r1.critical_missing)}`);
  check("完整卡片 → optional_missing=[]", r1.optional_missing.length === 0, `missing=${JSON.stringify(r1.optional_missing)}`);
  check("完整卡片 → link_valid=true", r1.link_valid === true);

  // critical 缺失 - title
  const card2 = makeFullCard({ title: "" });
  const r2 = validateCardCompleteness(card2);
  check("title='' → valid=false", r2.valid === false);
  check("title='' → critical_missing 含 'title'", r2.critical_missing.includes("title"));

  // critical 缺失 - official_source_url
  const card3 = makeFullCard({ official_source_url: "" });
  const r3 = validateCardCompleteness(card3);
  check("official_source_url='' → valid=false", r3.valid === false);
  check("official_source_url='' → critical_missing 含 'official_source_url'", r3.critical_missing.includes("official_source_url"));
  check("official_source_url='' → link_valid=false", r3.link_valid === false);

  // optional 缺失 - region
  const card4 = makeFullCard({ region: "未明确" });
  const r4 = validateCardCompleteness(card4);
  check("region='未明确' → valid=true（critical 无缺失）", r4.valid === true);
  check("region='未明确' → optional_missing 含 'region'", r4.optional_missing.includes("region"));

  // 分数等级不匹配 - backend_score=95, visible_level="C"
  const card5 = makeFullCard({ backend_score: 95, visible_level: "C" });
  const r5 = validateCardCompleteness(card5);
  check("backend_score=95, visible_level='C' → score_warning=true", r5.score_warning === true);

  // 分数等级匹配 - backend_score=95, visible_level="S"
  const card6 = makeFullCard({ backend_score: 95, visible_level: "S" });
  const r6 = validateCardCompleteness(card6);
  check("backend_score=95, visible_level='S' → score_warning=false", r6.score_warning === false);

  // 分数等级匹配 - backend_score=85, visible_level="A"
  const card7 = makeFullCard({ backend_score: 85, visible_level: "A" });
  const r7 = validateCardCompleteness(card7);
  check("backend_score=85, visible_level='A' → score_warning=false", r7.score_warning === false);

  // 分数等级匹配 - backend_score=70, visible_level="B"
  const card8 = makeFullCard({ backend_score: 70, visible_level: "B" });
  const r8 = validateCardCompleteness(card8);
  check("backend_score=70, visible_level='B' → score_warning=false", r8.score_warning === false);

  // 分数 < 50 → scoreToLevel 返回 hidden → 任何 CardVisibleLevel 都不匹配
  const card9 = makeFullCard({ backend_score: 30, visible_level: "C" });
  const r9 = validateCardCompleteness(card9);
  check("backend_score=30, visible_level='C' → score_warning=true（hidden 不匹配）", r9.score_warning === true);
}

// ============================================================
// 验收 5.6：卡片渲染 - compact
// ============================================================

console.log("\n[验收 5.6] 卡片渲染 - compact\n");

{
  const card = makeFullCard();
  const output = renderCardCompact(card);
  check("compact 含 visible_level [S]", output.includes("[S]"));
  check("compact 含 title", output.includes(card.title));
  check("compact 含 deadline", output.includes(card.deadline));
  check("compact 含 match_reason", output.includes(card.match_reason));
  check("compact 单行格式（无换行）", !output.includes("\n"), `output=${output}`);
  check("compact 以 '- ' 开头", output.startsWith("- "));
}

// ============================================================
// 验收 5.7：卡片渲染 - standard
// ============================================================

console.log("\n[验收 5.7] 卡片渲染 - standard\n");

{
  const card = makeFullCard();
  const output = renderCardStandard(card);
  const lines = output.split("\n");

  check("standard 以 '### ' 开头", lines[0]?.startsWith("### ") === true, `first=${lines[0]}`);
  check("standard 含 '推荐等级：'", output.includes("推荐等级："));
  check("standard 含 '机会类型：'", output.includes("机会类型："));
  check("standard 含 '主办方 / 发布方：'", output.includes("主办方 / 发布方："));
  check("standard 含 '地区：'", output.includes("地区："));
  check("standard 含 '截止日期：'", output.includes("截止日期："));
  check("standard 含 '奖励 / 补贴 / 价值：'", output.includes("奖励 / 补贴 / 价值："));
  check("standard 含 '适合对象：'", output.includes("适合对象："));
  check("standard 含 '为什么适合你：'", output.includes("为什么适合你："));
  check("standard 含 '下一步行动建议：'", output.includes("下一步行动建议："));
  check("standard 含 '官方来源链接：'", output.includes("官方来源链接："));
  check("standard 含 '报名链接：'", output.includes("报名链接："));
  check("standard 含 '联系方式：'", output.includes("联系方式："));
  check("standard 含 '风险提醒：'", output.includes("风险提醒："));

  // OPPORTUNITY_CARD_REQUIRED_FIELDS 长度为 14
  check("OPPORTUNITY_CARD_REQUIRED_FIELDS 长度为 14", OPPORTUNITY_CARD_REQUIRED_FIELDS.length === 14);

  // 列表格式：每个字段一行 - 前缀
  const listLines = lines.filter((l) => l.startsWith("- "));
  check("standard 含 13 个列表项（- 前缀）", listLines.length === 13, `count=${listLines.length}`);

  // 空值处理
  const emptyCard = makeFullCard({ region: "", application_url: "" });
  const emptyOutput = renderCardStandard(emptyCard);
  check("standard 空字符串 → '未明确'", emptyOutput.includes("地区：未明确"));
  check("standard 空 URL → '需人工复核'", emptyOutput.includes("报名链接：需人工复核"));
}

// ============================================================
// 验收 5.8：卡片渲染 - detail
// ============================================================

console.log("\n[验收 5.8] 卡片渲染 - detail\n");

{
  const card = makeFullCard();
  const output = renderCardDetail(card);
  const lines = output.split("\n");

  check("detail 以 '# ' 开头", lines[0]?.startsWith("# ") === true, `first=${lines[0]}`);
  check("detail 含 '## 基本信息'", output.includes("## 基本信息"));
  check("detail 含 '## 价值与资格'", output.includes("## 价值与资格"));
  check("detail 含 '## 匹配分析'", output.includes("## 匹配分析"));
  check("detail 含 '## 链接与联系'", output.includes("## 链接与联系"));

  // 含状态中文名
  check("detail 含 CARD_STATUS_LABELS 对应值", output.includes(CARD_STATUS_LABELS[card.status]));
  // 含来源中文名（V0.5 默认 manual）
  check("detail 含 CARD_SOURCE_LABELS 对应值", output.includes(CARD_SOURCE_LABELS.manual));
  // 含等级定义
  check("detail 含 LEVEL_DEFINITIONS 对应值", output.includes(LEVEL_DEFINITIONS[card.visible_level]));
  // 含后台分数
  check("detail 含 '后台分数：'", output.includes("后台分数："));
  check("detail 含 backend_score 值", output.includes(String(card.backend_score)));
  // 含距今天数
  check("detail 含 '距今天数：'", output.includes("距今天数："));
}

// ============================================================
// 验收 5.9：编译与引用
// ============================================================

console.log("\n[验收 5.9] 编译与引用\n");

{
  // 检查文件存在
  const opportunityCardPath = path.resolve(process.cwd(), "src/schema/opportunity-card.ts");
  check("src/schema/opportunity-card.ts 存在", fs.existsSync(opportunityCardPath));

  const cardTemplatePath = path.resolve(process.cwd(), "src/agents/card-template.ts");
  check("src/agents/card-template.ts 存在", fs.existsSync(cardTemplatePath));

  const cardFactoryPath = path.resolve(process.cwd(), "src/agents/card-factory.ts");
  check("src/agents/card-factory.ts 存在", fs.existsSync(cardFactoryPath));

  const verifyPath = path.resolve(process.cwd(), "scripts/verify-task014.ts");
  check("scripts/verify-task014.ts 存在", fs.existsSync(verifyPath));

  // 检查 card-template.ts 引用
  const templateContent = fs.readFileSync(cardTemplatePath, "utf-8");
  check("card-template 引用 OpportunityCard 类型", templateContent.includes("OpportunityCard"));
  check("card-template 引用 CARD_STATUS_LABELS", templateContent.includes("CARD_STATUS_LABELS"));
  check("card-template 引用 CARD_SOURCE_LABELS", templateContent.includes("CARD_SOURCE_LABELS"));
  check("card-template 引用 LEVEL_DEFINITIONS", templateContent.includes("LEVEL_DEFINITIONS"));
  check("card-template 不硬编码状态中文名", !templateContent.includes('"新发现"'));
  check("card-template 导出 renderCardCompact", templateContent.includes("export function renderCardCompact"));
  check("card-template 导出 renderCardStandard", templateContent.includes("export function renderCardStandard"));
  check("card-template 导出 renderCardDetail", templateContent.includes("export function renderCardDetail"));

  // 检查 card-factory.ts 引用
  const factoryContent = fs.readFileSync(cardFactoryPath, "utf-8");
  check("card-factory 引用 OpportunityCard 类型", factoryContent.includes("OpportunityCard"));
  check("card-factory 引用 scoreToLevel", factoryContent.includes("scoreToLevel"));
  check("card-factory 引用 isStatusTransitionValid", factoryContent.includes("isStatusTransitionValid"));
  check("card-factory 引用 CARD_CRITICAL_FIELDS", factoryContent.includes("CARD_CRITICAL_FIELDS"));
  check("card-factory 引用 CARD_OPTIONAL_FIELDS", factoryContent.includes("CARD_OPTIONAL_FIELDS"));
  check("card-factory 导出 createOpportunityCard", factoryContent.includes("export function createOpportunityCard"));
  check("card-factory 导出 createOpportunityCards", factoryContent.includes("export function createOpportunityCards"));
  check("card-factory 导出 updateCardStatus", factoryContent.includes("export function updateCardStatus"));
  check("card-factory 导出 validateCardCompleteness", factoryContent.includes("export function validateCardCompleteness"));
  check("card-factory 不重复实现 validateOpportunityCard", !factoryContent.includes("function validateOpportunityCard"));

  // 检查 opportunity-card.ts 扩展
  const schemaContent = fs.readFileSync(opportunityCardPath, "utf-8");
  check("opportunity-card 导出 CARD_STATUS_TRANSITIONS", schemaContent.includes("export const CARD_STATUS_TRANSITIONS"));
  check("opportunity-card 导出 CARD_STATUS_LABELS", schemaContent.includes("export const CARD_STATUS_LABELS"));
  check("opportunity-card 导出 CARD_PRIORITY_LABELS", schemaContent.includes("export const CARD_PRIORITY_LABELS"));
  check("opportunity-card 导出 CARD_SOURCE_LABELS", schemaContent.includes("export const CARD_SOURCE_LABELS"));
  check("opportunity-card 导出 CARD_CRITICAL_FIELDS", schemaContent.includes("export const CARD_CRITICAL_FIELDS"));
  check("opportunity-card 导出 CARD_OPTIONAL_FIELDS", schemaContent.includes("export const CARD_OPTIONAL_FIELDS"));
  check("opportunity-card 导出 isStatusTransitionValid", schemaContent.includes("export function isStatusTransitionValid"));
  check("opportunity-card 导出 CardRenderMode 类型", schemaContent.includes("export type CardRenderMode"));
  check("opportunity-card 导出 CardPriority 类型", schemaContent.includes("export type CardPriority"));
  check("opportunity-card 导出 CardSource 类型", schemaContent.includes("export type CardSource"));
}

// ============================================================
// V0.5 汇总验收
// ============================================================

console.log("\n[V0.5 汇总验收] Task 014 自检\n");

{
  const card = makeFullCard();
  check("V0.5-1: OpportunityCard 含全部 17 个字段", Object.keys(card).length === 17);
  check("V0.5-2: 卡片状态机 6 种状态转换合法",
    Object.keys(CARD_STATUS_TRANSITIONS).length === 6);
  check("V0.5-3: 卡片工厂函数支持部分数据创建",
    createOpportunityCard(makeMinimalInput()).title === "测试机会");
  check("V0.5-4: 卡片完整性校验（critical/optional/link/score）",
    typeof validateCardCompleteness(card).valid === "boolean");
  check("V0.5-5: 3 种渲染模板（compact/standard/detail）",
    typeof renderCardCompact === "function" &&
    typeof renderCardStandard === "function" &&
    typeof renderCardDetail === "function");
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
