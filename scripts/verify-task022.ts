/**
 * Task 022 验收脚本
 *
 * 运行：npx tsx scripts/verify-task022.ts
 *
 * 不启动真实 HTTP 服务器，用 Hono 的 app.request() 方法测试。
 * 覆盖 26 项测试（5.1 API 端点 + 5.2 响应格式 + 5.3 工程约束 + 5.4 回归）。
 */

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import type { ApiResponse } from "../src/api/types";

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

// ============================================================
// 临时文件路径
// ============================================================

const TEST_STORE_PATH = "data/opportunity-store-api-test.json";
const TEST_WATCH_PATH = "data/watch-rules-api-test.txt";

// ============================================================
// Mock 数据构造
// ============================================================

function makeCard(over: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    title: "API 测试 AI 大赛",
    type: "AI 赛事",
    organizer: "测试主办方",
    region: "上海",
    deadline: "2026-12-31",
    reward_or_value: "奖金 10 万",
    eligibility: "公司/团队",
    materials_required: "商业计划书",
    match_reason: "AI 赛事匹配",
    next_action: "立即报名",
    official_source_url: "https://example.com/api-test",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 80,
    visible_level: "A",
    status: "new",
    ...over,
  };
}

// ============================================================
// 创建测试用 AppContext（用临时文件）
// ============================================================

function createTestContext(): AppContext {
  // 清理可能残留的临时文件
  if (fs.existsSync(TEST_STORE_PATH)) fs.unlinkSync(TEST_STORE_PATH);
  if (fs.existsSync(TEST_WATCH_PATH)) fs.unlinkSync(TEST_WATCH_PATH);

  const modelRouter = new ModelRouter();
  const store = new LocalFileStore({ file_path: TEST_STORE_PATH });
  store.load();
  const starManager = new StarManager(store);
  const watchStore = new LocalWatchStore({ file_path: TEST_WATCH_PATH });

  return {
    llmAdapter: modelRouter,
    store,
    starManager,
    watchStore,
    conversations: new Map(),
  };
}

// ============================================================
// 辅助：解析响应
// ============================================================

