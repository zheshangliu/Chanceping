/**
 * Task 020 真实 API 联调脚本
 *
 * 运行：npx tsx scripts/verify-task020-real.ts
 *
 * 用真实 API Key 测试三个适配器的真实模式 + fallback 降级链路。
 * 分别测试商业版（commercial）和参赛版（competition）策略。
 *
 * 前置条件：.env 文件已配置 ZAI_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY
 */

import fs from "fs";
import path from "path";

// ============================================================
// 1. 手动加载 .env 文件（项目未使用 dotenv）
// ============================================================
function loadEnvFile(): void {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error("[FATAL] .env 文件不存在，请先配置 API Key");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

// ============================================================
// 2. 导入被测模块（在 .env 加载后导入，确保构造器能读到 env）
// ============================================================
import { QwenAdapter } from "../src/agents/qwen-adapter";
import { DeepSeekAdapter } from "../src/agents/deepseek-adapter";
import { GlmAdapter } from "../src/agents/glm-adapter";
import { ModelRouter, type TaskType } from "../src/agents/model-router";
import {
  COMMERCIAL_STRATEGY,
  COMPETITION_STRATEGY,
} from "../src/config/llm-strategy";
import type { LLMRequest } from "../src/agents/llm-adapter";

// ============================================================
// 3. 测试框架
// ============================================================
let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS  ${name}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

function skip(name: string, reason: string): void {
  skipped++;
  console.log(`  ⏭️ SKIP  ${name} (${reason})`);
}

function section(title: string): void {
  console.log("");
  console.log(`════════════════════════════════════════════`);
  console.log(`  ${title}`);
  console.log(`════════════════════════════════════════════`);
}

/** 最小请求 prompt，控制 token 消耗 */
const SIMPLE_PROMPT = "请只回复两个字：你好";

function makeRequest(content: string): LLMRequest {
  return {
    messages: [{ role: "user", content }],
    temperature: 0.1,
  };
}

/** 带 30 秒超时的调用 */
async function callWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs = 30000
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`超时 (${timeoutMs}ms)`)), timeoutMs)
      ),
    ]);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 脱敏 key */
function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

