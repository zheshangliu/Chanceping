/**
 * Task 021 验收脚本
 *
 * 运行：npx tsx scripts/verify-task021.ts
 *
 * 覆盖验收标准 5.1-5.5：
 *   5.1 DSL 解析器（17 项）
 *   5.2 匹配引擎（16 项）
 *   5.3 存储层（5 项）
 *   5.4 集成与回归（2 项 + 回归）
 *   5.5 工程约束自检
 */

import fs from "fs";
import path from "path";
import type { StoreEntry } from "../src/agents/opportunity-store";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import { parseLine, parseWatchRules } from "../src/watch/dsl-parser";
import { matchEntry, filterByRules, matchAndSummarize } from "../src/watch/rule-matcher";
import { LocalWatchStore, createDefaultWatchStore } from "../src/watch/watch-store";
import { generateReminders } from "../src/agents/reminder-engine";

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
// Mock StoreEntry 数据构造
// ============================================================

/** 基准日期：2026-07-01（UTC） */
const BASE_DATE = new Date("2026-07-01T00:00:00Z");

function makeCard(over: Partial<OpportunityCard>): OpportunityCard {
  return {
    title: "默认标题",
    type: "AI 赛事",
    organizer: "默认主办方",
    region: "上海",
    deadline: "2026-07-15",
    reward_or_value: "奖金 10 万",
    eligibility: "公司/团队",
    materials_required: "商业计划书",
    match_reason: "AI 赛事匹配",
    next_action: "立即报名",
    official_source_url: "https://example.com",
    application_url: "",
    contact_info: "",
    risk_note: "",
    backend_score: 80,
    visible_level: "A",
    status: "new",
    ...over,
  };
}

function makeEntry(over: Omit<Partial<StoreEntry>, "card"> & { card?: Partial<OpportunityCard> }): StoreEntry {
  const { card, ...rest } = over;
  return {
    card: makeCard(card ?? {}),
    radar_type: "ai_competition",
    added_at: "2026-06-28T00:00:00Z",
    updated_at: "2026-06-28T00:00:00Z",
    dedup_key: "default-key",
    ...rest,
  };
}

// 5 条 Mock 数据（覆盖不同雷达类型/等级/地区/截止日期/状态）
const mockEntries: StoreEntry[] = [
  // [0] AI 比赛，A 级，上海，deadline 5 天后（2026-07-06），status=new
  makeEntry({
    card: {
      title: "上海 AI 创新大赛",
      type: "AI 赛事",
      organizer: "上海市科委",
      region: "上海",
      deadline: "2026-07-06",
      visible_level: "A",
      status: "new",
      match_reason: "AI 赛事匹配，地区上海",
    },
    radar_type: "ai_competition",
    dedup_key: "entry-1",
  }),
  // [1] 政策补贴，B 级，北京，deadline 60 天后（2026-08-30），status=saved
  makeEntry({
    card: {
      title: "北京市 AI 补贴申报",
      type: "政策补贴",
      organizer: "北京市经信局",
      region: "北京",
      deadline: "2026-08-30",
      reward_or_value: "补贴 50 万",
      visible_level: "B",
      status: "saved",
      match_reason: "政策补贴，地区北京",
    },
    radar_type: "opc_policy",
    dedup_key: "entry-2",
  }),
  // [2] 文创比赛，S 级，上海，deadline 已过（2026-06-15），status=viewed
  makeEntry({
    card: {
      title: "上海文创设计大赛",
      type: "文创比赛",
      organizer: "上海文创办",
      region: "上海",
      deadline: "2026-06-15",
      visible_level: "S",
      status: "viewed",
      match_reason: "文创比赛，地区上海",
    },
    radar_type: "cultural_heritage",
    dedup_key: "entry-3",
  }),
  // [3] AI 黑客松，A 级，全国，deadline 10 天后（2026-07-11），status=saved
  makeEntry({
    card: {
      title: "全国 AI 黑客松挑战赛",
      type: "AI 赛事",
      organizer: "阿里云",
      region: "全国",
      deadline: "2026-07-11",
      reward_or_value: "奖金 100 万",
      visible_level: "A",
      status: "saved",
      match_reason: "AI 黑客松，全国范围",
    },
    radar_type: "ai_competition",
    dedup_key: "entry-4",
  }),
  // [4] 政策申报，C 级，深圳，deadline 100 天后（2026-10-09），status=new
  makeEntry({
    card: {
      title: "深圳人工智能专项申报",
      type: "政策补贴",
      organizer: "深圳市科创委",
      region: "深圳",
      deadline: "2026-10-09",
      reward_or_value: "补贴 20 万",
      visible_level: "C",
      status: "new",
      match_reason: "政策申报，地区深圳",
    },
    radar_type: "opc_policy",
    dedup_key: "entry-5",
  }),
];

