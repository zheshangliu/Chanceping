/**
 * Task 003 验收脚本：AI 赛事雷达样板报告
 *
 * 运行：npx tsx scripts/verify-task003.ts
 * 覆盖验收标准：
 *   - 报告结构完整性（标题 / 周期 / 雷达版本 / 10 节 / 本周结论四问）
 *   - 机会卡片完整性（JSON 数量 / 字段 / 分级 / 分数对应 / 链接域名）
 *   - 筛选规则执行（不建议投入 section / AI 赛事类型 / 无 K12 政府采购）
 *   - 链接有效性（official_source_url 指向真实平台域名）
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

// 真实平台域名白名单（official_source_url 必须命中其一）
const REAL_DOMAINS = [
  "devpost.com",
  "itch.io",
  "kaggle.com",
  "github.com",
  "huggingface.co",
  "hackerearth.com",
];

// 被排除类型关键词（不应出现在推荐机会中）
const EXCLUDED_KEYWORDS = ["K12", "少儿", "青少年", "政府采购", "招投标", "招标"];

// 分数与等级对应校验
function scoreMatchesLevel(score: number, level: string): boolean {
  if (score >= 90 && score <= 100) return level === "S";
  if (score >= 80 && score <= 89) return level === "A";
  if (score >= 65 && score <= 79) return level === "B";
  if (score >= 50 && score <= 64) return level === "C";
  return false;
}

// 域名是否命中真实平台白名单
function isRealDomain(url: string): boolean {
  return REAL_DOMAINS.some((d) => url.includes(d));
}

console.log("\n=== Task 003 验收检查 ===\n");

// ---------------------------------------------------------------------------
// 读取报告与 JSON
// ---------------------------------------------------------------------------
const reportPath = path.join(__dirname, "..", "reports", "ai-competition-radar-v0.1.md");
const jsonPath = path.join(__dirname, "..", "data", "samples", "ai-competition-opportunities.json");

const report = fs.readFileSync(reportPath, "utf-8");
const opportunities = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Array<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// 1. 报告结构完整性
// ---------------------------------------------------------------------------
console.log("[验收 1] 报告结构完整性");

const expectedTitlePrefix = `${BRAND.product_name}｜本周 AI 赛事雷达报告`;
const firstLine = report.split("\n")[0].trim();
const titleText = firstLine.replace(/^#+\s*/, "");
check(
  `标题以「${BRAND.product_name}｜本周 AI 赛事雷达报告」开头`,
  titleText.startsWith(expectedTitlePrefix),
  `实际标题：${titleText}`
);
check('包含「周期：」', report.includes("周期："));
check('包含「雷达版本：V0.12」', report.includes("雷达版本：V0.12"));
check('包含「目标用户：」', report.includes("目标用户："));
check('包含「报告生成时间：」', report.includes("报告生成时间："));

// 10 节结构
const sections = [
  "## 0. 本周一句话判断",
  "## 1. 本周 S 级机会",
  "## 2. 本周 A 级机会",
  "## 3. 本周 B 级机会",
  "## 4. 即将截止机会",
  "## 5. 机会详情卡片",
  "## 6. 本周建议行动",
  "## 7. 不建议投入的机会",
  "## 8. 下周继续追踪",
  "## 9. 信息源与人工复核清单",
];
for (const s of sections) {
  check(`包含「${s}」`, report.includes(s));
}
check('包含「## 本周结论」', report.includes("## 本周结论"));

// 结论四问
check('包含「最值得优先行动」', report.includes("最值得优先行动"));
check('包含「最适合保存观察」', report.includes("最适合保存观察"));
check('包含「最需要人工复核」', report.includes("最需要人工复核"));
check('包含「下周最应该继续追踪」', report.includes("下周最应该继续追踪"));

