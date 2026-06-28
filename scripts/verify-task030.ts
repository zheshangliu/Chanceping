/**
 * Task 030 验收脚本：机会状态机扩展 + 机会复盘（T17+T16）
 *
 * 来源：Task 030 第 6 节验收标准。
 *
 * 7 组验证：
 *   1. 文件存在性检查
 *   2. opportunity-card.ts 状态枚举/转换表/标签（F1-F4）
 *   3. opportunity-state-machine.ts 状态机引擎（F5-F11）
 *   4. opportunity-review.ts 机会复盘（F12-F17）
 *   5. API 路由检查（F18-F20）
 *   6. 工程约束（T2 无新依赖）
 */

import fs from "fs";
import path from "path";

// ============================================================
// 测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passCount++;
  } else {
    console.log(`  FAIL  ${message}`);
    failCount++;
    failures.push(message);
  }
}

function section(title: string): void {
  console.log(`\n[验收 ${sectionCount}] ${title}\n`);
  sectionCount++;
}

let sectionCount = 1;

// ============================================================
// 1. 文件存在性检查
// ============================================================

function checkFileExists(): void {
  section("文件存在性检查");
  const files = [
    "src/agents/opportunity-state-machine.ts",
    "src/agents/opportunity-review.ts",
    "src/api/routes/review.ts",
    "scripts/verify-task030.ts",
  ];
  for (const file of files) {
    const fullPath = path.resolve(process.cwd(), file);
    assert(fs.existsSync(fullPath), `文件存在: ${file}`);
  }

  // 检查 app.ts 注册 review 路由
  const appPath = path.resolve(process.cwd(), "src/api/app.ts");
  const appContent = fs.readFileSync(appPath, "utf-8");
  assert(appContent.includes('import { reviewRoutes }'), "app.ts 导入 reviewRoutes");
  assert(appContent.includes('app.route("/api/review"'), "app.ts 注册 /api/review 路由");

  // 检查 package.json 含 verify:review 脚本
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkgContent = fs.readFileSync(pkgPath, "utf-8");
  assert(
    pkgContent.includes('"verify:review": "tsx scripts/verify-task030.ts"'),
    'package.json 含 verify:review 脚本',
  );
}

// ============================================================
// 2. opportunity-card.ts 状态枚举/转换表/标签
// ============================================================

function checkStatusExtensions(): void {
  section("opportunity-card.ts 状态枚举/转换表/标签");
  const {
    CARD_STATUS_TRANSITIONS,
    CARD_STATUS_LABELS,
    isStatusTransitionValid,
  } = require("../src/schema/opportunity-card");

  // F1: 状态枚举含 9 个状态（含 tracking/missed/expired）
  const allStatuses = Object.keys(CARD_STATUS_TRANSITIONS);
  assert(allStatuses.length === 9, `F1 状态枚举含 9 个状态（实际 ${allStatuses.length}）`);
  assert(allStatuses.includes("tracking"), "F1 含 tracking 状态");
  assert(allStatuses.includes("missed"), "F1 含 missed 状态");
  assert(allStatuses.includes("expired"), "F1 含 expired 状态");

  // F2: tracking 可转 saved/applied/missed/expired/archived/dismissed
  const trackingTransitions = CARD_STATUS_TRANSITIONS["tracking"];
  assert(trackingTransitions.includes("saved"), "F2 tracking → saved");
  assert(trackingTransitions.includes("applied"), "F2 tracking → applied");
  assert(trackingTransitions.includes("missed"), "F2 tracking → missed");
  assert(trackingTransitions.includes("expired"), "F2 tracking → expired");
  assert(trackingTransitions.includes("archived"), "F2 tracking → archived");
  assert(trackingTransitions.includes("dismissed"), "F2 tracking → dismissed");
  assert(trackingTransitions.length === 6, `F2 tracking 可转 6 个状态（实际 ${trackingTransitions.length}）`);

  // F3: missed/expired 可转 archived/dismissed
  const missedTransitions = CARD_STATUS_TRANSITIONS["missed"];
  assert(missedTransitions.includes("archived"), "F3 missed → archived");
  assert(missedTransitions.includes("dismissed"), "F3 missed → dismissed");
  assert(missedTransitions.length === 2, "F3 missed 可转 2 个状态");

  const expiredTransitions = CARD_STATUS_TRANSITIONS["expired"];
  assert(expiredTransitions.includes("archived"), "F3 expired → archived");
  assert(expiredTransitions.includes("dismissed"), "F3 expired → dismissed");
  assert(expiredTransitions.length === 2, "F3 expired 可转 2 个状态");

  // F4: 标签含 9 个
  const allLabels = Object.keys(CARD_STATUS_LABELS);
  assert(allLabels.length === 9, `F4 标签含 9 个（实际 ${allLabels.length}）`);
  assert(CARD_STATUS_LABELS["tracking"] === "跟踪中", "F4 tracking 标签 = 跟踪中");
  assert(CARD_STATUS_LABELS["missed"] === "已错过", "F4 missed 标签 = 已错过");
  assert(CARD_STATUS_LABELS["expired"] === "已过期", "F4 expired 标签 = 已过期");

  // F5: new → tracking 合法
  assert(isStatusTransitionValid("new", "tracking") === true, "F5 new → tracking 合法");

  // F6: applied → tracking 非法
  assert(isStatusTransitionValid("applied", "tracking") === false, "F6 applied → tracking 非法");
}

