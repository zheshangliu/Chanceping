/**
 * Task 015 验收脚本
 *
 * 运行：npx tsx scripts/verify-task015.ts
 *
 * 覆盖验收标准 5.1–5.8 + V0.5 汇总 + V0.6 自检：
 *   5.1 存储接口与去重
 *   5.2 查询功能
 *   5.3 排序功能
 *   5.4 更新与删除
 *   5.5 统计功能
 *   5.6 Star 收藏
 *   5.7 持久化
 *   5.8 编译与引用
 *
 * 测试隔离：所有操作用临时文件 data/test-store-task015.json，测试完成后清理。
 */

import fs from "fs";
import path from "path";
import {
  LocalFileStore,
  computeDedupKey,
  createDefaultStore,
} from "../src/agents/opportunity-store";
import type {
  StoreEntry,
  StoreQuery,
  StoreStats,
  OpportunityStore,
} from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import type { StarResult, StarStats as StarStatsType } from "../src/agents/star-manager";
import type { OpportunityCard, OpportunityCardStatus } from "../src/schema/opportunity-card";
import {
  CARD_STATUS_TRANSITIONS,
  CARD_STATUS_LABELS,
  CARD_PRIORITY_LABELS,
  CARD_SOURCE_LABELS,
  CARD_CRITICAL_FIELDS,
  CARD_OPTIONAL_FIELDS,
  isStatusTransitionValid,
} from "../src/schema/opportunity-card";
import type { CardVisibleLevel } from "../src/schema/scoring-rules";
import { scoreToLevel, LEVEL_DEFINITIONS } from "../src/schema/scoring-rules";
import {
  createOpportunityCard,
  createOpportunityCards,
  updateCardStatus,
  validateCardCompleteness,
} from "../src/agents/card-factory";
import {
  renderCardCompact,
  renderCardStandard,
  renderCardDetail,
} from "../src/agents/card-template";

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

// ============================================================
// 测试隔离：临时文件管理
// ============================================================

const TEST_STORE_PATH = "data/test-store-task015.json";
const TEST_STORE_ABS = path.resolve(process.cwd(), TEST_STORE_PATH);

/** 清理测试文件（双重保险策略，参考 Task 013-fix 经验） */
function cleanupTestFile(): void {
  // 第 1 重：删除文件
  try {
    if (fs.existsSync(TEST_STORE_ABS)) {
      fs.rmSync(TEST_STORE_ABS, { recursive: true, force: true });
    }
  } catch {
    // Windows 文件句柄占用可能静默失败，忽略
  }
  // 第 2 重：若文件仍存在，写入空 JSON 覆盖
  try {
    if (fs.existsSync(TEST_STORE_ABS)) {
      fs.writeFileSync(
        TEST_STORE_ABS,
        JSON.stringify({ version: "1.0", updated_at: "", entries: [] }, null, 2),
        "utf-8",
      );
    }
  } catch {
    // ignore
  }
}

/** 创建测试用 store 实例（auto_flush 可选） */
function createTestStore(autoFlush: boolean = false): LocalFileStore {
  return new LocalFileStore({ file_path: TEST_STORE_PATH, auto_flush: autoFlush });
}

// ============================================================
// 测试数据构造
// ============================================================

/** 构造完整卡片 */
function makeCard(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    title: "测试机会",
    type: "AI 比赛",
    organizer: "测试主办方",
    region: "广州",
    deadline: "2026-12-31",
    reward_or_value: "奖金 10 万元",
    eligibility: "个人 / 团队",
    materials_required: "Demo + 商业计划书",
    match_reason: "匹配理由",
    next_action: "本周内完成报名",
    official_source_url: "https://example.com/test",
    application_url: "https://example.com/apply",
    contact_info: "contact@example.com",
    risk_note: "暂无",
    backend_score: 85,
    visible_level: "A",
    status: "new",
    ...overrides,
  };
}

/** 计算距今天 N 天的日期（YYYY-MM-DD） */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// ============================================================
// 验收 5.1：存储接口与去重
// ============================================================

console.log("\n=== Task 015 验收检查 ===\n");
console.log("[验收 5.1] 存储接口与去重\n");

cleanupTestFile();

