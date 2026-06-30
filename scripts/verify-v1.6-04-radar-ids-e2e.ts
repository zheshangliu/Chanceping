/**
 * Task V1.6-04 验收脚本：radarIds 端到端验证
 *
 * 运行：npx tsx scripts/verify-v1.6-04-radar-ids-e2e.ts
 *
 * 验证目标：同一机会被两个雷达命中时，机会库只存一条（按 dedup_key 去重），
 * 但两个雷达详情页都能看到它（entry.radarIds 含两个雷达 id）。
 *
 * 验证范围（8 个步骤）：
 *   步骤 1：创建两个自定义雷达 A 和 B，并激活
 *   步骤 2：雷达 A 运行（POST /api/radars/A/run）
 *   步骤 3：雷达 B 运行（POST /api/radars/B/run）
 *   步骤 4：机会库全局唯一性（dedup_key 无重复）
 *   步骤 5：radarIds 多归属（同一机会 radarIds 含 A 和 B）
 *   步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
 *   步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
 *   步骤 8：直接操作 store 验证 radarIds 去重追加（核心，不受 mock 随机性影响）
 *
 * 测试隔离：使用临时文件 data/*-v1.6.04-test.json，测试后清理。
 * Mock 模式：DATA_MODE=mock + LLM_MODE=mock。
 *
 * 说明：免费用户雷达配额为 1（RADAR_QUOTA.free=1），通过 POST /api/radars 只能
 * 创建 1 个自定义雷达。因此雷达 A 走 API 创建（验证创建路径），雷达 B 因配额限制
 * 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），两者激活后均通过
 * API 运行 / 查询，完整覆盖 radarIds 的端到端路径。
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置，确保 SearchOrchestrator 走 mock 数据）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";

import fs from "fs";
import path from "path";
import { createApp } from "../src/api/app";
import type { AppContext } from "../src/api/context";
import { ModelRouter } from "../src/agents/model-router";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry, StoreQueryResult, RadarType } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { LocalWatchStore } from "../src/watch/watch-store";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { JsonReportStore } from "../src/agents/report-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
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
// 临时文件路径（独特名称，避免与其他测试冲突）
// ============================================================

const TEMP_RADARS_FILE = "data/radars-v1.6.04-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-v1.6.04-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-v1.6.04-test.json";
const TEMP_WATCH_FILE = "data/watch-rules-v1.6.04-test.txt";
const TEMP_REPORT_FILE = "data/report-index-v1.6.04-test.json";

function cleanupTempFiles(): void {
  for (const f of [TEMP_RADARS_FILE, TEMP_RUNS_FILE, TEMP_STORE_FILE, TEMP_WATCH_FILE, TEMP_REPORT_FILE]) {
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
  const reportStore = new JsonReportStore({ file_path: TEMP_REPORT_FILE });

  return {
    llmAdapter: modelRouter,
    store,
    starManager,
    watchStore,
    conversations: new Map(),
    radarStore,
    radarRunStore,
    radarRegistry,
    reportStore,
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

/** POST 请求辅助 */
async function postJson(
  app: ReturnType<typeof createApp>,
  url: string,
  body: unknown,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: await parseResponse(res) };
}

/** GET 请求辅助 */
async function getJson(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ res: Response; json: ApiResponse }> {
  const res = await app.request(url, { method: "GET" });
  return { res, json: await parseResponse(res) };
}