// ---------------------------------------------------------------------------
// 2. 「不建议投入的机会」section 至少 1 条被排除机会
// ---------------------------------------------------------------------------
console.log("\n[验收 2] 不建议投入的机会 section");
const section7Match = report.match(/## 7\. 不建议投入的机会[\s\S]*?(?=## 8\.)/);
const section7 = section7Match ? section7Match[0] : "";
const excludeCount = (section7.match(/排除原因/g) || []).length;
check(`section 7 至少 1 条被排除机会（排除原因出现 ${excludeCount} 次）`, excludeCount >= 1, `实际 ${excludeCount} 次`);

// ---------------------------------------------------------------------------
// 3. 机会卡片完整性（JSON）
// ---------------------------------------------------------------------------
console.log("\n[验收 3] 机会卡片完整性（JSON）");
check(`机会数量 ≥6（实际 ${opportunities.length}）`, opportunities.length >= 6);

let allUrlNonEmpty = true;
let allLevelValid = true;
let allScoreValid = true;
let allStatusNew = true;
let allTitleTypeDeadlineNonEmpty = true;
let allMatchReasonValid = true;
let allScoreLevelMatch = true;
let allRealDomain = true;
let allTypeAiRelated = true;
let noExcludedType = true;
let hasSorA = false;

for (let i = 0; i < opportunities.length; i++) {
  const o = opportunities[i];
  const idx = `[${i}] ${String(o.title)}`;

  if (typeof o.official_source_url !== "string" || o.official_source_url.trim() === "") {
    allUrlNonEmpty = false;
    console.log(`    FAIL  ${idx} official_source_url 为空`);
  }
  if (!["S", "A", "B", "C"].includes(o.visible_level as string)) {
    allLevelValid = false;
    console.log(`    FAIL  ${idx} visible_level 非法：${o.visible_level}`);
  }
  if (typeof o.backend_score !== "number" || o.backend_score < 0 || o.backend_score > 100) {
    allScoreValid = false;
    console.log(`    FAIL  ${idx} backend_score 非法：${o.backend_score}`);
  }
  if (o.status !== "new") {
    allStatusNew = false;
    console.log(`    FAIL  ${idx} status 非 new：${o.status}`);
  }
  if (
    typeof o.title !== "string" || o.title.trim() === "" ||
    typeof o.type !== "string" || o.type.trim() === "" ||
    typeof o.deadline !== "string" || o.deadline.trim() === ""
  ) {
    allTitleTypeDeadlineNonEmpty = false;
    console.log(`    FAIL  ${idx} title/type/deadline 存在空值`);
  }
  const mr = typeof o.match_reason === "string" ? o.match_reason : "";
  if (mr.trim() === "" || !mr.includes("陈启明") && !mr.includes("AI 游戏") && !mr.includes("独立开发者")) {
    allMatchReasonValid = false;
    console.log(`    FAIL  ${idx} match_reason 不含「陈启明 / AI 游戏 / 独立开发者」`);
  }
  if (!scoreMatchesLevel(o.backend_score as number, o.visible_level as string)) {
    allScoreLevelMatch = false;
    console.log(`    FAIL  ${idx} score=${o.backend_score} 与 level=${o.visible_level} 不对应`);
  }
  if (typeof o.official_source_url === "string" && !isRealDomain(o.official_source_url)) {
    allRealDomain = false;
    console.log(`    FAIL  ${idx} official_source_url 非真实平台域名：${o.official_source_url}`);
  }
  const tp = typeof o.type === "string" ? o.type : "";
  if (!tp.includes("AI") || !tp.includes("赛事") && !tp.includes("游戏") && !tp.includes("应用") && !tp.includes("智能体")) {
    allTypeAiRelated = false;
    console.log(`    FAIL  ${idx} type 与 AI 赛事不相关：${tp}`);
  }
  const textForExclude = `${o.title} ${o.type} ${o.organizer}`;
  for (const kw of EXCLUDED_KEYWORDS) {
    if (textForExclude.includes(kw)) {
      noExcludedType = false;
      console.log(`    FAIL  ${idx} 含被排除关键词「${kw}」`);
    }
  }
  if (o.visible_level === "S" || o.visible_level === "A") {
    hasSorA = true;
  }
}

check("所有 official_source_url 非空", allUrlNonEmpty);
check("所有 visible_level 为 S/A/B/C", allLevelValid);
check("所有 backend_score 为 0-100 数字", allScoreValid);
check('所有 status 为 "new"', allStatusNew);
check("所有 title/type/deadline 非空", allTitleTypeDeadlineNonEmpty);
check('所有 match_reason 非空且含「陈启明 / AI 游戏 / 独立开发者」', allMatchReasonValid);
check("所有 visible_level 与 backend_score 对应", allScoreLevelMatch);
check("所有 official_source_url 指向真实平台域名", allRealDomain);
check("所有 type 与 AI 赛事相关", allTypeAiRelated);
check("不含 K12 / 政府采购等被排除类型", noExcludedType);
check("至少 1 条 S 或 A 级机会", hasSorA);

// ---------------------------------------------------------------------------
// 4. 汇总
// ---------------------------------------------------------------------------
console.log("\n=== 汇总 ===");
console.log(`PASS: ${passed}   FAIL: ${failed}`);
console.log("\n请另行执行：");
console.log("  npx tsc --noEmit   # TypeScript 编译无错误");
console.log("");

if (failed > 0) {
  process.exit(1);
}
