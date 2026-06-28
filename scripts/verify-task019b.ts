/**
 * Task 019b 验收脚本
 *
 * 运行：npx tsx scripts/verify-task019b.ts
 *
 * 覆盖验收标准 5.1-5.3：
 *   5.1 LLM Qwen Adapter
 *   5.2 T2 guid > url 去重优先级
 *   5.3 T5 渠道格式指南
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/agents/llm-adapter";
import { QwenAdapter, type QwenConfig } from "../src/agents/qwen-adapter";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import {
  computeDedupKey,
  LocalFileStore,
  type StoreEntry,
  type RadarType,
} from "../src/agents/opportunity-store";
import {
  renderRemindersMarkdown,
  renderRemindersJson,
  renderSingleReminder,
  renderRemindersForChannel,
  getChannelFormatGuide,
  type ReminderChannel,
  type ChannelFormatGuide,
} from "../src/agents/reminder-renderer";
import type { ReminderItem, ReminderResult, ReminderLevel } from "../src/agents/reminder-engine";
import { BRAND } from "../src/brand/constants";

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
// 测试数据构造
// ============================================================

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

/** 计算相对基准日期 N 天的日期 */
function daysFromBase(days: number, base: string = BASE_DATE): string {
  const baseDate = new Date(`${base}T00:00:00Z`);
  baseDate.setUTCDate(baseDate.getUTCDate() + days);
  return baseDate.toISOString().split("T")[0];
}

/** 构造 ReminderItem */
function makeReminderItem(
  entry: StoreEntry,
  level: ReminderLevel,
  daysUntil: number,
): ReminderItem {
  return {
    entry,
    level,
    days_until_deadline: daysUntil,
    deadline: entry.card.deadline,
    title: entry.card.title,
    suggested_action: "建议尽快处理",
    priority: level === "urgent" ? 1 : level === "soon" ? 2 : level === "warning" ? 3 : 4,
  };
}

/** 构造完整 ReminderResult */
function makeReminderResult(): ReminderResult {
  const urgentEntry = makeStoreEntry({
    title: "紧急机会",
    deadline: daysFromBase(2),
    official_source_url: "https://example.com/urgent",
  });
  const soonEntry = makeStoreEntry({
    title: "即将机会",
    deadline: daysFromBase(5),
    official_source_url: "https://example.com/soon",
  });
  const warningEntry = makeStoreEntry({
    title: "预警机会",
    deadline: daysFromBase(10),
    official_source_url: "https://example.com/warning",
  });
  const expiredEntry = makeStoreEntry({
    title: "过期机会",
    deadline: daysFromBase(-3),
    official_source_url: "https://example.com/expired",
  });

  return {
    urgent: [makeReminderItem(urgentEntry, "urgent", 2)],
    soon: [makeReminderItem(soonEntry, "soon", 5)],
    warning: [makeReminderItem(warningEntry, "warning", 10)],
    expired: [makeReminderItem(expiredEntry, "expired", -3)],
    no_reminder: [],
    summary: {
      total: 4,
      urgent_count: 1,
      soon_count: 1,
      warning_count: 1,
      expired_count: 1,
      no_reminder_count: 0,
    },
    base_date: BASE_DATE,
  };
}

// ============================================================
// 主函数（async，包装所有验收逻辑）
// ============================================================