/** 构造一个完整可用的 OpportunityCard（步骤 8 直测用） */
function makeDirectCard(): OpportunityCard {
  return {
    title: "V1.6-04 直测机会（radarIds 去重追加）",
    type: "AI 赛事",
    organizer: "V1.6-04 测试主办方",
    region: "全国",
    deadline: "2026-12-31",
    reward_or_value: "测试奖励",
    eligibility: "测试资格",
    materials_required: "无",
    match_reason: "直测 radarIds 去重追加",
    next_action: "立即报名",
    official_source_url: "https://v1.6-04.test/direct-store-opportunity",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 85,
    visible_level: "A",
    status: "new",
  };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== V1.6-04 radarIds 端到端验证 ===\n");

  const ctx = createTestContext();
  const app = createApp(ctx);

  // ============================================================
  // 步骤 1：创建两个自定义雷达 A 和 B，并激活
  // ============================================================
  section("步骤1: 创建两个自定义雷达");

  let radarIdA = "";
  let radarIdB = "";

  // 雷达 A：通过 API 创建（验证 POST /api/radars 创建路径）
  {
    const { res, json } = await postJson(app, "/api/radars", {
      name: "雷达A",
      kind: "custom",
      spec: { radar_type: "ai_competition", core_keywords: ["AI", "赛事"] },
    });
    const radar = json.data as { id?: string; status?: string; isBuiltin?: boolean } | null;
    radarIdA = radar?.id ?? "";
    check(
      "1.1 POST /api/radars 创建雷达A 返回 200 且 id 非空",
      res.status === 200 && typeof radarIdA === "string" && radarIdA.startsWith("radar_"),
      `status=${res.status}, id=${radarIdA}`,
    );
  }

  // 雷达 B：免费配额=1，API 会拒绝第二个自定义雷达。
  // 直接通过 ctx.radarStore.create() 创建（store 层不检查配额），随后仍走 API 激活/运行。
  {
    const radarB = ctx.radarStore.create({ name: "雷达B", kind: "custom" });
    radarIdB = radarB.id;
    check(
      "1.2 store.create 创建雷达B（绕过 free 配额）id 非空",
      typeof radarIdB === "string" && radarIdB.startsWith("radar_"),
      `id=${radarIdB}`,
    );
  }

  // 激活雷达 A
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.3 POST /api/radars/A/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // 激活雷达 B（B 已在 store 中，API activate 仅按 id 查 store 并改状态）
  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/activate`, {});
    const radar = json.data as { status?: string } | null;
    check(
      "1.4 POST /api/radars/B/activate → status=active",
      res.status === 200 && radar?.status === "active",
      `status=${res.status}, radar.status=${radar?.status}`,
    );
  }

  // ============================================================
  // 步骤 2：雷达 A 运行
  // ============================================================
  section("步骤2: 雷达A 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdA}/run`, { query: "AI比赛" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "2.1 POST /api/radars/A/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "2.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 3：雷达 B 运行
  // ============================================================
  section("步骤3: 雷达B 运行");

  {
    const { res, json } = await postJson(app, `/api/radars/${radarIdB}/run`, { query: "AI赛事" });
    const data = json.data as { run?: { id?: string; status?: string } } | null;
    const runId = data?.run?.id ?? "";
    check(
      "3.1 POST /api/radars/B/run 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "3.2 run.id 非空",
      typeof runId === "string" && runId.length > 0,
      `runId=${runId}`,
    );
  }

  // ============================================================
  // 步骤 4：机会库全局唯一性（dedup_key 无重复）
  // ============================================================
  section("步骤4: 机会库全局唯一性");

  let allEntries: StoreEntry[] = [];
  {
    allEntries = ctx.store.list({ page_size: 10000 }).entries;
    check(
      "4.1 机会库非空（两雷达运行后有结果）",
      allEntries.length > 0,
      `count=${allEntries.length}`,
    );

    // dedup_key 全局唯一（LocalFileStore 用 Map 保证，这里再断言一次）
    const keys = allEntries.map((e) => e.dedup_key);
    const uniqueKeys = new Set(keys);
    check(
      "4.2 dedup_key 全局唯一（无重复条目）",
      keys.length === uniqueKeys.size,
      `total=${keys.length}, unique=${uniqueKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 5：radarIds 多归属验证
  // mock 模式下两雷达均推断为 ai_competition，加载同一份 demo 数据，
  // 因此会命中相同机会（相同 dedup_key），radarIds 应同时含 A 和 B。
  // ============================================================
  section("步骤5: radarIds 多归属验证");

  {
    const withA = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) || e.radarId === radarIdA,
    );
    const withB = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdB) || e.radarId === radarIdB,
    );
    const overlap = allEntries.filter(
      (e) => (e.radarIds ?? []).includes(radarIdA) && (e.radarIds ?? []).includes(radarIdB),
    );

    check(
      "5.1 存在被雷达A和雷达B同时命中的机会（radarIds 含两者）",
      overlap.length > 0,
      `overlap=${overlap.length}, withA=${withA.length}, withB=${withB.length}`,
    );

    // 回退断言：若无交集（mock 数据差异），至少每个雷达自身的机会都带对应 radarId
    if (overlap.length === 0) {
      check(
        "5.2（回退）雷达A 机会均含 radarId=A 且雷达B 机会均含 radarId=B",
        withA.length > 0 && withB.length > 0,
        `withA=${withA.length}, withB=${withB.length}`,
      );
    } else {
      // 交集存在时，抽查一条多归属机会的 radarIds 字段
      const sample = overlap[0];
      check(
        "5.2 多归属机会 radarIds 同时含 A 和 B",
        (sample.radarIds ?? []).includes(radarIdA) && (sample.radarIds ?? []).includes(radarIdB),
        `radarIds=${JSON.stringify(sample.radarIds)}`,
      );
    }
  }

  // ============================================================
  // 步骤 6：按雷达 A 筛选（GET /api/opportunities?radar_id=A）
  // ============================================================
  section("步骤6: 按雷达A 筛选");

  {
    const { res, json } = await getJson(app, `/api/opportunities?radar_id=${radarIdA}`);
    const data = json.data as StoreQueryResult | null;
    const entries = data?.entries ?? [];
    check(
      "6.1 GET /api/opportunities?radar_id=A 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "6.2 按雷达A筛选结果非空",
      entries.length > 0,
      `total=${data?.total ?? 0}`,
    );
    // 每条返回的机会都归属雷达 A（radarId 或 radarIds 命中）
    check(
      "6.3 返回的机会均归属雷达A（list 同时检查 radarId 与 radarIds）",
      entries.length > 0 &&
        entries.every(
          (e) => e.radarId === radarIdA || (e.radarIds ?? []).includes(radarIdA),
        ),
      `不匹配数=${entries.filter((e) => e.radarId !== radarIdA && !(e.radarIds ?? []).includes(radarIdA)).length}`,
    );
  }

  // ============================================================
  // 步骤 7：按雷达 B 筛选（GET /api/opportunities?radar_id=B）
  // ============================================================
  section("步骤7: 按雷达B 筛选");

  {
    const { res, json } = await getJson(app, `/api/opportunities?radar_id=${radarIdB}`);
    const data = json.data as StoreQueryResult | null;
    const entries = data?.entries ?? [];
    check(
      "7.1 GET /api/opportunities?radar_id=B 返回 200 且 success=true",
      res.status === 200 && json.success === true,
      `status=${res.status}, msg=${json.error?.message}`,
    );
    check(
      "7.2 按雷达B筛选结果非空",
      entries.length > 0,
      `total=${data?.total ?? 0}`,
    );
    check(
      "7.3 返回的机会均归属雷达B（list 同时检查 radarId 与 radarIds）",
      entries.length > 0 &&
        entries.every(
          (e) => e.radarId === radarIdB || (e.radarIds ?? []).includes(radarIdB),
        ),
      `不匹配数=${entries.filter((e) => e.radarId !== radarIdB && !(e.radarIds ?? []).includes(radarIdB)).length}`,
    );

    // 额外验证：A 和 B 筛选到的机会集合应一致（同一批机会，多归属）
    const aRes = await getJson(app, `/api/opportunities?radar_id=${radarIdA}`);
    const aData = aRes.json.data as StoreQueryResult | null;
    const aKeys = new Set((aData?.entries ?? []).map((e) => e.dedup_key));
    const bKeys = new Set(entries.map((e) => e.dedup_key));
    const sameSet = aKeys.size === bKeys.size && [...aKeys].every((k) => bKeys.has(k));
    check(
      "7.4 雷达A与雷达B筛选到同一批机会（dedup_key 集合一致）",
      sameSet,
      `aKeys=${aKeys.size}, bKeys=${bKeys.size}`,
    );
  }

  // ============================================================
  // 步骤 8：直接操作 store 验证 radarIds 去重追加（核心）
  // 用 ctx.store.add() 手动添加同一个机会两次，分别传 radarId="A" 和 radarId="B"，
  // 验证：只存一条（dedup_key 相同），radarIds 含 ["A","B"]，且按 A / B 均能查到。
  // 此步骤直接验证 LocalFileStore 的去重追加逻辑，不受 mock 数据随机性影响。
  // ============================================================
  section("步骤8: 直接操作 store 验证 radarIds 去重追加（核心）");

  {
    const card = makeDirectCard();
    const radarType: RadarType = "ai_competition";

    // 运行前该机会不应存在
    const beforeCount = ctx.store.list({ page_size: 10000 }).entries.filter(
      (e) => e.dedup_key === "" /* placeholder，下面用真实 key */,
    ).length;

    // 第一次添加（radarId="A"）
    const entry1 = ctx.store.add(card, radarType, "A");
    const dedupKey = entry1.dedup_key;
    check(
      "8.1 store.add(card, 'A') 返回 entry 且 dedup_key 非空",
      typeof dedupKey === "string" && dedupKey.length > 0,
      `dedup_key=${dedupKey}`,
    );
    check(
      "8.2 首次添加后 entry.radarIds 含 ['A']",
      (entry1.radarIds ?? []).includes("A"),
      `radarIds=${JSON.stringify(entry1.radarIds)}`,
    );

    // 第二次添加同一机会（radarId="B"）—— 应去重追加，而非新增
    const countAfterFirst = ctx.store.list({ page_size: 10000 }).entries.filter(
      (e) => e.dedup_key === dedupKey,
    ).length;
    const entry2 = ctx.store.add(card, radarType, "B");
    const countAfterSecond = ctx.store.list({ page_size: 10000 }).entries.filter(
      (e) => e.dedup_key === dedupKey,
    ).length;

    check(
      "8.3 第二次 add 同一机会 → dedup_key 相同（去重）",
      entry2.dedup_key === dedupKey,
      `key1=${dedupKey}, key2=${entry2.dedup_key}`,
    );
    check(
      "8.4 该机会只出现一次（count 未因第二次 add 增加）",
      countAfterFirst === 1 && countAfterSecond === 1,
      `afterFirst=${countAfterFirst}, afterSecond=${countAfterSecond}`,
    );
    check(
      "8.5 entry.radarIds 同时含 ['A', 'B']",
      (entry2.radarIds ?? []).includes("A") && (entry2.radarIds ?? []).includes("B"),
      `radarIds=${JSON.stringify(entry2.radarIds)}`,
    );

    // get() 返回单条且 radarIds 含两者
    const got = ctx.store.get(dedupKey);
    check(
      "8.6 store.get(key) 返回单条且 radarIds 含 ['A','B']",
      got !== null &&
        (got.radarIds ?? []).includes("A") &&
        (got.radarIds ?? []).includes("B"),
      `got=${got ? "exists" : "null"}, radarIds=${JSON.stringify(got?.radarIds)}`,
    );

    // list({ radarId: "A" }) 能查到该机会
    const listA = ctx.store.list({ radarId: "A", page_size: 10000 }).entries;
    check(
      "8.7 list({ radarId: 'A' }) 能查到该机会",
      listA.some((e) => e.dedup_key === dedupKey),
      `匹配数=${listA.filter((e) => e.dedup_key === dedupKey).length}`,
    );

    // list({ radarId: "B" }) 能查到该机会
    const listB = ctx.store.list({ radarId: "B", page_size: 10000 }).entries;
    check(
      "8.8 list({ radarId: 'B' }) 能查到该机会",
      listB.some((e) => e.dedup_key === dedupKey),
      `匹配数=${listB.filter((e) => e.dedup_key === dedupKey).length}`,
    );

    // 清理：删除直测机会，避免影响后续（虽然脚本结束会清理临时文件）
    ctx.store.delete(dedupKey);
    void beforeCount;
  }

  // ============================================================
  // 总结
  // ============================================================
  console.log("");
  console.log(`=== 结果: ${passed} PASS / ${failed} FAIL ===`);
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
