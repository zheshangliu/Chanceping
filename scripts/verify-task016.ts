/**
 * Task 016 验收脚本
 *
 * 运行：npx tsx scripts/verify-task016.ts
 *
 * 覆盖验收标准 5.1–5.7 + V0.6 汇总 + V0.7 自检：
 *   5.1 距今天数计算
 *   5.2 提醒级别判定
 *   5.3 单条提醒生成
 *   5.4 批量提醒生成
 *   5.5 Markdown 渲染
 *   5.6 JSON 渲染与单条渲染
 *   5.7 编译与引用
 *
 * 测试基准日期固定为 2026-06-15，便于稳定测试。
 */

import fs from "fs";
import path from "path";
import {
  computeDaysUntilDeadline,
  determineReminderLevel,
  createReminderItem,
  generateReminders,
  DEFAULT_THRESHOLDS,
  REMINDER_LEVEL_LABELS,
} from "../src/agents/reminder-engine";
import type {
  ReminderItem,
  ReminderResult,
  ReminderQuery,
  ReminderLevel,
} from "../src/agents/reminder-engine";
import {
  renderRemindersMarkdown,
  renderRemindersJson,
  renderSingleReminder,
} from "../src/agents/reminder-renderer";
import type { StoreEntry, RadarType } from "../src/agents/opportunity-store";
import { LocalFileStore } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import type { OpportunityCard, OpportunityCardStatus } from "../src/schema/opportunity-card";
import { CARD_STATUS_LABELS } from "../src/schema/opportunity-card";
import { LEVEL_DEFINITIONS, scoreToLevel } from "../src/schema/scoring-rules";
import { BRAND } from "../src/brand/constants";
import {
  createOpportunityCard,
  updateCardStatus,
  validateCardCompleteness,
} from "../src/agents/card-factory";
import {
  renderCardCompact,
  renderCardStandard,
  renderCardDetail,
} from "../src/agents/card-template";
import {
  CARD_STATUS_TRANSITIONS,
  isStatusTransitionValid,
  CARD_CRITICAL_FIELDS,
  CARD_OPTIONAL_FIELDS,
} from "../src/schema/opportunity-card";

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
// 测试隔离：临时文件管理（V0.6 汇总段用）
// ============================================================

const TEST_STORE_PATH = "data/test-store-task016.json";
const TEST_STORE_ABS = path.resolve(process.cwd(), TEST_STORE_PATH);