// ============================================================
// 3. opportunity-state-machine.ts 状态机引擎
// ============================================================

function checkStateMachine(): void {
  section("opportunity-state-machine.ts 状态机引擎");
  const {
    transition,
    autoExpire,
    autoMiss,
    getValidTransitions,
    batchAutoTransition,
  } = require("../src/agents/opportunity-state-machine");

  // F5: transition 合法转换
  const card1 = { status: "new", deadline: "2026-12-31" } as any;
  const r1 = transition(card1, "tracking");
  assert(r1.success === true, "F5 transition new → tracking success");
  assert(r1.card.status === "tracking", "F5 transition 后 status = tracking");

  // F6: transition 非法转换
  const card2 = { status: "applied", deadline: "2026-12-31" } as any;
  const r2 = transition(card2, "tracking");
  assert(r2.success === false, "F6 transition applied → tracking 失败");
  assert(r2.error !== undefined, "F6 transition 返回 error");
  assert(r2.card.status === "applied", "F6 transition 后 status 不变");

  // F7: autoExpire 截止已过 + 未报名 → expired
  const pastDate = "2026-01-01";
  const card3 = { status: "new", deadline: pastDate } as any;
  const r3 = autoExpire(card3, new Date("2026-06-28"));
  assert(r3.success === true, "F7 autoExpire success");
  assert(r3.card.status === "expired", "F7 autoExpire 后 status = expired");

  // F8: autoMiss 截止 7 天以上 + 未报名 → missed
  const card4 = { status: "tracking", deadline: "2026-05-15" } as any;
  const r4 = autoMiss(card4, new Date("2026-06-28"));
  assert(r4.success === true, "F8 autoMiss success");
  assert(r4.card.status === "missed", "F8 autoMiss 后 status = missed");

  // F9: autoExpire 截止未到 → 状态不变
  const futureDate = "2026-12-31";
  const card5 = { status: "new", deadline: futureDate } as any;
  const r5 = autoExpire(card5, new Date("2026-06-28"));
  assert(r5.success === true, "F9 autoExpire 截止未到 success");
  assert(r5.card.status === "new", "F9 autoExpire 截止未到 → status 不变");

  // F10: autoExpire 已报名 → 状态不变
  const card6 = { status: "applied", deadline: pastDate } as any;
  const r6 = autoExpire(card6, new Date("2026-06-28"));
  assert(r6.success === true, "F10 autoExpire 已报名 success");
  assert(r6.card.status === "applied", "F10 autoExpire 已报名 → status 不变");

  // F11: batchAutoTransition 批量自动转换
  const entries = [
    { dedup_key: "k1", card: { status: "new", deadline: "2026-06-15", title: "机会1" } },
    { dedup_key: "k2", card: { status: "tracking", deadline: "2026-06-25", title: "机会2" } },
    { dedup_key: "k3", card: { status: "applied", deadline: "2026-06-15", title: "机会3" } },
    { dedup_key: "k4", card: { status: "new", deadline: "2026-12-31", title: "机会4" } },
  ];
  const results = batchAutoTransition(entries as any, new Date("2026-06-28"));
  assert(results.length === 2, `F11 batchAutoTransition 返回 2 条（实际 ${results.length}）`);
  // k1 截止 6 月 15 日，已过 13 天（> 7 天）→ missed
  const k1Result = results.find((r: any) => r.dedup_key === "k1");
  assert(k1Result !== undefined, "F11 k1 在结果中");
  assert(k1Result?.to === "missed", "F11 k1 → missed（截止 7 天以上）");
  // k2 截止 6 月 25 日，已过 3 天（< 7 天）→ expired
  const k2Result = results.find((r: any) => r.dedup_key === "k2");
  assert(k2Result !== undefined, "F11 k2 在结果中");
  assert(k2Result?.to === "expired", "F11 k2 → expired（截止已过未到 7 天）");
  // k3 已报名 → 不转换
  const k3Result = results.find((r: any) => r.dedup_key === "k3");
  assert(k3Result === undefined, "F11 k3 不在结果中（已报名）");
  // k4 截止未到 → 不转换
  const k4Result = results.find((r: any) => r.dedup_key === "k4");
  assert(k4Result === undefined, "F11 k4 不在结果中（截止未到）");

  // getValidTransitions
  const newTransitions = getValidTransitions("new");
  assert(newTransitions.includes("tracking"), "getValidTransitions(new) 含 tracking");
  assert(newTransitions.includes("applied"), "getValidTransitions(new) 含 applied");
}