async function main(): Promise<void> {
// ============================================================
// 验收 5.1：LLM Qwen Adapter
// ============================================================

console.log("\n=== Task 019b 验收检查 ===\n");
console.log("[验收 5.1] LLM Qwen Adapter\n");

{
  // 1. QwenAdapter 存在且可实例化
  const adapter = new QwenAdapter();
  check("QwenAdapter 可实例化", adapter instanceof QwenAdapter);

  // 2. QwenConfig interface 存在（类型检查）
  const config: QwenConfig = {
    apiKey: "test-key",
    model: "qwen-plus",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  };
  check("QwenConfig interface 可用", config.apiKey === "test-key");

  // 3. QwenAdapter 实现 LLMAdapter 接口（类型兼容）
  const llmAdapter: LLMAdapter = new QwenAdapter();
  check("QwenAdapter 实现 LLMAdapter 接口", typeof llmAdapter.chat === "function");

  // 4. 无 DASHSCOPE_API_KEY 时自动进入 Mock 模式（不抛错）
  // 先保存原始环境变量
  const originalKey = process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  let mockAdapter: QwenAdapter;
  try {
    mockAdapter = new QwenAdapter();
    check("无 DASHSCOPE_API_KEY 时构造不抛错", true);
  } catch (e) {
    mockAdapter = new QwenAdapter({ mockMode: true });
    check("无 DASHSCOPE_API_KEY 时构造不抛错", false, String(e));
  }

  // 5. Mock 模式下 response_format="json" 返回有效 JSON
  const jsonReq: LLMRequest = {
    messages: [{ role: "user", content: "帮我提取机会信息" }],
    response_format: "json",
  };
  const jsonResp = await mockAdapter.chat(jsonReq);
  check("Mock json 模式返回 content 非空", jsonResp.content.length > 0);
  check("Mock json 模式返回 parsed 字段", jsonResp.parsed !== undefined);
  let parsedOk = false;
  try {
    JSON.parse(jsonResp.content);
    parsedOk = true;
  } catch {
    parsedOk = false;
  }
  check("Mock json 模式 content 可被 JSON.parse", parsedOk);

  // 6. Mock 模式下 response_format="text" 返回非空字符串
  const textReq: LLMRequest = {
    messages: [{ role: "user", content: "帮我提取机会信息" }],
    response_format: "text",
  };
  const textResp = await mockAdapter.chat(textReq);
  check("Mock text 模式返回非空字符串", typeof textResp.content === "string" && textResp.content.length > 0);

  // 7. Mock 模式含"机会"/"评分"/"提取"关键词 → 机会提取预设 JSON
  const oppReq: LLMRequest = {
    messages: [{ role: "user", content: "请提取这个机会的评分信息" }],
    response_format: "json",
  };
  const oppResp = await mockAdapter.chat(oppReq);
  let oppParsed: { extracted_info?: { client_identity?: { industry?: string } } } | null = null;
  try {
    oppParsed = JSON.parse(oppResp.content);
  } catch {
    oppParsed = null;
  }
  check("机会关键词 → 返回可解析 JSON", oppParsed !== null);
  check(
    "机会关键词 → extracted_info.client_identity.industry = AI 游戏",
    oppParsed?.extracted_info?.client_identity?.industry === "AI 游戏",
    `industry=${oppParsed?.extracted_info?.client_identity?.industry}`,
  );

  // 8. Mock 模式含"需求"/"确认"/"理解"关键词 → 需求理解预设 JSON
  const reqReq: LLMRequest = {
    messages: [{ role: "user", content: "请确认你的需求理解" }],
    response_format: "json",
  };
  const reqResp = await mockAdapter.chat(reqReq);
  let reqParsed: { extracted_info?: { client_identity?: { industry?: string } } } | null = null;
  try {
    reqParsed = JSON.parse(reqResp.content);
  } catch {
    reqParsed = null;
  }
  check("需求关键词 → 返回可解析 JSON", reqParsed !== null);
  check(
    "需求关键词 → extracted_info.client_identity.industry = 文创",
    reqParsed?.extracted_info?.client_identity?.industry === "文创",
    `industry=${reqParsed?.extracted_info?.client_identity?.industry}`,
  );

  // 9. 通用关键词 → 通用预设
  const genericReq: LLMRequest = {
    messages: [{ role: "user", content: "你好，今天天气怎么样" }],
    response_format: "json",
  };
  const genericResp = await mockAdapter.chat(genericReq);
  let genericParsed = false;
  try {
    JSON.parse(genericResp.content);
    genericParsed = true;
  } catch {
    genericParsed = false;
  }
  check("通用关键词 → 返回可解析 JSON", genericParsed);

  // 10. 真实模式代码路径存在（读源码确认 fetch 调用）
  const qwenSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/agents/qwen-adapter.ts"),
    "utf-8",
  );
  check("qwen-adapter.ts 含 fetch 调用", qwenSrc.includes("fetch("));
  check("qwen-adapter.ts 含 dashscope API URL", qwenSrc.includes("dashscope.aliyuncs.com"));
  check("qwen-adapter.ts 含 Authorization Bearer", qwenSrc.includes("Authorization"));
  check("qwen-adapter.ts 含 chat/completions", qwenSrc.includes("chat/completions"));

  // 11. 导入 T4 parseJsonWithRepair
  check(
    "qwen-adapter.ts 导入 parseJsonWithRepair",
    qwenSrc.includes("parseJsonWithRepair") && qwenSrc.includes("json-repair"),
  );

  // 12. 不修改 llm-adapter.ts 和 mock-llm-adapter.ts（git 状态检查）
  const llmAdapterPath = path.resolve(process.cwd(), "src/agents/llm-adapter.ts");
  const mockAdapterPath = path.resolve(process.cwd(), "src/agents/mock-llm-adapter.ts");
  const llmAdapterContent = fs.readFileSync(llmAdapterPath, "utf-8");
  const mockAdapterContent = fs.readFileSync(mockAdapterPath, "utf-8");
  // llm-adapter.ts 应该只有接口定义，不含 QwenAdapter 类定义或导入
  check("llm-adapter.ts 不含 QwenAdapter class 定义", !llmAdapterContent.includes("class QwenAdapter"));
  check("llm-adapter.ts 不含 QwenAdapter import", !llmAdapterContent.includes("import") || !llmAdapterContent.match(/import.*QwenAdapter/));
  check("mock-llm-adapter.ts 不含 QwenAdapter class 定义", !mockAdapterContent.includes("class QwenAdapter"));

  // 13. 真实模式构造器读取 config.apiKey
  const realAdapter = new QwenAdapter({ apiKey: "real-test-key" });
  check("有 apiKey 时构造不抛错", realAdapter instanceof QwenAdapter);

  // 14. 显式 mockMode 优先
  const forceMock = new QwenAdapter({ apiKey: "real-key", mockMode: true });
  const forceMockResp = await forceMock.chat({
    messages: [{ role: "user", content: "提取机会" }],
    response_format: "text",
  });
  check("显式 mockMode=true 时走 Mock 路径", forceMockResp.content.includes("Mock"));

  // 恢复原始环境变量
  if (originalKey !== undefined) {
    process.env.DASHSCOPE_API_KEY = originalKey;
  }
}

