/**
 * Task 023 验收脚本：MeilisearchStore 适配
 *
 * 来源：Task 023 第 4.5 节。
 *
 * 验证内容：
 *   5.1 接口兼容性测试（LocalFileStore + MeilisearchStore 对照，27 项 × 2）
 *   5.2 MeilisearchStore 独有能力测试（search，3 项）
 *   5.3 工厂函数测试（4 项）
 *   5.4 数据迁移测试（3 项）
 *   5.5 工程约束自检（5 项）
 *
 * 测试策略：
 *   - MeilisearchStore 使用 mockMode=true，不依赖真实 Meilisearch 服务
 *   - 临时文件用 data/opportunity-store-task023-*.json，测试后清理
 *   - 所有测试都能 PASS
 */

import fs from "fs";
import path from "path";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type {
  OpportunityStore,
  StoreEntry,
  StoreQuery,
  RadarType,
} from "../src/agents/opportunity-store";
import { MeilisearchStore } from "../src/agents/meilisearch-store";
import { createStore, getStoreType, type StoreType } from "../src/agents/store-factory";
import type { OpportunityCard, OpportunityCardStatus } from "../src/schema/opportunity-card";
import type { CardVisibleLevel } from "../src/schema/scoring-rules";

// ============================================================
// 测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(cond: boolean, label: string): void {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

// ============================================================
// Mock 数据
// ============================================================

/** 构造完整 OpportunityCard */
function makeCard(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    title: "测试机会",
    type: "AI 赛事",
    organizer: "测试主办方",
    region: "上海",
    deadline: "2099-12-31",
    reward_or_value: "奖金 10 万",
    eligibility: "全国开发者",
    materials_required: "项目说明",
    match_reason: "匹配 AI 技术",
    next_action: "立即报名",
    official_source_url: "https://example.com/test",
    application_url: "https://example.com/apply",
    contact_info: "test@example.com",
    risk_note: "无",
    backend_score: 75,
    visible_level: "A",
    status: "new",
    ...overrides,
  };
}

/** 5 条 Mock 数据，覆盖不同类型/等级/地区/截止日期/状态 */
function makeMockCards(): OpportunityCard[] {
  const today = new Date();
  const futureDate = (days: number): string => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  };

  return [
    makeCard({
      title: "AI 创新大赛",
      type: "AI 赛事",
      organizer: "上海科技局",
      region: "上海",
      deadline: futureDate(3),  // 即将截止
      backend_score: 90,
      visible_level: "S",
      status: "new",
      official_source_url: "https://example.com/ai-contest",
    }),
    makeCard({
      title: "政策补贴申报",
      type: "政策补贴",
      organizer: "国家发改委",
      region: "全国",
      deadline: futureDate(30),  // 本月
      backend_score: 80,
      visible_level: "A",
      status: "saved",
      official_source_url: "https://example.com/policy",
    }),
    makeCard({
      title: "文创设计比赛",
      type: "文创比赛",
      organizer: "文化部",
      region: "北京",
      deadline: futureDate(60),  // 远期
      backend_score: 70,
      visible_level: "B",
      status: "viewed",
      official_source_url: "https://example.com/cultural",
    }),
    makeCard({
      title: "海外 AI 峰会",
      type: "AI 赛事",
      organizer: "OpenAI",
      region: "海外",
      deadline: futureDate(180),  // 远期
      backend_score: 60,
      visible_level: "C",
      status: "new",
      official_source_url: "https://example.com/overseas",
    }),
    makeCard({
      title: "已截止的比赛",
      type: "AI 赛事",
      organizer: "旧主办方",
      region: "全国",
      deadline: futureDate(-10),  // 已截止
      backend_score: 50,
      visible_level: "C",
      status: "archived",
      official_source_url: "https://example.com/expired",
    }),
  ];
}

// ============================================================
// 临时文件管理
// ============================================================

const TEMP_FILES: string[] = [
  "data/opportunity-store-task023-local.json",
  "data/opportunity-store-task023-meili.json",
];