// ============================================================
// 4. opportunity-review.ts 机会复盘
// ============================================================

function checkReview(): void {
  section("opportunity-review.ts 机会复盘");
  const { generateReview } = require("../src/agents/opportunity-review");

  // 构造 mock 数据：5 条已截止机会
  const now = new Date("2026-06-28");
  const mockEntries = [
    {
      dedup_key: "k1",
      radar_type: "ai_competition",
      card: { title: "AI大赛1", status: "applied", deadline: "2026-06-01", visible_level: "S" },
    },
    {
      dedup_key: "k2",
      radar_type: "ai_competition",
      card: { title: "AI大赛2", status: "new", deadline: "2026-06-01", visible_level: "A" },
    },
    {
      dedup_key: "k3",
      radar_type: "opc_policy",
      card: { title: "政策1", status: "tracking", deadline: "2026-06-05", visible_level: "B" },
    },
    {
      dedup_key: "k4",
      radar_type: "cultural_heritage",
      card: { title: "文创1", status: "saved", deadline: "2026-06-10", visible_level: "A" },
    },
    {
      dedup_key: "k5",
      radar_type: "ai_competition",
      card: { title: "AI大赛3", status: "applied", deadline: "2026-06-15", visible_level: "C" },
    },
  ];

  // 使用固定时间避免测试不稳定
  const review = generateReview(mockEntries as any, 30);

  // F12: generateReview 返回 ReviewSummary
  assert(typeof review === "object", "F12 generateReview 返回对象");
  assert(review.total_opportunities === 5, `F12 total_opportunities = 5（实际 ${review.total_opportunities}）`);
  assert(review.applied_count === 2, `F12 applied_count = 2（实际 ${review.applied_count}）`);
  assert(review.missed_count === 3, `F12 missed_count = 3（实际 ${review.missed_count}）`);

  // F13: 命中率 = applied / total
  assert(review.hit_rate === 0.4, `F13 hit_rate = 0.4（实际 ${review.hit_rate}）`);

  // F14: 错过率 = missed / total
  assert(review.miss_rate === 0.6, `F14 miss_rate = 0.6（实际 ${review.miss_rate}）`);

  // F15: 按等级分组含 S/A/B/C 4 组
  assert(review.by_level.S !== undefined, "F15 by_level 含 S");
  assert(review.by_level.A !== undefined, "F15 by_level 含 A");
  assert(review.by_level.B !== undefined, "F15 by_level 含 B");
  assert(review.by_level.C !== undefined, "F15 by_level 含 C");
  assert(review.by_level.S.hit_rate === 1.0, `F15 S 级命中率 = 1.0（实际 ${review.by_level.S.hit_rate}）`);
  assert(review.by_level.A.hit_rate === 0.0, `F15 A 级命中率 = 0.0（实际 ${review.by_level.A.hit_rate}）`);

  // F16: 错过原因含分类
  assert(Array.isArray(review.miss_reasons), "F16 miss_reasons 是数组");
  assert(review.miss_reasons.length > 0, "F16 miss_reasons 非空");
  const reasons = review.miss_reasons.map((r: any) => r.reason);
  assert(reasons.includes("未查看就过期"), 'F16 含"未查看就过期"');
  assert(reasons.includes("跟踪后未报名"), 'F16 含"跟踪后未报名"');
  assert(reasons.includes("保存后未报名"), 'F16 含"保存后未报名"');

  // F17: 改进建议非空
  assert(Array.isArray(review.suggestions), "F17 suggestions 是数组");
  assert(review.suggestions.length > 0, "F17 suggestions 非空");
}

