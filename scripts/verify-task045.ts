/**
 * Task 045 验收脚本：一次一问 + 长文本整理 + 确认卡（Task B 产出）
 *
 * 运行：npx tsx scripts/verify-task045.ts
 *
 * 验证项（≥17 项）：
 *   1. QuestionPlanner 选问引擎（9 项）
 *   2. normalizeUserInput 长文本整理（5 项）
 *   3. generateConfirmationCard 确认卡（4 项）
 *
 * 遵循 IDE 交付规范调整声明：
 *   - 红线 1：tsc 附完整输出（脚本不调用 tsc，由外部命令验证）
 *   - 红线 4：optionalDependencies 类型声明（不引入新依赖）
 */

import fs from "fs";
import path from "path";

// ============================================================
// 计数器
// ============================================================

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

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.resolve(process.cwd(), relPath));
}

// ============================================================
// 1. QuestionPlanner 单元测试
// ============================================================

async function checkQuestionPlanner(): Promise<void> {
  section("1. QuestionPlanner 选问引擎");

  check("T1 question-planner.ts 存在", fileExists("src/agents/question-planner.ts"));

  const { QuestionPlanner, MAX_TURNS, CONFIRM_THRESHOLD, LOW_CONFIDENCE_THRESHOLD } =
    await import("../src/agents/question-planner");
  const { createDefaultConfidence } = await import("../src/schema/requirement-confidence");

  // 可实例化
  const planner = new QuestionPlanner("ai_competition");
  check('T2 new QuestionPlanner("ai_competition") 可实例化', planner instanceof QuestionPlanner);

  // selectNextQuestion 返回 NextQuestion
  const conf = createDefaultConfidence();
  const q = planner.selectNextQuestion(conf);
  check("T3 selectNextQuestion 返回 NextQuestion", q !== null && q !== undefined);
  if (q) {
    check("T3.1 NextQuestion 含 question 字段", typeof q.question === "string" && q.question.length > 0);
    check("T3.2 NextQuestion 含 questionType 字段",
      ["open_text", "single_choice", "multi_choice", "yes_no"].includes(q.questionType));
    check("T3.3 NextQuestion 含 targetDimension 字段", typeof q.targetDimension === "string");
  }

  // 连续调用 7 次，第 7 次返回 null（共 7 个维度）
  const planner2 = new QuestionPlanner("general");
  const conf2 = createDefaultConfidence();
  for (let i = 0; i < 7; i++) {
    const qq = planner2.selectNextQuestion(conf2);
    if (qq === null) {
      // 提前返回 null 也算通过
      break;
    }
  }
  const q7 = planner2.selectNextQuestion(conf2);
  check("T4 selectNextQuestion 所有维度问完后返回 null", q7 === null, `q7=${q7?.question ?? "null"}`);

  // shouldGenerateDraft({total:95}, 3) → {should:true, isLowConfidence:false}
  const d1 = planner.shouldGenerateDraft({ ...createDefaultConfidence(), total: 95 }, 3);
  check("T5 shouldGenerateDraft total=95 turnCount=3 → should=true isLowConfidence=false",
    d1.should === true && d1.isLowConfidence === false, `decision=${JSON.stringify(d1)}`);

  // shouldGenerateDraft({total:75}, 7) → {should:true, isLowConfidence:true}
  const d2 = planner.shouldGenerateDraft({ ...createDefaultConfidence(), total: 75 }, 7);
  check("T6 shouldGenerateDraft total=75 turnCount=7 → should=true isLowConfidence=true",
    d2.should === true && d2.isLowConfidence === true, `decision=${JSON.stringify(d2)}`);

  // shouldGenerateDraft({total:60}, 7) → {should:false, isLowConfidence:false}
  const d3 = planner.shouldGenerateDraft({ ...createDefaultConfidence(), total: 60 }, 7);
  check("T7 shouldGenerateDraft total=60 turnCount=7 → should=false",
    d3.should === false && d3.isLowConfidence === false, `decision=${JSON.stringify(d3)}`);

  // shouldGenerateDraft({total:80}, 3) → {should:false, isLowConfidence:false}
  const d4 = planner.shouldGenerateDraft({ ...createDefaultConfidence(), total: 80 }, 3);
  check("T8 shouldGenerateDraft total=80 turnCount=3 → should=false",
    d4.should === false && d4.isLowConfidence === false, `decision=${JSON.stringify(d4)}`);

  // getMaxTurns() = 6
  check("T9 getMaxTurns() 返回 6", planner.getMaxTurns() === 6);

  // 常量检查
  check("T9.1 MAX_TURNS=6", MAX_TURNS === 6);
  check("T9.2 CONFIRM_THRESHOLD=90", CONFIRM_THRESHOLD === 90);
  check("T9.3 LOW_CONFIDENCE_THRESHOLD=70", LOW_CONFIDENCE_THRESHOLD === 70);
}

// ============================================================
// 2. normalizeUserInput 单元测试
// ============================================================