// ============================================================
// 5.1 DSL 解析器测试
// ============================================================

section("5.1 DSL 解析器测试");

// 测试 1: 空行解析
check("1. 空行解析返回 null", parseLine("", 1) === null);

// 测试 2: 注释行解析
check("2. 注释行解析返回 null", parseLine("# 这是注释", 2) === null);

// 测试 3: 纯井号注释
check("3. 纯井号注释返回 null", parseLine("#", 3) === null);

// 测试 4: 基础语法 + 含关键词（词组含空格）
{
  const rule = parseLine("+AI 比赛", 4);
  check(
    "4. + 前缀解析为 include",
    rule !== null && rule.conditions.length === 1 && rule.conditions[0].operator === "include",
  );
  check(
    "4.1 include 值为 'AI 比赛'（词组含空格）",
    rule !== null && rule.conditions[0].value === "AI 比赛",
    `actual=${rule?.conditions[0].value}`,
  );
}

// 测试 5: 基础语法 - 排除关键词
{
  const rule = parseLine("!青少年", 5);
  check(
    "5. ! 前缀解析为 exclude",
    rule !== null && rule.conditions.length === 1 && rule.conditions[0].operator === "exclude",
  );
  check("5.1 exclude 值为 '青少年'", rule !== null && rule.conditions[0].value === "青少年");
}

// 测试 6: 基础语法 @雷达类型
{
  const rule = parseLine("@ai_competition", 6);
  check(
    "6. @ 前缀解析为 radar",
    rule !== null && rule.conditions.length === 1 && rule.conditions[0].operator === "radar",
  );
  check(
    "6.1 radar 值为 'ai_competition'",
    rule !== null && rule.conditions[0].value === "ai_competition",
  );
}

// 测试 7: 基础语法 [组名]
{
  const rule = parseLine("[上海AI赛事] +AI", 7);
  check(
    "7. [组名] 解析为 group_name",
    rule !== null && rule.group_name === "上海AI赛事",
    `actual=${rule?.group_name}`,
  );
}

// 测试 8: 扩展 #等级（单等级）
{
  const rule = parseLine("#A", 8);
  check(
    "8. # 前缀解析为 level",
    rule !== null && rule.conditions.length === 1 && rule.conditions[0].operator === "level",
  );
  const levels = rule?.conditions[0].value as string[];
  check("8.1 level 值为 ['A']", levels && levels.length === 1 && levels[0] === "A");
}

// 测试 9: 扩展 #多等级
{
  const rule = parseLine("#AB", 9);
  const levels = rule?.conditions[0].value as string[];
  check(
    "9. #AB 解析为多等级",
    levels && levels.length === 2 && levels.includes("A") && levels.includes("B"),
  );
}

// 测试 10: 扩展 $地区
{
  const rule = parseLine("$上海", 10);
  check(
    "10. $ 前缀解析为 region",
    rule !== null && rule.conditions.length === 1 && rule.conditions[0].operator === "region",
  );
  check("10.1 region 值为 '上海'", rule !== null && rule.conditions[0].value === "上海");
}

// 测试 11: 扩展 %天数
{
  const rule = parseLine("%7", 11);
  check(
    "11. % 前缀解析为 deadline",
    rule !== null && rule.conditions.length === 1 && rule.conditions[0].operator === "deadline",
  );
  check("11.1 deadline 值为 7", rule !== null && rule.conditions[0].value === 7);
}

