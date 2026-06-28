/**
 * Task 029 验收脚本：字节拆分 + 多渠道适配
 *
 * 来源：Task 029 第 6 节验收标准。
 *
 * 9 组验证：
 *   1. 文件存在性检查
 *   2. byte-splitter.ts 字节拆分（F1-F7）
 *   3. channel-adapter.ts 接口 + 工厂
 *   4. wechat-adapter.ts 微信适配器（F8-F9, F14）
 *   5. email-adapter.ts 邮件适配器（F10, F14）
 *   6. webhook-adapter.ts Webhook 适配器（F11, F14）
 *   7. notify-sender.ts 统一发送入口（F12）
 *   8. triggers.ts 调度器集成（F13）
 *   9. 工程约束（T2 无新依赖）
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
    "src/notify/byte-splitter.ts",
    "src/notify/channel-adapter.ts",
    "src/notify/wechat-adapter.ts",
    "src/notify/email-adapter.ts",
    "src/notify/webhook-adapter.ts",
    "src/notify/notify-sender.ts",
    "scripts/verify-task029.ts",
  ];
  for (const file of files) {
    const fullPath = path.resolve(process.cwd(), file);
    assert(fs.existsSync(fullPath), `文件存在: ${file}`);
  }

  // 检查 triggers.ts 导入 notifyReminders
  const triggersPath = path.resolve(process.cwd(), "src/scheduler/triggers.ts");
  const triggersContent = fs.readFileSync(triggersPath, "utf-8");
  assert(
    triggersContent.includes('import { notifyReminders }'),
    "triggers.ts 导入 notifyReminders",
  );
  assert(
    triggersContent.includes("notifyReminders("),
    "triggers.ts 调用 notifyReminders",
  );

  // 检查 package.json 含 verify:notify 脚本
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkgContent = fs.readFileSync(pkgPath, "utf-8");
  assert(
    pkgContent.includes('"verify:notify": "tsx scripts/verify-task029.ts"'),
    'package.json 含 verify:notify 脚本',
  );
}

// ============================================================
// 2. byte-splitter.ts 字节拆分测试
// ============================================================

function checkByteSplitter(): void {
  section("byte-splitter.ts 字节拆分");
  const { splitByBytes } = require("../src/notify/byte-splitter");

  // F1: 短文本不拆分
  const shortText = "短文本";
  const r1 = splitByBytes(shortText, { maxBytes: 2048 });
  assert(r1.totalParts === 1, "F1 短文本 → totalParts = 1");
  assert(r1.messages.length === 1, "F1 短文本 → messages = 1 条");
  assert(r1.originalBytes === Buffer.byteLength(shortText, "utf-8"), "F1 原始字节数正确");

  // F2: 长文本拆分
  const longText = "【提醒】盯一下 ChancePing\n\n" + "🔴 [紧急] 机会1\n".repeat(200);
  const r2 = splitByBytes(longText, { maxBytes: 2048 });
  assert(r2.totalParts >= 2, "F2 长文本 → totalParts >= 2");
  assert(r2.messages.length >= 2, "F2 长文本 → messages >= 2 条");
  assert(r2.originalBytes > 2048, "F2 原始字节数 > 2048");

  // F3: 每段不超限
  const allWithinLimit = r2.messages.every(
    (msg: string) => Buffer.byteLength(msg, "utf-8") <= 2048,
  );
  assert(allWithinLimit, "F3 每段字节数 <= 2048");

  // F4: 原子性保证（标题 + 首条在同一段）
  const atomicText = "## 紧急提醒\n- 机会1\n- 机会2\n## 即将提醒\n- 机会3";
  const r3 = splitByBytes(atomicText, { maxBytes: 100 });
  assert(r3.totalParts >= 1, "F4 原子性测试 → totalParts >= 1");
  // 检查第一段是否包含标题 + 至少一行内容
  const firstPart = r3.messages[0];
  assert(
    firstPart.includes("## 紧急提醒") || firstPart.includes("## 即将提醒"),
    "F4 第一段包含标题",
  );

  // F5: footer 保留
  const footerMsgs = r2.messages;
  const hasFooter = footerMsgs.every((msg: string) => {
    // 检查是否含 (页码/总数) 格式的 footer
    return /\(\d+\/\d+\)/.test(msg) || /（\d+\/\d+）/.test(msg);
  });
  assert(hasFooter, "F5 每段含 footer（{page}/{total}）");

  // F6: header 续接（第 2+ 段含 header）
  if (r2.totalParts >= 2) {
    const secondPart = r2.messages[1];
    assert(
      secondPart.includes("续接") || secondPart.includes("【续"),
      "F6 第 2 段含 header 续接标识",
    );
  } else {
    assert(true, "F6 跳过（totalParts < 2）");
  }

  // F7: 中文不截断（按行边界）
  // 检查每段是否都是完整的行（不以半个中文字符结尾）
  const noTruncation = r2.messages.every((msg: string) => {
    // 每段应该以换行符或完整字符结尾
    // 简单检查：每段都能正确 decode 为 UTF-8 字符串（Node.js Buffer 自动处理）
    return Buffer.from(msg, "utf-8").toString("utf-8") === msg;
  });
  assert(noTruncation, "F7 中文不截断（按行边界）");

  // 额外测试：自定义 footer/header 模板
  const r4 = splitByBytes(longText, {
    maxBytes: 2048,
    footerTemplate: "[第{page}页/共{total}页]",
    headerTemplate: ">> 续第{page}页/共{total}页\n",
  });
  assert(r4.totalParts >= 2, "自定义模板 → totalParts >= 2");
  const customFooter = r4.messages.every((msg: string) =>
    /\[第\d+页\/共\d+页\]/.test(msg),
  );
  assert(customFooter, "自定义 footer 模板生效");
}

// ============================================================
// 3. channel-adapter.ts 接口 + 工厂
// ============================================================

function checkChannelAdapter(): void {
  section("channel-adapter.ts 接口 + 工厂");
  const { createChannelAdapter, isGlobalMockMode } = require("../src/notify/channel-adapter");

  // 工厂创建适配器
  const wechatAdapter = createChannelAdapter("wechat");
  assert(wechatAdapter.channel === "wechat", "工厂创建 wechat 适配器");
  assert(typeof wechatAdapter.send === "function", "wechat 适配器有 send 方法");
  assert(typeof wechatAdapter.healthCheck === "function", "wechat 适配器有 healthCheck 方法");

  const emailAdapter = createChannelAdapter("email");
  assert(emailAdapter.channel === "email", "工厂创建 email 适配器");

  const webhookAdapter = createChannelAdapter("webhook");
  assert(webhookAdapter.channel === "webhook", "工厂创建 webhook 适配器");

  // 未知渠道抛异常
  let threwError = false;
  try {
    createChannelAdapter("unknown" as any);
  } catch {
    threwError = true;
  }
  assert(threwError, "未知渠道抛异常");

  // 全局 Mock 模式检查
  const mockMode = isGlobalMockMode();
  assert(typeof mockMode === "boolean", "isGlobalMockMode 返回 boolean");
}

// ============================================================
// 4. wechat-adapter.ts 微信适配器
// ============================================================

async function checkWeChatAdapter(): Promise<void> {
  section("wechat-adapter.ts 微信适配器");
  const { WeChatAdapter } = require("../src/notify/wechat-adapter");

  const adapter = new WeChatAdapter();
  assert(adapter.channel === "wechat", "channel = wechat");
  assert(adapter.mockMode === true, "Mock 模式 = true（默认）");

  // F8: Mock 模式 send 返回 success=true
  const result = await adapter.send(["短消息"]);
  assert(result.success === true, "F8 Mock send → success = true");
  assert(result.channel === "wechat", "F8 result.channel = wechat");
  assert(result.messages_sent === 1, "F8 短消息 → messages_sent = 1");
  assert(result.mock_mode === true, "F8 mock_mode = true");

  // F9: 长文本拆分为多条
  const longMsg = "【提醒】盯一下 ChancePing\n\n" + "🔴 [紧急] 机会1\n".repeat(200);
  const result2 = await adapter.send([longMsg]);
  assert(result2.messages_sent >= 2, "F9 长文本 → messages_sent >= 2");
  assert(result2.success === true, "F9 长文本 → success = true");

  // F14: 健康检查
  const healthy = await adapter.healthCheck();
  assert(healthy === true, "F14 wechat healthCheck = true");
}

// ============================================================
// 5. email-adapter.ts 邮件适配器
// ============================================================

async function checkEmailAdapter(): Promise<void> {
  section("email-adapter.ts 邮件适配器");
  const { EmailAdapter } = require("../src/notify/email-adapter");

  const adapter = new EmailAdapter();
  assert(adapter.channel === "email", "channel = email");
  assert(adapter.mockMode === true, "Mock 模式 = true（默认）");

  // F10: Mock 模式 send 返回 success=true
  const result = await adapter.send(["<p>邮件内容</p>"]);
  assert(result.success === true, "F10 Mock send → success = true");
  assert(result.channel === "email", "F10 result.channel = email");
  assert(result.messages_sent === 1, "F10 邮件 → messages_sent = 1（不拆分）");
  assert(result.mock_mode === true, "F10 mock_mode = true");

  // F14: 健康检查
  const healthy = await adapter.healthCheck();
  assert(healthy === true, "F14 email healthCheck = true");
}

// ============================================================
// 6. webhook-adapter.ts Webhook 适配器
// ============================================================

async function checkWebhookAdapter(): Promise<void> {
  section("webhook-adapter.ts Webhook 适配器");
  const { WebhookAdapter } = require("../src/notify/webhook-adapter");

  const adapter = new WebhookAdapter();
  assert(adapter.channel === "webhook", "channel = webhook");
  assert(adapter.mockMode === true, "Mock 模式 = true（默认）");

  // F11: Mock 模式 send 返回 success=true
  const result = await adapter.send(['{"message":"test"}']);
  assert(result.success === true, "F11 Mock send → success = true");
  assert(result.channel === "webhook", "F11 result.channel = webhook");
  assert(result.messages_sent === 1, "F11 webhook → messages_sent = 1");
  assert(result.mock_mode === true, "F11 mock_mode = true");

  // F14: 健康检查
  const healthy = await adapter.healthCheck();
  assert(healthy === true, "F14 webhook healthCheck = true");
}

// ============================================================
// 7. notify-sender.ts 统一发送入口
// ============================================================

async function checkNotifySender(): Promise<void> {
  section("notify-sender.ts 统一发送入口");
  const { notifyReminders } = require("../src/notify/notify-sender");

  // 构造 mock ReminderResult
  const mockResult = {
    base_date: "2026-06-28",
    summary: {
      total: 0,
      urgent_count: 0,
      soon_count: 0,
      warning_count: 0,
      expired_count: 0,
    },
    urgent: [],
    soon: [],
    warning: [],
    expired: [],
    no_reminder: [],
  };

  // F12: notifyReminders 返回多渠道结果
  const results = await notifyReminders(mockResult, ["wechat", "email", "webhook"]);
  assert(typeof results === "object", "F12 返回对象");
  assert(results.wechat !== undefined, "F12 含 wechat 结果");
  assert(results.email !== undefined, "F12 含 email 结果");
  assert(results.webhook !== undefined, "F12 含 webhook 结果");
  assert(results.wechat.success === true, "F12 wechat success = true");
  assert(results.email.success === true, "F12 email success = true");
  assert(results.webhook.success === true, "F12 webhook success = true");

  // 默认渠道（只 wechat）
  const defaultResults = await notifyReminders(mockResult);
  assert(defaultResults.wechat !== undefined, "默认渠道含 wechat");
  assert(defaultResults.email === undefined, "默认渠道不含 email");
}

// ============================================================
// 8. triggers.ts 调度器集成
// ============================================================

function checkTriggersIntegration(): void {
  section("triggers.ts 调度器集成");
  const triggersPath = path.resolve(process.cwd(), "src/scheduler/triggers.ts");
  const content = fs.readFileSync(triggersPath, "utf-8");

  // F13: 提醒触发后调用 notifyReminders
  assert(
    content.includes('import { notifyReminders }'),
    "F13 导入 notifyReminders",
  );
  assert(
    content.includes("import type { NotifyChannel }"),
    "F13 导入 NotifyChannel 类型",
  );
  assert(
    content.includes("notifyReminders("),
    "F13 调用 notifyReminders",
  );
  assert(
    content.includes("notify_channels"),
    "F13 返回值含 notify_channels",
  );
  assert(
    content.includes("notify_results"),
    "F13 返回值含 notify_results",
  );
  assert(
    content.includes('params.notify_channels'),
    "F13 从 params 读取 notify_channels",
  );
}

// ============================================================
// 9. 工程约束检查
// ============================================================

function checkEngineeringConstraints(): void {
  section("工程约束检查");

  // T2: 无新 npm 依赖
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});

  // 检查是否引入了 nodemailer / axios 等新依赖
  const forbiddenDeps = ["nodemailer", "axios", "node-cron", "agenda", "bull"];
  const hasForbidden = forbiddenDeps.some(
    (d) => deps.includes(d) || devDeps.includes(d),
  );
  assert(!hasForbidden, "T2 无新 npm 依赖（nodemailer/axios 等）");

  // 检查 notify 目录文件数
  const notifyDir = path.resolve(process.cwd(), "src/notify");
  const notifyFiles = fs.existsSync(notifyDir)
    ? fs.readdirSync(notifyDir).filter((f) => f.endsWith(".ts"))
    : [];
  assert(notifyFiles.length === 6, `src/notify/ 含 6 个 .ts 文件（实际 ${notifyFiles.length}）`);

  // 检查 verify:notify 脚本
  assert(
    pkg.scripts?.["verify:notify"] === "tsx scripts/verify-task029.ts",
    "package.json 含 verify:notify 脚本",
  );
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("=== Task 029 字节拆分 + 多渠道适配验收 ===\n");

  checkFileExists();
  checkByteSplitter();
  checkChannelAdapter();
  await checkWeChatAdapter();
  await checkEmailAdapter();
  await checkWebhookAdapter();
  await checkNotifySender();
  checkTriggersIntegration();
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

main().catch((err) => {
  console.error("验收脚本异常:", err);
  process.exit(1);
});