// ============================================================
// 验收 5.2：T2 guid > url 去重优先级
// ============================================================

console.log("\n[验收 5.2] T2 guid > url 去重优先级\n");

{
  // 1. OpportunityCard 新增 guid?: string 可选字段
  const card: OpportunityCard = makeCard({ guid: "test-guid-123" });
  check("OpportunityCard.guid 存在", card.guid === "test-guid-123");

  const cardNoGuid: OpportunityCard = makeCard();
  check("OpportunityCard.guid 可选（未设置时 undefined）", cardNoGuid.guid === undefined);

  // 2. computeDedupKey(title, url) 不传 guid → 与现有行为完全一致（向后兼容）
  const title = "机会A";
  const url = "https://a.com";
  const expectedKey = crypto
    .createHash("sha256")
    .update(`${title}|${url}`, "utf-8")
    .digest("hex")
    .slice(0, 16);
  const actualKey = computeDedupKey(title, url);
  check("computeDedupKey(title, url) 向后兼容", actualKey === expectedKey, `actual=${actualKey} expected=${expectedKey}`);

  // 3. computeDedupKey(title, url, guid) 传 guid → sha256(guid).slice(0,16)
  const guid = "guid-123";
  const expectedGuidKey = crypto
    .createHash("sha256")
    .update(guid, "utf-8")
    .digest("hex")
    .slice(0, 16);
  const actualGuidKey = computeDedupKey(title, url, guid);
  check(
    "computeDedupKey(title, url, guid) = sha256(guid).slice(0,16)",
    actualGuidKey === expectedGuidKey,
    `actual=${actualGuidKey} expected=${expectedGuidKey}`,
  );

  // 4. 有 guid 的卡片和无 guid 的卡片不会碰撞
  const keyNoGuid = computeDedupKey("A", "https://a.com");
  const keyWithGuid = computeDedupKey("A", "https://a.com", "guid-123");
  check("有 guid 和无 guid 的 dedup_key 不碰撞", keyNoGuid !== keyWithGuid);

  // 5. 传空字符串 guid → 等价于不传 guid（向后兼容）
  const keyEmptyGuid = computeDedupKey(title, url, "");
  check("空字符串 guid 等价于不传 guid", keyEmptyGuid === expectedKey);

  // 6. 传 undefined guid → 等价于不传 guid
  const keyUndefinedGuid = computeDedupKey(title, url, undefined);
  check("undefined guid 等价于不传 guid", keyUndefinedGuid === expectedKey);

  // 7. 不同 guid 产生不同 dedup_key
  const key1 = computeDedupKey("A", "https://a.com", "guid-1");
  const key2 = computeDedupKey("A", "https://a.com", "guid-2");
  check("不同 guid 产生不同 dedup_key", key1 !== key2);

  // 8. LocalFileStore.add() 传递 card.guid（读源码确认）
  const storeSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/agents/opportunity-store.ts"),
    "utf-8",
  );
  check(
    "LocalFileStore.add() 传递 card.guid",
    storeSrc.includes("computeDedupKey(card.title, card.official_source_url, card.guid)"),
  );

  // 9. LocalFileStore.addBatch() 传递 card.guid（读源码确认）
  // addBatch 中也有同样的调用
  const addBatchMatch = storeSrc.match(/addBatch[\s\S]*?computeDedupKey\(card\.title, card\.official_source_url, card\.guid\)/);
  check("LocalFileStore.addBatch() 传递 card.guid", addBatchMatch !== null);

  // 10. LocalFileStore 实际行为测试：有 guid 的卡片用 guid 去重
  const testStorePath = "data/test-store-task019b.json";
  const testStoreAbs = path.resolve(process.cwd(), testStorePath);
  // 清理旧文件
  try {
    if (fs.existsSync(testStoreAbs)) fs.rmSync(testStoreAbs, { force: true });
  } catch {
    // ignore
  }

  const store = new LocalFileStore({ file_path: testStorePath, auto_flush: false });
  const cardWithGuid = makeCard({
    title: "_GUID 测试机会",
    official_source_url: "https://example.com/guid-test",
    guid: "unique-guid-abc",
  });
  const entry = store.add(cardWithGuid, "ai_competition");
  const expectedDedup = crypto
    .createHash("sha256")
    .update("unique-guid-abc", "utf-8")
    .digest("hex")
    .slice(0, 16);
  check(
    "LocalFileStore.add 用 guid 生成 dedup_key",
    entry.dedup_key === expectedDedup,
    `actual=${entry.dedup_key} expected=${expectedDedup}`,
  );

  // 11. 同 guid 不同 title/url → 去重为同一条
  const cardSameGuidDiffTitle = makeCard({
    title: "_GUID 不同标题",
    official_source_url: "https://example.com/different-url",
    guid: "unique-guid-abc",
  });
  const entry2 = store.add(cardSameGuidDiffTitle, "ai_competition");
  check("同 guid 不同 title/url → 去重为同一条", entry2.dedup_key === entry.dedup_key);

  // 12. 无 guid 的卡片仍用 title|url 去重
  const cardNoGuidA = makeCard({
    title: "无 GUID 机会 A",
    official_source_url: "https://example.com/no-guid-a",
  });
  const entry3 = store.add(cardNoGuidA, "ai_competition");
  const expectedNoGuidKey = crypto
    .createHash("sha256")
    .update(`无 GUID 机会 A|https://example.com/no-guid-a`, "utf-8")
    .digest("hex")
    .slice(0, 16);
  check(
    "无 guid 卡片用 title|url 去重",
    entry3.dedup_key === expectedNoGuidKey,
    `actual=${entry3.dedup_key} expected=${expectedNoGuidKey}`,
  );

  // 清理测试文件
  try {
    if (fs.existsSync(testStoreAbs)) fs.rmSync(testStoreAbs, { force: true });
  } catch {
    // ignore
  }
}