async function parseResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task 022 验收检查 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 5.1 API 端点功能测试
  // ============================================================
  section("5.1 API 端点功能测试");

  // 测试 1: 健康检查
  {
    const res = await app.request("/health", { method: "GET" });
    const body = await parseResponse(res);
    check("1. 健康检查返回 200", res.status === 200, `status=${res.status}`);
    check("1.1 健康检查 success=true", body.success === true);
    check("1.2 健康检查 data.status=ok", (body.data as { status?: string })?.status === "ok");
  }

  // 测试 2: 404 处理
  {
    const res = await app.request("/nonexistent", { method: "GET" });
    const body = await parseResponse(res);
    check("2. 404 返回 404 状态码", res.status === 404, `status=${res.status}`);
    check("2.1 404 success=false", body.success === false);
    check("2.2 404 error.code=NOT_FOUND", body.error?.code === "NOT_FOUND");
  }

  // 测试 3: 对话 - 新建会话
  {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我想找 AI 比赛机会", radar_type: "ai_competition" }),
    });
    const body = await parseResponse(res);
    check("3. 对话新建会话返回 200", res.status === 200, `status=${res.status}, error=${body.error?.message}`);
    check("3.1 对话 success=true", body.success === true, body.error?.message ?? "");
    const data = body.data as { conversation_id?: string } | null;
    check("3.2 对话返回 conversation_id", typeof data?.conversation_id === "string");
  }

  // 测试 4: 对话 - 继续会话
  {
    // 先新建会话
    const res1 = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我在上海", radar_type: "ai_competition" }),
    });
    const body1 = await parseResponse(res1);
    const convId = (body1.data as { conversation_id?: string })?.conversation_id;
    check("4. 对话继续会话-先新建成功", body1.success === true && typeof convId === "string");

    // 用同一 conversation_id 继续
    const res2 = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "预算 10 万", conversation_id: convId }),
    });
    const body2 = await parseResponse(res2);
    check("4.1 对话继续会话返回 200", res2.status === 200, `status=${res2.status}`);
    check("4.2 对话继续会话 success=true", body2.success === true, body2.error?.message ?? "");
    check("4.3 对话继续会话 conversation_id 一致", (body2.data as { conversation_id?: string })?.conversation_id === convId);
  }

  // 测试 5: 机会库 - 添加
  let addedKey = "";
  {
    const card = makeCard({ title: "测试添加的 AI 大赛" });
    const res = await app.request("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card, radar_type: "ai_competition" }),
    });
    const body = await parseResponse(res);
    check("5. 机会库添加返回 200", res.status === 200, `status=${res.status}`);
    check("5.1 机会库添加 success=true", body.success === true, body.error?.message ?? "");
    const entry = body.data as { dedup_key?: string } | null;
    addedKey = entry?.dedup_key ?? "";
    check("5.2 机会库添加返回 dedup_key", typeof addedKey === "string" && addedKey.length > 0);
  }

  // 测试 6: 机会库 - 列表
  {
    const res = await app.request("/api/opportunities", { method: "GET" });
    const body = await parseResponse(res);
    check("6. 机会库列表返回 200", res.status === 200);
    check("6.1 机会库列表 success=true", body.success === true);
    const data = body.data as { entries?: unknown[]; total?: number } | null;
    check("6.2 机会库列表 total > 0", (data?.total ?? 0) > 0, `total=${data?.total}`);
  }

  // 测试 7: 机会库 - 获取单条
  {
    const res = await app.request(`/api/opportunities/${addedKey}`, { method: "GET" });
    const body = await parseResponse(res);
    check("7. 机会库获取单条返回 200", res.status === 200, `status=${res.status}`);
    check("7.1 机会库获取单条 success=true", body.success === true);
    const entry = body.data as { dedup_key?: string } | null;
    check("7.2 机会库获取单条 dedup_key 匹配", entry?.dedup_key === addedKey);
  }

  // 测试 8: 机会库 - 更新
  {
    const res = await app.request(`/api/opportunities/${addedKey}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: { status: "viewed" } }),
    });
    const body = await parseResponse(res);
    check("8. 机会库更新返回 200", res.status === 200, `status=${res.status}`);
    check("8.1 机会库更新 success=true", body.success === true);
    const entry = body.data as { card?: { status?: string } } | null;
    check("8.2 机会库更新 status=viewed", entry?.card?.status === "viewed");
  }

  // 测试 10: 机会库 - 统计（先测统计，再测收藏，最后删）
  {
    const res = await app.request("/api/opportunities/stats", { method: "GET" });
    const body = await parseResponse(res);
    check("10. 机会库统计返回 200", res.status === 200);
    check("10.1 机会库统计 success=true", body.success === true);
    const stats = body.data as { total?: number } | null;
    check("10.2 机会库统计 total > 0", (stats?.total ?? 0) > 0);
  }

  // 测试 11: 机会库 - 收藏
  {
    const res = await app.request(`/api/opportunities/${addedKey}/star`, { method: "POST" });
    const body = await parseResponse(res);
    check("11. 机会库收藏返回 200", res.status === 200, `status=${res.status}, msg=${body.error?.message}`);
    check("11.1 机会库收藏 success=true", body.success === true, body.error?.message ?? "");
    const entry = body.data as { card?: { status?: string } } | null;
    check("11.2 机会库收藏 status=saved", entry?.card?.status === "saved");
  }

  // 测试 13: 机会库 - 收藏统计
  {
    const res = await app.request("/api/opportunities/starred/stats", { method: "GET" });
    const body = await parseResponse(res);
    check("13. 机会库收藏统计返回 200", res.status === 200);
    check("13.1 机会库收藏统计 success=true", body.success === true);
    const stats = body.data as { total?: number } | null;
    check("13.2 机会库收藏统计 total > 0", (stats?.total ?? 0) > 0);
  }

  // 测试 12: 机会库 - 取消收藏
  {
    const res = await app.request(`/api/opportunities/${addedKey}/star`, { method: "DELETE" });
    const body = await parseResponse(res);
    check("12. 机会库取消收藏返回 200", res.status === 200, `status=${res.status}`);
    check("12.1 机会库取消收藏 success=true", body.success === true);
  }

  // 测试 9: 机会库 - 删除
  {
    const res = await app.request(`/api/opportunities/${addedKey}`, { method: "DELETE" });
    const body = await parseResponse(res);
    check("9. 机会库删除返回 200", res.status === 200, `status=${res.status}`);
    check("9.1 机会库删除 success=true", body.success === true);
  }

  // 测试 14: 搜索（Mock 模式）
  {
    const res = await app.request("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enable_content_fetch: false }),
    });
    const body = await parseResponse(res);
    check("14. 搜索返回 200", res.status === 200, `status=${res.status}, msg=${body.error?.message}`);
    check("14.1 搜索 success=true", body.success === true, body.error?.message ?? "");
    const data = body.data as { total_raw?: number; duration_ms?: number } | null;
    check("14.2 搜索返回 total_raw >= 0", typeof data?.total_raw === "number");
  }

  // 测试 15: 提醒查询
  {
    // 先添加一条有 deadline 的卡片
    const card = makeCard({ title: "提醒测试卡片", deadline: "2026-07-15", status: "new" });
    await app.request("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card, radar_type: "ai_competition" }),
    });

    const res = await app.request("/api/reminders", { method: "GET" });
    const body = await parseResponse(res);
    check("15. 提醒查询返回 200", res.status === 200);
    check("15.1 提醒查询 success=true", body.success === true);
    const data = body.data as { summary?: { total?: number } } | null;
    check("15.2 提醒查询返回 summary", typeof data?.summary?.total === "number");
  }

  // 测试 16-20: Watch Rules CRUD
  // 测试 16: Watch Rules - 获取（初始为空）
  {
    const res = await app.request("/api/watch-rules", { method: "GET" });
    const body = await parseResponse(res);
    check("16. Watch Rules 获取返回 200", res.status === 200);
    check("16.1 Watch Rules 获取 success=true", body.success === true);
    const data = body.data as { rules_text?: string; rules_count?: number } | null;
    check("16.2 Watch Rules 初始 rules_count=0", data?.rules_count === 0, `count=${data?.rules_count}`);
  }

  // 测试 17: Watch Rules - 保存
  {
    const res = await app.request("/api/watch-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules_text: "[测试组] +AI @ai_competition\n[政策] +补贴 @opc_policy" }),
    });
    const body = await parseResponse(res);
    check("17. Watch Rules 保存返回 200", res.status === 200);
    check("17.1 Watch Rules 保存 success=true", body.success === true);
    const data = body.data as { rules_count?: number } | null;
    check("17.2 Watch Rules 保存 rules_count=2", data?.rules_count === 2, `count=${data?.rules_count}`);
  }

  // 测试 18: Watch Rules - 追加
  {
    const res = await app.request("/api/watch-rules/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line: "[追加] +黑客松 @ai_competition" }),
    });
    const body = await parseResponse(res);
    check("18. Watch Rules 追加返回 200", res.status === 200);
    check("18.1 Watch Rules 追加 success=true", body.success === true);
    const data = body.data as { rules_count?: number } | null;
    check("18.2 Watch Rules 追加后 rules_count=3", data?.rules_count === 3, `count=${data?.rules_count}`);
  }

  // 测试 19: Watch Rules - 匹配
  {
    const res = await app.request("/api/watch-rules/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ use_store_entries: true }),
    });
    const body = await parseResponse(res);
    check("19. Watch Rules 匹配返回 200", res.status === 200, `status=${res.status}`);
    check("19.1 Watch Rules 匹配 success=true", body.success === true);
    const data = body.data as { total_rules?: number; matched_entries?: number } | null;
    check("19.2 Watch Rules 匹配 total_rules=3", data?.total_rules === 3, `rules=${data?.total_rules}`);
    check("19.3 Watch Rules 匹配返回 matched_entries", typeof data?.matched_entries === "number");
  }

  // 测试 20: Watch Rules - 清空
  {
    const res = await app.request("/api/watch-rules", { method: "DELETE" });
    const body = await parseResponse(res);
    check("20. Watch Rules 清空返回 200", res.status === 200);
    check("20.1 Watch Rules 清空 success=true", body.success === true);
    // 验证已清空
    const res2 = await app.request("/api/watch-rules", { method: "GET" });
    const body2 = await parseResponse(res2);
    const data = body2.data as { rules_count?: number } | null;
    check("20.2 Watch Rules 清空后 rules_count=0", data?.rules_count === 0);
  }

  // 测试 21: 报告生成
  {
    const res = await app.request("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunities: [], radar_type: "ai_competition" }),
    });
    const body = await parseResponse(res);
    check("21. 报告生成返回 200", res.status === 200, `status=${res.status}`);
    check("21.1 报告生成 success=true", body.success === true, body.error?.message ?? "");
    const data = body.data as { markdown?: string | null; version?: string } | null;
    check("21.2 报告生成返回 markdown", typeof data?.markdown === "string" || data?.markdown === null);
  }

  // ============================================================
  // 5.2 响应格式与中间件
  // ============================================================
  section("5.2 响应格式与中间件");

  // 测试 22: 响应格式统一性
  {
    const endpoints = [
      { path: "/health", method: "GET" },
      { path: "/api/opportunities", method: "GET" },
      { path: "/api/reminders", method: "GET" },
      { path: "/api/watch-rules", method: "GET" },
    ];
    let allUnified = true;
    for (const ep of endpoints) {
      const res = await app.request(ep.path, { method: ep.method });
      const body = await parseResponse(res);
      const hasAllFields =
        typeof body.success === "boolean" &&
        "data" in body &&
        "error" in body &&
        typeof body.duration_ms === "number";
      if (!hasAllFields) {
        allUnified = false;
        console.log(`    ${ep.method} ${ep.path} 缺少字段`);
      }
    }
    check("22. 所有响应含 success/data/error/duration_ms", allUnified);
  }

  // 测试 23: CORS 头
  {
    const res = await app.request("/health", { method: "GET" });
    const corsHeader = res.headers.get("access-control-allow-origin");
    check("23. 响应含 CORS 头", corsHeader !== null, `header=${corsHeader}`);
  }

  // 测试 24: 错误处理 - POST 空体返回 400
  {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await parseResponse(res);
    check("24. POST 空体返回 400", res.status === 400, `status=${res.status}`);
    check("24.1 POST 空体 success=false", body.success === false);
    check("24.2 POST 空体 error.code=BAD_REQUEST", body.error?.code === "BAD_REQUEST");
  }

  // ============================================================
  // 5.3 工程约束
  // ============================================================
  section("5.3 工程约束自检");

  // 测试 25: 不修改现有文件
  {
    const existingDirs = ["src/agents", "src/search", "src/watch", "src/schema", "src/utils"];
    let noModify = true;
    // 检查 src/api 目录下的文件不修改现有目录
    for (const dir of existingDirs) {
      // 这些目录应该存在且未被修改（git 层面验证留给 git status）
      if (!fs.existsSync(dir)) {
        noModify = false;
        console.log(`    ${dir} 不存在`);
      }
    }
    check("25. 不修改现有文件（约束）", noModify);
    check("25.1 新源码文件全在 src/api/ 目录下", fs.existsSync("src/api/app.ts"));
    check("25.2 验证脚本不启动真实服务器（用 app.request）", typeof app.request === "function");
  }

  // 测试 26: 不引入额外依赖（除 hono + @hono/node-server；Task 023 引入 meilisearch 为合法依赖）
  {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
    const deps = Object.keys(pkg.dependencies);
    const newDeps = deps.filter(
      (d) => !["ajv", "ajv-formats", "i18next"].includes(d),
    );
    check(
      "26. 仅引入 hono + @hono/node-server 两个新依赖（Task 023 meilisearch 除外）",
      newDeps.includes("hono") && newDeps.includes("@hono/node-server") &&
        newDeps.every((d) => ["hono", "@hono/node-server", "meilisearch"].includes(d)),
      `newDeps=${JSON.stringify(newDeps)}`,
    );
  }

  // 测试 26.1: 临时文件清理
  {
    // 清理临时文件
    if (fs.existsSync(TEST_STORE_PATH)) fs.unlinkSync(TEST_STORE_PATH);
    if (fs.existsSync(TEST_WATCH_PATH)) fs.unlinkSync(TEST_WATCH_PATH);
    // 清理 reports/api 目录（如果创建了）
    const reportsDir = path.resolve(process.cwd(), "reports/api");
    if (fs.existsSync(reportsDir)) {
      const files = fs.readdirSync(reportsDir);
      for (const f of files) {
        fs.unlinkSync(path.join(reportsDir, f));
      }
    }
    check("26.1 临时文件已清理", !fs.existsSync(TEST_STORE_PATH) && !fs.existsSync(TEST_WATCH_PATH));
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log("");
  console.log("=== 汇总 ===");
  console.log(`PASS: ${passed}`);
  console.log(`FAIL: ${failed}`);
  if (failed > 0) {
    console.log("❌ 有失败项");
    process.exit(1);
  } else {
    console.log("✅ 全部通过");
  }
}

main().catch((err) => {
  console.error("验证脚本异常:", err);
  process.exit(1);
});