// ============================================================
// 5. API 路由检查
// ============================================================

function checkApiRoutes(): void {
  section("API 路由检查");
  const reviewPath = path.resolve(process.cwd(), "src/api/routes/review.ts");
  const content = fs.readFileSync(reviewPath, "utf-8");

  // F18: GET /
  assert(content.includes('app.get("/"'), "F18 含 GET / 端点");
  assert(content.includes("generateReview"), "F18 GET / 调用 generateReview");

  // F19: GET /summary
  assert(content.includes('app.get("/summary"'), "F19 含 GET /summary 端点");
  assert(content.includes("hit_rate"), "F19 summary 返回 hit_rate");

  // F20: POST /auto-transition
  assert(content.includes('app.post("/auto-transition"'), "F20 含 POST /auto-transition 端点");
  assert(content.includes("batchAutoTransition"), "F20 调用 batchAutoTransition");
  assert(content.includes("ctx.store.update"), "F20 调用 ctx.store.update");
  assert(content.includes("transitioned"), "F20 返回 transitioned 计数");

  // 检查 reviewRoutes 导出
  assert(content.includes("export function reviewRoutes"), "reviewRoutes 导出函数");
}

// ============================================================
// 6. 工程约束检查
// ============================================================

function checkEngineeringConstraints(): void {
  section("工程约束检查");

  // T2: 无新 npm 依赖
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});

  const forbiddenDeps = ["nodemailer", "axios", "node-cron", "agenda", "bull", "lodash", "moment"];
  const hasForbidden = forbiddenDeps.some(
    (d) => deps.includes(d) || devDeps.includes(d),
  );
  assert(!hasForbidden, "T2 无新 npm 依赖");

  // 检查 verify:review 脚本
  assert(
    pkg.scripts?.["verify:review"] === "tsx scripts/verify-task030.ts",
    "package.json 含 verify:review 脚本",
  );
}

// ============================================================
// 主函数
// ============================================================

function main(): void {
  console.log("=== Task 030 机会状态机扩展 + 机会复盘验收 ===\n");

  checkFileExists();
  checkStatusExtensions();
  checkStateMachine();
  checkReview();
  checkApiRoutes();
  checkEngineeringConstraints();

  console.log("\n=== 汇总 ===");
  console.log(`PASS: ${passCount}`);
  console.log(`FAIL: ${failCount}`);
  if (failCount === 0) {
    console.log("✓ 全部通过");
    process.exit(0);
  } else {
    console.log("✗ 存在失败项:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main();
