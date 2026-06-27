/**
 * Task 005 验收脚本
 *
 * 运行：npx tsx scripts/verify-task005.ts
 * 覆盖验收标准：
 *   - 报告结构完整性（标题/周期/版本/用户/时间/10 节/本周结论/四问）
 *   - 机会卡片完整性（数量/字段/分级/匹配理由/链接/状态）
 *   - 筛选规则执行（不建议投入机会 ≥1 条 / 类型相关 / 无学生类与纯线上虚拟展览）
 *   - 链接有效性（official_source_url 指向合理域名）
 *   - 分级与分数对应（90-100→S, 80-89→A, 65-79→B, 50-64→C）
 */

import fs from "fs";
import path from "path";
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

console.log("\n=== Task 005 验收检查 ===\n");

const reportPath = path.join(__dirname, "..", "reports", "cultural-heritage-radar-v0.1.md");
const jsonPath = path.join(__dirname, "..", "data", "samples", "cultural-heritage-opportunities.json");

const report = fs.readFileSync(reportPath, "utf-8");
const opportunities = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Array<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// 验收 1：报告结构完整性
// ---------------------------------------------------------------------------
console.log("[验收 1] 报告结构完整性");

const expectedTitlePrefix = `${BRAND.product_name}｜本周文创 / 非遗雷达报告`;
const firstLine = report.split("\n")[0] ?? "";
check(
  "标题以「品牌名｜本周文创 / 非遗雷达报告」开头",
  firstLine.startsWith("# " + expectedTitlePrefix),
  `首行应为「# ${expectedTitlePrefix}」，实际为「${firstLine}」`,
);

check('包含「周期：」', report.includes("周期："));
check('包含「雷达版本：V0.12」', report.includes("雷达版本：V0.12"));
check('包含「目标用户：」', report.includes("目标用户："));
check('包含「报告生成时间：」', report.includes("报告生成时间："));

for (let i = 0; i <= 9; i++) {
  check(`包含「## ${i}.」section`, report.includes(`## ${i}.`));
}

check('包含「## 本周结论」', report.includes("## 本周结论"));
check('包含「最值得优先行动」', report.includes("最值得优先行动"));
check('包含「最适合保存观察」', report.includes("最适合保存观察"));
check('包含「最需要人工复核」', report.includes("最需要人工复核"));
check('包含「下周最应该继续追踪」', report.includes("下周最应该继续追踪"));

