/**
 * Task 001 验收脚本
 *
 * 运行：npm run verify
 * 覆盖验收标准 #1–#4 + 机会卡片校验 + source_strategy 预留字段检查。
 * 验收 #5（无硬编码）请另运行：npm run check:no-hardcode
 * 验收 #7（TS 编译）请另运行：npm run typecheck
 */

import fs from "fs";
import path from "path";
import { validateSpec, validateConfidence, validateOpportunityCard } from "../src/utils/validators";
import { scoreToLevel } from "../src/schema/scoring-rules";
import { BRAND } from "../src/brand/constants";
import { CONFIDENCE_WEIGHTS } from "../src/schema/requirement-confidence";

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

console.log("\n=== Task 001 验收检查 ===\n");

// 加载示例 Spec
const samplePath = path.resolve(process.cwd(), "data/samples/sample-spec.json");
const sample = JSON.parse(fs.readFileSync(samplePath, "utf-8"));

// --- 验收 #1：sample-spec 通过 validateSpec ---
console.log("[验收 #1] 示例 Spec 通过 validateSpec");
const r1 = validateSpec(sample);
check("validateSpec(sample) 返回 valid=true", r1.valid, r1.errors.join("; "));
check("validateSpec(sample) 无 errors", r1.errors.length === 0, `${r1.errors.length} 条 error`);

// --- 验收 #2：删除 core_goals 后失败并指出缺失 ---
console.log("\n[验收 #2] 删除 core_goals 字段后 validateSpec 失败");
const broken = JSON.parse(JSON.stringify(sample));
delete broken.core_goals;
const r2 = validateSpec(broken);
check("删除 core_goals 后 valid=false", !r2.valid, r2.errors.join("; "));
check("errors 中指出 core_goals 缺失", r2.errors.some((e) => e.includes("core_goals")), r2.errors.join("; "));

// --- 验收 #3：validateConfidence 权重和=100，篡改权重为 0 则失败 ---
console.log("\n[验收 #3] 需求确认度校验");
const r3 = validateConfidence(sample.requirement_confidence);
check("sample confidence 通过 validateConfidence", r3.valid, r3.errors.join("; "));

const tampered = JSON.parse(JSON.stringify(sample.requirement_confidence));
tampered.business_goal.weight = 0; // 篡改权重为 0
const r3b = validateConfidence(tampered);
check("篡改 business_goal.weight=0 后 valid=false", !r3b.valid, r3b.errors.join("; "));
check("errors 指出权重不一致或权重之和!=100",
  r3b.errors.some((e) => e.includes("weight") || e.includes("权重之和")),
  r3b.errors.join("; "));

// --- 验收 #4：scoreToLevel 分级 ---
console.log("\n[验收 #4] scoreToLevel 分级映射");
check("scoreToLevel(92) === 'S'", scoreToLevel(92) === "S", `got ${scoreToLevel(92)}`);
check("scoreToLevel(85) === 'A'", scoreToLevel(85) === "A", `got ${scoreToLevel(85)}`);
check("scoreToLevel(70) === 'B'", scoreToLevel(70) === "B", `got ${scoreToLevel(70)}`);
check("scoreToLevel(55) === 'C'", scoreToLevel(55) === "C", `got ${scoreToLevel(55)}`);
check("scoreToLevel(40) === 'hidden'", scoreToLevel(40) === "hidden", `got ${scoreToLevel(40)}`);

// --- 机会卡片校验器（V0.0 清单：三项校验工具可用） ---
console.log("\n[附加] 机会卡片校验 validateOpportunityCard");
const validCard = {
  title: "AI Game Jam 2026 春季赛",
  type: "AI 游戏比赛",
  organizer: "Itch.io × 某社区",
  region: "海外（英语地区）",
  deadline: "2026-04-15",
  reward_or_value: "奖金 $5,000 + Steam 推荐",
  eligibility: "个人或小团队均可",
  materials_required: "可运行 Demo + 演示视频",
  match_reason: "适合快速做 Demo，奖金明确，个人可参赛",
  next_action: "注册 itch.io 账号并组建项目仓库",
  official_source_url: "https://itch.io/jam/ai-game-jam-2026",
  application_url: "https://itch.io/jam/ai-game-jam-2026/enter",
  contact_info: "organizer@example.com",
  risk_note: "需确认是否允许使用第三方 AI API",
  backend_score: 88,
  visible_level: "A",
  status: "new",
};
const rc = validateOpportunityCard(validCard);
check("合法机会卡片通过校验", rc.valid, rc.errors.join("; "));

const badCard = { ...validCard, visible_level: "X", backend_score: 120, official_source_url: "" };
const rcb = validateOpportunityCard(badCard);
check("非法卡片被检出（level/score/url）", !rcb.valid, rcb.errors.join("; "));

// --- source_strategy 预留字段（V0.0 清单） ---
console.log("\n[附加] source_strategy 自演进预留字段");
const ss = sample.source_strategy;
check("存在 sources_used_in_report 数组", !!ss && Array.isArray(ss.sources_used_in_report));
check("存在 user_supplied_sources 数组", !!ss && Array.isArray(ss.user_supplied_sources));
check("存在 source_transparency_enabled 布尔", !!ss && typeof ss.source_transparency_enabled === "boolean");

// --- 品牌/确认度维度权重（V0.0 清单） ---
console.log("\n[附加] 品牌常量引用与确认度权重");
check("sample.product_name 与品牌常量一致", sample.product_name === BRAND.product_name);
const sum = Object.values(CONFIDENCE_WEIGHTS).reduce((a: number, b: number) => a + b, 0);
check("7 维度权重之和 = 100", sum === 100, `sum=${sum}`);

// --- 汇总 ---
console.log("\n=== 汇总 ===");
console.log(`PASS: ${passed}   FAIL: ${failed}`);
console.log("\n请另行执行：");
console.log("  npm run check:no-hardcode   # 验收 #5 品牌无硬编码");
console.log("  npm run typecheck           # 验收 #7 TypeScript 编译无错误");
console.log("");

if (failed > 0) {
  process.exit(1);
}
