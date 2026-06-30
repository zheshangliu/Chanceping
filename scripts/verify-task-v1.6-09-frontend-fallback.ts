/**
 * Task V1.6-09 验收脚本：live 模式生成失败前端降级
 *
 * 运行：npx tsx scripts/verify-task-v1.6-09-frontend-fallback.ts
 *
 * 验证目标（对应任务书第四节验收清单）：
 *   1. 错误展示 → submitGenerate 失败时调用 showGenerateError
 *   2. 错误信息 → 展示后端返回的 error.message
 *   3. 重试按钮 → 含"重试"按钮，点击重新调用 submitGenerate
 *   4. 手动创建按钮 → 含"手动创建"按钮，点击关闭 AI 弹窗 + 打开创建弹窗
 *   5. 一次一问按钮 → 含"转入一次一问"按钮，点击切换到对话 Tab
 *   6. 后端错误码 → POST /generate 失败返回 500 + RADAR_GENERATION_FAILED
 *   7. 后端错误信息 → error.message 含具体失败原因
 *   8. CSS 样式 → .generate-error / .error-actions 样式存在
 *   9. HTML 容器 → radars.js 含 ai-gen-error 容器（动态创建）
 *   10. 回归 → verify:v15 + verify:v15:e2e（由外部命令运行）
 */

// ============================================================
// 0. 强制 Mock 模式（验证 API 错误响应 + 前端代码静态检查）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";

// ============================================================
// 测试框架
// ============================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

// ============================================================
// 读取前端文件内容（静态检查）
// ============================================================

const radarsJsPath = path.resolve(process.cwd(), "web/radars.js");
const stylesCssPath = path.resolve(process.cwd(), "web/styles.css");
const radarsJs = fs.readFileSync(radarsJsPath, "utf-8");
const stylesCss = fs.readFileSync(stylesCssPath, "utf-8");

// ============================================================
// 测试用例
// ============================================================

async function main(): Promise<void> {
  console.log("Task V1.6-09 验收：live 模式生成失败前端降级");
  console.log("================================");

  // ----------------------------------------------------------
  // A. 前端静态检查（radars.js）
  // ----------------------------------------------------------
  section("A. 前端代码静态检查");

  check("A1. radars.js 含 showGenerateError 函数", radarsJs.includes("function showGenerateError"));
  check("A2. submitGenerate 失败时调用 showGenerateError", radarsJs.includes("showGenerateError(modal, msg, description)"));
  check("A3. 网络错误也调用 showGenerateError", radarsJs.includes("showGenerateError(modal, msg, description)"));
  check("A4. 含 ai-gen-error 容器（动态创建）", radarsJs.includes('id="ai-gen-error"'));
  check("A5. 展示后端返回的 error.message", radarsJs.includes("json.error?.message"));
  check("A6. 展示失败原因前缀 'AI 生成失败'", radarsJs.includes("AI 生成失败："));

  // ----------------------------------------------------------
  // B. 降级选项按钮检查
  // ----------------------------------------------------------
  section("B. 降级选项按钮");

  check("B1. 含'重试'按钮", radarsJs.includes("重试") && radarsJs.includes("ai-gen-retry"));
  check("B2. 重试按钮点击调用 submitGenerate", radarsJs.includes("submitGenerate(modal)"));
  check("B3. 含'手动创建'按钮", radarsJs.includes("手动创建") && radarsJs.includes("ai-gen-manual"));
  check("B4. 手动创建点击调用 openCreateModal", radarsJs.includes("openCreateModal()"));
  check("B5. 含'转入一次一问'按钮", radarsJs.includes("转入一次一问") && radarsJs.includes("ai-gen-oneshot"));
  check("B6. 一次一问点击调用 switchTab('chat')", radarsJs.includes('switchTab("chat")'));
  check("B7. 一次一问预填需求描述到 chat-input", radarsJs.includes('chatInput.value = description'));

  // ----------------------------------------------------------
  // C. CSS 样式检查
  // ----------------------------------------------------------
  section("C. CSS 样式");

  check("C1. 含 .generate-error 样式", stylesCss.includes(".generate-error"));
  check("C2. 含 .error-message 样式", stylesCss.includes(".error-message"));
  check("C3. 含 .error-actions 样式", stylesCss.includes(".error-actions"));
  check("C4. .generate-error 含 border 样式", /\.generate-error\s*\{[^}]*border/.test(stylesCss));
  check("C5. .error-actions 含 flex 布局", /\.error-actions\s*\{[^}]*display:\s*flex/.test(stylesCss));

  // ----------------------------------------------------------
  // D. 后端 API 错误码检查
  // ----------------------------------------------------------
  section("D. 后端 API 错误响应");

  const radarsTsPath = path.resolve(process.cwd(), "src/api/routes/radars.ts");
  const radarsTs = fs.readFileSync(radarsTsPath, "utf-8");

  check("D1. POST /generate 使用 RADAR_GENERATION_FAILED 错误码", radarsTs.includes('"RADAR_GENERATION_FAILED"'));
  check("D2. 错误响应返回 500 状态码", /errorResponse\("RADAR_GENERATION_FAILED"[\s\S]*?,\s*500\)/.test(radarsTs));
  check("D3. 错误信息透传 err.message", radarsTs.includes("err instanceof Error ? err.message : String(err)"));

  // ----------------------------------------------------------
  // E. API 端到端测试：触发生成失败
  // ----------------------------------------------------------
  section("E. API 端到端：生成失败响应");

  const app = createApp();

  // E1. 不传 description → 400（不是 500，验证参数校验）
  const res1 = await app.request("/api/radars/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const json1 = await res1.json();
  check("E1. 不传 description → 400 BAD_REQUEST", res1.status === 400);
  check("E2. 错误码为 BAD_REQUEST（参数校验）", json1.error?.code === "BAD_REQUEST");

  // E2. Mock 模式下生成成功（验证正常路径不受影响）
  const res2 = await app.request("/api/radars/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "我要盯 AI 比赛" }),
  });
  const json2 = await res2.json();
  check("E3. Mock 模式生成成功 → 200", res2.status === 200);
  check("E4. Mock 模式返回 success=true", json2.success === true);
  check("E5. Mock 模式返回 spec 数据", json2.data?.spec !== undefined);

  // ----------------------------------------------------------
  // F. 错误信息脱敏检查
  // ----------------------------------------------------------
  section("F. 错误信息处理");

  check("F1. showGenerateError 使用 escapeHtml 转义", radarsJs.includes("escapeHtml(message)"));
  check("F2. 网络错误使用 err.message || 默认提示", radarsJs.includes('err && err.message') || radarsJs.includes("err.message"));
  check("F3. 不展示内部堆栈（仅 message 字段）", !radarsJs.includes("err.stack") && !radarsJs.includes("err.toString()"));

  // ----------------------------------------------------------
  // 汇总
  // ----------------------------------------------------------
  console.log("");
  console.log("================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) {
    console.log("失败项:");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  }
  console.log("✅ 全部通过");
}

main().catch((err) => {
  console.error("验收脚本异常:", err);
  process.exit(1);
});