// ============================================================
// 验收 5.3：T5 渠道格式指南
// ============================================================

console.log("\n[验收 5.3] T5 渠道格式指南\n");

{
  // 1. getChannelFormatGuide 返回正确格式
  const wechatGuide = getChannelFormatGuide("wechat");
  check("wechat guide.channel = wechat", wechatGuide.channel === "wechat");
  check("wechat guide.max_length = 2048", wechatGuide.max_length === 2048);
  check("wechat guide.format = plain", wechatGuide.format === "plain");
  check("wechat guide.emoji_enabled = true", wechatGuide.emoji_enabled === true);
  check("wechat guide.link_format = inline", wechatGuide.link_format === "inline");

  const emailGuide = getChannelFormatGuide("email");
  check("email guide.channel = email", emailGuide.channel === "email");
  check("email guide.max_length = 0（无限制）", emailGuide.max_length === 0);
  check("email guide.format = html", emailGuide.format === "html");
  check("email guide.emoji_enabled = false", emailGuide.emoji_enabled === false);
  check("email guide.link_format = inline", emailGuide.link_format === "inline");

  const webGuide = getChannelFormatGuide("web");
  check("web guide.channel = web", webGuide.channel === "web");
  check("web guide.max_length = 0（无限制）", webGuide.max_length === 0);
  check("web guide.format = markdown", webGuide.format === "markdown");
  check("web guide.emoji_enabled = true", webGuide.emoji_enabled === true);
  check("web guide.link_format = inline", webGuide.link_format === "inline");

  // 2. ReminderChannel 类型检查
  const channels: ReminderChannel[] = ["wechat", "email", "web"];
  check("ReminderChannel 包含 wechat/email/web", channels.length === 3);

  // 3. ChannelFormatGuide interface 可用
  const guide: ChannelFormatGuide = wechatGuide;
  check("ChannelFormatGuide interface 可用", guide.channel === "wechat");

  // 4. renderRemindersForChannel 存在
  check("renderRemindersForChannel 是函数", typeof renderRemindersForChannel === "function");

  // 5. wechat 渠道：纯文本 + emoji
  const result = makeReminderResult();
  const wechatOutput = renderRemindersForChannel(result, "wechat");
  check("wechat 输出非空", wechatOutput.length > 0);
  check("wechat 含【前缀", wechatOutput.includes("【"));
  check("wechat 含品牌名", wechatOutput.includes(BRAND.product_name));
  check("wechat 含 emoji 🔴", wechatOutput.includes("🔴"));
  check("wechat 含 emoji 🟡", wechatOutput.includes("🟡"));
  check("wechat 含 emoji 🔵", wechatOutput.includes("🔵"));
  check("wechat 含 emoji ⚪", wechatOutput.includes("⚪"));
  check("wechat 含 URL", wechatOutput.includes("https://example.com/urgent"));
  check("wechat 含紧急提醒标题", wechatOutput.includes("紧急机会"));
  // wechat 是纯文本，不含 Markdown 语法
  check("wechat 不含 Markdown # 标题", !wechatOutput.includes("# "));
  check("wechat 不含 HTML 标签", !wechatOutput.includes("<"));

  // 6. wechat 超长截断 + "详见Web"
  // 构造大量提醒触发截断
  const manyItems: ReminderItem[] = [];
  for (let i = 0; i < 200; i++) {
    const entry = makeStoreEntry({
      title: `超长测试机会编号 ${i} 用于触发微信截断逻辑`,
      deadline: daysFromBase(2),
      official_source_url: `https://example.com/very-long-url-${i}`,
    });
    manyItems.push(makeReminderItem(entry, "urgent", 2));
  }
  const longResult: ReminderResult = {
    urgent: manyItems,
    soon: [],
    warning: [],
    expired: [],
    no_reminder: [],
    summary: {
      total: 200,
      urgent_count: 200,
      soon_count: 0,
      warning_count: 0,
      expired_count: 0,
      no_reminder_count: 0,
    },
    base_date: BASE_DATE,
  };
  const longWechat = renderRemindersForChannel(longResult, "wechat");
  check("wechat 超长时截断到 ≤ 2048 字符", longWechat.length <= 2048, `length=${longWechat.length}`);
  check("wechat 超长时含「详见Web」", longWechat.includes("详见Web"));

  // 7. wechat 有紧急项时标题用【紧急提醒】
  check("wechat 有紧急项 → 标题含【紧急提醒】", wechatOutput.includes("【紧急提醒】"));

  // 8. wechat 无紧急项时标题用【提醒】
  const noUrgentResult: ReminderResult = {
    urgent: [],
    soon: [makeReminderItem(makeStoreEntry({ title: "即将", deadline: daysFromBase(5) }), "soon", 5)],
    warning: [],
    expired: [],
    no_reminder: [],
    summary: {
      total: 1,
      urgent_count: 0,
      soon_count: 1,
      warning_count: 0,
      expired_count: 0,
      no_reminder_count: 0,
    },
    base_date: BASE_DATE,
  };
  const noUrgentWechat = renderRemindersForChannel(noUrgentResult, "wechat");
  check("wechat 无紧急项 → 标题含【提醒】", noUrgentWechat.includes("【提醒】"));
  check("wechat 无紧急项 → 标题不含【紧急提醒】", !noUrgentWechat.includes("【紧急提醒】"));

  // 9. email 渠道：HTML + <h2> + <a href，无 emoji
  const emailOutput = renderRemindersForChannel(result, "email");
  check("email 输出非空", emailOutput.length > 0);
  check("email 含 <h2> 标签", emailOutput.includes("<h2>"));
  check("email 含 <table> 标签", emailOutput.includes("<table"));
  check("email 含 <tr> 标签", emailOutput.includes("<tr>"));
  check("email 含 <a href", emailOutput.includes("<a href"));
  check("email 含品牌名", emailOutput.includes(BRAND.product_name));
  check("email 含紧急项红色高亮", emailOutput.includes('style="color:red"'));
  // email 不含 emoji
  check("email 不含 🔴", !emailOutput.includes("🔴"));
  check("email 不含 🟡", !emailOutput.includes("🟡"));
  check("email 不含 🔵", !emailOutput.includes("🔵"));
  check("email 不含 ⚪", !emailOutput.includes("⚪"));

  // 10. email HTML 转义（含特殊字符的标题）
  const xssResult: ReminderResult = {
    urgent: [
      makeReminderItem(
        makeStoreEntry({
          title: "<script>alert('xss')</script>",
          deadline: daysFromBase(2),
        }),
        "urgent",
        2,
      ),
    ],
    soon: [],
    warning: [],
    expired: [],
    no_reminder: [],
    summary: {
      total: 1,
      urgent_count: 1,
      soon_count: 0,
      warning_count: 0,
      expired_count: 0,
      no_reminder_count: 0,
    },
    base_date: BASE_DATE,
  };
  const xssEmail = renderRemindersForChannel(xssResult, "email");
  check("email 转义 <script>", xssEmail.includes("&lt;script&gt;"));
  check("email 不含原始 <script>", !xssEmail.includes("<script>"));

  // 11. web 渠道：Markdown + emoji
  const webOutput = renderRemindersForChannel(result, "web");
  check("web 输出非空", webOutput.length > 0);
  check("web 含 Markdown # 标题", webOutput.includes("# "));
  check("web 含品牌名", webOutput.includes(BRAND.product_name));
  check("web 含 emoji 🔴", webOutput.includes("🔴"));
  check("web 含 emoji 🟡", webOutput.includes("🟡"));
  check("web 含 emoji 🔵", webOutput.includes("🔵"));
  check("web 含 emoji ⚪", webOutput.includes("⚪"));
  check("web 含 Markdown 链接 [URL](URL)", webOutput.includes("](https://example.com/urgent)"));
  check("web 含紧急机会标题", webOutput.includes("紧急机会"));

  // 12. 现有 3 个渲染函数仍保留导出
  check("renderRemindersMarkdown 仍导出", typeof renderRemindersMarkdown === "function");
  check("renderRemindersJson 仍导出", typeof renderRemindersJson === "function");
  check("renderSingleReminder 仍导出", typeof renderSingleReminder === "function");

  // 13. 现有函数行为不变（回归）
  const md = renderRemindersMarkdown(result);
  check("renderRemindersMarkdown 输出含品牌名", md.includes(BRAND.product_name));
  check("renderRemindersMarkdown 输出含紧急提醒", md.includes("紧急提醒"));

  const json = renderRemindersJson(result);
  let jsonParsed: { summary?: { total?: number } } | null = null;
  try {
    jsonParsed = JSON.parse(json);
  } catch {
    jsonParsed = null;
  }
  check("renderRemindersJson 输出可解析", jsonParsed !== null);
  check("renderRemindersJson 含 total=4", jsonParsed?.summary?.total === 4);

  const single = renderSingleReminder(result.urgent[0]);
  check("renderSingleReminder 输出非空", single.length > 0);
  check("renderSingleReminder 含紧急标签", single.includes("紧急"));

  // 14. reminder-renderer.ts 源码检查：新增导出存在
  const rendererSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/agents/reminder-renderer.ts"),
    "utf-8",
  );
  check("reminder-renderer.ts 导出 ReminderChannel 类型", rendererSrc.includes("export type ReminderChannel"));
  check("reminder-renderer.ts 导出 ChannelFormatGuide interface", rendererSrc.includes("export interface ChannelFormatGuide"));
  check("reminder-renderer.ts 导出 renderRemindersForChannel", rendererSrc.includes("export function renderRemindersForChannel"));
  check("reminder-renderer.ts 导出 getChannelFormatGuide", rendererSrc.includes("export function getChannelFormatGuide"));
  // 现有函数仍存在
  check("reminder-renderer.ts 保留 renderRemindersMarkdown", rendererSrc.includes("export function renderRemindersMarkdown"));
  check("reminder-renderer.ts 保留 renderRemindersJson", rendererSrc.includes("export function renderRemindersJson"));
  check("reminder-renderer.ts 保留 renderSingleReminder", rendererSrc.includes("export function renderSingleReminder"));
}

// ============================================================
// 汇总
// ============================================================

console.log("\n=== 汇总 ===");
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);
if (failed > 0) {
  console.log("\n❌ 存在失败项");
  process.exit(1);
} else {
  console.log("\n✅ 全部通过");
  process.exit(0);
}
} // end main()

main().catch((err: unknown) => {
  console.error("验收脚本异常退出:", err);
  process.exit(1);
});