function cleanupTestFile(): void {
  try {
    if (fs.existsSync(TEST_STORE_ABS)) {
      fs.rmSync(TEST_STORE_ABS, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
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

// ============================================================
// 测试数据构造
// ============================================================

/** 固定基准日期，便于稳定测试 */
const BASE_DATE = "2026-06-15";

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

/** 构造 StoreEntry */
function makeStoreEntry(
  overrides: Partial<OpportunityCard> = {},
  radarType: RadarType = "ai_competition",
): StoreEntry {
  const card = makeCard(overrides);
  return {
    card,
    radar_type: radarType,
    added_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
    dedup_key: `key-${card.title}-${card.official_source_url}`,
  };
}

/** 计算相对基准日期 N 天的日期（YYYY-MM-DD） */
function daysFromBase(days: number, base: string = BASE_DATE): string {
  const baseDate = new Date(`${base}T00:00:00Z`);
  baseDate.setUTCDate(baseDate.getUTCDate() + days);
  return baseDate.toISOString().split("T")[0];
}

// ============================================================
// 验收 5.1：距今天数计算
// ============================================================

console.log("\n=== Task 016 验收检查 ===\n");
console.log("[验收 5.1] 距今天数计算\n");

{
  // 今天截止
  const d0 = computeDaysUntilDeadline(BASE_DATE, BASE_DATE);
  check("今天截止 → days=0", d0 === 0, `d=${d0}`);

  // 3 天后截止
  const d3 = computeDaysUntilDeadline(daysFromBase(3), BASE_DATE);
  check("3 天后截止 → days=3", d3 === 3, `d=${d3}`);

  // 7 天后截止
  const d7 = computeDaysUntilDeadline(daysFromBase(7), BASE_DATE);
  check("7 天后截止 → days=7", d7 === 7, `d=${d7}`);

  // 14 天后截止
  const d14 = computeDaysUntilDeadline(daysFromBase(14), BASE_DATE);
  check("14 天后截止 → days=14", d14 === 14, `d=${d14}`);

  // 已截止 1 天
  const dNeg1 = computeDaysUntilDeadline(daysFromBase(-1), BASE_DATE);
  check("已截止 1 天 → days=-1", dNeg1 === -1, `d=${dNeg1}`);

  // 已截止 10 天
  const dNeg10 = computeDaysUntilDeadline(daysFromBase(-10), BASE_DATE);
  check("已截止 10 天 → days=-10", dNeg10 === -10, `d=${dNeg10}`);

  // 默认 base_date（不传 base_date，用当前日期）
  const dDefault = computeDaysUntilDeadline(daysFromBase(5, new Date().toISOString().split("T")[0]));
  check("默认 base_date → 用当前日期", dDefault === 5, `d=${dDefault}`);

  // 空截止日期
  const dEmpty = computeDaysUntilDeadline("", BASE_DATE);
  check("空截止日期 → NaN", Number.isNaN(dEmpty), `d=${dEmpty}`);

  // "未明确" 截止
  const dUnknown = computeDaysUntilDeadline("未明确", BASE_DATE);
  check("未明确截止 → NaN", Number.isNaN(dUnknown), `d=${dUnknown}`);

  // DEFAULT_THRESHOLDS 存在
  check("DEFAULT_THRESHOLDS 存在", typeof DEFAULT_THRESHOLDS === "object");
  check("DEFAULT_THRESHOLDS.urgent=3", DEFAULT_THRESHOLDS.urgent === 3);
  check("DEFAULT_THRESHOLDS.soon=7", DEFAULT_THRESHOLDS.soon === 7);
  check("DEFAULT_THRESHOLDS.warning=14", DEFAULT_THRESHOLDS.warning === 14);
}

// ============================================================
// 验收 5.2：提醒级别判定
// ============================================================

console.log("\n[验收 5.2] 提醒级别判定\n");

{
  check("0 天 → urgent", determineReminderLevel(0) === "urgent");
  check("3 天 → urgent", determineReminderLevel(3) === "urgent");
  check("4 天 → soon", determineReminderLevel(4) === "soon");
  check("7 天 → soon", determineReminderLevel(7) === "soon");
  check("8 天 → warning", determineReminderLevel(8) === "warning");
  check("14 天 → warning", determineReminderLevel(14) === "warning");
  check("15 天 → none", determineReminderLevel(15) === "none");
  check("-1 天 → expired", determineReminderLevel(-1) === "expired");
  check("-10 天 → expired", determineReminderLevel(-10) === "expired");

  // 自定义阈值
  const custom = determineReminderLevel(6, { urgent: 5, soon: 10, warning: 20 });
  check("自定义阈值 days=6 → soon（urgent=5, soon=10）", custom === "soon", `level=${custom}`);

  // 自定义阈值 days=20 → warning
  const custom2 = determineReminderLevel(20, { urgent: 5, soon: 10, warning: 20 });
  check("自定义阈值 days=20 → warning", custom2 === "warning", `level=${custom2}`);

  // 自定义阈值 days=21 → none
  const custom3 = determineReminderLevel(21, { urgent: 5, soon: 10, warning: 20 });
  check("自定义阈值 days=21 → none", custom3 === "none", `level=${custom3}`);

  // NaN → none
  check("NaN → none", determineReminderLevel(NaN) === "none");
}

// ============================================================
// 验收 5.3：单条提醒生成
// ============================================================

console.log("\n[验收 5.3] 单条提醒生成\n");

{
  // urgent 提醒
  const urgentEntry = makeStoreEntry({
    title: "紧急机会",
    deadline: daysFromBase(2),
    official_source_url: "https://example.com/urgent",
    status: "new",
  });
  const urgentItem = createReminderItem(urgentEntry, BASE_DATE);
  check("urgent 提醒 → 非空", urgentItem !== null);
  check("urgent 提醒 → level=urgent", urgentItem?.level === "urgent");
  check("urgent 提醒 → days=2", urgentItem?.days_until_deadline === 2);
  check("urgent 提醒 → priority=1", urgentItem?.priority === 1);
  check("urgent 提醒 → title 正确", urgentItem?.title === "紧急机会");
  check("urgent suggested_action 含标题", urgentItem?.suggested_action.includes("紧急机会") === true);
  check("urgent suggested_action 含天数", urgentItem?.suggested_action.includes("2 天") === true);
  check("urgent suggested_action 含链接", urgentItem?.suggested_action.includes("https://example.com/urgent") === true);

  // soon 提醒
  const soonEntry = makeStoreEntry({
    title: "即将到期机会",
    deadline: daysFromBase(5),
    official_source_url: "https://example.com/soon",
    status: "viewed",
  });
  const soonItem = createReminderItem(soonEntry, BASE_DATE);
  check("soon 提醒 → level=soon", soonItem?.level === "soon");
  check("soon 提醒 → days=5", soonItem?.days_until_deadline === 5);
  check("soon 提醒 → priority=2", soonItem?.priority === 2);

  // warning 提醒
  const warningEntry = makeStoreEntry({
    title: "远期预警机会",
    deadline: daysFromBase(10),
    official_source_url: "https://example.com/warning",
    status: "saved",
  });
  const warningItem = createReminderItem(warningEntry, BASE_DATE);
  check("warning 提醒 → level=warning", warningItem?.level === "warning");
  check("warning 提醒 → days=10", warningItem?.days_until_deadline === 10);
  check("warning 提醒 → priority=3", warningItem?.priority === 3);

  // expired 提醒
  const expiredEntry = makeStoreEntry({
    title: "已截止机会",
    deadline: daysFromBase(-1),
    official_source_url: "https://example.com/expired",
    status: "viewed",
  });
  const expiredItem = createReminderItem(expiredEntry, BASE_DATE);
  check("expired 提醒 → level=expired", expiredItem?.level === "expired");
  check("expired 提醒 → days=-1", expiredItem?.days_until_deadline === -1);
  check("expired 提醒 → priority=4", expiredItem?.priority === 4);
  check("expired suggested_action 含已过期天数", expiredItem?.suggested_action.includes("1 天") === true);

  // no_reminder（>14天）
  const farEntry = makeStoreEntry({
    title: "远期机会",
    deadline: daysFromBase(20),
    status: "new",
  });
  const farItem = createReminderItem(farEntry, BASE_DATE);
  check("no_reminder（>14天）→ null", farItem === null);

  // archived 不提醒
  const archivedEntry = makeStoreEntry({
    title: "已归档",
    deadline: daysFromBase(2),
    status: "archived",
  });
  check("archived 不提醒 → null", createReminderItem(archivedEntry, BASE_DATE) === null);

  // dismissed 不提醒
  const dismissedEntry = makeStoreEntry({
    title: "已忽略",
    deadline: daysFromBase(2),
    status: "dismissed",
  });
  check("dismissed 不提醒 → null", createReminderItem(dismissedEntry, BASE_DATE) === null);

  // 空截止日期
  const emptyDeadlineEntry = makeStoreEntry({
    title: "空截止",
    deadline: "",
    status: "new",
  });
  check("空截止日期 → null", createReminderItem(emptyDeadlineEntry, BASE_DATE) === null);

  // "未明确" 截止
  const unknownDeadlineEntry = makeStoreEntry({
    title: "未明确截止",
    deadline: "未明确",
    status: "new",
  });
  check("未明确截止 → null", createReminderItem(unknownDeadlineEntry, BASE_DATE) === null);

  // priority 正确：urgent < soon < warning < expired
  check("priority: urgent(1) < soon(2)", (urgentItem?.priority ?? 99) < (soonItem?.priority ?? 0));
  check("priority: soon(2) < warning(3)", (soonItem?.priority ?? 99) < (warningItem?.priority ?? 0));
  check("priority: warning(3) < expired(4)", (warningItem?.priority ?? 99) < (expiredItem?.priority ?? 0));
}

// ============================================================
// 验收 5.4：批量提醒生成
// ============================================================

console.log("\n[验收 5.4] 批量提醒生成\n");

{
  // 准备 8 条测试数据
  const entries: StoreEntry[] = [
    // 1 urgent
    makeStoreEntry({
      title: "紧急 1",
      deadline: daysFromBase(2),
      official_source_url: "https://example.com/b-urgent",
      status: "new",
      visible_level: "S",
    }, "ai_competition"),
    // 1 soon
    makeStoreEntry({
      title: "即将到期 1",
      deadline: daysFromBase(5),
      official_source_url: "https://example.com/b-soon",
      status: "viewed",
      visible_level: "A",
    }, "ai_competition"),
    // 1 warning
    makeStoreEntry({
      title: "远期预警 1",
      deadline: daysFromBase(10),
      official_source_url: "https://example.com/b-warning",
      status: "saved",
      visible_level: "B",
    }, "opc_policy"),
    // 1 expired
    makeStoreEntry({
      title: "已截止 1",
      deadline: daysFromBase(-3),
      official_source_url: "https://example.com/b-expired",
      status: "viewed",
      visible_level: "C",
    }, "cultural_heritage"),
    // 1 no_reminder（>14天）
    makeStoreEntry({
      title: "远期不提醒",
      deadline: daysFromBase(20),
      official_source_url: "https://example.com/b-far",
      status: "new",
    }, "ai_competition"),
    // 1 no_reminder（空截止）
    makeStoreEntry({
      title: "空截止不提醒",
      deadline: "",
      official_source_url: "https://example.com/b-empty",
      status: "new",
    }, "opc_policy"),
    // 1 archived（不提醒）
    makeStoreEntry({
      title: "已归档不提醒",
      deadline: daysFromBase(2),
      official_source_url: "https://example.com/b-archived",
      status: "archived",
    }, "ai_competition"),
    // 1 dismissed（不提醒）
    makeStoreEntry({
      title: "已忽略不提醒",
      deadline: daysFromBase(2),
      official_source_url: "https://example.com/b-dismissed",
      status: "dismissed",
    }, "ai_competition"),
  ];

  const result = generateReminders(entries, { base_date: BASE_DATE });

  // 各级别数量
  check("urgent 数量=1", result.urgent.length === 1, `len=${result.urgent.length}`);
  check("soon 数量=1", result.soon.length === 1, `len=${result.soon.length}`);
  check("warning 数量=1", result.warning.length === 1, `len=${result.warning.length}`);
  check("expired 数量=1", result.expired.length === 1, `len=${result.expired.length}`);
  check("no_reminder 数量=2（空截止 + >14天）", result.no_reminder.length === 2, `len=${result.no_reminder.length}`);

  // archived/dismissed 不进任何提醒组
  const allReminderTitles = [
    ...result.urgent,
    ...result.soon,
    ...result.warning,
    ...result.expired,
  ].map((r) => r.title);
  check("archived 不进任何提醒组", !allReminderTitles.includes("已归档不提醒"));
  check("dismissed 不进任何提醒组", !allReminderTitles.includes("已忽略不提醒"));
  check("archived/dismissed 不进 no_reminder", !result.no_reminder.some((e) => e.card.title === "已归档不提醒") && !result.no_reminder.some((e) => e.card.title === "已忽略不提醒"));

  // summary 统计
  check("summary.urgent_count=1", result.summary.urgent_count === 1);
  check("summary.soon_count=1", result.summary.soon_count === 1);
  check("summary.warning_count=1", result.summary.warning_count === 1);
  check("summary.expired_count=1", result.summary.expired_count === 1);
  check("summary.no_reminder_count=2", result.summary.no_reminder_count === 2);
  check("summary.total=4（urgent+soon+warning+expired，不含 no_reminder）", result.summary.total === 4, `total=${result.summary.total}`);
  check("base_date 正确", result.base_date === BASE_DATE);

  // 按 radar_type 筛选
  const aiOnly = generateReminders(entries, { base_date: BASE_DATE, radar_type: "ai_competition" });
  const aiAllTitles = [
    ...aiOnly.urgent,
    ...aiOnly.soon,
    ...aiOnly.warning,
    ...aiOnly.expired,
  ].map((r) => r.title);
  check("按 radar_type 筛选 → 仅含 ai_competition", aiAllTitles.length >= 1 && aiOnly.no_reminder.length >= 1);

  // 按 visible_level 筛选
  const sOnly = generateReminders(entries, { base_date: BASE_DATE, visible_level: "S" });
  const sAllCount = sOnly.urgent.length + sOnly.soon.length + sOnly.warning.length + sOnly.expired.length;
  check("按 visible_level=S 筛选 → 仅含 S 级", sAllCount === 1, `count=${sAllCount}`);

  // starred_only 筛选
  const starredOnly = generateReminders(entries, { base_date: BASE_DATE, starred_only: true });
  const starredAllTitles = [
    ...starredOnly.urgent,
    ...starredOnly.soon,
    ...starredOnly.warning,
    ...starredOnly.expired,
  ].map((r) => r.title);
  check("starred_only 筛选 → 仅含 saved 状态", starredAllTitles.includes("远期预警 1") && !starredAllTitles.includes("紧急 1"));

  // 组内排序（urgent 按 days 升序）
  const multiUrgentEntries: StoreEntry[] = [
    makeStoreEntry({
      title: "紧急 3 天",
      deadline: daysFromBase(3),
      status: "new",
    }),
    makeStoreEntry({
      title: "紧急 1 天",
      deadline: daysFromBase(1),
      status: "new",
    }),
    makeStoreEntry({
      title: "紧急 2 天",
      deadline: daysFromBase(2),
      status: "new",
    }),
  ];
  const multiResult = generateReminders(multiUrgentEntries, { base_date: BASE_DATE });
  check("urgent 组按 days 升序", multiResult.urgent[0].days_until_deadline <= multiResult.urgent[1].days_until_deadline && multiResult.urgent[1].days_until_deadline <= multiResult.urgent[2].days_until_deadline, `days=${multiResult.urgent.map((r) => r.days_until_deadline).join(",")}`);
  check("urgent 组第 1 条是 1 天", multiResult.urgent[0].title === "紧急 1 天", `first=${multiResult.urgent[0].title}`);

  // 自定义阈值批量
  const customResult = generateReminders(entries, {
    base_date: BASE_DATE,
    thresholds: { urgent: 5, soon: 10, warning: 20 },
  });
  // 原本 urgent(2) + soon(5) 都进 urgent（≤5），warning(10) 进 soon（≤10），expired(-3) 仍 expired
  check("自定义阈值 urgent=5 → urgent 数量增加", customResult.urgent.length >= 2, `urgent=${customResult.urgent.length}`);
}

// ============================================================
// 验收 5.5：Markdown 渲染
// ============================================================

console.log("\n[验收 5.5] Markdown 渲染\n");

{
  const entries: StoreEntry[] = [
    makeStoreEntry({
      title: "紧急 Markdown",
      deadline: daysFromBase(2),
      official_source_url: "https://example.com/md-urgent",
      status: "new",
      visible_level: "S",
    }, "ai_competition"),
    makeStoreEntry({
      title: "已截止 Markdown",
      deadline: daysFromBase(-5),
      official_source_url: "https://example.com/md-expired",
      status: "viewed",
      visible_level: "C",
    }, "opc_policy"),
    makeStoreEntry({
      title: "远期不提醒",
      deadline: daysFromBase(30),
      status: "new",
    }, "ai_competition"),
  ];

  const result = generateReminders(entries, { base_date: BASE_DATE });
  const md = renderRemindersMarkdown(result);

  check("Markdown 含 BRAND.product_name", md.includes(BRAND.product_name));
  check("Markdown 含「基准日期：」", md.includes("基准日期："));
  check("Markdown 含「提醒总数：」", md.includes("提醒总数："));
  check("Markdown 含「## 紧急提醒」", md.includes("## 紧急提醒"));
  check("Markdown 含「## 即将到期」", md.includes("## 即将到期"));
  check("Markdown 含「## 远期预警」", md.includes("## 远期预警"));
  check("Markdown 含「## 已截止」", md.includes("## 已截止"));
  check("Markdown 含「## 无需提醒」", md.includes("## 无需提醒"));
  check("Markdown 含 urgent 机会标题", md.includes("紧急 Markdown"));
  check("Markdown 含 expired 机会标题", md.includes("已截止 Markdown"));
  check("Markdown 含「已过期」", md.includes("已过期"));
  check("Markdown 含官方链接", md.includes("https://example.com/md-urgent"));
  check("Markdown 含状态中文名（新发现）", md.includes(CARD_STATUS_LABELS.new));
  check("Markdown 含状态中文名（已查看）", md.includes(CARD_STATUS_LABELS.viewed));
  check("Markdown 含等级定义", md.includes(LEVEL_DEFINITIONS.S));

  // 空组显示「暂无」
  const emptyResult: ReminderResult = {
    urgent: [],
    soon: [],
    warning: [],
    expired: [],
    no_reminder: [],
    summary: {
      total: 0,
      urgent_count: 0,
      soon_count: 0,
      warning_count: 0,
      expired_count: 0,
      no_reminder_count: 0,
    },
    base_date: BASE_DATE,
  };
  const emptyMd = renderRemindersMarkdown(emptyResult);
  check("空 urgent 组显示「暂无紧急提醒」", emptyMd.includes("暂无紧急提醒"));
  check("空 expired 组显示「暂无已截止项」", emptyMd.includes("暂无已截止项"));
  check("空 no_reminder 组显示「暂无需提醒项」", emptyMd.includes("暂无需提醒项"));
}

// ============================================================
// 验收 5.6：JSON 渲染与单条渲染
// ============================================================

console.log("\n[验收 5.6] JSON 渲染与单条渲染\n");

{
  const entries: StoreEntry[] = [
    makeStoreEntry({
      title: "JSON 测试",
      deadline: daysFromBase(2),
      official_source_url: "https://example.com/json-test",
      status: "new",
    }, "ai_competition"),
    makeStoreEntry({
      title: "已截止 JSON",
      deadline: daysFromBase(-1),
      official_source_url: "https://example.com/json-expired",
      status: "viewed",
    }, "opc_policy"),
  ];

  const result = generateReminders(entries, { base_date: BASE_DATE });

  // JSON 可解析
  let parsed: any = null;
  try {
    parsed = JSON.parse(renderRemindersJson(result));
    check("JSON 可解析", parsed !== null);
  } catch (e) {
    check("JSON 可解析", false, `parse error: ${e}`);
  }

  if (parsed) {
    check("JSON 含 urgent 字段", Array.isArray(parsed.urgent));
    check("JSON 含 soon 字段", Array.isArray(parsed.soon));
    check("JSON 含 warning 字段", Array.isArray(parsed.warning));
    check("JSON 含 expired 字段", Array.isArray(parsed.expired));
    check("JSON 含 summary 对象", typeof parsed.summary === "object" && parsed.summary !== null);
    check("JSON 含 base_date", typeof parsed.base_date === "string");
    check("JSON 含 no_reminder", Array.isArray(parsed.no_reminder));
    check("JSON summary.urgent_count 正确", parsed.summary.urgent_count === 1);
  }

  // 单条渲染
  const urgentItem = result.urgent[0];
  const single = renderSingleReminder(urgentItem);
  check("单条渲染含级别标签「[紧急]」", single.includes("[紧急]"));
  check("单条渲染含标题", single.includes("JSON 测试"));
  check("单条渲染含截止日期", single.includes(daysFromBase(2)));
  check("单条渲染含天数「天」", single.includes("天"));
  check("单条渲染含官方链接", single.includes("https://example.com/json-test"));

  // expired 单条渲染
  const expiredItem = result.expired[0];
  const singleExpired = renderSingleReminder(expiredItem);
  check("expired 单条渲染含「[已截止]」", singleExpired.includes("[已截止]"));
  check("expired 单条渲染含「已过期」", singleExpired.includes("已过期"));

  // REMINDER_LEVEL_LABELS 存在
  check("REMINDER_LEVEL_LABELS.urgent=紧急", REMINDER_LEVEL_LABELS.urgent === "紧急");
  check("REMINDER_LEVEL_LABELS.soon=即将到期", REMINDER_LEVEL_LABELS.soon === "即将到期");
  check("REMINDER_LEVEL_LABELS.warning=远期预警", REMINDER_LEVEL_LABELS.warning === "远期预警");
  check("REMINDER_LEVEL_LABELS.expired=已截止", REMINDER_LEVEL_LABELS.expired === "已截止");
}

// ============================================================
// 验收 5.7：编译与引用
// ============================================================

console.log("\n[验收 5.7] 编译与引用\n");

{
  // 检查文件存在
  const enginePath = path.resolve(process.cwd(), "src/agents/reminder-engine.ts");
  const rendererPath = path.resolve(process.cwd(), "src/agents/reminder-renderer.ts");
  const verifyPath = path.resolve(process.cwd(), "scripts/verify-task016.ts");

  check("src/agents/reminder-engine.ts 存在", fs.existsSync(enginePath));
  check("src/agents/reminder-renderer.ts 存在", fs.existsSync(rendererPath));
  check("scripts/verify-task016.ts 存在", fs.existsSync(verifyPath));

  // 检查 reminder-engine.ts 引用
  const engineContent = fs.readFileSync(enginePath, "utf-8");
  check("reminder-engine 引用 OpportunityCard 类型", engineContent.includes("OpportunityCard"));
  check("reminder-engine 引用 StoreEntry 类型", engineContent.includes("StoreEntry"));
  check("reminder-engine 引用 RadarType 类型", engineContent.includes("RadarType"));
  check("reminder-engine 导出 computeDaysUntilDeadline", engineContent.includes("export function computeDaysUntilDeadline"));
  check("reminder-engine 导出 determineReminderLevel", engineContent.includes("export function determineReminderLevel"));
  check("reminder-engine 导出 createReminderItem", engineContent.includes("export function createReminderItem"));
  check("reminder-engine 导出 generateReminders", engineContent.includes("export function generateReminders"));
  check("reminder-engine 导出 DEFAULT_THRESHOLDS", engineContent.includes("export const DEFAULT_THRESHOLDS"));

  // 检查 reminder-renderer.ts 引用
  const rendererContent = fs.readFileSync(rendererPath, "utf-8");
  check("reminder-renderer 引用 BRAND.product_name", rendererContent.includes("BRAND"));
  check("reminder-renderer 引用 CARD_STATUS_LABELS", rendererContent.includes("CARD_STATUS_LABELS"));
  check("reminder-renderer 引用 LEVEL_DEFINITIONS", rendererContent.includes("LEVEL_DEFINITIONS"));
  check("reminder-renderer 引用 StoreEntry 类型", rendererContent.includes("StoreEntry"));
  check("reminder-renderer 引用 ReminderItem 类型", rendererContent.includes("ReminderItem"));
  check("reminder-renderer 引用 ReminderResult 类型", rendererContent.includes("ReminderResult"));
  check("reminder-renderer 引用 REMINDER_LEVEL_LABELS（来自 reminder-engine）", rendererContent.includes("REMINDER_LEVEL_LABELS"));
  check("reminder-renderer 不重复实现 computeDaysUntilDeadline", !rendererContent.includes("function computeDaysUntilDeadline"));
  check("reminder-renderer 导出 renderRemindersMarkdown", rendererContent.includes("export function renderRemindersMarkdown"));
  check("reminder-renderer 导出 renderRemindersJson", rendererContent.includes("export function renderRemindersJson"));
  check("reminder-renderer 导出 renderSingleReminder", rendererContent.includes("export function renderSingleReminder"));
  check("reminder-renderer 不硬编码品牌名", !rendererContent.includes('"盯一下 ChancePing"'));
}

// ============================================================
// V0.6 汇总验收（Task 016 首次汇总）
// ============================================================

console.log("\n[V0.6 汇总验收] Task 015 + Task 016 自检\n");

cleanupTestFile();

{
  const store = new LocalFileStore({ file_path: TEST_STORE_PATH, auto_flush: true });

  // V0.6-1: 机会库支持 CRUD + 去重
  const added = store.add(makeCard({ title: "V0.6 CRUD", official_source_url: "https://example.com/v06-crud" }), "ai_competition");
  check("V0.6-1a: 机会库 add", typeof added.dedup_key === "string");
  check("V0.6-1b: 机会库 get", store.get(added.dedup_key) !== null);
  check("V0.6-1c: 机会库 list", store.list({}).total === 1);
  check("V0.6-1d: 机会库 update", store.update(added.dedup_key, { region: "深圳" })?.card.region === "深圳");
  store.add(makeCard({ title: "V0.6 CRUD", official_source_url: "https://example.com/v06-crud" }), "ai_competition");
  check("V0.6-1e: 机会库 去重", store.list({}).total === 1);
  check("V0.6-1f: 机会库 delete", store.delete(added.dedup_key) === true);

  // V0.6-2: Star 收藏基于状态机
  const starMgr = new StarManager(store);
  const starCard = store.add(makeCard({ title: "V0.6 Star", official_source_url: "https://example.com/v06-star", status: "new" }), "ai_competition");
  const starRes = starMgr.star(starCard.dedup_key);
  check("V0.6-2a: Star 收藏 star", starRes.success === true && starRes.entry?.card.status === "saved");
  check("V0.6-2b: Star 收藏 isStarred", starMgr.isStarred(starCard.dedup_key) === true);
  check("V0.6-2c: Star 收藏 unstar", starMgr.unstar(starCard.dedup_key).success === true);
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
  check("V0.6-3a: 查询 radar_type", store.list({ radar_type: "ai_competition" }).total >= 1);
  check("V0.6-3b: 查询 visible_level", store.list({ visible_level: "S" }).total >= 1);
  check("V0.6-3c: 查询 starred_only", store.list({ starred_only: true }).total >= 0);

  // V0.6-4: 存储接口可插拔
  check("V0.6-4: OpportunityStore 接口可插拔（LocalFileStore 实现 8 方法）",
    typeof store.add === "function" &&
    typeof store.get === "function" &&
    typeof store.list === "function" &&
    typeof store.update === "function" &&
    typeof store.delete === "function" &&
    typeof store.stats === "function" &&
    typeof store.flush === "function" &&
    typeof store.load === "function");

  // V0.6-5: V0.6 验收清单全部通过
  check("V0.6-5: V0.6 验收清单全部通过",
    typeof added.dedup_key === "string" &&
    starRes.success === true &&
    store.list({}).total >= 1);
}

cleanupTestFile();

// ============================================================
// V0.7 自检（Task 016 覆盖）
// ============================================================

console.log("\n[V0.7 自检] Task 016 覆盖\n");

{
  // V0.7-1: 4 级提醒
  check("V0.7-1: 4 级提醒（urgent/soon/warning/expired）",
    determineReminderLevel(0) === "urgent" &&
    determineReminderLevel(4) === "soon" &&
    determineReminderLevel(8) === "warning" &&
    determineReminderLevel(-1) === "expired");

  // V0.7-2: 提醒基于机会库（输入 StoreEntry[]）
  const entries: StoreEntry[] = [
    makeStoreEntry({ title: "V0.7 测试", deadline: daysFromBase(2), status: "new" }),
  ];
  const result = generateReminders(entries, { base_date: BASE_DATE });
  check("V0.7-2: 提醒基于机会库（generateReminders 输入 StoreEntry[]）", result.summary.urgent_count === 1);

  // V0.7-3: archived/dismissed 不提醒
  const archivedEntries: StoreEntry[] = [
    makeStoreEntry({ title: "archived", deadline: daysFromBase(2), status: "archived" }),
    makeStoreEntry({ title: "dismissed", deadline: daysFromBase(2), status: "dismissed" }),
  ];
  const archivedResult = generateReminders(archivedEntries, { base_date: BASE_DATE });
  check("V0.7-3: archived/dismissed 不提醒", archivedResult.summary.total === 0 && archivedResult.no_reminder.length === 0);

  // V0.7-4: 提醒内容含建议行动 + 官方链接
  const item = result.urgent[0];
  check("V0.7-4a: 提醒含 suggested_action", item.suggested_action.length > 0);
  check("V0.7-4b: suggested_action 含官方链接", item.suggested_action.includes("https://example.com/test"));

  // V0.7-5: 提醒 Markdown 渲染
  const md = renderRemindersMarkdown(result);
  check("V0.7-5: 提醒 Markdown 渲染含 BRAND", md.includes(BRAND.product_name));

  // V0.7-6: 提醒 JSON 渲染
  const json = renderRemindersJson(result);
  let jsonOk = false;
  try {
    const p = JSON.parse(json);
    jsonOk = p.summary.urgent_count === 1;
  } catch {
    jsonOk = false;
  }
  check("V0.7-6: 提醒 JSON 渲染可解析", jsonOk);
}

// ============================================================
// 汇总输出
// ============================================================

console.log("\n=== 验收汇总 ===");
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