// 不建议投入的机会 section 至少 1 条被排除机会 + 排除原因
const section7Match = report.match(/## 7\.[^\n]*\n([\s\S]*?)(?=\n## )/);
const section7 = section7Match ? section7Match[1] : "";
const hasExcludedItem = /排除原因/.test(section7);
const hasExcludedKeyword = /学生|虚拟|论坛|元宇宙|线上展览/.test(section7);
check(
  "「不建议投入的机会」section 至少 1 条被排除机会 + 排除原因",
  section7.trim().length > 0 && hasExcludedItem && hasExcludedKeyword,
  `section7 长度=${section7.trim().length}，含排除原因=${hasExcludedItem}，含排除关键词=${hasExcludedKeyword}`,
);

// ---------------------------------------------------------------------------
// 验收 2：机会卡片完整性（JSON）
// ---------------------------------------------------------------------------
console.log("\n[验收 2] 机会卡片完整性（JSON）");

check(`机会数量 ≥6（实际 ${opportunities.length}）`, opportunities.length >= 6);

const validLevels = ["S", "A", "B", "C"];
const reasonableDomainPatterns = [
  /\.gov\.cn/i,
  /\.org\.cn/i,
  /\.com(\.cn)?(\/|$)/i,
  /\.cn(\/|$)/i,
  /\.museum(\/|$)/i,
  /\.net(\/|$)/i,
];
const culturalTypeKeywords = [
  "文创",
  "非遗",
  "城市",
  "礼物",
  "工艺",
  "美术",
  "文旅",
  "博物",
  "景区",
  "联名",
  "设计",
  "扶持",
  "比赛",
  "征集",
  "展会",
  "产品",
];
const forbiddenTypeKeywords = ["学生", "虚拟", "线上展览", "元宇宙", "大会论坛"];

let hasSA = false;
let allUrlOk = true;
let allLevelValid = true;
let allScoreOk = true;
let allStatusNew = true;
let allMatchReasonOk = true;
let allTypeCultural = true;
let noForbiddenType = true;
let allTitleOk = true;
let allTypeOk = true;
let allDeadlineOk = true;
let allScoreLevelMatch = true;

for (let i = 0; i < opportunities.length; i++) {
  const o = opportunities[i];
  const url = String(o.official_source_url ?? "");
  const level = String(o.visible_level ?? "");
  const score = Number(o.backend_score);
  const status = String(o.status ?? "");
  const matchReason = String(o.match_reason ?? "");
  const type = String(o.type ?? "");
  const title = String(o.title ?? "");
  const deadline = String(o.deadline ?? "");

  if (!url || !reasonableDomainPatterns.some((p) => p.test(url))) {
    allUrlOk = false;
    check(`机会 ${i + 1} official_source_url 指向合理域名`, false, `url=${url}`);
  }
  if (!validLevels.includes(level)) {
    allLevelValid = false;
    check(`机会 ${i + 1} visible_level 为 S/A/B/C 之一`, false, `level=${level}`);
  }
  if (!(score >= 0 && score <= 100)) {
    allScoreOk = false;
    check(`机会 ${i + 1} backend_score 为 0-100 数字`, false, `score=${score}`);
  }
  if (status !== "new") {
    allStatusNew = false;
    check(`机会 ${i + 1} status 为 new`, false, `status=${status}`);
  }
  if (!matchReason || !/苏婉清|文创|工作室|非遗/.test(matchReason)) {
    allMatchReasonOk = false;
    check(`机会 ${i + 1} match_reason 非空且含画像关键词`, false, `matchReason=${matchReason}`);
  }
  if (!culturalTypeKeywords.some((k) => type.includes(k))) {
    allTypeCultural = false;
    check(`机会 ${i + 1} type 与文创/非遗相关`, false, `type=${type}`);
  }
  if (forbiddenTypeKeywords.some((k) => type.includes(k))) {
    noForbiddenType = false;
    check(`机会 ${i + 1} type 不含学生类/虚拟展览/大会论坛`, false, `type=${type}`);
  }
  if (!title) {
    allTitleOk = false;
    check(`机会 ${i + 1} title 非空`, false);
  }
  if (!type) {
    allTypeOk = false;
    check(`机会 ${i + 1} type 非空`, false);
  }
  if (!deadline) {
    allDeadlineOk = false;
    check(`机会 ${i + 1} deadline 非空`, false);
  }

  if (level === "S" || level === "A") hasSA = true;

  // 分级与分数对应：90-100→S, 80-89→A, 65-79→B, 50-64→C
  let expectedLevel = "C";
  if (score >= 90) expectedLevel = "S";
  else if (score >= 80) expectedLevel = "A";
  else if (score >= 65) expectedLevel = "B";
  else if (score >= 50) expectedLevel = "C";
  else expectedLevel = "hidden";
  if (expectedLevel !== level) {
    allScoreLevelMatch = false;
    check(
      `机会 ${i + 1} 分级与分数对应（${level} / ${score}）`,
      false,
      `score=${score} 应对应 ${expectedLevel}，实际 ${level}`,
    );
  }
}

check("所有 official_source_url 指向合理域名", allUrlOk);
check("所有 visible_level 为 S/A/B/C 之一", allLevelValid);
check("所有 backend_score 为 0-100 数字", allScoreOk);
check("所有 status 为 new", allStatusNew);
check("所有 match_reason 非空且含画像关键词", allMatchReasonOk);
check("所有 type 与文创/非遗相关", allTypeCultural);
check("所有 type 不含学生类/虚拟展览/大会论坛", noForbiddenType);
check("所有 title 非空", allTitleOk);
check("所有 type 非空", allTypeOk);
check("所有 deadline 非空", allDeadlineOk);
check("visible_level 与 backend_score 对应（90-100→S, 80-89→A, 65-79→B, 50-64→C）", allScoreLevelMatch);
check("至少 1 条 S 或 A 级", hasSA);

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
console.log("\n=== 汇总 ===");
console.log(`PASS: ${passed}   FAIL: ${failed}`);
console.log("\n请另行执行：");
console.log("  npx tsc --noEmit   # TypeScript 编译无错误");
console.log("");

if (failed > 0) {
  process.exit(1);
}
