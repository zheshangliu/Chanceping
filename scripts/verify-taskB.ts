/**
 * Task B 验收脚本：一次一问需求确认 + 长文本整理
 *
 * 运行：npx tsx scripts/verify-taskB.ts
 *
 * 验证项：
 *   1. 文件存在性检查（3 新建 + 4 改造）
 *   2. QuestionPlanner 单元测试（7 项）
 *   3. normalizeUserInput 单元测试（6 项）
 *   4. RequirementCardGenerator 单元测试（4 项）
 *   5. ConversationManager 集成测试（6 项）
 *   6. API 测试（5 项）
 *   7. 兼容性验证（3 项）
 *   8. 安全红线（4 项）
 *   9. 回归测试（7 项，可通过 SKIP_REGRESSION=1 跳过）
 *
 * 遵循 IDE 交付规范调整声明：
 *   - 红线 1：tsc 附完整输出
 *   - 红线 2：PASS 正则取最后一个匹配（matchAll）
 *   - 红线 5：回归测试范围与任务书一致
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.PORT = "3997";
process.env.STORE_TYPE = "meili";
process.env.MEILI_MOCK = "true";

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

function readFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.resolve(process.cwd(), relPath));
}

// ============================================================
// 1. 文件存在性检查
// ============================================================

function checkFileExistence(): void {
  section("1. 文件存在性检查");

  // 3 个新建文件
  check("B1 src/agents/question-planner.ts 存在", fileExists("src/agents/question-planner.ts"));
  check("B2 src/agents/normalize-user-input.ts 存在", fileExists("src/agents/normalize-user-input.ts"));
  check("B3 src/agents/requirement-card-generator.ts 存在", fileExists("src/agents/requirement-card-generator.ts"));

  // 4 个改造文件
  check("B4 src/agents/conversation-turn-output.ts 存在", fileExists("src/agents/conversation-turn-output.ts"));
  check("B5 src/agents/conversation-manager.ts 存在", fileExists("src/agents/conversation-manager.ts"));
  check("B6 src/api/routes/chat.ts 存在", fileExists("src/api/routes/chat.ts"));
  check("B7 web/requirement-chat.js 存在", fileExists("web/requirement-chat.js"));
}

// ============================================================
// 2. QuestionPlanner 单元测试
// ============================================================

async function checkQuestionPlanner(): Promise<void> {
  section("2. QuestionPlanner 单元测试");

  const { QuestionPlanner, MAX_TURNS, CONFIRM_THRESHOLD, LOW_CONFIDENCE_THRESHOLD } =
    await import("../src/agents/question-planner");
  const { createDefaultConfidence } = await import("../src/schema/requirement-confidence");
  type Conf = ReturnType<typeof createDefaultConfidence>;

  // T1: selectNextQuestion 返回 priority 最高的未问维度的问题
  const planner1 = new QuestionPlanner("ai_competition");
  const conf1 = createDefaultConfidence();
  const q1 = planner1.selectNextQuestion(conf1);
  check("T1 selectNextQuestion 返回 NextQuestion", q1 !== null && q1 !== undefined);
  check("T1.1 NextQuestion 含 question 字段", !!q1 && typeof q1.question === "string" && q1.question.length > 0);
  check("T1.2 NextQuestion 含 questionType 字段", !!q1 && ["open_text", "single_choice", "multi_choice", "yes_no"].includes(q1.questionType));
  check("T1.3 NextQuestion 含 targetDimension 字段", !!q1 && typeof q1.targetDimension === "string");

  // T2: selectNextQuestion 返回 null（所有维度都已问过）
  const planner2 = new QuestionPlanner("general");
  const conf2 = createDefaultConfidence();
  // 调用 7 次覆盖所有维度
  for (let i = 0; i < 7; i++) {
    planner2.selectNextQuestion(conf2);
  }
  const q2 = planner2.selectNextQuestion(conf2);
  check("T2 所有维度问过后 selectNextQuestion 返回 null", q2 === null, `q2=${q2?.question ?? "null"}`);

  // T3: shouldGenerateDraft total >= 90 → { should: true, isLowConfidence: false }
  const planner3 = new QuestionPlanner("ai_competition");
  const conf3: Conf = { ...createDefaultConfidence(), total: 95 };
  const d3 = planner3.shouldGenerateDraft(conf3, 3);
  check("T3 total>=90 → should=true, isLowConfidence=false",
    d3.should === true && d3.isLowConfidence === false,
    `decision=${JSON.stringify(d3)}`);

  // T4: shouldGenerateDraft turnCount >= 6 && total >= 70 → { should: true, isLowConfidence: true }
  const conf4: Conf = { ...createDefaultConfidence(), total: 75 };
  const d4 = planner3.shouldGenerateDraft(conf4, 7);
  check("T4 turnCount>=6 && total>=70 → should=true, isLowConfidence=true",
    d4.should === true && d4.isLowConfidence === true,
    `decision=${JSON.stringify(d4)}`);

  // T5: shouldGenerateDraft turnCount >= 6 && total < 70 → { should: false, isLowConfidence: false }
  const conf5: Conf = { ...createDefaultConfidence(), total: 60 };
  const d5 = planner3.shouldGenerateDraft(conf5, 7);
  check("T5 turnCount>=6 && total<70 → should=false",
    d5.should === false && d5.isLowConfidence === false,
    `decision=${JSON.stringify(d5)}`);

  // T6: shouldGenerateDraft turnCount < 6 && total < 90 → { should: false, isLowConfidence: false }
  const conf6: Conf = { ...createDefaultConfidence(), total: 80 };
  const d6 = planner3.shouldGenerateDraft(conf6, 3);
  check("T6 turnCount<6 && total<90 → should=false",
    d6.should === false && d6.isLowConfidence === false,
    `decision=${JSON.stringify(d6)}`);

  // T7: getMaxTurns() 返回 6
  check("T7 getMaxTurns() 返回 6", planner3.getMaxTurns() === 6, `maxTurns=${MAX_TURNS}`);

  // 常量检查
  check("T7.1 MAX_TURNS=6", MAX_TURNS === 6);
  check("T7.2 CONFIRM_THRESHOLD=90", CONFIRM_THRESHOLD === 90);
  check("T7.3 LOW_CONFIDENCE_THRESHOLD=70", LOW_CONFIDENCE_THRESHOLD === 70);
}

// ============================================================
// 3. normalizeUserInput 单元测试
// ============================================================

async function checkNormalizeUserInput(): Promise<void> {
  section("3. normalizeUserInput 单元测试");

  const { normalizeUserInput, LONG_TEXT_THRESHOLD } = await import("../src/agents/normalize-user-input");

  // T1: 短文本（≤50 字）wasNormalized = false
  const r1 = normalizeUserInput("帮我盯比赛");
  check("T1 短文本 wasNormalized=false", r1.wasNormalized === false, `wasNormalized=${r1.wasNormalized}`);

  // T2: 长文本（>50 字）wasNormalized = true
  const longText = "我是做AI产品的帮我盯比赛就是那种大厂办的比较有含金量的我想找比赛就是AI比赛最好AI相关";
  const r2 = normalizeUserInput(longText);
  check("T2 长文本 wasNormalized=true", r2.wasNormalized === true, `wasNormalized=${r2.wasNormalized}, len=${longText.length}`);

  // T3: "QWAN" 被修正为 "Qwen"
  const r3 = normalizeUserInput("我是做QWAN产品的帮我盯比赛就是那种大厂办的比较有含金量的我想找比赛就是AI比赛最好AI相关");
  check("T3 QWAN 被修正为 Qwen",
    r3.correctedTypos.some((t) => t.includes("QWAN") && t.includes("Qwen")),
    `typos=${r3.correctedTypos.join("|")}`);
  check("T3.1 normalizedText 含 Qwen", r3.normalizedText.includes("Qwen"));

  // T4: "我是做AI产品的帮我盯比赛" 被断句为含逗号的文本
  const r4 = normalizeUserInput("我是做AI产品的帮我盯比赛就是那种大厂办的比较有含金量的我想找比赛就是AI比赛最好AI相关");
  check("T4 长文本被断句（含逗号或句号）",
    r4.normalizedText.includes("，") || r4.normalizedText.includes("。"),
    `normalizedText=${r4.normalizedText.slice(0, 80)}`);

  // T5: 重复句子被去重
  const r5 = normalizeUserInput("我想找比赛。我想找比赛。我想找比赛。");
  // 长度 ≤ 50 但含口语化触发整理？测试重复去重
  const dupText = "我想找比赛我想找比赛我想找比赛我想找比赛我想找比赛我想找比赛我想找比赛";
  const r5b = normalizeUserInput(dupText);
  check("T5 重复文本被去重",
    r5b.wasNormalized === true && r5b.normalizedText.length < dupText.length,
    `before=${dupText.length}, after=${r5b.normalizedText.length}`);

  // T6: 口语化"大厂办的"被提取为结构化约束
  const r6 = normalizeUserInput("我是做AI产品的帮我盯比赛就是那种大厂办的比较有含金量的我想找比赛就是AI比赛最好AI相关");
  check("T6 口语化被检测",
    r6.detectedColloquialisms.length > 0,
    `colloquialisms=${r6.detectedColloquialisms.join("|")}`);
  check("T6.1 含'主办方权威'", r6.detectedColloquialisms.includes("主办方权威"));

  // 阈值检查
  check("T6.2 LONG_TEXT_THRESHOLD=50", LONG_TEXT_THRESHOLD === 50);
}

// ============================================================
// 4. RequirementCardGenerator 单元测试
// ============================================================

async function checkRequirementCardGenerator(): Promise<void> {
  section("4. RequirementCardGenerator 单元测试");

  const { generateConfirmationCard, CONFIRM_THRESHOLD, LOW_CONFIDENCE_THRESHOLD, MAX_TURNS } =
    await import("../src/agents/requirement-card-generator");
  const { createDefaultConfidence } = await import("../src/schema/requirement-confidence");
  const { createEmptyExtractedInfo } = await import("../src/schema/extracted-requirement-info");

  type Conf = ReturnType<typeof createDefaultConfidence>;

  // T1: generateConfirmationCard 返回 RequirementConfirmationCard
  const conf1: Conf = { ...createDefaultConfidence(), total: 95 };
  const info1 = createEmptyExtractedInfo();
  const card1 = generateConfirmationCard("conv_test_1", conf1, info1, 3);
  check("T1 返回 RequirementConfirmationCard", !!card1 && typeof card1 === "object");
  check("T1.1 含 cardId 字段", typeof card1.cardId === "string" && card1.cardId.startsWith("card_"));
  check("T1.2 含 conversationId 字段", card1.conversationId === "conv_test_1");
  check("T1.3 含 summary 字段", typeof card1.summary === "string");
  check("T1.4 含 createdAt 字段", typeof card1.createdAt === "string");
  check("T1.5 含 isLowConfidence 字段", typeof card1.isLowConfidence === "boolean");

  // T2: 正常确认度（≥90%）isLowConfidence = false
  const conf2: Conf = { ...createDefaultConfidence(), total: 90 };
  const card2 = generateConfirmationCard("conv_test_2", conf2, info1, 2);
  check("T2 total=90 isLowConfidence=false", card2.isLowConfidence === false, `isLowConfidence=${card2.isLowConfidence}`);

  // T3: 低置信度（6 轮 + ≥70%）isLowConfidence = true
  const conf3: Conf = { ...createDefaultConfidence(), total: 75 };
  const card3 = generateConfirmationCard("conv_test_3", conf3, info1, 6);
  check("T3 total=75 turnCount=6 isLowConfidence=true", card3.isLowConfidence === true, `isLowConfidence=${card3.isLowConfidence}`);

  // T3.1: 6 轮 + total=90 仍为正式卡
  const conf3b: Conf = { ...createDefaultConfidence(), total: 90 };
  const card3b = generateConfirmationCard("conv_test_3b", conf3b, info1, 6);
  check("T3.1 total=90 turnCount=6 isLowConfidence=false", card3b.isLowConfidence === false);

  // T4: summary ≤ 200 字
  check("T4 summary ≤ 200 字", card1.summary.length <= 200, `len=${card1.summary.length}`);

  // 常量检查
  check("T4.1 CONFIRM_THRESHOLD=90", CONFIRM_THRESHOLD === 90);
  check("T4.2 LOW_CONFIDENCE_THRESHOLD=70", LOW_CONFIDENCE_THRESHOLD === 70);
  check("T4.3 MAX_TURNS=6", MAX_TURNS === 6);
}

// ============================================================
// 5. ConversationManager 集成测试
// ============================================================

async function checkConversationManager(): Promise<void> {
  section("5. ConversationManager 集成测试");

  const { ConversationManager } = await import("../src/agents/conversation-manager");
  const { MockLlmAdapter } = await import("../src/demo/mock-llm-adapter");

  // T1: V2 模式下 processUserInput 返回 nextQuestion（≤1 个）
  const mockAdapter1 = new MockLlmAdapter();
  const manager1 = new ConversationManager(mockAdapter1, "ai_competition", "conv_v2_test", true);
  const turn1 = await manager1.processUserInput("我想找 AI 比赛");
  check("T1 V2 模式 questionMode='single'", turn1.questionMode === "single", `questionMode=${turn1.questionMode}`);
  check("T1.1 V2 模式 isV2Mode()=true", manager1.isV2Mode() === true);
  // nextQuestion 应该是 null（无确认卡）或对象（≤1 个）
  check("T1.2 V2 模式 nextQuestion 类型正确",
    turn1.nextQuestion === null || typeof turn1.nextQuestion === "object",
    `nextQuestion=${JSON.stringify(turn1.nextQuestion)?.slice(0, 60)}`);

  // T2: V1 模式（旧）questionMode = "multi"
  const mockAdapter2 = new MockLlmAdapter();
  const manager2 = new ConversationManager(mockAdapter2, "ai_competition", "conv_v1_test", false);
  const turn2 = await manager2.processUserInput("我想找 AI 比赛");
  check("T2 V1 模式 questionMode='multi'", turn2.questionMode === "multi", `questionMode=${turn2.questionMode}`);
  check("T2.1 V1 模式 isV2Mode()=false", manager2.isV2Mode() === false);
  check("T2.2 V1 模式 questions 数组存在", Array.isArray(turn2.questions));

  // T3: getConfirmationCard 初始为 null
  check("T3 初始 getConfirmationCard()=null", manager1.getConfirmationCard() === null);

  // T4: canGenerateDraft 字段存在
  check("T4 V2 模式 canGenerateDraft 字段存在", typeof turn1.canGenerateDraft === "boolean");
  check("T4.1 V1 模式 canGenerateDraft 字段存在", typeof turn2.canGenerateDraft === "boolean");

  // T5: maxTurnsReached 字段存在
  check("T5 V2 模式 maxTurnsReached 字段存在", typeof turn1.maxTurnsReached === "boolean");

  // T6: questions 数组在 V2 模式下也存在（fallback 兼容）
  check("T6 V2 模式 questions 数组存在", Array.isArray(turn1.questions));
}

// ============================================================
// 6. API 测试
// ============================================================

async function checkApiEndpoints(): Promise<void> {
  section("6. API 测试");

  const { createApp } = await import("../src/api/app");
  const { serve } = await import("@hono/node-server");
  const app = createApp();
  const port = 3997;
  const server = serve({ fetch: app.fetch, port });

  type ApiRes = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } };

  try {
    // T1: POST /api/chat V2 模式下返回 nextQuestion 或 canGenerateDraft
    const res1 = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我想找 AI 比赛", radar_type: "ai_competition" }),
    });
    const json1 = (await res1.json()) as ApiRes;
    check("T1 POST /api/chat 返回 200", res1.status === 200, `status=${res1.status}`);
    check("T1.1 success=true", json1.success === true);
    const data1 = json1.data || {};
    check("T1.2 含 conversation_id", typeof data1.conversation_id === "string");
    check("T1.3 含 questionMode", typeof data1.questionMode === "string");
    const convId = data1.conversation_id as string;

    // T2: POST /api/chat/:id/confirmation-card 未生成时返回 400
    const res2 = await fetch(`http://localhost:${port}/api/chat/${convId}/confirmation-card`, {
      method: "POST",
    });
    const json2 = (await res2.json()) as ApiRes;
    check("T2 confirmation-card 未生成时返回 400", res2.status === 400, `status=${res2.status}`);
    check("T2.1 error.code=CARD_NOT_READY", json2.error?.code === "CARD_NOT_READY", `code=${json2.error?.code}`);

    // T3: POST /api/chat/:id/confirmation-card 不存在的会话返回 404
    const res3 = await fetch(`http://localhost:${port}/api/chat/nonexistent/confirmation-card`, {
      method: "POST",
    });
    const json3 = (await res3.json()) as ApiRes;
    check("T3 confirmation-card 不存在会话返回 404", res3.status === 404, `status=${res3.status}`);
    check("T3.1 error.code=NOT_FOUND", json3.error?.code === "NOT_FOUND");

    // T4: POST /api/chat/:id/confirm action=confirm
    const res4 = await fetch(`http://localhost:${port}/api/chat/${convId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm" }),
    });
    const json4 = (await res4.json()) as ApiRes;
    check("T4 confirm action=confirm 返回 200", res4.status === 200, `status=${res4.status}`);
    check("T4.1 success=true", json4.success === true);

    // T5: POST /api/chat/:id/confirm action=reject
    // 先创建新会话（因为 confirm 后状态变了）
    const res5a = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我要找政策补贴", radar_type: "opc_policy" }),
    });
    const json5a = (await res5a.json()) as ApiRes;
    const convId2 = json5a.data?.conversation_id as string;
    const res5 = await fetch(`http://localhost:${port}/api/chat/${convId2}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    const json5 = (await res5.json()) as ApiRes;
    check("T5 confirm action=reject 返回 200", res5.status === 200, `status=${res5.status}`);
    check("T5.1 success=true", json5.success === true);

    // T6: POST /api/chat/:id/confirm 不存在的会话返回 404
    const res6 = await fetch(`http://localhost:${port}/api/chat/nonexistent/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm" }),
    });
    check("T6 confirm 不存在会话返回 404", res6.status === 404, `status=${res6.status}`);
  } finally {
    // 等待 server 完全关闭，避免 libuv async handle 崩溃
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

// ============================================================
// 7. 兼容性验证
// ============================================================

async function checkCompatibility(): Promise<void> {
  section("7. 兼容性验证");

  const { ConversationManager } = await import("../src/agents/conversation-manager");
  const { MockLlmAdapter } = await import("../src/demo/mock-llm-adapter");

  // T1: V1 模式下 questions 数组仍正常返回
  const mockAdapter = new MockLlmAdapter();
  const manager = new ConversationManager(mockAdapter, "ai_competition", "conv_compat", false);
  const turn = await manager.processUserInput("我想找 AI 比赛");
  check("T1 V1 模式 questions 数组存在", Array.isArray(turn.questions), `questions=${typeof turn.questions}`);
  check("T1.1 V1 模式 questionMode='multi'", turn.questionMode === "multi");

  // T2: 旧 API 响应（无新字段）仍可被前端解析
  // 验证 TurnOutput 新增字段全部 optional
  const turnOutputTs = readFile("src/agents/conversation-turn-output.ts");
  check("T2 nextQuestion 是 optional", /nextQuestion\?\s*:/.test(turnOutputTs));
  check("T2.1 canGenerateDraft 是 optional", /canGenerateDraft\?\s*:/.test(turnOutputTs));
  check("T2.2 maxTurnsReached 是 optional", /maxTurnsReached\?\s*:/.test(turnOutputTs));
  check("T2.3 questionMode 是 optional", /questionMode\?\s*:/.test(turnOutputTs));

  // T3: createInitialConversationState 未修改（V1 Prompt 默认）
  const stateTs = readFile("src/agents/conversation-state.ts");
  check("T3 createInitialConversationState 仍引用 V1 Prompt",
    stateTs.includes("REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT") &&
    !stateTs.includes("REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT_V2"));
}

// ============================================================
// 8. 安全红线
// ============================================================

function checkSecurityRedLines(): void {
  section("8. 安全红线");

  const turnOutputTs = readFile("src/agents/conversation-turn-output.ts");
  const managerTs = readFile("src/agents/conversation-manager.ts");
  const chatTs = readFile("src/api/routes/chat.ts");
  const reqChatJs = readFile("web/requirement-chat.js");

  // 红线 #10：新增字段全部 optional
  check("红线#10 TurnOutput 新增字段全部 optional",
    /nextQuestion\?/.test(turnOutputTs) &&
    /canGenerateDraft\?/.test(turnOutputTs) &&
    /maxTurnsReached\?/.test(turnOutputTs) &&
    /questionMode\?/.test(turnOutputTs));

  // 红线 #11：TurnOutput 新增字段不破坏现有 API 响应
  check("红线#11 chat.ts 仍返回 ...turn 展开",
    chatTs.includes("...turn") || chatTs.includes("{ ...turn"));

  // 红线 #12：questions 数组保留为 fallback
  check("红线#12 conversation-manager.ts 仍维护 questions 数组",
    managerTs.includes("questions") && managerTs.includes("let questions"));
  check("红线#12.1 requirement-chat.js 仍含 questions fallback 渲染",
    reqChatJs.includes("Array.isArray(data.questions)"));

  // 约束：未引入新 npm 依赖（Task A 已新增 meilisearch，baseline=6）
  const pkgJson = JSON.parse(readFile("package.json"));
  const depCount = Object.keys(pkgJson.dependencies || {}).length;
  const devDepCount = Object.keys(pkgJson.devDependencies || {}).length;
  check("约束：dependencies 数量未增加", depCount <= 6, `depCount=${depCount}`);
  check("约束：devDependencies 数量未增加", devDepCount <= 3, `devDepCount=${devDepCount}`);

  // 约束：品牌名通过 BRAND.product_name 引用
  const v2PromptTs = readFile("src/prompts/requirement-confirmation-system-prompt-v2.ts");
  check("约束：V2 Prompt 通过 BRAND.product_name 引用品牌名",
    v2PromptTs.includes("BRAND.product_name"));
}

// ============================================================
// 9. 回归测试（顺序执行以避免 TRAE sandbox 资源竞争）
// ============================================================

function runRegressionTestSync(scriptName: string, label: string, expectedPass: number): Promise<void> {
  return new Promise((resolve) => {
    exec(`npx.cmd tsx scripts/${scriptName}`, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180000,
      env: { ...process.env, SKIP_REGRESSION: "1" },
    }, (err, stdout, stderr) => {
      const output = (stdout || "") + (stderr || "");
      // 红线 2：使用 matchAll 取最后一个匹配
      const allMatches = output.matchAll(/(\d+)\s*PASS/gi);
      const matches = [...allMatches];
      const passNum = matches.length > 0 ? parseInt(matches[matches.length - 1][1], 10) : 0;
      const success = passNum >= expectedPass;
      check(`${label} 回归通过（${passNum}/${expectedPass} PASS）`, success, `passNum=${passNum}`);
      const resultLine = `${label}: ${success ? "PASS" : "FAIL"} (${passNum}/${expectedPass})\n`;
      fs.appendFileSync(path.resolve(process.cwd(), "verify-taskB-result.log"), resultLine, "utf-8");
      if (!success && err) {
        console.log(`    错误: ${(err.message || "").slice(0, 150)}`);
      }
      resolve();
    });
  });
}

async function checkRegression(): Promise<void> {
  section("9. 回归测试（顺序）");
  const resultFile = path.resolve(process.cwd(), "verify-taskB-result.log");
  try { fs.unlinkSync(resultFile); } catch { /* ignore */ }
  // 顺序执行避免并行资源竞争导致 libuv 崩溃
  await runRegressionTestSync("verify-e2e-ai-events.ts", "T1 verify-e2e-ai-events", 13);
  await runRegressionTestSync("verify-task038.ts", "T2 verify-task038", 30);
  await runRegressionTestSync("verify-task039.ts", "T3 verify-task039", 57);
  await runRegressionTestSync("verify-task040.ts", "T4 verify-task040", 75);
  await runRegressionTestSync("verify-task041.ts", "T5 verify-task041", 38);
  await runRegressionTestSync("verify-task042.ts", "T6 verify-task042", 30);
  await runRegressionTestSync("verify-task043.ts", "T7 verify-task043", 23);
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task B 验收检查：一次一问需求确认 + 长文本整理 ===\n");

  checkFileExistence();
  await checkQuestionPlanner();
  await checkNormalizeUserInput();
  await checkRequirementCardGenerator();
  await checkConversationManager();
  await checkApiEndpoints();
  await checkCompatibility();
  checkSecurityRedLines();
  if (process.env.SKIP_REGRESSION === "1") {
    console.log("\n--- 跳过回归测试（SKIP_REGRESSION=1） ---");
  } else {
    await checkRegression();
  }

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  // 写入结果文件（避免 PowerShell 管道缓冲导致输出丢失）
  const resultLog = `Task B 验收结果: ${passed} PASS / ${failed} FAIL\n`;
  fs.writeFileSync(path.resolve(process.cwd(), "verify-taskB-result.log"), resultLog, "utf-8");

  if (failed > 0) {
    console.log("\n❌ 存在失败项，请修复后重试");
    process.exitCode = 1;
  } else {
    console.log("\n✓ 全部通过");
    process.exitCode = 0;
  }
  // 不调用 process.exit()，让事件循环自然退出，避免 libuv async handle 崩溃
}

main().catch((err) => {
  console.error("执行失败：", err);
  process.exitCode = 1;
});
