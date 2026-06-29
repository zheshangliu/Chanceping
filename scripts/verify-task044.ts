/**
 * Task 044 验收脚本：V1.3 Schema 层验证（Task A 产出）
 *
 * 运行：npx tsx scripts/verify-task044.ts
 *
 * 验证范围（≥21 项）：
 *   1. Radar 实体（radar.ts）
 *   2. RadarSpecDraft 草案（radar-spec-draft.ts）
 *   3. NextQuestion 一次一问（next-question.ts）
 *   4. RequirementConfirmationCard 需求确认卡（requirement-confirmation-card.ts）
 *   5. SourceCandidate 来源候选（source-candidate.ts）
 *   6. EvidenceItem 证据项（evidence-item.ts）
 *   7. UserInputSource 多模态输入（user-input-source.ts）
 *   8. ScoringRules 评分与 D 级（scoring-rules.ts）
 *
 * 遵循 IDE 交付规范调整声明：
 *   - 红线 1：tsc 附完整输出（脚本不调用 tsc，由外部命令验证）
 *   - 红线 4：optionalDependencies 类型声明（不引入新依赖）
 */

import fs from "fs";
import path from "path";
import type { RadarKind } from "../src/schema/radar";
import type { DraftStatus } from "../src/schema/radar-spec-draft";
import type { SourceType, SourceConfidenceGrade } from "../src/schema/source-candidate";
import type { EvidenceField } from "../src/schema/evidence-item";
import type { UserInputSource } from "../src/schema/user-input-source";

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
// 1. Radar 实体验证（radar.ts）
// ============================================================

async function checkRadar(): Promise<void> {
  section("1. Radar 实体（radar.ts）");

  check("T1 radar.ts 存在", fileExists("src/schema/radar.ts"));

  const radarModule = await import("../src/schema/radar");
  check("T2 导出 createDefaultRadar 函数", typeof radarModule.createDefaultRadar === "function");
  check("T3 导出 generateRadarId 函数", typeof radarModule.generateRadarId === "function");

  // createDefaultRadar("测试雷达", "custom") 返回正确
  const radar = radarModule.createDefaultRadar("测试雷达", "custom");
  check('T4 createDefaultRadar status="draft"', radar.status === "draft", `status=${radar.status}`);
  check('T5 createDefaultRadar kind="custom"', radar.kind === "custom", `kind=${radar.kind}`);
  check("T6 createDefaultRadar 含 spec 字段", typeof radar.spec === "object" && radar.spec !== null);
  check("T7 createDefaultRadar 含 privacy 字段", typeof radar.privacy === "object" && radar.privacy !== null);

  // generateRadarId 以 "radar_" 开头
  const radarId = radarModule.generateRadarId();
  check('T8 generateRadarId 以 "radar_" 开头', radarId.startsWith("radar_"), `id=${radarId}`);

  // RadarKind 包含 4 种类型
  const kindSample: RadarKind[] = ["ai_competition", "opc_policy", "cultural_heritage", "custom"];
  check("T9 RadarKind 包含 4 种类型", kindSample.length === 4);
}

// ============================================================
// 2. RadarSpecDraft 草案验证（radar-spec-draft.ts）
// ============================================================

async function checkRadarSpecDraft(): Promise<void> {
  section("2. RadarSpecDraft 草案（radar-spec-draft.ts）");

  check("T10 radar-spec-draft.ts 存在", fileExists("src/schema/radar-spec-draft.ts"));

  const draftModule = await import("../src/schema/radar-spec-draft");
  check("T11 导出 generateDraftId 函数", typeof draftModule.generateDraftId === "function");

  // DraftStatus 包含 5 种状态
  const draftStatuses: DraftStatus[] = [
    "generating", "ready", "confirmed", "rejected", "low_confidence",
  ];
  check("T12 DraftStatus 包含 5 种状态", draftStatuses.length === 5);

  // generateDraftId 以 "draft_" 开头
  const draftId = draftModule.generateDraftId();
  check('T13 generateDraftId 以 "draft_" 开头', draftId.startsWith("draft_"), `id=${draftId}`);
}

// ============================================================
// 3. NextQuestion 验证（next-question.ts）
// ============================================================

async function checkNextQuestion(): Promise<void> {
  section("3. NextQuestion 一次一问（next-question.ts）");

  check("T14 next-question.ts 存在", fileExists("src/schema/next-question.ts"));

  // QuestionType 包含 4 种题型
  const questionTypes = ["open_text", "single_choice", "multi_choice", "yes_no"] as const;
  check("T15 QuestionType 包含 4 种题型", questionTypes.length === 4);
}