async function checkNormalizeUserInput(): Promise<void> {
  section("2. normalizeUserInput 长文本整理");

  check("T10 normalize-user-input.ts 存在", fileExists("src/agents/normalize-user-input.ts"));

  const { normalizeUserInput, LONG_TEXT_THRESHOLD } = await import("../src/agents/normalize-user-input");

  // 短文本（≤50 字）wasNormalized = false
  const r1 = normalizeUserInput("帮我盯比赛");
  check("T11 短文本 wasNormalized=false", r1.wasNormalized === false, `wasNormalized=${r1.wasNormalized}`);

  // 长文本（>50 字）wasNormalized = true
  const longText = "我是做AI产品的帮我盯比赛就是那种大厂办的比较有含金量的我想找比赛就是AI比赛最好AI相关";
  const r2 = normalizeUserInput(longText);
  check("T12 长文本 wasNormalized=true", r2.wasNormalized === true, `wasNormalized=${r2.wasNormalized}, len=${longText.length}`);

  // QWAN → Qwen 修正
  const r3 = normalizeUserInput("我是做QWAN产品的帮我盯比赛就是那种大厂办的比较有含金量的我想找比赛就是AI比赛最好AI相关");
  check("T13 修正 QWAN → Qwen",
    r3.correctedTypos.some((t) => t.includes("QWAN") && t.includes("Qwen")),
    `typos=${r3.correctedTypos.join("|")}`);
  check("T13.1 normalizedText 含 Qwen", r3.normalizedText.includes("Qwen"));

  // 长文本被断句
  check("T14 长文本被断句（含逗号或句号）",
    r2.normalizedText.includes("，") || r2.normalizedText.includes("。"),
    `normalizedText=${r2.normalizedText.slice(0, 80)}`);

  // 口语化"大厂办的"被检测
  check("T15 检测口语化'大厂办的'",
    r2.detectedColloquialisms.includes("主办方权威"),
    `colloquialisms=${r2.detectedColloquialisms.join("|")}`);

  // 阈值检查
  check("T15.1 LONG_TEXT_THRESHOLD=50", LONG_TEXT_THRESHOLD === 50);
}

// ============================================================
// 3. generateConfirmationCard 单元测试
// ============================================================

async function checkConfirmationCard(): Promise<void> {
  section("3. generateConfirmationCard 确认卡");

  check("T16 requirement-card-generator.ts 存在", fileExists("src/agents/requirement-card-generator.ts"));

  const { generateConfirmationCard, CONFIRM_THRESHOLD, LOW_CONFIDENCE_THRESHOLD, MAX_TURNS } =
    await import("../src/agents/requirement-card-generator");
  const { createDefaultConfidence } = await import("../src/schema/requirement-confidence");
  const { createEmptyExtractedInfo } = await import("../src/schema/extracted-requirement-info");

  // 正常确认度（≥90%）isLowConfidence = false
  const conf1 = { ...createDefaultConfidence(), total: 95 };
  const card1 = generateConfirmationCard("conv_test_1", conf1, createEmptyExtractedInfo(), 3);
  check("T17 正常确认度 isLowConfidence=false",
    card1.isLowConfidence === false, `isLowConfidence=${card1.isLowConfidence}`);

  // 低置信度（6 轮 + 70-89）isLowConfidence = true
  const conf2 = { ...createDefaultConfidence(), total: 75 };
  const card2 = generateConfirmationCard("conv_test_2", conf2, createEmptyExtractedInfo(), 6);
  check("T18 低置信度 isLowConfidence=true",
    card2.isLowConfidence === true, `isLowConfidence=${card2.isLowConfidence}`);

  // 6 轮 + 90+ 仍为正式卡
  const conf3 = { ...createDefaultConfidence(), total: 90 };
  const card3 = generateConfirmationCard("conv_test_3", conf3, createEmptyExtractedInfo(), 6);
  check("T19 total=90 turnCount=6 isLowConfidence=false",
    card3.isLowConfidence === false, `isLowConfidence=${card3.isLowConfidence}`);

  // summary ≤ 200 字
  check("T20 summary ≤ 200 字", card1.summary.length <= 200, `len=${card1.summary.length}`);

  // 常量检查
  check("T20.1 CONFIRM_THRESHOLD=90", CONFIRM_THRESHOLD === 90);
  check("T20.2 LOW_CONFIDENCE_THRESHOLD=70", LOW_CONFIDENCE_THRESHOLD === 70);
  check("T20.3 MAX_TURNS=6", MAX_TURNS === 6);
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 045 验收检查：一次一问 + 长文本整理 ===\n");

  await checkQuestionPlanner();
  await checkNormalizeUserInput();
  await checkConfirmationCard();

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  const resultLog = `Task 045 验收结果: ${passed} PASS / ${failed} FAIL\n`;
  fs.writeFileSync(path.resolve(process.cwd(), "verify-task045-result.log"), resultLog, "utf-8");

  if (failed > 0) {
    console.log("\n❌ 存在失败项，请修复后重试");
    process.exitCode = 1;
  } else {
    console.log("\n✓ 全部通过");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error("执行失败：", err);
  process.exitCode = 1;
});
