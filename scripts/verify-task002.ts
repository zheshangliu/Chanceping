/**
 * Task 002 验收脚本
 *
 * 运行：npx tsx scripts/verify-task002.ts
 * 覆盖验收标准 5.1–5.5：
 *   - 5.1 system prompt 覆盖度（关键词检查）
 *   - 5.2 状态机正确性（15 个转换测试用例）
 *   - 5.3 追问问题库完整性（数量 / 字段 / 优先级 / 组合函数）
 *   - 5.4 确认度计算规格完整性（7 维度 / weight 一致）
 *   - 5.5 编译与引用（不硬编码品牌名 / import 引用 Task 001）
 */

import fs from "fs";
import path from "path";
import { REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT } from "../src/prompts/requirement-confirmation-system-prompt";
import { STATE_TRANSITIONS, getNextStatus } from "../src/schema/conversation-state-machine";
import {
  GENERAL_QUESTIONS,
  AI_COMPETITION_QUESTIONS,
  OPC_POLICY_QUESTIONS,
  CULTURAL_HERITAGE_QUESTIONS,
  getQuestionsForRadarType,
} from "../src/prompts/question-bank";
import { CONFIDENCE_CALCULATION_SPEC } from "../src/schema/confidence-calculation-spec";
import { CONFIDENCE_WEIGHTS, CONFIDENCE_DIMENSIONS } from "../src/schema/requirement-confidence";
import { CONFIRMATION_STATUSES } from "../src/schema/radar-requirement-spec";
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

const prompt = REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT;

console.log("\n=== Task 002 验收检查 ===\n");

// ---------------------------------------------------------------------------
// 5.1 system prompt 覆盖度
// ---------------------------------------------------------------------------
console.log("[验收 5.1] system prompt 覆盖度");
check('Agent 身份 "互动式需求确认 Agent"', prompt.includes("互动式需求确认 Agent"));
check('90% 阈值 "90%"', prompt.includes("90%"));
check('不过早下结论 "不过早下结论"', prompt.includes("不过早下结论"));
check('标准流程 "初步理解"', prompt.includes("初步理解"));
check('标准流程 "已确认信息"', prompt.includes("已确认信息"));
check('标准流程 "不确定信息"', prompt.includes("不确定信息"));
check('每轮 3–5 问 含 "3"', prompt.includes("3"));
check('每轮 3–5 问 含 "5"', prompt.includes("5"));
check('7 维度 "客户身份清晰度"', prompt.includes("客户身份清晰度"));
check('7 维度 "业务目标清晰度"', prompt.includes("业务目标清晰度"));
check('7 维度 "机会类型清晰度"', prompt.includes("机会类型清晰度"));
check('7 维度 "地域范围清晰度"', prompt.includes("地域范围清晰度"));
check('7 维度 "排除条件清晰度"', prompt.includes("排除条件清晰度"));
check('7 维度 "行动场景清晰度"', prompt.includes("行动场景清晰度"));
check('7 维度 "报告形式清晰度"', prompt.includes("报告形式清晰度"));
check('低于 70% 分支 含 "70%"', prompt.includes("70%"));
check('低于 70% 分支 含 "不能生成"', prompt.includes("不能生成"));
check('70–89% 分支 含 "89%"', prompt.includes("89%"));
check('90–94% 分支 含 "94%"', prompt.includes("94%"));
check('90–94% 分支 含 "确认卡"', prompt.includes("确认卡"));
check('95% 分支 含 "95%"', prompt.includes("95%"));
check('95% 分支 含 "雷达"', prompt.includes("雷达"));

// 确认卡 10 模块
const cardModules = [
  "我理解你的身份",
  "我理解你的核心目标",
  "我理解你需要盯的机会类型",
  "我建议优先追踪的信号",
  "我建议优先排除的信息",
  "我建议的雷达方向",
  "我建议的机会分级方式",
  "我建议的报告结构",
  "当前需求确认度",
  "请你确认",
];
for (const m of cardModules) {
  check(`确认卡模块 "${m}"`, prompt.includes(m));
}

// 禁止行为 10 条（"禁止" 至少出现 10 次）
const forbidCount = (prompt.match(/禁止/g) || []).length;
check(`禁止行为 "禁止" 出现 ≥10 次（实际 ${forbidCount} 次）`, forbidCount >= 10);