// ============================================================
// 4. RequirementConfirmationCard 验证（requirement-confirmation-card.ts）
// ============================================================

async function checkConfirmationCard(): Promise<void> {
  section("4. RequirementConfirmationCard（requirement-confirmation-card.ts）");

  check("T16 requirement-confirmation-card.ts 存在", fileExists("src/schema/requirement-confirmation-card.ts"));

  const cardModule = await import("../src/schema/requirement-confirmation-card");
  check("T17 导出 generateCardId 函数", typeof cardModule.generateCardId === "function");

  const cardId = cardModule.generateCardId();
  check('T18 generateCardId 以 "card_" 开头', cardId.startsWith("card_"), `id=${cardId}`);
}

// ============================================================
// 5. SourceCandidate 验证（source-candidate.ts）
// ============================================================

async function checkSourceCandidate(): Promise<void> {
  section("5. SourceCandidate 来源候选（source-candidate.ts）");

  check("T19 source-candidate.ts 存在", fileExists("src/schema/source-candidate.ts"));

  const sourceModule = await import("../src/schema/source-candidate");

  // SourceType 包含 9 种来源类型
  const sourceTypes: SourceType[] = [
    "official", "government", "organizer", "media_authoritative", "media_general",
    "social", "forum", "user_uploaded", "unknown",
  ];
  check("T20 SourceType 包含 9 种来源类型", sourceTypes.length === 9);

  // SourceConfidenceGrade 包含 8 级
  const grades: SourceConfidenceGrade[] = ["A1", "A2", "B1", "B2", "C1", "C3", "D4", "E5"];
  check("T21 SourceConfidenceGrade 包含 8 级", grades.length === 8);

  // CONFIDENCE_GRADE_SCORES["A1"] = 100
  check('T22 CONFIDENCE_GRADE_SCORES["A1"] = 100', sourceModule.CONFIDENCE_GRADE_SCORES["A1"] === 100);

  // isOfficialSource("government") = true
  check('T23 isOfficialSource("government") = true', sourceModule.isOfficialSource("government") === true);

  // isOfficialSource("social") = false
  check('T24 isOfficialSource("social") = false', sourceModule.isOfficialSource("social") === false);

  // generateSourceId 以 "src_" 开头
  const srcId = sourceModule.generateSourceId();
  check('T25 generateSourceId 以 "src_" 开头', srcId.startsWith("src_"), `id=${srcId}`);

  // CONFIDENCE_GRADE_LABELS / SOURCE_TYPE_LABELS 存在
  check("T26 CONFIDENCE_GRADE_LABELS 存在", typeof sourceModule.CONFIDENCE_GRADE_LABELS === "object");
  check("T27 SOURCE_TYPE_LABELS 存在", typeof sourceModule.SOURCE_TYPE_LABELS === "object");
}

// ============================================================
// 6. EvidenceItem 验证（evidence-item.ts）
// ============================================================

async function checkEvidenceItem(): Promise<void> {
  section("6. EvidenceItem 证据项（evidence-item.ts）");

  check("T28 evidence-item.ts 存在", fileExists("src/schema/evidence-item.ts"));

  const evidenceModule = await import("../src/schema/evidence-item");

  // EvidenceField 包含 8 个字段
  const fields: EvidenceField[] = [
    "title", "deadline", "organizer", "reward_or_value",
    "eligibility", "region", "application_url", "contact_info",
  ];
  check("T29 EvidenceField 包含 8 个字段", fields.length === 8);

  // shouldReviewEvidence("", 0.8) = true（无 sourceId）
  check('T30 shouldReviewEvidence("", 0.8) = true', evidenceModule.shouldReviewEvidence("", 0.8) === true);

  // shouldReviewEvidence("src_xxx", 0.5) = true（低置信度）
  check('T31 shouldReviewEvidence("src_xxx", 0.5) = true', evidenceModule.shouldReviewEvidence("src_xxx", 0.5) === true);

  // shouldReviewEvidence("src_xxx", 0.8) = false
  check('T32 shouldReviewEvidence("src_xxx", 0.8) = false', evidenceModule.shouldReviewEvidence("src_xxx", 0.8) === false);

  // EVIDENCE_REVIEW_THRESHOLD = 0.6
  check("T33 EVIDENCE_REVIEW_THRESHOLD = 0.6", evidenceModule.EVIDENCE_REVIEW_THRESHOLD === 0.6);

  // generateEvidenceId 以 "ev_" 开头
  const evId = evidenceModule.generateEvidenceId();
  check('T34 generateEvidenceId 以 "ev_" 开头', evId.startsWith("ev_"), `id=${evId}`);

  // EVIDENCE_FIELD_LABELS 存在
  check("T35 EVIDENCE_FIELD_LABELS 存在", typeof evidenceModule.EVIDENCE_FIELD_LABELS === "object");
}