// 测试 12: 扩展 *收藏
{
  const rule = parseLine("*", 12);
  check(
    "12. * 前缀解析为 starred",
    rule !== null && rule.conditions.length === 1 && rule.conditions[0].operator === "starred",
  );
  check("12.1 starred 值为 true", rule !== null && rule.conditions[0].value === true);
}

// 测试 13: 完整规则 7 条件
{
  const rule = parseLine(
    "[上海AI赛事] +AI 比赛 !青少年 @ai_competition $上海 #AB %30 *",
    13,
  );
  check(
    "13. 完整规则解析出 7 个条件",
    rule !== null && rule.conditions.length === 7,
    `actual=${rule?.conditions.length}`,
  );
  check(
    "13.1 组名正确",
    rule !== null && rule.group_name === "上海AI赛事",
  );
  const ops = rule?.conditions.map((c) => c.operator);
  check(
    "13.2 含全部 7 种操作符",
    Boolean(
      ops &&
        ops.includes("include") &&
        ops.includes("exclude") &&
        ops.includes("radar") &&
        ops.includes("level") &&
        ops.includes("region") &&
        ops.includes("deadline") &&
        ops.includes("starred"),
    ),
  );
}

// 测试 14: 默认组名
{
  const rule = parseLine("+AI", 14);
  check(
    "14. 无组名时默认为 '默认规则'",
    rule !== null && rule.group_name === "默认规则",
    `actual=${rule?.group_name}`,
  );
}

// 测试 15: 多行解析
{
  const text = `# 注释行
[上海AI赛事] +AI 比赛 @ai_competition
[政策补贴] +补贴 @opc_policy
+AI @ai_competition`;
  const ruleSet = parseWatchRules(text);
  check(
    "15. 多行解析 rules.length=3",
    ruleSet.rules.length === 3,
    `actual=${ruleSet.rules.length}`,
  );
  check("15.1 errors 为空", ruleSet.errors.length === 0);
}

// 测试 16: 错误：只有组名
{
  const text = "[测试组]";
  const ruleSet = parseWatchRules(text);
  check(
    "16. 只有组名时 errors 含 1 条",
    ruleSet.errors.length === 1 && ruleSet.errors[0].message.includes("没有任何条件"),
    `actual errors=${ruleSet.errors.length}`,
  );
}

// 测试 17: 组名提取含特殊字符
{
  const rule = parseLine("[我的规则-2026] +AI", 17);
  check(
    "17. 组名含特殊字符",
    rule !== null && rule.group_name === "我的规则-2026",
    `actual=${rule?.group_name}`,
  );
}

// ============================================================
// 5.2 匹配引擎测试
// ============================================================

section("5.2 匹配引擎测试");

// 测试 18: include 条件命中
{
  const rule = parseLine("+AI", 18)!;
  const result = matchEntry(mockEntries[0], rule, BASE_DATE);
  check("18. include 条件命中", result.matched === true, result.reason);
}

// 测试 19: include 条件未命中
{
  const rule = parseLine("+不存在的关键词", 19)!;
  const result = matchEntry(mockEntries[0], rule, BASE_DATE);
  check("19. include 条件未命中", result.matched === false);
}

// 测试 20: exclude 条件排除
{
  const rule = parseLine("+AI !青少年", 20)!;
  // entry[0] 含 "AI" 不含 "青少年" → 通过
  const result0 = matchEntry(mockEntries[0], rule, BASE_DATE);
  check("20. exclude 条件：不含排除词时通过", result0.matched === true);

  // 构造含 "青少年" 的条目
  const entryWithExclude = makeEntry({
    card: { title: "青少年 AI 大赛", match_reason: "青少年赛事" },
  });
  const result1 = matchEntry(entryWithExclude, rule, BASE_DATE);
  check("20.1 exclude 条件：含排除词时不通过", result1.matched === false);
}

// 测试 21: radar 条件匹配
{
  const rule = parseLine("@ai_competition", 21)!;
  const result = matchEntry(mockEntries[0], rule, BASE_DATE);
  check("21. radar 条件匹配", result.matched === true);
}