// 最终输出判断
check('当前状态 "当前状态"', prompt.includes("当前状态"));
check('当前状态 "继续确认需求"', prompt.includes("继续确认需求"));
check('当前状态 "可以生成需求确认卡"', prompt.includes("可以生成需求确认卡"));
check('当前状态 "可以进入雷达方案生成"', prompt.includes("可以进入雷达方案生成"));
check('一句话总结 "宁可多问两轮"', prompt.includes("宁可多问两轮"));

// ---------------------------------------------------------------------------
// 5.2 状态机正确性
// ---------------------------------------------------------------------------
console.log("\n[验收 5.2] 状态机正确性");

// 转换表条数
check(`STATE_TRANSITIONS 共 15 条（实际 ${STATE_TRANSITIONS.length} 条）`, STATE_TRANSITIONS.length === 15);

type Case = {
  name: string;
  current: typeof CONFIRMATION_STATUSES[number];
  total: number;
  action?: "confirmed" | "requested_revision";
  expected: typeof CONFIRMATION_STATUSES[number];
};
const stateCases: Case[] = [
  { name: "草稿→低确认度 (draft,50)", current: "draft", total: 50, expected: "needs_more_info" },
  { name: "草稿→中确认度 (draft,80)", current: "draft", total: 80, expected: "ready_for_confirmation_card" },
  { name: "草稿→高确认度 (draft,92)", current: "draft", total: 92, expected: "confirmation_card_generated" },
  { name: "低→低 (needs_more_info,60)", current: "needs_more_info", total: 60, expected: "needs_more_info" },
  { name: "低→中 (needs_more_info,75)", current: "needs_more_info", total: 75, expected: "ready_for_confirmation_card" },
  { name: "低→高 (needs_more_info,91)", current: "needs_more_info", total: 91, expected: "confirmation_card_generated" },
  { name: "中→中 (ready_for_confirmation_card,85)", current: "ready_for_confirmation_card", total: 85, expected: "ready_for_confirmation_card" },
  { name: "中→高 (ready_for_confirmation_card,93)", current: "ready_for_confirmation_card", total: 93, expected: "confirmation_card_generated" },
  { name: "确认卡→用户修改 (confirmation_card_generated,requested_revision)", current: "confirmation_card_generated", total: 92, action: "requested_revision", expected: "user_revision_requested" },
  { name: "确认卡→已确认 (confirmation_card_generated,confirmed,92)", current: "confirmation_card_generated", total: 92, action: "confirmed", expected: "confirmed" },
  { name: "已确认→可进方案 (confirmed,96)", current: "confirmed", total: 96, expected: "ready_for_radar_plan" },
  { name: "已确认→停留 (confirmed,92)", current: "confirmed", total: 92, expected: "confirmed" },
  { name: "用户修改→低 (user_revision_requested,60)", current: "user_revision_requested", total: 60, expected: "needs_more_info" },
  { name: "用户修改→中 (user_revision_requested,80)", current: "user_revision_requested", total: 80, expected: "ready_for_confirmation_card" },
  { name: "用户修改→高 (user_revision_requested,91)", current: "user_revision_requested", total: 91, expected: "confirmation_card_generated" },
];
for (const c of stateCases) {
  const got = getNextStatus(c.current, c.total, c.action);
  check(c.name, got === c.expected, `got ${got}, expected ${c.expected}`);
}

// ---------------------------------------------------------------------------
// 5.3 追问问题库完整性
// ---------------------------------------------------------------------------
console.log("\n[验收 5.3] 追问问题库完整性");
check(`GENERAL_QUESTIONS 长度=8（实际 ${GENERAL_QUESTIONS.length}）`, GENERAL_QUESTIONS.length === 8);
check(`AI_COMPETITION_QUESTIONS 长度=7（实际 ${AI_COMPETITION_QUESTIONS.length}）`, AI_COMPETITION_QUESTIONS.length === 7);
check(`OPC_POLICY_QUESTIONS 长度=7（实际 ${OPC_POLICY_QUESTIONS.length}）`, OPC_POLICY_QUESTIONS.length === 7);
check(`CULTURAL_HERITAGE_QUESTIONS 长度=7（实际 ${CULTURAL_HERITAGE_QUESTIONS.length}）`, CULTURAL_HERITAGE_QUESTIONS.length === 7);

const allQuestions = [
  ...GENERAL_QUESTIONS,
  ...AI_COMPETITION_QUESTIONS,
  ...OPC_POLICY_QUESTIONS,
  ...CULTURAL_HERITAGE_QUESTIONS,
];
let fieldMissing = false;
let badPriority = false;
for (const q of allQuestions) {
  if (!q.question || !q.why_it_matters || !q.related_field || !q.priority) fieldMissing = true;
  if (!["high", "medium", "low"].includes(q.priority)) badPriority = true;
}
check("所有问题含 question/why_it_matters/related_field/priority 四字段", !fieldMissing);
check("所有 priority 仅 high/medium/low", !badPriority);