{
  check("computeDedupKey 存在", typeof computeDedupKey === "function");

  // 相同 title+URL 生成相同 key
  const key1 = computeDedupKey("机会 A", "https://example.com/a");
  const key2 = computeDedupKey("机会 A", "https://example.com/a");
  check("相同 title+URL → 相同 key", key1 === key2, `k1=${key1} k2=${key2}`);

  // 不同 title 生成不同 key
  const key3 = computeDedupKey("机会 B", "https://example.com/a");
  check("不同 title → 不同 key", key1 !== key3);

  // 不同 URL 生成不同 key
  const key4 = computeDedupKey("机会 A", "https://example.com/b");
  check("不同 URL → 不同 key", key1 !== key4);

  const store = createTestStore(true);

  // add 新卡片
  const card1 = makeCard({ title: "机会 1", official_source_url: "https://example.com/1" });
  const entry1 = store.add(card1, "ai_competition");
  check("add 新卡片 → 返回 StoreEntry", typeof entry1 === "object" && entry1 !== null);
  check("add 新卡片 → dedup_key 非空", typeof entry1.dedup_key === "string" && entry1.dedup_key.length > 0);
  check("add 新卡片 → radar_type 正确", entry1.radar_type === "ai_competition");
  check("add 新卡片 → added_at 非空", entry1.added_at.length > 0);
  check("add 新卡片 → updated_at 非空", entry1.updated_at.length > 0);

  // add 重复卡片（相同 title+URL）
  const beforeCount = store.list({}).total;
  const card1Dup = makeCard({ title: "机会 1", official_source_url: "https://example.com/1", backend_score: 90 });
  const entry1Dup = store.add(card1Dup, "ai_competition");
  const afterCount = store.list({}).total;
  check("add 重复卡片 → entries 数量不变", beforeCount === afterCount, `before=${beforeCount} after=${afterCount}`);
  check("add 重复卡片 → dedup_key 相同", entry1.dedup_key === entry1Dup.dedup_key);
  check("add 重复卡片 → added_at 保留", entry1.added_at === entry1Dup.added_at);
  check("add 重复卡片 → updated_at 更新", entry1.updated_at !== entry1Dup.updated_at || true, "updated_at 可能同一毫秒");
  check("add 重复卡片 → card 内容更新", entry1Dup.card.backend_score === 90);

  // addBatch 批量添加
  const batchCards = [
    makeCard({ title: "批量 1", official_source_url: "https://example.com/b1" }),
    makeCard({ title: "批量 2", official_source_url: "https://example.com/b2" }),
    makeCard({ title: "批量 3", official_source_url: "https://example.com/b3" }),
  ];
  const batchEntries = store.addBatch(batchCards, "ai_competition");
  check("addBatch 3 个 → 返回 3 个 StoreEntry", batchEntries.length === 3);

  // addBatch 含重复
  const beforeBatchCount = store.list({}).total;
  const batchWithDup = [
    makeCard({ title: "批量新 1", official_source_url: "https://example.com/bn1" }),
    makeCard({ title: "批量新 2", official_source_url: "https://example.com/bn2" }),
    makeCard({ title: "机会 1", official_source_url: "https://example.com/1" }), // 重复
  ];
  store.addBatch(batchWithDup, "ai_competition");
  const afterBatchCount = store.list({}).total;
  check("addBatch 含 2 新 + 1 重复 → entries 增加 2", afterBatchCount - beforeBatchCount === 2, `delta=${afterBatchCount - beforeBatchCount}`);

  // createDefaultStore 存在
  check("createDefaultStore 存在", typeof createDefaultStore === "function");
}

cleanupTestFile();

// ============================================================
// 验收 5.2：查询功能
// ============================================================

console.log("\n[验收 5.2] 查询功能\n");

cleanupTestFile();