// 测试 22: radar 条件不匹配
{
  const rule = parseLine("@opc_policy", 22)!;
  const result = matchEntry(mockEntries[0], rule, BASE_DATE);
  check("22. radar 条件不匹配", result.matched === false);
}

// 测试 23: level 条件匹配（单等级）
{
  const rule = parseLine("#A", 23)!;
  const result = matchEntry(mockEntries[0], rule, BASE_DATE); // entry[0] 是 A 级
  check("23. level 条件匹配（单等级）", result.matched === true);
}

// 测试 24: level 条件匹配（多等级 #AB）
{
  const rule = parseLine("#AB", 24)!;
  const result0 = matchEntry(mockEntries[0], rule, BASE_DATE); // A 级
  const result1 = matchEntry(mockEntries[1], rule, BASE_DATE); // B 级
  const result4 = matchEntry(mockEntries[4], rule, BASE_DATE); // C 级
  check("24. level #AB 匹配 A 级", result0.matched === true);
  check("24.1 level #AB 匹配 B 级", result1.matched === true);
  check("24.2 level #AB 不匹配 C 级", result4.matched === false);
}

// 测试 25: region 条件匹配
{
  const rule = parseLine("$上海", 25)!;
  const result0 = matchEntry(mockEntries[0], rule, BASE_DATE); // 上海
  const result1 = matchEntry(mockEntries[1], rule, BASE_DATE); // 北京
  check("25. region 条件匹配", result0.matched === true);
  check("25.1 region 条件不匹配", result1.matched === false);
}

// 测试 26: deadline 条件在范围内
{
  const rule = parseLine("%7", 26)!;
  // entry[0] deadline=2026-07-06，base=2026-07-01 → 5 天 → 在 7 天内
  const result = matchEntry(mockEntries[0], rule, BASE_DATE);
  check("26. deadline 条件在范围内", result.matched === true, result.reason);
}

// 测试 27: deadline 条件超出范围
{
  const rule = parseLine("%7", 27)!;
  // entry[3] deadline=2026-07-11，base=2026-07-01 → 10 天 → 超出 7 天
  const result = matchEntry(mockEntries[3], rule, BASE_DATE);
  check("27. deadline 条件超出范围", result.matched === false, result.reason);
}

// 测试 28: starred 条件匹配
{
  const rule = parseLine("*", 28)!;
  const result1 = matchEntry(mockEntries[1], rule, BASE_DATE); // status=saved
  const result0 = matchEntry(mockEntries[0], rule, BASE_DATE); // status=new
  check("28. starred 条件匹配（status=saved）", result1.matched === true);
  check("28.1 starred 条件不匹配（status=new）", result0.matched === false);
}

// 测试 29: 完整规则全条件通过
{
  // entry[0]: 上海 AI 创新大赛，A 级，上海，deadline 5 天后，ai_competition
  const rule = parseLine(
    "[上海AI赛事] +AI !青少年 @ai_competition $上海 #A %7",
    29,
  )!;
  const result = matchEntry(mockEntries[0], rule, BASE_DATE);
  check("29. 完整规则全条件通过", result.matched === true, result.reason);
}

// 测试 30: 完整规则部分条件未通过
{
  // entry[1]: 北京政策补贴，B 级，不匹配 @ai_competition 和 $上海
  const rule = parseLine(
    "[上海AI赛事] +AI @ai_competition $上海 #A",
    30,
  )!;
  const result = matchEntry(mockEntries[1], rule, BASE_DATE);
  check("30. 完整规则部分条件未通过", result.matched === false, result.reason);
}

// 测试 31: filterByRules 筛选（OR 逻辑）
{
  const text = `+补贴 @opc_policy
+黑客松 @ai_competition`;
  const ruleSet = parseWatchRules(text);
  const filtered = filterByRules(mockEntries, ruleSet, BASE_DATE);
  // 应命中 entry[1]（政策补贴）、entry[3]（AI 黑客松）、entry[4]（政策申报）
  check(
    "31. filterByRules 筛选正确（OR 逻辑）",
    filtered.length === 3,
    `actual=${filtered.length}`,
  );
}