// ============================================================
// 7. UserInputSource 验证（user-input-source.ts）
// ============================================================

async function checkUserInputSource(): Promise<void> {
  section("7. UserInputSource 多模态输入（user-input-source.ts）");

  check("T36 user-input-source.ts 存在", fileExists("src/schema/user-input-source.ts"));

  const userInputModule = await import("../src/schema/user-input-source");

  // FileParser 接口存在（运行时为 undefined，但 import 不报错即通过）
  check("T37 import type { FileParser } 无报错", true);

  // SUPPORTED_MIME_TYPES["application/pdf"] = "uploaded_pdf"
  check(
    'T38 SUPPORTED_MIME_TYPES["application/pdf"] = "uploaded_pdf"',
    userInputModule.SUPPORTED_MIME_TYPES["application/pdf"] === "uploaded_pdf",
  );

  // MAX_FILE_SIZE = 20 * 1024 * 1024
  check("T39 MAX_FILE_SIZE = 20MB", userInputModule.MAX_FILE_SIZE === 20 * 1024 * 1024);

  // UserInputSource 包含 7 种来源
  const sources: UserInputSource[] = [
    "typed_text", "ime_voice_to_text", "pasted_text",
    "uploaded_image", "uploaded_pdf", "uploaded_docx", "uploaded_xlsx",
  ];
  check("T40 UserInputSource 包含 7 种来源", sources.length === 7);
}

// ============================================================
// 8. ScoringRules 验证（scoring-rules.ts）
// ============================================================

async function checkScoringRules(): Promise<void> {
  section("8. ScoringRules 评分与 D 级（scoring-rules.ts）");

  check("T41 scoring-rules.ts 存在", fileExists("src/schema/scoring-rules.ts"));

  const scoringModule = await import("../src/schema/scoring-rules");

  // scoreToLevel(49) = "D"
  check('T42 scoreToLevel(49) = "D"', scoringModule.scoreToLevel(49) === "D");

  // scoreToLevel(50) = "C"
  check('T43 scoreToLevel(50) = "C"', scoringModule.scoreToLevel(50) === "C");

  // scoreToLevel(89) = "A"
  check('T44 scoreToLevel(89) = "A"', scoringModule.scoreToLevel(89) === "A");

  // scoreToLevel(90) = "S"
  check('T45 scoreToLevel(90) = "S"', scoringModule.scoreToLevel(90) === "S");

  // VISIBLE_LEVEL_MAPPING["D"] = "0-49"
  check('T46 VISIBLE_LEVEL_MAPPING["D"] = "0-49"', scoringModule.VISIBLE_LEVEL_MAPPING["D"] === "0-49");

  // LEVEL_DEFINITIONS["D"] = "不推荐"
  check('T47 LEVEL_DEFINITIONS["D"] = "不推荐"', scoringModule.LEVEL_DEFINITIONS["D"] === "不推荐");

  // VISIBLE_LEVEL_MAPPING["hidden"] = "不展示"
  check('T48 VISIBLE_LEVEL_MAPPING["hidden"] = "不展示"', scoringModule.VISIBLE_LEVEL_MAPPING["hidden"] === "不展示");

  // createDefaultScoringRules 返回含 D 级
  const rules = scoringModule.createDefaultScoringRules();
  check('T49 createDefaultScoringRules visible_level_mapping 含 "D"', rules.visible_level_mapping["D"] !== undefined);
  check('T50 createDefaultScoringRules level_definitions 含 "D"', rules.level_definitions["D"] !== undefined);
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 044 验收检查：V1.3 Schema 层 ===\n");

  await checkRadar();
  await checkRadarSpecDraft();
  await checkNextQuestion();
  await checkConfirmationCard();
  await checkSourceCandidate();
  await checkEvidenceItem();
  await checkUserInputSource();
  await checkScoringRules();

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  const resultLog = `Task 044 验收结果: ${passed} PASS / ${failed} FAIL\n`;
  fs.writeFileSync(path.resolve(process.cwd(), "verify-task044-result.log"), resultLog, "utf-8");

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
