/**
 * Task V1.5-03 验收脚本：API 最小闭环
 *
 * 运行：npx tsx scripts/verify-task-v1.5-03-api.ts
 *
 * 验证范围（19 项 API 断言 + 5 项回归由外部命令运行）：
 *   6.1 雷达 CRUD（1-10）
 *   6.2 激活与运行（11-16）
 *   6.3 /api/search 支持 radar_id（17-19）
 *
 * 回归测试（20-24）由外部命令运行：
 *   - tsc --noEmit
 *   - verify-task038.ts
 *   - verify-e2e-v13.ts
 *   - verify-task-v1.5-01-model.ts
 *   - verify-task-v1.5-02-store.ts
 *
 * 测试隔离：使用临时文件 data/radars-v1.5.03-test.json / data/radar-runs-v1.5.03-test.json /
 *           data/opportunity-store-v1.5.03-test.json，测试后清理。
 */

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import type { ApiResponse } from "../src/api/types";

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
// 临时文件路径
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1.5.03-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.5.03-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.5.03-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.5.03-test.txt";

function cleanupTempFiles(): void {
  for (const f of [TEMP_RADARS_FILE, TEMP_RUNS_FILE, TEMP_STORE_FILE, TEMP_WATCH_FILE]) {
    const abs = path.resolve(process.cwd(), f);
    if (fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        // 忽略删除失败
      }
    }
  }
}

// ============================================================
// 创建测试用 AppContext（使用临时文件，避免污染生产数据）
// ============================================================

function createTestContext(): AppContext {
  cleanupTempFiles();

  const modelRouter = new ModelRouter();
  const store = new LocalFileStore({ file_path: TEMP_STORE_FILE });
  store.load();
  const starManager = new StarManager(store);
  const watchStore = new LocalWatchStore({ file_path: TEMP_WATCH_FILE });
  const radarStore = new JsonRadarStore({ file_path: TEMP_RADARS_FILE });
  const radarRunStore = new JsonRadarRunStore({ file_path: TEMP_RUNS_FILE });
  const radarRegistry = new RadarRegistry(radarStore);
  radarRegistry.initialize(); // 初始化 3 个内置雷达

  return {
    llmAdapter: modelRouter,
    store,
    starManager,
    watchStore,
    conversations: new Map(),
    radarStore,
    radarRunStore,
    radarRegistry,
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

/** POST/PUT 请求辅助 */
async function postJson(app: ReturnType<typeof createApp>, url: string, body: unknown): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: await parseResponse(res) };
}

async function putJson(app: ReturnType<typeof createApp>, url: string, body: unknown): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: await parseResponse(res) };
}

async function getJson(app: ReturnType<typeof createApp>, url: string): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