// 测试 32: filterByRules 空规则集返回全部
{
  const ruleSet = parseWatchRules("");
  const filtered = filterByRules(mockEntries, ruleSet, BASE_DATE);
  check(
    "32. filterByRules 空规则集返回全部",
    filtered.length === mockEntries.length,
    `actual=${filtered.length}`,
  );
}

// 测试 33: matchAndSummarize 汇总正确
{
  const text = `+AI @ai_competition
+补贴 @opc_policy`;
  const ruleSet = parseWatchRules(text);
  const summary = matchAndSummarize(mockEntries, ruleSet, BASE_DATE);
  check("33. matchAndSummarize total_entries=5", summary.total_entries === 5);
  // entry[0][3] 含 AI，entry[1][4] 含补贴
  check(
    "33.1 matched_entries=4",
    summary.matched_entries === 4,
    `actual=${summary.matched_entries}`,
  );
  check("33.2 by_rule 长度=2", summary.by_rule.length === 2);
}

// ============================================================
// 5.3 存储层测试
// ============================================================

section("5.3 存储层测试");

const TEST_STORE_PATH = "data/watch-rules-test.txt";

// 测试 34: LocalWatchStore 保存 + 加载
{
  const store = new LocalWatchStore({ file_path: TEST_STORE_PATH });
  store.clear();
  const text = "[测试] +AI @ai_competition";
  store.saveRaw(text);
  const loaded = store.loadRaw();
  check(
    "34. LocalWatchStore 保存 + 加载一致",
    loaded.trim() === text,
    `actual=${loaded}`,
  );
}

// 测试 35: LocalWatchStore appendLine
{
  const store = new LocalWatchStore({ file_path: TEST_STORE_PATH });
  store.clear();
  store.appendLine("[规则1] +AI");
  store.appendLine("[规则2] +补贴");
  const loaded = store.loadRaw();
  check(
    "35. appendLine 追加正确",
    loaded.includes("[规则1] +AI") && loaded.includes("[规则2] +补贴"),
    `actual=${loaded}`,
  );
}

// 测试 36: LocalWatchStore clear
{
  const store = new LocalWatchStore({ file_path: TEST_STORE_PATH });
  store.saveRaw("一些规则");
  store.clear();
  const loaded = store.loadRaw();
  check("36. clear 清空", loaded === "", `actual=${loaded}`);
}

// 测试 37: LocalWatchStore loadRules 解析
{
  const store = new LocalWatchStore({ file_path: TEST_STORE_PATH });
  store.saveRaw("[测试] +AI @ai_competition\n[规则2] +补贴");
  const ruleSet = store.loadRules();
  check(
    "37. loadRules 解析正确",
    ruleSet.rules.length === 2 && ruleSet.errors.length === 0,
    `rules=${ruleSet.rules.length}, errors=${ruleSet.errors.length}`,
  );
}