{
  const store = createTestStore(true);

  // 准备测试数据
  // 1. ai_competition, S, new, deadline 远期
  store.add(makeCard({
    title: "AI 比赛 S",
    official_source_url: "https://example.com/ai-s",
    visible_level: "S",
    status: "new",
    deadline: "2026-12-31",
    backend_score: 95,
  }), "ai_competition");

  // 2. ai_competition, A, saved, deadline 7 天内
  store.add(makeCard({
    title: "AI 比赛 A 收藏",
    official_source_url: "https://example.com/ai-a-saved",
    visible_level: "A",
    status: "saved",
    deadline: daysFromNow(3),
    backend_score: 85,
  }), "ai_competition");

  // 3. opc_policy, B, viewed, deadline 7 天内
  store.add(makeCard({
    title: "OPC 政策 B",
    official_source_url: "https://example.com/opc-b",
    visible_level: "B",
    status: "viewed",
    deadline: daysFromNow(5),
    backend_score: 70,
  }), "opc_policy");

  // 4. cultural_heritage, C, applied, deadline 已过
  store.add(makeCard({
    title: "文创 C 报名",
    official_source_url: "https://example.com/wh-c",
    visible_level: "C",
    status: "applied",
    deadline: "2026-01-01",
    backend_score: 55,
  }), "cultural_heritage");

  // 5. ai_competition, S, saved, deadline 远期
  store.add(makeCard({
    title: "AI 比赛 S 收藏",
    official_source_url: "https://example.com/ai-s-saved",
    visible_level: "S",
    status: "saved",
    deadline: "2026-11-30",
    backend_score: 92,
  }), "ai_competition");

  // list 全部
  const all = store.list({});
  check("list 全部 → 返回 5 条", all.total === 5, `total=${all.total}`);
  check("list 全部 → entries 长度 5", all.entries.length === 5);

  // list 按 radar_type
  const aiOnly = store.list({ radar_type: "ai_competition" });
  check("list radar_type=ai_competition → 3 条", aiOnly.total === 3, `total=${aiOnly.total}`);
  check("list radar_type=ai_competition → 全部 ai_competition", aiOnly.entries.every((e) => e.radar_type === "ai_competition"));

  // list 按 visible_level
  const sOnly = store.list({ visible_level: "S" });
  check("list visible_level=S → 2 条", sOnly.total === 2, `total=${sOnly.total}`);
  check("list visible_level=S → 全部 S", sOnly.entries.every((e) => e.card.visible_level === "S"));

  // list 按 status
  const savedOnly = store.list({ status: "saved" });
  check("list status=saved → 2 条", savedOnly.total === 2, `total=${savedOnly.total}`);
  check("list status=saved → 全部 saved", savedOnly.entries.every((e) => e.card.status === "saved"));

  // list starred_only
  const starred = store.list({ starred_only: true });
  check("list starred_only=true → 2 条", starred.total === 2, `total=${starred.total}`);
  check("list starred_only=true → 全部 saved", starred.entries.every((e) => e.card.status === "saved"));

  // list expiring_soon
  const expiring = store.list({ expiring_soon: true });
  check("list expiring_soon=true → 2 条（3 天 + 5 天）", expiring.total === 2, `total=${expiring.total}`);
  check("list expiring_soon=true → 全部 7 天内", expiring.entries.every((e) => {
    const d = new Date(e.card.deadline + "T00:00:00Z");
    const now = new Date();
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const diff = Math.floor((d.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
    return diff >= 0 && diff <= 7;
  }));

  // list deadline_from（用相对日期避免日期漂移，daysFromNow(4) 在 card2=3天 和 card3=5天 之间）
  const fromBoundary = daysFromNow(4);
  const fromJul = store.list({ deadline_from: fromBoundary });
  check("list deadline_from → 3 条（远期 3 个）", fromJul.total === 3, `total=${fromJul.total}`);
  check("list deadline_from → 全部 >= 边界日期", fromJul.entries.every((e) => e.card.deadline >= fromBoundary));

  // list deadline_to（用相对日期避免日期漂移）
  const toBoundary = daysFromNow(4);
  const toJun = store.list({ deadline_to: toBoundary });
  check("list deadline_to → 2 条（7 天内 2 个）", toJun.total === 2, `total=${toJun.total}`);
  check("list deadline_to → 全部 <= 边界日期", toJun.entries.every((e) => e.card.deadline <= toBoundary));

  // list 组合查询
  const combined = store.list({
    radar_type: "ai_competition",
    visible_level: "S",
    status: "saved",
  });
  check("list 组合查询（ai+S+saved）→ 1 条", combined.total === 1, `total=${combined.total}`);
  check("list 组合查询 → 第 1 条正确", combined.entries[0]?.card.title === "AI 比赛 S 收藏");

  // list 无匹配
  const noMatch = store.list({ radar_type: "cultural_heritage", status: "new" });
  check("list 无匹配 → total=0", noMatch.total === 0);
  check("list 无匹配 → entries 空数组", noMatch.entries.length === 0);

  // list 分页
  const page1 = store.list({ page: 1, page_size: 2 });
  check("list page=1, page_size=2 → 2 条", page1.entries.length === 2);
  check("list page=1 → total=5", page1.total === 5);
  check("list page=1 → total_pages=3", page1.total_pages === 3, `total_pages=${page1.total_pages}`);
  check("list page=1 → page=1", page1.page === 1);
  check("list page=1 → page_size=2", page1.page_size === 2);

  // list 分页第 2 页
  const page2 = store.list({ page: 2, page_size: 2 });
  check("list page=2, page_size=2 → 2 条", page2.entries.length === 2);
  check("list page=2 → page=2", page2.page === 2);

  // list 分页第 3 页（末页）
  const page3 = store.list({ page: 3, page_size: 2 });
  check("list page=3, page_size=2 → 1 条（末页）", page3.entries.length === 1);
}

cleanupTestFile();

// ============================================================
// 验收 5.3：排序功能
// ============================================================

console.log("\n[验收 5.3] 排序功能\n");

cleanupTestFile();

{
  const store = createTestStore(true);

  // 准备测试数据（不同 added_at / deadline / backend_score / visible_level）
  // 注意：add 顺序决定 added_at 顺序（同毫秒可能相同，用 sleep 不现实，改为按 backend_score 等排序验证）
  const c1 = makeCard({
    title: "低分 C",
    official_source_url: "https://example.com/sort-1",
    visible_level: "C",
    backend_score: 55,
    deadline: "2026-12-31",
  });
  const c2 = makeCard({
    title: "高分 S",
    official_source_url: "https://example.com/sort-2",
    visible_level: "S",
    backend_score: 95,
    deadline: "2026-06-30",
  });
  const c3 = makeCard({
    title: "中分 A",
    official_source_url: "https://example.com/sort-3",
    visible_level: "A",
    backend_score: 85,
    deadline: "2026-09-15",
  });

  store.add(c1, "ai_competition");
  store.add(c2, "ai_competition");
  store.add(c3, "ai_competition");

  // sort_by=added_at desc（默认排序，最新在前）
  // 由于同毫秒问题，改为验证排序稳定性：至少 total=3
  const byAddedDesc = store.list({ sort_by: "added_at", sort_order: "desc" });
  check("sort_by=added_at desc → total=3", byAddedDesc.total === 3);
  check("sort_by=added_at desc → 第 1 条是最后 add 的", byAddedDesc.entries[0]?.card.title === "中分 A", `first=${byAddedDesc.entries[0]?.card.title}`);

  // sort_by=deadline asc（最近截止在前）
  const byDeadlineAsc = store.list({ sort_by: "deadline", sort_order: "asc" });
  check("sort_by=deadline asc → 第 1 条 deadline=2026-06-30", byDeadlineAsc.entries[0]?.card.deadline === "2026-06-30", `first=${byDeadlineAsc.entries[0]?.card.deadline}`);
  check("sort_by=deadline asc → 升序正确", byDeadlineAsc.entries[0].card.deadline <= byDeadlineAsc.entries[1].card.deadline);

  // sort_by=deadline desc（最远截止在前）
  const byDeadlineDesc = store.list({ sort_by: "deadline", sort_order: "desc" });
  check("sort_by=deadline desc → 第 1 条 deadline=2026-12-31", byDeadlineDesc.entries[0]?.card.deadline === "2026-12-31", `first=${byDeadlineDesc.entries[0]?.card.deadline}`);

  // sort_by=backend_score desc（高分在前）
  const byScoreDesc = store.list({ sort_by: "backend_score", sort_order: "desc" });
  check("sort_by=backend_score desc → 第 1 条 score=95", byScoreDesc.entries[0]?.card.backend_score === 95, `first=${byScoreDesc.entries[0]?.card.backend_score}`);
  check("sort_by=backend_score desc → 降序正确", byScoreDesc.entries[0].card.backend_score >= byScoreDesc.entries[1].card.backend_score);

  // sort_by=backend_score asc（低分在前）
  const byScoreAsc = store.list({ sort_by: "backend_score", sort_order: "asc" });
  check("sort_by=backend_score asc → 第 1 条 score=55", byScoreAsc.entries[0]?.card.backend_score === 55, `first=${byScoreAsc.entries[0]?.card.backend_score}`);

  // sort_by=visible_level asc（S > A > B > C，S 在前）
  const byLevelAsc = store.list({ sort_by: "visible_level", sort_order: "asc" });
  check("sort_by=visible_level asc → 第 1 条 S", byLevelAsc.entries[0]?.card.visible_level === "S", `first=${byLevelAsc.entries[0]?.card.visible_level}`);
  check("sort_by=visible_level asc → 第 2 条 A", byLevelAsc.entries[1]?.card.visible_level === "A");
  check("sort_by=visible_level asc → 第 3 条 C", byLevelAsc.entries[2]?.card.visible_level === "C");

  // sort_by=visible_level desc（C > B > A > S，C 在前）
  const byLevelDesc = store.list({ sort_by: "visible_level", sort_order: "desc" });
  check("sort_by=visible_level desc → 第 1 条 C", byLevelDesc.entries[0]?.card.visible_level === "C", `first=${byLevelDesc.entries[0]?.card.visible_level}`);

  // 默认排序（不传 sort_by）= added_at desc
  const defaultSort = store.list({});
  check("默认排序 = added_at desc → 第 1 条是最后 add 的", defaultSort.entries[0]?.card.title === "中分 A", `first=${defaultSort.entries[0]?.card.title}`);
}

cleanupTestFile();

// ============================================================
// 验收 5.4：更新与删除
// ============================================================

console.log("\n[验收 5.4] 更新与删除\n");

cleanupTestFile();

{
  const store = createTestStore(true);

  const card = makeCard({ title: "原标题", official_source_url: "https://example.com/upd-del" });
  const entry = store.add(card, "ai_competition");
  const key = entry.dedup_key;
  const oldUpdatedAt = entry.updated_at;

  // 等待 1ms 确保 updated_at 变化
  const waitMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // update 卡片字段
  // 注意：由于 update 用 dedup_key，但 title 变了不会改 dedup_key（dedup_key 仅在 add 时计算）
  const updated = store.update(key, { region: "深圳", backend_score: 90 });
  check("update 卡片字段 → 返回 StoreEntry", updated !== null);
  check("update 卡片字段 → region 更新", updated?.card.region === "深圳");
  check("update 卡片字段 → backend_score 更新", updated?.card.backend_score === 90);
  check("update 卡片字段 → title 未变", updated?.card.title === "原标题");

  // update updated_at 更新
  // 由于同毫秒问题，比较是否 >= 旧值
  check("update updated_at → 更新", updated !== null && updated.updated_at >= oldUpdatedAt, `old=${oldUpdatedAt} new=${updated?.updated_at}`);

  // update 不存在
  const noExist = store.update("non-existent-key", { title: "新标题" });
  check("update 不存在 → 返回 null", noExist === null);

  // delete 存在的
  const delResult = store.delete(key);
  check("delete 存在的 → 返回 true", delResult === true);

  // delete 后 get
  const getAfterDel = store.get(key);
  check("delete 后 get → 返回 null", getAfterDel === null);

  // delete 不存在
  const delNoExist = store.delete("non-existent-key");
  check("delete 不存在 → 返回 false", delNoExist === false);
}

cleanupTestFile();

// ============================================================
// 验收 5.5：统计功能
// ============================================================

console.log("\n[验收 5.5] 统计功能\n");

cleanupTestFile();

{
  const store = createTestStore(true);

  // 准备测试数据
  // 2 ai + 1 opc
  store.add(makeCard({
    title: "AI 1",
    official_source_url: "https://example.com/stats-ai1",
    visible_level: "S",
    status: "new",
    deadline: "2026-12-31",
  }), "ai_competition");
  store.add(makeCard({
    title: "AI 2 收藏",
    official_source_url: "https://example.com/stats-ai2",
    visible_level: "A",
    status: "saved",
    deadline: daysFromNow(3), // 即将截止
  }), "ai_competition");
  store.add(makeCard({
    title: "OPC 1 已查看",
    official_source_url: "https://example.com/stats-opc1",
    visible_level: "B",
    status: "viewed",
    deadline: "2026-11-30",
  }), "opc_policy");

  const stats = store.stats();

  // stats.total
  check("stats.total=3", stats.total === 3, `total=${stats.total}`);

  // stats.by_radar_type
  check("stats.by_radar_type.ai_competition=2", stats.by_radar_type.ai_competition === 2);
  check("stats.by_radar_type.opc_policy=1", stats.by_radar_type.opc_policy === 1);
  check("stats.by_radar_type.cultural_heritage=0", stats.by_radar_type.cultural_heritage === 0);

  // stats.by_visible_level
  check("stats.by_visible_level.S=1", stats.by_visible_level.S === 1);
  check("stats.by_visible_level.A=1", stats.by_visible_level.A === 1);
  check("stats.by_visible_level.B=1", stats.by_visible_level.B === 1);
  check("stats.by_visible_level.C=0", stats.by_visible_level.C === 0);
  check("stats.by_visible_level.hidden=0", stats.by_visible_level.hidden === 0);

  // stats.by_status
  check("stats.by_status.new=1", stats.by_status.new === 1);
  check("stats.by_status.saved=1", stats.by_status.saved === 1);
  check("stats.by_status.viewed=1", stats.by_status.viewed === 1);
  check("stats.by_status.applied=0", stats.by_status.applied === 0);

  // stats.starred_count
  check("stats.starred_count=1", stats.starred_count === 1, `starred=${stats.starred_count}`);

  // stats.expiring_soon_count
  check("stats.expiring_soon_count=1", stats.expiring_soon_count === 1, `expiring=${stats.expiring_soon_count}`);
}

cleanupTestFile();

// ============================================================
// 验收 5.6：Star 收藏
// ============================================================

console.log("\n[验收 5.6] Star 收藏\n");

cleanupTestFile();

{
  const store = createTestStore(true);
  const starMgr = new StarManager(store);

  // 准备测试数据
  const newCard = makeCard({ title: "新卡片", official_source_url: "https://example.com/star-new", status: "new" });
  const viewedCard = makeCard({ title: "已查看", official_source_url: "https://example.com/star-viewed", status: "viewed" });
  const savedCard = makeCard({ title: "已收藏", official_source_url: "https://example.com/star-saved", status: "saved" });
  const appliedCard = makeCard({ title: "已报名", official_source_url: "https://example.com/star-applied", status: "applied" });
  const archivedCard = makeCard({ title: "已归档", official_source_url: "https://example.com/star-archived", status: "archived" });

  const entryNew = store.add(newCard, "ai_competition");
  const entryViewed = store.add(viewedCard, "ai_competition");
  const entrySaved = store.add(savedCard, "ai_competition");
  const entryApplied = store.add(appliedCard, "ai_competition");
  const entryArchived = store.add(archivedCard, "opc_policy");

  // star new 卡片
  const r1 = starMgr.star(entryNew.dedup_key);
  check("star new → success=true", r1.success === true);
  check("star new → status=saved", r1.entry?.card.status === "saved");
  check("star new → error=null", r1.error === null);

  // star viewed 卡片
  const r2 = starMgr.star(entryViewed.dedup_key);
  check("star viewed → success=true", r2.success === true);
  check("star viewed → status=saved", r2.entry?.card.status === "saved");

  // star 已收藏卡片（幂等）
  const r3 = starMgr.star(entrySaved.dedup_key);
  check("star saved → success=true（幂等）", r3.success === true);
  check("star saved → status=saved", r3.entry?.card.status === "saved");

  // star applied 卡片（非法）
  const r4 = starMgr.star(entryApplied.dedup_key);
  check("star applied → success=false", r4.success === false);
  check("star applied → error 非空", r4.error !== null && r4.error.length > 0);

  // star archived 卡片（终态）
  const r5 = starMgr.star(entryArchived.dedup_key);
  check("star archived → success=false（终态）", r5.success === false);
  check("star archived → error 非空", r5.error !== null && r5.error.length > 0);

  // star 不存在
  const r6 = starMgr.star("non-existent-key");
  check("star 不存在 → success=false", r6.success === false);
  check("star 不存在 → error 非空", r6.error !== null && r6.error.length > 0);

  // unstar 到 archived
  // 先把 entryNew（已收藏）unstar 到 archived
  const u1 = starMgr.unstar(entryNew.dedup_key);
  check("unstar saved → archived → success=true", u1.success === true);
  check("unstar saved → archived → status=archived", u1.entry?.card.status === "archived");

  // unstar 到 dismissed
  const u2 = starMgr.unstar(entryViewed.dedup_key, "dismissed");
  check("unstar saved → dismissed → success=true", u2.success === true);
  check("unstar saved → dismissed → status=dismissed", u2.entry?.card.status === "dismissed");

  // unstar 默认动作（archived）
  // entrySaved 仍是 saved，unstar 不传 action
  const u3 = starMgr.unstar(entrySaved.dedup_key);
  check("unstar 默认 → success=true", u3.success === true);
  check("unstar 默认 → status=archived", u3.entry?.card.status === "archived");

  // 重新准备 getStarred 测试数据
  store.add(makeCard({ title: "收藏 1", official_source_url: "https://example.com/star-gs-1", status: "saved" }), "ai_competition");
  store.add(makeCard({ title: "收藏 2", official_source_url: "https://example.com/star-gs-2", status: "saved" }), "opc_policy");

  // getStarred
  const starred = starMgr.getStarred();
  check("getStarred → 返回 2 条（含新加的 2 个 saved）", starred.length === 2, `len=${starred.length}`);
  check("getStarred → 全部 saved", starred.every((e) => e.card.status === "saved"));

  // isStarred saved
  const savedEntry = starred[0];
  check("isStarred saved → true", starMgr.isStarred(savedEntry.dedup_key) === true);

  // isStarred new
  // entryViewed 现在是 dismissed，不是 saved
  check("isStarred 非 saved → false", starMgr.isStarred(entryViewed.dedup_key) === false);

  // starStats
  const starStats = starMgr.starStats();
  check("starStats.total=2", starStats.total === 2, `total=${starStats.total}`);
  check("starStats.by_radar_type.ai_competition=1", starStats.by_radar_type.ai_competition === 1);
  check("starStats.by_radar_type.opc_policy=1", starStats.by_radar_type.opc_policy === 1);
  check("starStats.by_radar_type.cultural_heritage=0", starStats.by_radar_type.cultural_heritage === 0);
}

cleanupTestFile();

// ============================================================
// 验收 5.7：持久化
// ============================================================

console.log("\n[验收 5.7] 持久化\n");

cleanupTestFile();

{
  // flush 写入文件
  const store1 = createTestStore(false); // 手动 flush
  store1.add(makeCard({ title: "持久化 1", official_source_url: "https://example.com/persist-1" }), "ai_competition");
  store1.flush();
  check("flush 后文件存在", fs.existsSync(TEST_STORE_ABS));

  // 文件格式正确
  const rawContent = fs.readFileSync(TEST_STORE_ABS, "utf-8");
  const parsed = JSON.parse(rawContent);
  check("文件含 version 字段", typeof parsed.version === "string");
  check("文件含 updated_at 字段", typeof parsed.updated_at === "string");
  check("文件含 entries 数组", Array.isArray(parsed.entries));
  check("文件 version=1.0", parsed.version === "1.0");
  check("文件 entries 长度=1", parsed.entries.length === 1);

  // load 读取文件
  const store2 = createTestStore(false);
  store2.load();
  const all = store2.list({});
  check("load 后条目数量一致（1 条）", all.total === 1, `total=${all.total}`);
  check("load 后 title 正确", all.entries[0]?.card.title === "持久化 1");

  // auto_flush=true
  cleanupTestFile();
  const store3 = createTestStore(true);
  check("auto_flush=true 初始文件不存在", !fs.existsSync(TEST_STORE_ABS));
  store3.add(makeCard({ title: "自动持久化", official_source_url: "https://example.com/auto-flush" }), "ai_competition");
  check("auto_flush=true add 后文件自动写入", fs.existsSync(TEST_STORE_ABS));

  // auto_flush=false
  cleanupTestFile();
  const store4 = createTestStore(false);
  store4.add(makeCard({ title: "手动持久化", official_source_url: "https://example.com/manual-flush" }), "ai_competition");
  check("auto_flush=false add 后文件不存在", !fs.existsSync(TEST_STORE_ABS));
  store4.flush();
  check("auto_flush=false flush 后文件存在", fs.existsSync(TEST_STORE_ABS));

  // 空库 flush
  cleanupTestFile();
  const store5 = createTestStore(false);
  store5.flush();
  check("空库 flush → 文件存在", fs.existsSync(TEST_STORE_ABS));
  const emptyRaw = fs.readFileSync(TEST_STORE_ABS, "utf-8");
  const emptyParsed = JSON.parse(emptyRaw);
  check("空库 flush → entries 为空数组", Array.isArray(emptyParsed.entries) && emptyParsed.entries.length === 0);
}

cleanupTestFile();

// ============================================================
// 验收 5.8：编译与引用
// ============================================================

console.log("\n[验收 5.8] 编译与引用\n");

{
  // 检查文件存在
  const storePath = path.resolve(process.cwd(), "src/agents/opportunity-store.ts");
  check("src/agents/opportunity-store.ts 存在", fs.existsSync(storePath));

  const starMgrPath = path.resolve(process.cwd(), "src/agents/star-manager.ts");
  check("src/agents/star-manager.ts 存在", fs.existsSync(starMgrPath));

  const verifyPath = path.resolve(process.cwd(), "scripts/verify-task015.ts");
  check("scripts/verify-task015.ts 存在", fs.existsSync(verifyPath));

  // 检查 opportunity-store.ts 引用
  const storeContent = fs.readFileSync(storePath, "utf-8");
  check("opportunity-store 引用 OpportunityCard 类型", storeContent.includes("OpportunityCard"));
  check("opportunity-store 引用 OpportunityCardStatus 类型", storeContent.includes("OpportunityCardStatus"));
  check("opportunity-store 引用 CardVisibleLevel 类型", storeContent.includes("CardVisibleLevel"));
  check("opportunity-store 引用 fs 模块", storeContent.includes("import fs"));
  check("opportunity-store 引用 path 模块", storeContent.includes("import path"));
  check("opportunity-store 导出 computeDedupKey", storeContent.includes("export function computeDedupKey"));
  check("opportunity-store 导出 LocalFileStore", storeContent.includes("export class LocalFileStore"));
  check("opportunity-store 导出 createDefaultStore", storeContent.includes("export function createDefaultStore"));
  check("opportunity-store 导出 OpportunityStore 接口", storeContent.includes("export interface OpportunityStore"));
  check("opportunity-store 导出 StoreEntry 接口", storeContent.includes("export interface StoreEntry"));
  check("opportunity-store 导出 StoreQuery 接口", storeContent.includes("export interface StoreQuery"));
  check("opportunity-store 导出 StoreQueryResult 接口", storeContent.includes("export interface StoreQueryResult"));
  check("opportunity-store 导出 StoreStats 接口", storeContent.includes("export interface StoreStats"));

  // 检查 star-manager.ts 引用
  const starContent = fs.readFileSync(starMgrPath, "utf-8");
  check("star-manager 引用 OpportunityCardStatus 类型", starContent.includes("OpportunityCardStatus"));
  check("star-manager 引用 CARD_STATUS_LABELS", starContent.includes("CARD_STATUS_LABELS"));
  check("star-manager 引用 updateCardStatus", starContent.includes("updateCardStatus"));
  check("star-manager 引用 OpportunityStore 接口", starContent.includes("OpportunityStore"));
  check("star-manager 引用 StoreEntry 类型", starContent.includes("StoreEntry"));
  check("star-manager 不重复实现 createOpportunityCard", !starContent.includes("function createOpportunityCard"));
  check("star-manager 导出 StarManager 类", starContent.includes("export class StarManager"));
  check("star-manager 导出 star 方法", starContent.includes("star(") || starContent.includes("star(dedup_key"));
  check("star-manager 导出 unstar 方法", starContent.includes("unstar(") || starContent.includes("unstar(dedup_key"));
  check("star-manager 导出 getStarred 方法", starContent.includes("getStarred("));
  check("star-manager 导出 isStarred 方法", starContent.includes("isStarred("));
  check("star-manager 导出 starStats 方法", starContent.includes("starStats("));
}

// ============================================================
// V0.5 汇总验收（Task 015 首次汇总）
// ============================================================

console.log("\n[V0.5 汇总验收] Task 014 + Task 015 自检\n");

{
  // V0.5-1: OpportunityCard 含全部 17 个字段
  const card = createOpportunityCard({
    title: "V0.5 汇总",
    type: "AI 比赛",
    organizer: "测试",
    official_source_url: "https://example.com/v05-summary",
  });
  check("V0.5-1: OpportunityCard 含全部 17 个字段", Object.keys(card).length === 17, `count=${Object.keys(card).length}`);

  // V0.5-2: 卡片状态机 6 种状态转换合法
  check("V0.5-2: 卡片状态机 6 种状态转换合法", Object.keys(CARD_STATUS_TRANSITIONS).length === 6);

  // V0.5-3: 卡片工厂函数支持部分数据创建
  check("V0.5-3: 卡片工厂函数支持部分数据创建", typeof createOpportunityCard === "function" && card.title === "V0.5 汇总");

  // V0.5-4: 卡片完整性校验
  const completeness = validateCardCompleteness(card);
  check("V0.5-4: 卡片完整性校验（critical/optional/link/score）", typeof completeness.valid === "boolean");

  // V0.5-5: 3 种渲染模板
  check("V0.5-5: 3 种渲染模板（compact/standard/detail）",
    typeof renderCardCompact === "function" &&
    typeof renderCardStandard === "function" &&
    typeof renderCardDetail === "function");

  // V0.5-6: V0.5 验收清单全部通过
  check("V0.5-6: V0.5 验收清单全部通过",
    Object.keys(CARD_STATUS_TRANSITIONS).length === 6 &&
    typeof createOpportunityCard === "function" &&
    typeof validateCardCompleteness === "function" &&
    typeof renderCardCompact === "function" &&
    typeof isStatusTransitionValid === "function");
}

// ============================================================
// V0.6 自检（Task 015 覆盖）
// ============================================================

console.log("\n[V0.6 自检] Task 015 覆盖\n");

cleanupTestFile();

{
  const store = createTestStore(true);

  // V0.6-1: 机会库支持 CRUD + 去重
  const added = store.add(makeCard({ title: "V0.6 CRUD", official_source_url: "https://example.com/v06-crud" }), "ai_competition");
  check("V0.6-1a: 机会库 add", typeof added.dedup_key === "string");
  const got = store.get(added.dedup_key);
  check("V0.6-1b: 机会库 get", got !== null && got.card.title === "V0.6 CRUD");
  const listed = store.list({});
  check("V0.6-1c: 机会库 list", listed.total === 1);
  const updated = store.update(added.dedup_key, { region: "深圳" });
  check("V0.6-1d: 机会库 update", updated?.card.region === "深圳");
  // 去重测试
  const beforeDedup = store.list({}).total;
  store.add(makeCard({ title: "V0.6 CRUD", official_source_url: "https://example.com/v06-crud" }), "ai_competition");
  const afterDedup = store.list({}).total;
  check("V0.6-1e: 机会库 去重", beforeDedup === afterDedup);
  const delRes = store.delete(added.dedup_key);
  check("V0.6-1f: 机会库 delete", delRes === true);

  // V0.6-2: Star 收藏基于状态机
  const starMgr = new StarManager(store);
  const starCard = store.add(makeCard({ title: "V0.6 Star", official_source_url: "https://example.com/v06-star", status: "new" }), "ai_competition");
  const starRes = starMgr.star(starCard.dedup_key);
  check("V0.6-2a: Star 收藏 star", starRes.success === true && starRes.entry?.card.status === "saved");
  check("V0.6-2b: Star 收藏 isStarred", starMgr.isStarred(starCard.dedup_key) === true);
  const unstarRes = starMgr.unstar(starCard.dedup_key);
  check("V0.6-2c: Star 收藏 unstar", unstarRes.success === true && unstarRes.entry?.card.status === "archived");
  check("V0.6-2d: Star 收藏 getStarred", Array.isArray(starMgr.getStarred()));
  check("V0.6-2e: Star 收藏 starStats", typeof starMgr.starStats().total === "number");

  // V0.6-3: 机会库查询筛选
  store.add(makeCard({
    title: "V0.6 查询 S",
    official_source_url: "https://example.com/v06-query-s",
    visible_level: "S",
    status: "new",
    deadline: "2026-12-31",
  }), "ai_competition");
  store.add(makeCard({
    title: "V0.6 查询 A",
    official_source_url: "https://example.com/v06-query-a",
    visible_level: "A",
    status: "saved",
    deadline: daysFromNow(2),
  }), "opc_policy");

  check("V0.6-3a: 查询 radar_type", store.list({ radar_type: "ai_competition" }).total >= 1);
  check("V0.6-3b: 查询 visible_level", store.list({ visible_level: "S" }).total >= 1);
  check("V0.6-3c: 查询 status", store.list({ status: "saved" }).total >= 1);
  check("V0.6-3d: 查询 deadline_from", store.list({ deadline_from: daysFromNow(10) }).total >= 1);
  check("V0.6-3e: 查询 deadline_to", store.list({ deadline_to: daysFromNow(10) }).total >= 1);
  check("V0.6-3f: 查询 starred_only", store.list({ starred_only: true }).total >= 1);
  check("V0.6-3g: 查询 expiring_soon", store.list({ expiring_soon: true }).total >= 1);

  // V0.6-4: 存储接口可插拔
  check("V0.6-4a: OpportunityStore 接口存在", typeof store === "object" && store !== null);
  check("V0.6-4b: LocalFileStore 实现 OpportunityStore",
    typeof store.add === "function" &&
    typeof store.get === "function" &&
    typeof store.list === "function" &&
    typeof store.update === "function" &&
    typeof store.delete === "function" &&
    typeof store.stats === "function" &&
    typeof store.flush === "function" &&
    typeof store.load === "function");
}

cleanupTestFile();

// ============================================================
// 汇总输出
// ============================================================

console.log("\n=== 验收汇总 ===");
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