// ============================================================
// 4. 主测试流程（IIFE 包裹，避免 top-level await）
// ============================================================
(async () => {
section("环境检查");

const zaiKey = process.env.ZAI_API_KEY ?? "";
const deepseekKey = process.env.DEEPSEEK_API_KEY ?? "";
const dashscopeKey = process.env.DASHSCOPE_API_KEY ?? "";
const dashscopeBaseUrl = process.env.DASHSCOPE_BASE_URL ?? "";

check("ZAI_API_KEY 已配置", zaiKey.length > 0, maskKey(zaiKey));
check("DEEPSEEK_API_KEY 已配置", deepseekKey.length > 0, maskKey(deepseekKey));
check("DASHSCOPE_API_KEY 已配置", dashscopeKey.length > 0, maskKey(dashscopeKey));
check(
  "DASHSCOPE_BASE_URL 已配置",
  dashscopeBaseUrl.length > 0,
  dashscopeBaseUrl.length > 0 ? `${dashscopeBaseUrl.substring(0, 20)}...` : ""
);

// ============================================================
// 5. 商业版 - 三适配器真实调用
// ============================================================
section("商业版 - GLM (glm-4.7-flash) 真实调用");

if (zaiKey) {
  // 测试 1：海外端点 api.z.ai（60 秒超时，混合思考模型可能慢）
  const glm = new GlmAdapter({ mockMode: false });
  console.log(`  [测试1] 海外端点: https://api.z.ai/api/paas/v4 (60s 超时)`);
  const result = await callWithTimeout(() => glm.chat(makeRequest(SIMPLE_PROMPT)), 60000);
  if (result.ok) {
    const content = result.data.content;
    check("GLM 海外端点真实调用成功", true, `回复: "${content.substring(0, 50)}"`);
    check("GLM 返回非空内容", content.length > 0, `长度=${content.length}`);
    if (content.length > 0 && content.length < 20) {
      console.log(`  ℹ️  回复较短 (${content.length} 字符)，可能走了 reasoning_content 回退`);
    }
  } else {
    check("GLM 海外端点真实调用成功", false, result.error);
    console.log(`  ℹ️  海外端点失败，尝试国内端点...`);

    // 测试 2：国内端点 open.bigmodel.cn（海外不通时的备选）
    const glmCn = new GlmAdapter({
      mockMode: false,
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    });
    console.log(`  [测试2] 国内端点: https://open.bigmodel.cn/api/paas/v4 (60s 超时)`);
    const result2 = await callWithTimeout(() => glmCn.chat(makeRequest(SIMPLE_PROMPT)), 60000);
    if (result2.ok) {
      const content = result2.data.content;
      check("GLM 国内端点真实调用成功", true, `回复: "${content.substring(0, 50)}"`);
      check("GLM 国内端点返回非空内容", content.length > 0, `长度=${content.length}`);
      console.log(`  ℹ️  建议商业版 GlmAdapter 使用国内端点 open.bigmodel.cn`);
    } else {
      check("GLM 国内端点真实调用成功", false, result2.error);
    }
  }
} else {
  skip("GLM 真实调用", "ZAI_API_KEY 未配置");
}

// --- DeepSeek ---
section("商业版 - DeepSeek (deepseek-v4-flash) 真实调用");

if (deepseekKey) {
  const ds = new DeepSeekAdapter({ mockMode: false });
  console.log(`  模型: deepseek-v4-flash, 端点: https://api.deepseek.com/v1`);
  const result = await callWithTimeout(() => ds.chat(makeRequest(SIMPLE_PROMPT)));
  if (result.ok) {
    const content = result.data.content;
    check("DeepSeek 真实调用成功", true, `回复: "${content.substring(0, 50)}"`);
    check(
      "DeepSeek 返回非空内容",
      content.length > 0,
      `长度=${content.length}`
    );
  } else {
    check("DeepSeek 真实调用成功", false, result.error);
  }
} else {
  skip("DeepSeek 真实调用", "DEEPSEEK_API_KEY 未配置");
}

// --- Qwen ---
section("商业版 - Qwen (qwen3.7-plus) 真实调用");

if (dashscopeKey) {
  const qwen = new QwenAdapter({ mockMode: false });
  const baseUrlUsed = dashscopeBaseUrl
    ? `${dashscopeBaseUrl.substring(0, 25)}...`
    : "https://dashscope.aliyuncs.com/compatible-mode/v1";
  console.log(`  模型: qwen3.7-plus, 端点: ${baseUrlUsed}`);
  const result = await callWithTimeout(() => qwen.chat(makeRequest(SIMPLE_PROMPT)));
  if (result.ok) {
    const content = result.data.content;
    check("Qwen 真实调用成功", true, `回复: "${content.substring(0, 50)}"`);
    check(
      "Qwen 返回非空内容",
      content.length > 0,
      `长度=${content.length}`
    );
  } else {
    check("Qwen 真实调用成功", false, result.error);
  }
} else {
  skip("Qwen 真实调用", "DASHSCOPE_API_KEY 未配置");
}

// ============================================================
// 6. 商业版 - Fallback 降级链路测试
// ============================================================
section("商业版 - Fallback 降级链路（故意用错误 key 触发降级）");

// 用错误 key 创建 GLM 适配器，触发 primary 失败 → fallback 成功
if (zaiKey && deepseekKey) {
  console.log(`  测试场景: GLM(错误key) → DeepSeek(真实key) 降级`);

  // 创建一个用错误 key 的 GLM 适配器
  const badGlm = new GlmAdapter({ apiKey: "sk-invalid-key-for-testing", mockMode: false });
  // fallback 用真实 DeepSeek
  const goodDs = new DeepSeekAdapter({ mockMode: false });

  // 手动实现 fallback 逻辑（模拟 FallbackAdapter）
  let fallbackTriggered = false;
  let primaryError = "";
  try {
    await badGlm.chat(makeRequest(SIMPLE_PROMPT));
  } catch (e) {
    primaryError = e instanceof Error ? e.message : String(e);
    fallbackTriggered = true;
    // primary 失败，尝试 fallback
    const fbResult = await callWithTimeout(() => goodDs.chat(makeRequest(SIMPLE_PROMPT)));
    if (fbResult.ok) {
      check(
        "Fallback 降级成功（GLM 失败 → DeepSeek 成功）",
        true,
        `回复: "${fbResult.data.content.substring(0, 30)}"`
      );
    } else {
      check("Fallback 降级成功", false, `fallback 也失败: ${fbResult.error}`);
    }
  }

  if (!fallbackTriggered) {
    check(
      "Fallback 降级测试（GLM 错误 key 应失败）",
      false,
      "GLM 错误 key 未触发失败，无法验证降级"
    );
  } else {
    check("Primary 失败已触发", true, `错误: ${primaryError.substring(0, 60)}`);
  }
} else {
  skip("Fallback 降级测试", "需要 GLM + DeepSeek 两个 key");
}

// ============================================================
// 7. 商业版 - ModelRouter 完整路由测试
// ============================================================
section("商业版 - ModelRouter 完整路由（batch_screening 任务）");

if (zaiKey && deepseekKey && dashscopeKey) {
  const router = new ModelRouter(COMMERCIAL_STRATEGY);
  console.log(`  策略: commercial, 任务: batch_screening`);
  console.log(`  预期路由: GLM(glm-4.7-flash) → DeepSeek(deepseek-v4-flash) 降级`);

  const result = await callWithTimeout(
    () => router.chatForTask("batch_screening" as TaskType, makeRequest(SIMPLE_PROMPT)),
    30000
  );
  if (result.ok) {
    check(
      "ModelRouter 商业版 batch_screening 路由成功",
      true,
      `回复: "${result.data.content.substring(0, 40)}"`
    );
  } else {
    check("ModelRouter 商业版 batch_screening 路由成功", false, result.error);
  }
} else {
  skip("ModelRouter 商业版路由测试", "需要三个 key 全部配置");
}

// ============================================================
// 8. 参赛版 - ModelRouter 完整路由测试
// ============================================================
section("参赛版 - ModelRouter 完整路由（只用 Qwen）");

if (dashscopeKey) {
  const router = new ModelRouter(COMPETITION_STRATEGY);
  console.log(`  策略: competition, 任务: batch_screening`);
  console.log(`  预期路由: Qwen(qwen3.7-plus), 无 fallback`);

  const result = await callWithTimeout(
    () => router.chatForTask("batch_screening" as TaskType, makeRequest(SIMPLE_PROMPT)),
    30000
  );
  if (result.ok) {
    check(
      "ModelRouter 参赛版 batch_screening 路由成功",
      true,
      `回复: "${result.data.content.substring(0, 40)}"`
    );
  } else {
    check("ModelRouter 参赛版 batch_screening 路由成功", false, result.error);
  }

  // 参赛版合规检查：所有路由 provider 必须是 qwen
  console.log(`  参赛版合规检查：所有路由 provider 必须为 qwen`);
  let allQwen = true;
  const taskTypes: TaskType[] = [
    "batch_screening",
    "core_judgment",
    "high_difficulty",
    "report_generation",
    "requirement_understanding",
    "summarization",
    "dedup_classification",
    "fallback",
  ];
  for (const tt of taskTypes) {
    const routing = COMPETITION_STRATEGY.taskRouting[tt];
    if (routing.primary.provider !== "qwen") {
      allQwen = false;
      console.log(`    ⚠️ ${tt} primary provider = ${routing.primary.provider} (应为 qwen)`);
    }
    if (routing.fallback && routing.fallback.provider !== "qwen") {
      allQwen = false;
      console.log(`    ⚠️ ${tt} fallback provider = ${routing.fallback.provider} (应为 qwen)`);
    }
  }
  check("参赛版所有路由仅用 Qwen", allQwen);
} else {
  skip("ModelRouter 参赛版路由测试", "DASHSCOPE_API_KEY 未配置");
}

// ============================================================
// 9. JSON 模式测试（商业版 GLM + 参赛版 Qwen）
// ============================================================
section("JSON 模式测试（response_format=json）");

const jsonPrompt = "请返回一个 JSON：{\"status\":\"ok\",\"message\":\"hello\"}，只返回 JSON 不要其他内容";

if (zaiKey) {
  console.log(`  等待 3 秒避免 GLM 429 限流...`);
  await new Promise((r) => setTimeout(r, 3000));
  // 优先用国内端点（海外端点可能超时）
  const glmBaseUrl = zaiKey ? "https://open.bigmodel.cn/api/paas/v4" : undefined;
  const glm = new GlmAdapter({ mockMode: false, baseUrl: glmBaseUrl });
  console.log(`  GLM JSON 模式，端点: ${glmBaseUrl ?? "默认(海外)"}`);
  const result = await callWithTimeout(() =>
    glm.chat({
      messages: [{ role: "user", content: jsonPrompt }],
      response_format: "json",
      temperature: 0.1,
    }),
    60000
  );
  if (result.ok) {
    const hasParsed = result.data.parsed !== undefined;
    check(
      "GLM JSON 模式返回成功",
      result.data.content.length > 0,
      `回复: "${result.data.content.substring(0, 50)}"`
    );
    check("GLM JSON 解析（parsed 字段）", hasParsed);
  } else {
    check("GLM JSON 模式", false, result.error);
  }
} else {
  skip("GLM JSON 模式测试", "ZAI_API_KEY 未配置");
}

if (dashscopeKey) {
  const qwen = new QwenAdapter({ mockMode: false });
  const result = await callWithTimeout(() =>
    qwen.chat({
      messages: [{ role: "user", content: jsonPrompt }],
      response_format: "json",
      temperature: 0.1,
    })
  );
  if (result.ok) {
    const hasParsed = result.data.parsed !== undefined;
    check(
      "Qwen JSON 模式返回成功",
      result.data.content.length > 0,
      `回复: "${result.data.content.substring(0, 50)}"`
    );
    check("Qwen JSON 解析（parsed 字段）", hasParsed);
  } else {
    check("Qwen JSON 模式", false, result.error);
  }
} else {
  skip("Qwen JSON 模式测试", "DASHSCOPE_API_KEY 未配置");
}

// ============================================================
// 10. 汇总报告
// ============================================================
section("汇总");

const total = passed + failed + skipped;
console.log(`  总计: ${total} 项`);
console.log(`  通过: ${passed} 项`);
console.log(`  失败: ${failed} 项`);
console.log(`  跳过: ${skipped} 项`);

console.log("");
if (failed === 0) {
  console.log("🎉 真实 API 联调全部通过！");
  console.log("");
  console.log("结论：");
  console.log("  - 商业版（commercial）：三适配器真实模式可用，fallback 降级链路正常");
  console.log("  - 参赛版（competition）：Qwen 真实模式可用，合规检查通过");
  console.log("  - 暂定使用商业版（LLM_STRATEGY=commercial）");
} else {
  console.log(`⚠️ 有 ${failed} 项失败，请检查上方日志`);
}

console.log("");
console.log(`耗时 prompt: "${SIMPLE_PROMPT}"，每适配器仅 1-2 次调用，token 消耗极低`);

})().then(() => {
  process.exit(failed === 0 ? 0 : 1);
}).catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