check(`getQuestionsForRadarType("general")=8（实际 ${getQuestionsForRadarType("general").length}）`, getQuestionsForRadarType("general").length === 8);
check(`getQuestionsForRadarType("ai_competition")=15（实际 ${getQuestionsForRadarType("ai_competition").length}）`, getQuestionsForRadarType("ai_competition").length === 15);
check(`getQuestionsForRadarType("opc_policy")=15（实际 ${getQuestionsForRadarType("opc_policy").length}）`, getQuestionsForRadarType("opc_policy").length === 15);
check(`getQuestionsForRadarType("cultural_heritage")=15（实际 ${getQuestionsForRadarType("cultural_heritage").length}）`, getQuestionsForRadarType("cultural_heritage").length === 15);

// ---------------------------------------------------------------------------
// 5.4 确认度计算规格完整性
// ---------------------------------------------------------------------------
console.log("\n[验收 5.4] 确认度计算规格完整性");
check(`CONFIDENCE_CALCULATION_SPEC 长度=7（实际 ${CONFIDENCE_CALCULATION_SPEC.length}）`, CONFIDENCE_CALCULATION_SPEC.length === 7);

let specFieldMissing = false;
let weightMismatch = false;
for (const s of CONFIDENCE_CALCULATION_SPEC) {
  if (!s.dimension || !s.weight || !s.what_it_measures || !s.scoring_guide || !s.related_questions) {
    specFieldMissing = true;
  }
  if (
    !s.scoring_guide.score_0_to_49 ||
    !s.scoring_guide.score_50_to_69 ||
    !s.scoring_guide.score_70_to_89 ||
    !s.scoring_guide.score_90_to_100
  ) {
    specFieldMissing = true;
  }
  const key = s.dimension;
  if (s.weight !== CONFIDENCE_WEIGHTS[key]) weightMismatch = true;
}
check("每个维度含 dimension/weight/what_it_measures/scoring_guide(4档)/related_questions", !specFieldMissing);
check("weight 值与 CONFIDENCE_WEIGHTS 一致", !weightMismatch);

// 维度集合与 Task 001 一致
const specDims = CONFIDENCE_CALCULATION_SPEC.map((s) => s.dimension).sort();
const refDims = [...CONFIDENCE_DIMENSIONS].sort();
check("维度集合与 CONFIDENCE_DIMENSIONS 一致", JSON.stringify(specDims) === JSON.stringify(refDims));

// ---------------------------------------------------------------------------
// 5.5 编译与引用（不硬编码品牌名 / import 引用）
// ---------------------------------------------------------------------------
console.log("\n[验收 5.5] 编译与引用");

// system prompt 源码不硬编码品牌名字符串字面量，通过 BRAND.product_name 引用
const promptSrcPath = path.resolve(process.cwd(), "src/prompts/requirement-confirmation-system-prompt.ts");
const promptSrc = fs.readFileSync(promptSrcPath, "utf-8");
check("system prompt 源码引用 BRAND.product_name", promptSrc.includes("BRAND.product_name"));
check('system prompt 源码不硬编码 "盯机会 ChancePing" 字面量', !promptSrc.includes("盯机会 ChancePing"));

// 运行时 prompt 字符串包含品牌名（证明引用生效）
check("运行时 prompt 字符串含品牌名（引用生效）", prompt.includes(BRAND.product_name));

// 状态机不重新定义枚举，import 引用 Task 001
const smSrcPath = path.resolve(process.cwd(), "src/schema/conversation-state-machine.ts");
const smSrc = fs.readFileSync(smSrcPath, "utf-8");
check("状态机 import ConfirmationStatus（不重新定义）", smSrc.includes('import') && smSrc.includes('ConfirmationStatus') && !smSrc.includes('export const CONFIRMATION_STATUSES'));

// CONFIRMATION_STATUSES 含 7 个状态
check(`CONFIRMATION_STATUSES 含 7 个状态（实际 ${CONFIRMATION_STATUSES.length}）`, CONFIRMATION_STATUSES.length === 7);

// --- 汇总 ---
console.log("\n=== 汇总 ===");
console.log(`PASS: ${passed}   FAIL: ${failed}`);
console.log("\n请另行执行：");
console.log("  npx tsc --noEmit   # 验收 5.5 TypeScript 编译无错误");
console.log("");

if (failed > 0) {
  process.exit(1);
}