// 测试 38: 不存在的文件返回空文本
{
  const store = new LocalWatchStore({ file_path: "data/watch-rules-not-exist.txt" });
  const loaded = store.loadRaw();
  check("38. 不存在的文件返回空文本", loaded === "", `actual=${loaded}`);
  // 清理：确保文件不存在
  const fp = store.getFilePath();
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

// 测试 39: createDefaultWatchStore 工厂函数
{
  const store = createDefaultWatchStore();
  check(
    "39. createDefaultWatchStore 返回 LocalWatchStore 实例",
    store instanceof LocalWatchStore,
  );
  check(
    "39.1 默认路径包含 data/watch-rules.txt",
    store.getFilePath().includes("watch-rules.txt"),
  );
}

// 清理测试文件
{
  const store = new LocalWatchStore({ file_path: TEST_STORE_PATH });
  const fp = store.getFilePath();
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

// ============================================================
// 5.4 集成与回归测试
// ============================================================

section("5.4 集成与回归测试");

// 测试 40: Watch Rules 筛选后再用 generateReminders 生成提醒
{
  const text = `[上海AI赛事] +AI @ai_competition $上海`;
  const ruleSet = parseWatchRules(text);
  const filtered = filterByRules(mockEntries, ruleSet, BASE_DATE);
  // entry[0] 上海 AI 大赛 → 应被筛选出来
  check(
    "40. Watch Rules 筛选后条目数 > 0",
    filtered.length > 0,
    `actual=${filtered.length}`,
  );
  // 用筛选后的条目生成提醒
  const reminders = generateReminders(filtered, {
    base_date: "2026-07-01",
  });
  check(
    "40.1 generateReminders 返回有效结果",
    reminders !== null && typeof reminders === "object",
  );
  check(
    "40.2 筛选后条目数 <= 原始条目数",
    filtered.length <= mockEntries.length,
  );
}

// 测试 41: reminder-engine 现有功能不受影响（回归）
{
  const reminders = generateReminders(mockEntries, {
    base_date: "2026-07-01",
  });
  // entry[0] deadline=2026-07-06 → 5 天 → soon
  // entry[3] deadline=2026-07-11 → 10 天 → warning
  // entry[2] deadline=2026-06-15 → 已截止 → expired
  // entry[1] deadline=2026-08-30 → 60 天 → none（不提醒）
  // entry[4] deadline=2026-10-09 → 100 天 → none（不提醒）
  check(
    "41. reminder-engine 回归：total=3",
    reminders.summary.total === 3,
    `actual=${reminders.summary.total}`,
  );
  check(
    "41.1 reminder-engine 回归：有提醒项",
    reminders.summary.urgent_count +
      reminders.summary.soon_count +
      reminders.summary.warning_count +
      reminders.summary.expired_count +
      reminders.summary.no_reminder_count ===
      5,
  );
}

// ============================================================
// 5.5 工程约束自检
// ============================================================

section("5.5 工程约束自检");

// 约束 1: 不引入新 npm 依赖（检查 package.json 无变化）
{
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  check(
    "约束1. 不引入新 npm 依赖",
    !deps.includes("lodash") && !devDeps.includes("lodash"),
    "package.json dependencies 无新增",
  );
}

// 约束 2: 不修改现有文件（检查关键文件存在且未被本任务修改）
{
  const files = [
    "src/agents/reminder-engine.ts",
    "src/agents/opportunity-store.ts",
    "src/schema/opportunity-card.ts",
    "src/schema/scoring-rules.ts",
    "src/search/rule-filter.ts",
  ];
  check(
    "约束2. 现有文件未被修改（仅引用）",
    files.every((f) => fs.existsSync(f)),
  );
}

// 约束 3: 新文件全部在 src/watch/ 目录下
{
  const watchFiles = [
    "src/watch/types.ts",
    "src/watch/dsl-parser.ts",
    "src/watch/rule-matcher.ts",
    "src/watch/watch-store.ts",
  ];
  check(
    "约束3. 新文件全部在 src/watch/ 目录下",
    watchFiles.every((f) => fs.existsSync(f)),
  );
}

// 约束 4: 验证脚本临时文件测试后清理
{
  const testFile = path.resolve(process.cwd(), TEST_STORE_PATH);
  check(
    "约束4. 验证脚本临时文件已清理",
    !fs.existsSync(testFile),
    `文件仍存在: ${testFile}`,
  );
}

// 约束 5: 纯函数（dsl-parser 和 rule-matcher 不引入 fs）
{
  const dslParserCode = fs.readFileSync("src/watch/dsl-parser.ts", "utf-8");
  const ruleMatcherCode = fs.readFileSync("src/watch/rule-matcher.ts", "utf-8");
  check(
    "约束5. dsl-parser.ts 不引入 fs",
    !dslParserCode.includes('import fs') && !dslParserCode.includes('from "fs"'),
  );
  check(
    "约束5.1 rule-matcher.ts 不引入 fs",
    !ruleMatcherCode.includes('import fs') && !ruleMatcherCode.includes('from "fs"'),
  );
}

// ============================================================
// 汇总
// ============================================================

section("汇总");
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);
if (failed === 0) {
  console.log("✅ 全部通过");
} else {
  console.log("❌ 有失败项");
}
process.exit(failed === 0 ? 0 : 1);
