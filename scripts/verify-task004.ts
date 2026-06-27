/**
 * Task 004 验收脚本
 *
 * 运行：npx tsx scripts/verify-task004.ts
 * 覆盖验收标准：
 *   - 报告结构完整性（标题 / 周期 / 雷达版本 / 目标用户 / 报告时间 / Section 0-9 / 本周结论 / 四问）
 *   - 机会卡片完整性（数量 / 字段 / 分级 / 评分对应 / 政府域名 / 政策类型 / 大型企业排除）
 *   - 筛选规则执行（不建议投入的机会 section 至少 1 条被排除）
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

const reportPath = path.join(__dirname, "..", "reports", "opc-policy-radar-v0.1.md");
const jsonPath = path.join(__dirname, "..", "data", "samples", "opc-policy-opportunities.json");

console.log("\n=== Task 004 验收检查 ===\n");

// ---------------------------------------------------------------------------
// 检查 1：报告结构完整性
// ---------------------------------------------------------------------------
console.log("[检查 1] 报告结构完整性");
const report = fs.readFileSync(reportPath, "utf-8");

const expectedTitlePrefix = `${BRAND.product_name}｜本周 OPC 政策雷达报告`;
const firstLine = report.split("\n")[0].trim();
check(
  "标题首行以「品牌名｜本周 OPC 政策雷达报告」开头",
  firstLine.startsWith(`# ${expectedTitlePrefix}`) || firstLine.startsWith(expectedTitlePrefix),
  `实际首行：${firstLine}`,
);

check("包含「周期：」", report.includes("周期："));
check("包含「雷达版本：V0.12」", report.includes("雷达版本：V0.12"));
check("包含「目标用户：」", report.includes("目标用户："));
check("包含「报告生成时间：」", report.includes("报告生成时间："));

// 检查 ## 0. 到 ## 9. 全部 10 节
for (let i = 0; i <= 9; i++) {
  check(`包含「## ${i}.」节`, report.includes(`## ${i}.`));
}

check("包含「## 本周结论」", report.includes("## 本周结论"));
check("包含「最值得优先行动」", report.includes("最值得优先行动"));
check("包含「最适合保存观察」", report.includes("最适合保存观察"));
check("包含「最需要人工复核」", report.includes("最需要人工复核"));
check("包含「下周最应该继续追踪」", report.includes("下周最应该继续追踪"));

// 检查"不建议投入的机会" section 至少有 1 条被排除机会
const section7Start = report.indexOf("## 7. 不建议投入的机会");
const section8Start = report.indexOf("## 8. 下周继续追踪");
const section7Content =
  section7Start >= 0 && section8Start > section7Start ? report.substring(section7Start, section8Start) : "";
const excludeCount = (section7Content.match(/### 排除项/g) || []).length;
check(
  `「不建议投入的机会」section 至少有 1 条被排除机会（实际 ${excludeCount} 条）`,
  excludeCount >= 1,
);

// ---------------------------------------------------------------------------
// 检查 2：JSON 机会数据完整性
// ---------------------------------------------------------------------------
console.log("\n[检查 2] JSON 机会数据完整性");
const jsonText = fs.readFileSync(jsonPath, "utf-8");
const opportunities = JSON.parse(jsonText) as Array<Record<string, unknown>>;

check(`机会数量 ≥6（实际 ${opportunities.length}）`, opportunities.length >= 6);

// 政策补贴相关的 type 关键词（与 04 号文档第 2.3 节重点机会类型对齐）
const policyTypeKeywords = [
  "补贴",
  "资助",
  "政策",
  "项目",
  "大赛",
  "专项",
  "扶持",
  "评价",
  "入库",
  "创业",
  "社保",
  "人才",
  "场地",
  "科技型",
  "大湾区",
  "数字经济",
  "AI",
];

// 仅限大型企业的关键词（出现则视为不适合一人公司）
const largeEnterpriseKeywords = ["50 人以上", "大型企业", "规模以上"];

// match_reason 必须包含的用户画像关键词之一
const matchReasonKeywords = ["林晓薇", "一人公司", "广州", "AI 创业"];

let hasSorA = false;

for (let i = 0; i < opportunities.length; i++) {
  const opp = opportunities[i];
  const title = String(opp.title ?? "");
  const type = String(opp.type ?? "");
  const deadline = String(opp.deadline ?? "");
  const matchReason = String(opp.match_reason ?? "");
  const officialUrl = String(opp.official_source_url ?? "");
  const visibleLevel = String(opp.visible_level ?? "");
  const backendScore = opp.backend_score;
  const status = String(opp.status ?? "");
  const eligibility = String(opp.eligibility ?? "");

  check(`机会 ${i + 1} title 非空`, title.length > 0);
  check(`机会 ${i + 1} type 非空`, type.length > 0);
  check(`机会 ${i + 1} deadline 非空`, deadline.length > 0);
  check(`机会 ${i + 1} official_source_url 非空`, officialUrl.length > 0, `实际：${officialUrl}`);
  check(
    `机会 ${i + 1} visible_level 为 S/A/B/C 之一`,
    ["S", "A", "B", "C"].includes(visibleLevel),
    `实际：${visibleLevel}`,
  );
  check(
    `机会 ${i + 1} backend_score 为 0-100 的数字`,
    typeof backendScore === "number" && backendScore >= 0 && backendScore <= 100,
    `实际：${String(backendScore)}`,
  );
  check(`机会 ${i + 1} status 为 new`, status === "new", `实际：${status}`);
  check(`机会 ${i + 1} match_reason 非空`, matchReason.length > 0);
  check(
    `机会 ${i + 1} match_reason 包含「林晓薇/一人公司/广州/AI 创业」之一`,
    matchReasonKeywords.some((k) => matchReason.includes(k)),
  );

  // visible_level 与 backend_score 对应（90-100→S, 80-89→A, 65-79→B, 50-64→C）
  let expectedLevel = "";
  if (typeof backendScore === "number") {
    if (backendScore >= 90 && backendScore <= 100) expectedLevel = "S";
    else if (backendScore >= 80 && backendScore <= 89) expectedLevel = "A";
    else if (backendScore >= 65 && backendScore <= 79) expectedLevel = "B";
    else if (backendScore >= 50 && backendScore <= 64) expectedLevel = "C";
  }
  check(
    `机会 ${i + 1} visible_level(${visibleLevel}) 与 backend_score(${String(backendScore)}) 对应`,
    visibleLevel === expectedLevel,
    `期望：${expectedLevel}`,
  );

  // official_source_url 指向真实政府域名
  const isGovUrl = /\.gov\.cn/.test(officialUrl);
  check(`机会 ${i + 1} official_source_url 指向政府域名(.gov.cn)`, isGovUrl, `实际：${officialUrl}`);

  // type 与政策补贴相关
  const isPolicyRelated = policyTypeKeywords.some((k) => type.includes(k));
  check(`机会 ${i + 1} type(${type}) 与政策补贴相关`, isPolicyRelated);

  // 不包含仅限大型企业的政策
  const isLargeEnterpriseOnly = largeEnterpriseKeywords.some((k) => eligibility.includes(k));
  check(`机会 ${i + 1} 不包含仅限大型企业的政策`, !isLargeEnterpriseOnly);

  if (visibleLevel === "S" || visibleLevel === "A") hasSorA = true;
}

check(`至少 1 条 S 或 A 级机会`, hasSorA);

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