function cleanupTempFiles(): void {
  for (const f of TEMP_FILES) {
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
// 接口兼容性测试（对 LocalFileStore 和 MeilisearchStore 各跑一遍）
// ============================================================

function runCompatibilityTests(store: OpportunityStore, label: string): void {
  section(`5.1 接口兼容性测试 - ${label}`);

  const cards = makeMockCards();

  // 测试 3: add() 添加卡片
  const entry1 = store.add(cards[0], "ai_competition");
  check(entry1.dedup_key.length > 0, `${label} 3. add() 添加卡片返回 dedup_key`);
  check(entry1.card.title === cards[0].title, `${label} 3.1 add() 卡片标题一致`);

  // 测试 4: add() 去重
  const entry1Again = store.add(cards[0], "ai_competition");
  check(entry1Again.dedup_key === entry1.dedup_key, `${label} 4. add() 去重 dedup_key 一致`);
  const listAll = store.list({ page: 1, page_size: 100 });
  check(listAll.total === 1, `${label} 4.1 add() 去重后总数仍为 1`);

  // 测试 5: addBatch() 批量添加
  store.addBatch([cards[1], cards[2], cards[3]], "ai_competition");
  const listAfterBatch = store.list({ page: 1, page_size: 100 });
  check(listAfterBatch.total === 4, `${label} 5. addBatch() 批量添加后总数为 4`);

  // 测试 6: get() 获取单条
  const got = store.get(entry1.dedup_key);
  check(got !== null, `${label} 6. get() 获取单条非 null`);
  check(got?.card.title === cards[0].title, `${label} 6.1 get() 标题一致`);

  // 测试 7: get() 不存在返回 null
  const notFound = store.get("nonexistent_key_12345");
  check(notFound === null, `${label} 7. get() 不存在返回 null`);

  // 测试 8: list() 无筛选
  const listNoFilter = store.list({ page: 1, page_size: 100 });
  check(listNoFilter.total === 4, `${label} 8. list() 无筛选返回 4 条`);

  // 测试 9: list() 按 radar_type 筛选
  const listByRadar = store.list({ radar_type: "ai_competition", page: 1, page_size: 100 });
  check(listByRadar.total === 4, `${label} 9. list() radar_type=ai_competition 返回 4 条`);

  // 测试 10: list() 按 visible_level 筛选
  const listByLevel = store.list({ visible_level: "S", page: 1, page_size: 100 });
  check(listByLevel.total === 1, `${label} 10. list() visible_level=S 返回 1 条`);

  // 测试 11: list() 按 status 筛选
  const listByStatus = store.list({ status: "saved", page: 1, page_size: 100 });
  check(listByStatus.total === 1, `${label} 11. list() status=saved 返回 1 条`);

  // 测试 12: list() 按 deadline_from 筛选
  const future30 = new Date();
  future30.setDate(future30.getDate() + 25);
  const future30Str = future30.toISOString().split("T")[0];
  const listByDeadlineFrom = store.list({ deadline_from: future30Str, page: 1, page_size: 100 });
  check(listByDeadlineFrom.total >= 1, `${label} 12. list() deadline_from 返回 >= 1 条`);

  // 测试 13: list() 按 deadline_to 筛选
  const future5 = new Date();
  future5.setDate(future5.getDate() + 5);
  const future5Str = future5.toISOString().split("T")[0];
  const listByDeadlineTo = store.list({ deadline_to: future5Str, page: 1, page_size: 100 });
  check(listByDeadlineTo.total >= 1, `${label} 13. list() deadline_to 返回 >= 1 条`);

  // 测试 14: list() starred_only 筛选
  const listStarred = store.list({ starred_only: true, page: 1, page_size: 100 });
  check(listStarred.total === 1, `${label} 14. list() starred_only 返回 1 条`);

  // 测试 15: list() expiring_soon 筛选（7 天内，含当天）
  const listExpiring = store.list({ expiring_soon: true, page: 1, page_size: 100 });
  check(listExpiring.total === 1, `${label} 15. list() expiring_soon 返回 1 条`);

  // 测试 16: list() sort_by=added_at desc
  const listSortAdded = store.list({ sort_by: "added_at", sort_order: "desc", page: 1, page_size: 100 });
  check(listSortAdded.entries.length === 4, `${label} 16. list() sort_by=added_at 返回 4 条`);
  if (listSortAdded.entries.length >= 2) {
    const first = listSortAdded.entries[0].added_at;
    const last = listSortAdded.entries[listSortAdded.entries.length - 1].added_at;
    check(first >= last, `${label} 16.1 list() added_at desc 顺序正确`);
  } else {
    check(false, `${label} 16.1 list() added_at desc 顺序正确（条目不足）`);
  }

  // 测试 17: list() sort_by=deadline asc
  const listSortDeadline = store.list({ sort_by: "deadline", sort_order: "asc", page: 1, page_size: 100 });
  if (listSortDeadline.entries.length >= 2) {
    const first = listSortDeadline.entries[0].card.deadline;
    const last = listSortDeadline.entries[listSortDeadline.entries.length - 1].card.deadline;
    check(first <= last, `${label} 17. list() deadline asc 顺序正确`);
  } else {
    check(false, `${label} 17. list() deadline asc 顺序正确（条目不足）`);
  }

  // 测试 18: list() sort_by=backend_score desc
  const listSortScore = store.list({ sort_by: "backend_score", sort_order: "desc", page: 1, page_size: 100 });
  if (listSortScore.entries.length >= 2) {
    const first = listSortScore.entries[0].card.backend_score;
    const last = listSortScore.entries[listSortScore.entries.length - 1].card.backend_score;
    check(first >= last, `${label} 18. list() backend_score desc 顺序正确`);
  } else {
    check(false, `${label} 18. list() backend_score desc 顺序正确（条目不足）`);
  }

  // 测试 19: list() sort_by=visible_level asc
  const listSortLevel = store.list({ sort_by: "visible_level", sort_order: "asc", page: 1, page_size: 100 });
  if (listSortLevel.entries.length >= 2) {
    const priority: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, hidden: 4 };
    const first = priority[listSortLevel.entries[0].card.visible_level] ?? 99;
    const last = priority[listSortLevel.entries[listSortLevel.entries.length - 1].card.visible_level] ?? 99;
    check(first <= last, `${label} 19. list() visible_level asc 顺序正确`);
  } else {
    check(false, `${label} 19. list() visible_level asc 顺序正确（条目不足）`);
  }

  // 测试 20: list() 分页
  const listPage = store.list({ page: 1, page_size: 2 });
  check(listPage.entries.length === 2, `${label} 20. list() page=1,page_size=2 返回 2 条`);
  check(listPage.total === 4, `${label} 20.1 list() total=4`);
  check(listPage.total_pages === 2, `${label} 20.2 list() total_pages=2`);

  // 测试 21: update() 更新卡片
  const updated = store.update(entry1.dedup_key, { status: "viewed" });
  check(updated !== null, `${label} 21. update() 返回非 null`);
  check(updated?.card.status === "viewed", `${label} 21.1 update() status=viewed`);

  // 测试 22: update() 不存在返回 null
  const updateNotFound = store.update("nonexistent_key", { status: "archived" });
  check(updateNotFound === null, `${label} 22. update() 不存在返回 null`);

  // 测试 23: delete() 删除
  const deleted = store.delete(entry1.dedup_key);
  check(deleted === true, `${label} 23. delete() 返回 true`);
  const afterDelete = store.get(entry1.dedup_key);
  check(afterDelete === null, `${label} 23.1 delete() 后 get() 返回 null`);

  // 测试 24: delete() 不存在返回 false
  const deleteNotFound = store.delete(entry1.dedup_key);
  check(deleteNotFound === false, `${label} 24. delete() 不存在返回 false`);

  // 测试 25: stats() 统计
  const stats = store.stats();
  check(stats.total === 3, `${label} 25. stats() total=3（删除后剩 3 条）`);
  check(typeof stats.starred_count === "number", `${label} 25.1 stats() starred_count 是数字`);
  check(typeof stats.expiring_soon_count === "number", `${label} 25.2 stats() expiring_soon_count 是数字`);
  check(Object.keys(stats.by_radar_type).length === 3, `${label} 25.3 stats() by_radar_type 有 3 个雷达`);
  check(Object.keys(stats.by_status).length === 6, `${label} 25.4 stats() by_status 有 6 个状态`);

  // 测试 26: flush() 不报错
  let flushOk = true;
  try {
    store.flush();
  } catch {
    flushOk = false;
  }
  check(flushOk, `${label} 26. flush() 不报错`);

  // 测试 27: load() 不报错
  let loadOk = true;
  try {
    store.load();
  } catch {
    loadOk = false;
  }
  check(loadOk, `${label} 27. load() 不报错`);
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("=== Task 023 验收检查：MeilisearchStore 适配 ===");

  // 清理可能的残留临时文件
  cleanupTempFiles();

  // ----------------------------------------------------------
  // 5.1 接口兼容性测试（LocalFileStore + MeilisearchStore 对照）
  // ----------------------------------------------------------

  const localStore = new LocalFileStore({
    file_path: TEMP_FILES[0],
    auto_flush: false,
  });
  runCompatibilityTests(localStore, "LocalFileStore");

  const meiliStore = new MeilisearchStore({
    autoFlush: false,
    mockMode: true,
  });
  runCompatibilityTests(meiliStore, "MeilisearchStore");

  // ----------------------------------------------------------
  // 5.2 MeilisearchStore 独有能力测试
  // ----------------------------------------------------------
  section("5.2 MeilisearchStore 独有能力测试");

  // 准备数据
  const searchStore = new MeilisearchStore({
    autoFlush: false,
    mockMode: true,
  });
  const searchCards = makeMockCards();
  searchStore.addBatch(searchCards, "ai_competition");

  // 测试 28: search() 全文搜索（title 关键词）
  const searchResult1 = await searchStore.search("AI");
  check(searchResult1.length >= 1, `28. search("AI") 返回 >= 1 条`);
  check(
    searchResult1.some((e) => e.card.title.includes("AI")),
    `28.1 search("AI") 结果含 "AI" 标题`,
  );

  // 测试 29: search() 按 radar_type 过滤
  const searchResult2 = await searchStore.search("比赛", { radar_type: "ai_competition" });
  check(searchResult2.length >= 1, `29. search("比赛", radar_type=ai_competition) 返回 >= 1 条`);
  check(
    searchResult2.every((e) => e.radar_type === "ai_competition"),
    `29.1 search() radar_type 过滤正确`,
  );

  // 测试 30: search() limit 限制
  const searchResult3 = await searchStore.search("", { limit: 2 });
  check(searchResult3.length <= 2, `30. search("", limit=2) 返回 <= 2 条`);

  // ----------------------------------------------------------
  // 5.3 工厂函数测试
  // ----------------------------------------------------------
  section("5.3 工厂函数测试");

  // 保存原始环境变量
  const origStoreType = process.env.STORE_TYPE;

  // 测试 31: STORE_TYPE=local 返回 LocalFileStore
  process.env.STORE_TYPE = "local";
  const storeLocal = createStore();
  check(storeLocal instanceof LocalFileStore, `31. STORE_TYPE=local 返回 LocalFileStore 实例`);

  // 测试 32: STORE_TYPE=meili 返回 MeilisearchStore
  process.env.STORE_TYPE = "meili";
  process.env.MEILI_MOCK = "true";
  const storeMeili = createStore();
  check(storeMeili instanceof MeilisearchStore, `32. STORE_TYPE=meili 返回 MeilisearchStore 实例`);

  // 测试 33: STORE_TYPE 未设置返回 LocalFileStore（默认）
  delete process.env.STORE_TYPE;
  const storeDefault = createStore();
  check(storeDefault instanceof LocalFileStore, `33. STORE_TYPE 未设置返回 LocalFileStore（默认）`);

  // 测试 34: getStoreType() 返回正确类型
  process.env.STORE_TYPE = "local";
  check(getStoreType() === "local", `34. getStoreType() STORE_TYPE=local 返回 "local"`);
  process.env.STORE_TYPE = "meili";
  check(getStoreType() === "meili", `34.1 getStoreType() STORE_TYPE=meili 返回 "meili"`);
  delete process.env.STORE_TYPE;
  check(getStoreType() === "local", `34.2 getStoreType() 默认返回 "local"`);

  // 恢复环境变量
  if (origStoreType !== undefined) {
    process.env.STORE_TYPE = origStoreType;
  } else {
    delete process.env.STORE_TYPE;
  }
  delete process.env.MEILI_MOCK;

  // ----------------------------------------------------------
  // 5.4 数据迁移测试
  // ----------------------------------------------------------
  section("5.4 数据迁移测试");

  // 测试 35: 迁移脚本核心逻辑 - LocalFileStore 数据导入 MeilisearchStore
  const migrateSource = new LocalFileStore({
    file_path: TEMP_FILES[1],
    auto_flush: false,
  });
  const migrateCards = makeMockCards();
  migrateSource.addBatch(migrateCards, "ai_competition");
  const sourceList = migrateSource.list({ page: 1, page_size: 100 });
  const sourceEntries = sourceList.entries;

  const migrateTarget = new MeilisearchStore({
    autoFlush: false,
    mockMode: true,
  });
  // 执行迁移：逐条 add 到目标 store
  for (const entry of sourceEntries) {
    migrateTarget.add(entry.card, entry.radar_type);
  }

  // 测试 36: 迁移后条目数一致
  const targetList = migrateTarget.list({ page: 1, page_size: 100 });
  check(targetList.total === sourceEntries.length, `35. 迁移完成（add 逐条导入）`);
  check(targetList.total === sourceEntries.length, `36. 迁移后条目数一致（${sourceEntries.length}）`);

  // 测试 37: 迁移后 get() 数据一致
  let dataConsistent = true;
  for (const entry of sourceEntries) {
    const target = migrateTarget.get(entry.dedup_key);
    if (!target) {
      dataConsistent = false;
      break;
    }
    if (target.card.title !== entry.card.title) {
      dataConsistent = false;
      break;
    }
    if (target.card.status !== entry.card.status) {
      dataConsistent = false;
      break;
    }
  }
  check(dataConsistent, `37. 迁移后 get() 数据一致（title + status）`);

  // ----------------------------------------------------------
  // 5.5 工程约束自检
  // ----------------------------------------------------------
  section("5.5 工程约束自检");

  // 测试 38: 仅引入 meilisearch 1 个新依赖
  const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const deps = Object.keys(pkgJson.dependencies);
  const newDeps = deps.filter((d: string) => !["@hono/node-server", "ajv", "ajv-formats", "hono", "i18next"].includes(d));
  check(newDeps.includes("meilisearch"), `38. package.json 含 meilisearch 依赖`);
  check(newDeps.length === 1, `38.1 仅引入 1 个新依赖（meilisearch），实际新增：${newDeps.join(",")}`);

  // 测试 39: 不修改 opportunity-store.ts
  const storeContent = fs.readFileSync("src/agents/opportunity-store.ts", "utf-8");
  check(storeContent.includes("export interface OpportunityStore"), `39. opportunity-store.ts 接口保留`);
  check(storeContent.includes("export class LocalFileStore"), `39.1 opportunity-store.ts LocalFileStore 保留`);
  check(storeContent.includes("export function createDefaultStore"), `39.2 opportunity-store.ts createDefaultStore 保留`);

  // 测试 40: 不修改 star-manager.ts
  const starContent = fs.readFileSync("src/agents/star-manager.ts", "utf-8");
  check(starContent.includes("export class StarManager"), `40. star-manager.ts 保留 StarManager 类`);

  // 测试 41: context.ts 改动验证
  const ctxContent = fs.readFileSync("src/api/context.ts", "utf-8");
  check(ctxContent.includes("import { createStore }"), `41. context.ts 使用 createStore`);
  check(ctxContent.includes("store: OpportunityStore"), `41.1 context.ts store 类型为 OpportunityStore`);
  check(!ctxContent.includes("LocalFileStore"), `41.2 context.ts 不再引用 LocalFileStore`);

  // 测试 42: 临时文件清理
  cleanupTempFiles();
  let allCleaned = true;
  for (const f of TEMP_FILES) {
    if (fs.existsSync(f)) {
      allCleaned = false;
      break;
    }
  }
  check(allCleaned, `42. 临时文件已清理`);

  // ----------------------------------------------------------
  // 汇总
  // ----------------------------------------------------------
  console.log("");
  console.log("=== 汇总 ===");
  console.log(`PASS: ${passCount}`);
  console.log(`FAIL: ${failCount}`);
  if (failCount === 0) {
    console.log("✅ 全部通过");
  } else {
    console.log("❌ 失败项：");
    for (const f of failures) {
      console.log(`   - ${f}`);
    }
  }

  // 清理
  cleanupTempFiles();

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("验证脚本异常：", err);
  cleanupTempFiles();
  process.exit(1);
});
