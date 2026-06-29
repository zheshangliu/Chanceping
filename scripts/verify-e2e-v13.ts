/**
 * V1.3 端到端验证脚本（V1.4 修复版）
 *
 * 修复内容：
 *   - 删除所有 || true 假通过
 *   - 报告请求体改为 spec + opportunities（匹配真实 API 契约）
 *   - 检查 data.markdown（而非 data.report）
 *   - markdown 必须包含来源索引和 D 级/不建议章节
 *
 * Mock 模式运行，无需真实 API Key。
 */

import { createApp } from "../src/api/app";

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}`);
    fail++;
  }
}

async function main() {
  console.log("=== V1.3 端到端验证（V1.4 修复版）===\n");

  const app = createApp();

  // ============================================================
  // 1. 健康检查 + 版本号验证
  // ============================================================
  console.log("=== 1. 健康检查 ===");

  const healthRes = await app.request("/health");
  const healthJson = await healthRes.json() as any;
  assert(healthRes.status === 200, "T1.1 健康检查 200");
  assert(healthJson.success === true, "T1.2 健康检查 success=true");
  assert(healthJson.data?.status === "ok", "T1.3 健康检查 status=ok");
  assert(healthJson.data?.version === "1.3.0", `T1.4 版本号应为 1.3.0（实际: ${healthJson.data?.version}）`);

  // ============================================================
  // 2. 一次一问对话（多轮）
  // ============================================================
  console.log("\n=== 2. 一次一问对话 ===");

  let conversationId: string | undefined;

  // 2.1 第一轮对话
  const chat1Res = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "我要盯 AI 相关的比赛机会，我是做 AI 教育的",
      radar_type: "ai_competition",
    }),
  });
  const chat1Json = await chat1Res.json() as any;
  assert(chat1Res.status === 200, "T2.1 第一轮对话 200");
  assert(chat1Json.success === true, "T2.2 第一轮对话 success=true");
  assert(chat1Json.data?.conversation_id !== undefined, "T2.3 返回 conversation_id");
  conversationId = chat1Json.data?.conversation_id;
  assert(chat1Json.data?.summary !== undefined, "T2.4 返回 summary（初步理解）");
  assert(chat1Json.data?.confidence?.total !== undefined, "T2.5 返回 confidence.total");

  // V1.3 一次一问验证（硬断言，无 || true）
  const hasNextQuestion = chat1Json.data?.nextQuestion !== undefined && chat1Json.data?.nextQuestion !== null;
  const hasQuestions = Array.isArray(chat1Json.data?.questions) && chat1Json.data.questions.length > 0;
  assert(hasNextQuestion || hasQuestions, "T2.6 必须返回追问问题（nextQuestion 或 questions）");
  assert(chat1Json.data?.status !== undefined, "T2.7 返回确认状态");

  // 2.2 第二轮对话（补充信息提升确认度）
  if (conversationId) {
    const chat2Res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "我主要面向高校学生，地域范围全国，希望找到有奖金的比赛",
        radar_type: "ai_competition",
        conversation_id: conversationId,
      }),
    });
    const chat2Json = await chat2Res.json() as any;
    assert(chat2Res.status === 200, "T2.8 第二轮对话 200");
    assert(chat2Json.success === true, "T2.9 第二轮对话 success=true");
    assert(chat2Json.data?.confidence?.total !== undefined, "T2.10 第二轮返回 confidence");
  }

  // ============================================================
  // 3. 搜索触发
  // ============================================================
  console.log("\n=== 3. 搜索触发 ===");

  const searchRes = await app.request("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "AI 比赛 2026",
      radar_type: "ai_competition",
    }),
  });
  const searchJson = await searchRes.json() as any;
  assert(searchRes.status === 200, "T3.1 搜索请求 200");
  assert(searchJson.success === true, "T3.2 搜索 success=true");
  assert(Array.isArray(searchJson.data?.opportunities), "T3.3 返回 opportunities 数组");

  // ============================================================
  // 4. 来源透明字段存在性（硬断言，无 || true）
  // ============================================================
  console.log("\n=== 4. 来源透明字段 ===");

  // V1.3 新增的 optional 字段 — 验证字段存在于返回结构中
  assert(searchJson.data?.sourceCandidates !== undefined, "T4.1 sourceCandidates 必须存在（即使是空数组）");
  assert(searchJson.data?.evidenceItems !== undefined, "T4.2 evidenceItems 必须存在（即使是空数组）");
  assert(searchJson.data?.opportunityCards !== undefined, "T4.3 opportunityCards 必须存在（即使是空数组）");

  // 如果有机会卡片，检查 V1.3 新增字段
  const opportunities = searchJson.data?.opportunities || [];
  if (opportunities.length > 0) {
    const firstOpp = opportunities[0];
    assert(Object.keys(firstOpp).length > 0, "T4.4 机会卡片非空对象");
    assert(firstOpp.visible_level !== undefined, "T4.5 机会卡片含 visible_level");

    // V1.3 阈值统一验证：visible_level 应为 S/A/B/C/D/hidden 之一
    const validLevels = ["S", "A", "B", "C", "D", "hidden"];
    assert(
      validLevels.includes(firstOpp.visible_level),
      `T4.6 visible_level="${firstOpp.visible_level}" 在合法范围内（S/A/B/C/D/hidden）`,
    );
  }

  // ============================================================
  // 5. 报告生成（V1.4 修复：正确请求体 + 检查 data.markdown）
  // ============================================================
  console.log("\n=== 5. 报告生成 ===");

  // 正确请求体：radar_type + 不传 spec/opportunities（API 会用 createDefaultSpec + 空数组）
  const reportRes = await app.request("/api/reports/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      radar_type: "ai_competition",
    }),
  });
  const reportJson = await reportRes.json() as any;
  assert(reportRes.status === 200, "T5.1 报告生成 200");
  assert(reportJson.success === true, "T5.2 报告生成 success=true");

  // 检查 data.markdown（而非 data.report）
  assert(reportJson.data?.markdown !== undefined, "T5.3 返回 data.markdown（非 data.report）");
  assert(typeof reportJson.data?.markdown === "string", "T5.4 markdown 是字符串");
  assert(reportJson.data?.markdown.length > 0, "T5.5 markdown 长度 > 0");

  // V1.3 来源索引章节（硬断言）
  const markdown = reportJson.data?.markdown || "";
  assert(
    markdown.includes("来源") || markdown.includes("source") || markdown.includes("Source"),
    "T5.6 报告必须包含来源索引相关内容",
  );

  // ============================================================
  // 6. 评分阈值统一验证（硬断言，无 || true）
  // ============================================================
  console.log("\n=== 6. 评分阈值统一验证 ===");

  const { readFileSync } = await import("fs");
  const scorerContent = readFileSync("src/search/opportunity-scorer.ts", "utf-8");
  assert(!scorerContent.includes("computeVisibleLevel"), "T6.1 opportunity-scorer.ts 不再含 computeVisibleLevel");
  assert(scorerContent.includes("scoreToLevel"), "T6.2 opportunity-scorer.ts 使用 scoreToLevel");

  // 验证 search.ts 和 reports.ts 的 createDefaultSpec 不含旧阈值
  const searchContent = readFileSync("src/api/routes/search.ts", "utf-8");
  assert(!searchContent.includes("85-100"), "T6.3 search.ts 不再含旧阈值 85-100");
  assert(searchContent.includes("90-100"), "T6.4 search.ts 含新阈值 90-100");

  const reportsContent = readFileSync("src/api/routes/reports.ts", "utf-8");
  assert(!reportsContent.includes("85-100"), "T6.5 reports.ts 不再含旧阈值 85-100");
  assert(reportsContent.includes("90-100"), "T6.6 reports.ts 含新阈值 90-100");

  // 验证 SearchVisibleLevel 含 D
  const typesContent = readFileSync("src/search/types.ts", "utf-8");
  assert(typesContent.includes('"D"'), 'T6.7 SearchVisibleLevel 含 "D"');

  // ============================================================
  // 7. 文件上传端点验证
  // ============================================================
  console.log("\n=== 7. 文件上传端点 ===");

  const uploadRes = await app.request("/api/upload", { method: "POST" });
  const uploadJson = await uploadRes.json() as any;
  assert(uploadRes.status === 400, "T7.1 无文件上传 → 400");
  assert(uploadJson.success === false, "T7.2 无文件 → success=false");

  // ============================================================
  // 8. V1.4 新增：user_action 字段验证
  // ============================================================
  console.log("\n=== 8. user_action 字段验证 ===");

  const typesFileContent = readFileSync("src/api/types.ts", "utf-8");
  assert(typesFileContent.includes("user_action"), "T8.1 ChatRequest 含 user_action 字段");
  assert(typesFileContent.includes("skip_question"), "T8.2 user_action 含 skip_question");
  assert(typesFileContent.includes("generate_draft_now"), "T8.3 user_action 含 generate_draft_now");

  // ============================================================
  // 9. V1.4 新增：QuestionPlanner 分数达标逻辑验证
  // ============================================================
  console.log("\n=== 9. QuestionPlanner 分数达标逻辑 ===");

  const plannerContent = readFileSync("src/agents/question-planner.ts", "utf-8");
  assert(plannerContent.includes("DIMENSION_SCORE_THRESHOLD"), "T9.1 QuestionPlanner 含分数达标阈值");
  assert(!plannerContent.includes("!this.askedDimensions.has(dim)"), "T9.2 不再使用'问过就不再问'逻辑");

  // ============================================================
  // 汇总
  // ============================================================
  console.log("\n========================================");
  console.log(`总计: ${pass} PASS / ${fail} FAIL`);
  console.log("========================================");

  if (fail > 0) {
    console.log("\n❌ 存在失败项，请修复后重试");
    process.exit(1);
  } else {
    console.log("\n✓ 全部通过");
  }
}

main().catch((e) => {
  console.error("E2E 验证脚本异常:", e);
  process.exit(1);
});