async function deleteJson(app: ReturnType<typeof createApp>, url: string): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "DELETE" });
  return { res, json: await parseResponse(res) };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task V1.5-03 验收检查：API 最小闭环 ===\n");

  // 确保 mock 模式（搜索返回预设数据）
  process.env.DATA_MODE = process.env.DATA_MODE ?? "mock";
  process.env.LLM_MODE = process.env.LLM_MODE ?? "mock";

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 6.1 雷达 CRUD（1-10）
  // ============================================================
  section("6.1 雷达 CRUD");

  // 1. POST /api/radars 创建自定义雷达 → 200, 返回 Radar(id 以 radar_ 开头, status=draft)
  let customId = "";
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "测试自定义雷达",
      kind: "custom",
    });
    check("1. POST /api/radars 创建返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    check("1.1 创建 success=true", json.success === true);
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    customId = radar?.id ?? "";
    check("1.2 返回 id 以 radar_ 开头", customId.startsWith("radar_"), `id=${customId}`);
    check("1.3 返回 status=draft", radar?.status === "draft", `status=${radar?.status}`);
    check("1.4 返回 isBuiltin=false", radar?.isBuiltin === false);
  }

  // 2. GET /api/radars → 200, 返回数组含 3 个内置 + 1 个自定义
  {
    const { res, json } = await getJson(app, "/api/radars");
    check("2. GET /api/radars 返回 200", res.status === 200);
    const arr = (json.data as Array<{ id?: string; isBuiltin?: boolean }> | null) ?? [];
    const builtinCount = arr.filter((r) => r.isBuiltin).length;
    const customCount = arr.filter((r) => !r.isBuiltin).length;
    check("2.1 含 3 个内置雷达", builtinCount === 3, `builtin=${builtinCount}`);
    check("2.2 含 1 个自定义雷达", customCount === 1, `custom=${customCount}`);
    check("2.3 含刚创建的自定义雷达", arr.some((r) => r.id === customId));
  }

  // 3. GET /api/radars/:id → 200, 返回刚才创建的雷达
  {
    const { res, json } = await getJson(app, `/api/radars/${customId}`);
    check("3. GET /api/radars/:id 返回 200", res.status === 200);
    const radar = json.data as { id?: string; name?: string } | null;
    check("3.1 返回 id 一致", radar?.id === customId);
    check("3.2 返回 name 一致", radar?.name === "测试自定义雷达");
  }

  // 4. GET /api/radars/不存在 → 404
  {
    const { res, json } = await getJson(app, "/api/radars/nonexistent_id_99999");
    check("4. GET /api/radars/不存在 返回 404", res.status === 404, `status=${res.status}`);
    check("4.1 error.code=RADAR_NOT_FOUND", json.error?.code === "RADAR_NOT_FOUND", `code=${json.error?.code}`);
  }

  // 5. PUT /api/radars/:id 更新名称 → 200, 名称已改
  {
    const { res, json } = await putJson(app, `/api/radars/${customId}`, {
      name: "改名后的雷达",
    });
    check("5. PUT /api/radars/:id 更新返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    const radar = json.data as { name?: string } | null;
    check("5.1 名称已改", radar?.name === "改名后的雷达", `name=${radar?.name}`);
  }

  // 6. PUT /api/radars/builtin_ai_competition → 403 RADAR_NOT_EDITABLE
  {
    const { res, json } = await putJson(app, "/api/radars/builtin_ai_competition", {
      name: "尝试改内置",
    });
    check("6. PUT 内置雷达返回 403", res.status === 403, `status=${res.status}`);
    check("6.1 error.code=RADAR_NOT_EDITABLE", json.error?.code === "RADAR_NOT_EDITABLE", `code=${json.error?.code}`);
  }

  // 7. DELETE /api/radars/:id → 200, status=archived（先创建一个用于删除的雷达）
  let deleteTargetId = "";
  {
    // V1.5-07 配额限制：先归档 customId 释放配额，再创建用于删除的雷达
    await deleteJson(app, `/api/radars/${customId}`);
    const createRes = await postJson(app, "/api/radars", { name: "待删除雷达", kind: "custom" });
    deleteTargetId = (createRes.json.data as { id?: string })?.id ?? "";

    const { res, json } = await deleteJson(app, `/api/radars/${deleteTargetId}`);
    check("7. DELETE /api/radars/:id 返回 200", res.status === 200, `status=${res.status}`);
    const radar = json.data as { status?: string; deletedAt?: string } | null;
    check("7.1 status=archived", radar?.status === "archived", `status=${radar?.status}`);
    check("7.2 deletedAt 有值", typeof radar?.deletedAt === "string" && radar!.deletedAt!.length > 0);

    // 重新创建 customId 供后续 activate/run 测试使用
    const recreateRes = await postJson(app, "/api/radars", { name: "测试自定义雷达", kind: "custom" });
    customId = (recreateRes.json.data as { id?: string })?.id ?? customId;
  }

  // 8. DELETE /api/radars/builtin_ai_competition → 403 RADAR_NOT_DELETABLE
  {
    const { res, json } = await deleteJson(app, "/api/radars/builtin_ai_competition");
    check("8. DELETE 内置雷达返回 403", res.status === 403, `status=${res.status}`);
    check("8.1 error.code=RADAR_NOT_DELETABLE", json.error?.code === "RADAR_NOT_DELETABLE", `code=${json.error?.code}`);
  }

  // 9. GET /api/radars?status=active → 只返回 active 状态的雷达
  {
    const { res, json } = await getJson(app, "/api/radars?status=active");
    check("9. GET ?status=active 返回 200", res.status === 200);
    const arr = (json.data as Array<{ status?: string }> | null) ?? [];
    check("9.1 所有返回项 status=active", arr.length > 0 && arr.every((r) => r.status === "active"), `len=${arr.length}`);
  }

  // 10. GET /api/radars?kind=custom → 只返回自定义雷达
  {
    const { res, json } = await getJson(app, "/api/radars?kind=custom");
    check("10. GET ?kind=custom 返回 200", res.status === 200);
    const arr = (json.data as Array<{ kind?: string }> | null) ?? [];
    check("10.1 所有返回项 kind=custom", arr.length > 0 && arr.every((r) => r.kind === "custom"), `len=${arr.length}`);
  }

  // ============================================================
  // 6.2 激活与运行（11-16）
  // ============================================================
  section("6.2 激活与运行");

  // 11. POST /api/radars/:id/activate → 200, status=active
  {
    const { res, json } = await postJson(app, `/api/radars/${customId}/activate`, {});
    check("11. POST /:id/activate 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    const radar = json.data as { status?: string } | null;
    check("11.1 status=active", radar?.status === "active", `status=${radar?.status}`);
  }

  // 12. POST /api/radars/:id/run → 200, 返回 RunResult(含 run + opportunities)
  {
    const { res, json } = await postJson(app, `/api/radars/${customId}/run`, {});
    check("12. POST /:id/run 返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);
    const data = json.data as { run?: unknown; opportunities?: unknown[] } | null;
    check("12.1 返回含 run 字段", data?.run !== undefined);
    check("12.2 返回含 opportunities 字段", Array.isArray(data?.opportunities));
  }

  // 13-15. 重新运行一次，详细检查返回结果
  {
    // 由于 currentRunId 已在 12 完成后被清空，可以再运行一次
    const { res, json } = await postJson(app, `/api/radars/${customId}/run`, {});
    check("13. POST /:id/run 二次运行返回 200", res.status === 200, `status=${res.status}, msg=${json.error?.message}`);

    const data = json.data as {
      run?: { status?: string; opportunityKeys?: string[]; mode?: string; triggeredBy?: string };
      opportunities?: Array<{ radarId?: string }>;
    } | null;

    // 13. run.status=succeeded, run.opportunityKeys 非空
    check("13.1 run.status=succeeded", data?.run?.status === "succeeded", `status=${data?.run?.status}`);
    check("13.2 run.opportunityKeys 非空数组", Array.isArray(data?.run?.opportunityKeys) && (data?.run?.opportunityKeys?.length ?? 0) > 0,
      `len=${data?.run?.opportunityKeys?.length ?? 0}`);

    // 14. run.mode=manual, run.triggeredBy=user
    check("14.1 run.mode=manual", data?.run?.mode === "manual", `mode=${data?.run?.mode}`);
    check("14.2 run.triggeredBy=user", data?.run?.triggeredBy === "user", `triggeredBy=${data?.run?.triggeredBy}`);

    // 15. 返回的 opportunities 每条含 radarId
    const opportunities = data?.opportunities ?? [];
    check("15. opportunities 数量 > 0", opportunities.length > 0, `len=${opportunities.length}`);
    check("15.1 opportunities 每条含 radarId", opportunities.length > 0 && opportunities.every((o) => o.radarId === customId),
      `missing count=${opportunities.filter((o) => !o.radarId).length}`);
  }

  // 16. POST /api/radars/draft雷达/run → 400 RADAR_NOT_ACTIVE
  {
    // V1.5-07 配额限制：先归档 customId 释放配额，再创建 draft 雷达
    await deleteJson(app, `/api/radars/${customId}`);
    // 创建一个 draft 状态的雷达
    const createRes = await postJson(app, "/api/radars", { name: "草稿雷达", kind: "custom" });
    const draftId = (createRes.json.data as { id?: string })?.id ?? "";

    const { res, json } = await postJson(app, `/api/radars/${draftId}/run`, {});
    check("16. POST draft 雷达 /run 返回 400", res.status === 400, `status=${res.status}`);
    check("16.1 error.code=RADAR_NOT_ACTIVE", json.error?.code === "RADAR_NOT_ACTIVE", `code=${json.error?.code}`);
  }

  // ============================================================
  // 6.3 /api/search 支持 radar_id（17-19）
  // ============================================================
  section("6.3 /api/search 支持 radar_id");

  // 17. POST /api/search 传 radar_id → 200, 返回结果
  {
    const { res, json } = await postJson(app, "/api/search", {
      radar_id: "builtin_ai_competition",
    });
    check("17. POST /api/search 传 radar_id 返回 200", res.status === 200,
      `status=${res.status}, msg=${json.error?.message}`);
    const data = json.data as { opportunities?: unknown[] } | null;
    check("17.1 返回含 opportunities 字段", Array.isArray(data?.opportunities));
  }

  // 18. 返回的 opportunities 含 radarId
  {
    const { res, json } = await postJson(app, "/api/search", {
      radar_id: "builtin_ai_competition",
    });
    check("18. POST /api/search radar_id 返回 200", res.status === 200);
    const data = json.data as { opportunities?: Array<{ radarId?: string }> } | null;
    const opportunities = data?.opportunities ?? [];
    check("18.1 opportunities 含 radarId", opportunities.length > 0 && opportunities.every((o) => o.radarId === "builtin_ai_competition"),
      `missing count=${opportunities.filter((o) => !o.radarId).length}`);
  }

  // 19. POST /api/search 传 body.spec(旧逻辑) → 200, 不破坏
  {
    const { res, json } = await postJson(app, "/api/search", {
      spec: {
        product_name: "ChancePing",
        product_category: "机会雷达",
        client_profile: {
          client_name: "测试", client_type: "团队", industry: "AI",
          business_type: "AI 应用", company_stage: "初创",
          products_or_projects: ["AI 应用"], target_users: ["用户"],
          core_capabilities: ["AI"], current_assets: [], regions: ["全国"], notes: "",
        },
        core_goals: {
          primary_goal: "找 AI 比赛机会", secondary_goals: [],
          success_definition: "获得奖金", action_intent: ["报名比赛"], priority_order: ["奖金"],
        },
        opportunity_scope: {
          primary_opportunity_types: ["AI 比赛"], secondary_opportunity_types: [],
          excluded_opportunity_types: [], must_have_conditions: [], nice_to_have_conditions: [],
        },
        region_scope: {
          primary_regions: ["全国"], secondary_regions: [],
          excluded_regions: [], global_allowed: false, overseas_allowed: false,
        },
        keyword_strategy: {
          core_keywords_zh: ["AI", "比赛"], core_keywords_en: ["AI", "competition"],
          expanded_keywords_zh: [], expanded_keywords_en: [], negative_keywords: [],
        },
        filter_rules: {
          must_include: [], must_exclude: [], low_priority_signals: [],
          high_priority_signals: [], requires_manual_review: [],
        },
        scoring_rules: {
          backend_score_enabled: true, visible_level_enabled: true,
          weights: { match_score: 30, business_value: 25, timeliness: 20, credibility: 15, actionability: 10, risk_penalty: -20 },
          visible_level_mapping: { S: "90-100", A: "80-89", B: "65-79", C: "50-64", D: "0-49", hidden: "不展示" },
          level_definitions: { S: "强烈推荐", A: "高价值", B: "可关注", C: "低优先级", D: "不推荐", hidden: "不展示" },
        },
        report_requirements: {
          report_format: "markdown", report_title_prefix: "本周", report_frequency: "weekly",
          max_items_per_report: 10, min_items_per_report: 5, must_include_sections: [],
          opportunity_card_required_fields: [], link_required: true,
          contact_required_if_available: true, deadline_required_if_available: true,
        },
        requirement_confidence: {
          total: 80,
          client_identity: { score: 80, weight: 15, reason: "" },
          business_goal: { score: 80, weight: 20, reason: "" },
          opportunity_type: { score: 80, weight: 20, reason: "" },
          region_scope: { score: 80, weight: 10, reason: "" },
          exclusion_rules: { score: 80, weight: 10, reason: "" },
          action_scenario: { score: 80, weight: 15, reason: "" },
          report_format: { score: 80, weight: 10, reason: "" },
        },
        questions_to_confirm: [],
        confirmation_status: {
          status: "confirmed", user_confirmed: true, confirmed_at: "2026-06-01",
          last_user_feedback: "", revision_count: 0,
        },
      },
    });
    check("19. POST /api/search 传 body.spec(旧逻辑) 返回 200", res.status === 200,
      `status=${res.status}, msg=${json.error?.message}`);
    check("19.1 success=true", json.success === true);
    const data = json.data as { opportunities?: unknown[] } | null;
    check("19.2 返回含 opportunities 字段", Array.isArray(data?.opportunities));
  }

  // ============================================================
  // 总结
  // ============================================================
  console.log("");
  console.log("=== 验收结果（API 部分 1-19）===");
  console.log(`PASS: ${passed} / FAIL: ${failed}`);
  if (failures.length > 0) {
    console.log("失败项：");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }

  // 清理临时文件
  cleanupTempFiles();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("验收脚本执行失败：", err);
  cleanupTempFiles();
  process.exit(1);
});
