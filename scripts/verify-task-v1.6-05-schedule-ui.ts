/**
 * Task V1.6-05 验收脚本:定时设置前端 UI
 *
 * 运行:npx tsx scripts/verify-task-v1.6-05-schedule-ui.ts
 *
 * 验证范围(11 项断言):
 *   1. radar-detail.js 含 renderScheduleSection 函数
 *   2. 含 daily/weekly 频率选项
 *   3. 含 type="time" 输入框
 *   4. 含 7 个 weekday-btn(周一到周日)
 *   5. 含 Asia/Shanghai 时区选项
 *   6. 保存定时调用 PUT /api/radars/:id/schedule
 *   7. 清除定时调用 DELETE /api/radars/:id/schedule
 *   8. 显示 enabled 状态 + nextRunAt
 *   9. styles.css 含 .radar-schedule-section 样式
 *   10. index.html 含 radar-schedule-container
 *   11. 回归(外部命令):verify:v15 + verify:v15:e2e
 */

import fs from "fs";
import path from "path";

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
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task V1.6-05 验收检查:定时设置前端 UI ===\n");

  const detailJsPath = path.resolve(process.cwd(), "web", "radar-detail.js");
  const indexHtmlPath = path.resolve(process.cwd(), "web", "index.html");
  const stylesCssPath = path.resolve(process.cwd(), "web", "styles.css");

  const detailJs = fs.readFileSync(detailJsPath, "utf-8");
  const indexHtml = fs.readFileSync(indexHtmlPath, "utf-8");
  const stylesCss = fs.readFileSync(stylesCssPath, "utf-8");

  // ============================================================
  // 6.1 radar-detail.js 函数与 HTML 检查
  // ============================================================
  section("6.1 radar-detail.js 函数与 HTML");

  // 1. renderScheduleSection 函数存在
  check(
    "1. radar-detail.js 含 renderScheduleSection 函数",
    /function\s+renderScheduleSection\s*\(/.test(detailJs),
    "找不到 renderScheduleSection 函数",
  );

  // 2. 频率选择含 daily/weekly
  check(
    '2. 含 daily/weekly 频率选项',
    detailJs.includes('value="daily"') && detailJs.includes('value="weekly"'),
    "缺少 daily/weekly 选项",
  );

  // 3. 时间输入框 type="time"
  check(
    '3. 含 type="time" 输入框',
    detailJs.includes('type="time"'),
    "缺少 type=time 输入框",
  );

  // 4. 周几选择 7 个 weekday-btn
  {
    const weekdayMatches = detailJs.match(/class="weekday-btn[^"]*"/g) ?? [];
    // 模板中渲染 7 个按钮(动态生成),检查模板逻辑
    const hasWeekdayLoop = /\[1,\s*2,\s*3,\s*4,\s*5,\s*6,\s*7\]/.test(detailJs);
    check(
      "4. 含 7 个 weekday-btn(周一到周日)",
      hasWeekdayLoop || weekdayMatches.length >= 7,
      `weekdayLoop=${hasWeekdayLoop}, matches=${weekdayMatches.length}`,
    );
  }

  // 5. 时区选择含 Asia/Shanghai
  check(
    "5. 含 Asia/Shanghai 时区选项",
    detailJs.includes("Asia/Shanghai"),
    "缺少 Asia/Shanghai 选项",
  );

  // 6. 保存定时调用 PUT /api/radars/:id/schedule
  check(
    "6. 保存定时调用 PUT /api/radars/:id/schedule",
    /saveSchedule[\s\S]*?method:\s*"PUT"[\s\S]*?\/schedule/.test(detailJs),
    "找不到 saveSchedule + PUT /schedule 调用",
  );

  // 7. 清除定时调用 DELETE /api/radars/:id/schedule
  {
    const hasDeleteFunc = /function\s+deleteSchedule\s*\(/.test(detailJs) || /async\s+function\s+deleteSchedule\s*\(/.test(detailJs);
    const hasDeleteMethod = /deleteSchedule[\s\S]*?method:\s*"DELETE"/.test(detailJs);
    const hasScheduleUrl = /deleteSchedule[\s\S]*?\/schedule/.test(detailJs);
    check(
      "7. 清除定时调用 DELETE /api/radars/:id/schedule",
      hasDeleteFunc && hasDeleteMethod && hasScheduleUrl,
      `func=${hasDeleteFunc}, method=${hasDeleteMethod}, url=${hasScheduleUrl}`,
    );
  }

  // 8. 显示 enabled 状态 + nextRunAt
  check(
    "8. 显示 enabled 状态 + nextRunAt",
    detailJs.includes("schedule-enabled") && detailJs.includes("nextRunAt"),
    "缺少 schedule-enabled 或 nextRunAt",
  );

  // ============================================================
  // 6.2 CSS 样式检查
  // ============================================================
  section("6.2 CSS 样式");

  // 9. .radar-schedule-section 样式存在
  check(
    "9. styles.css 含 .radar-schedule-section 样式",
    /\.radar-schedule-section\s*\{/.test(stylesCss),
    "找不到 .radar-schedule-section 样式",
  );

  // 额外检查:weekday-btn 样式
  check(
    "9.1 styles.css 含 .weekday-btn 样式",
    /\.weekday-btn\s*\{/.test(stylesCss) && /\.weekday-btn\.selected\s*\{/.test(stylesCss),
    "缺少 .weekday-btn 或 .weekday-btn.selected 样式",
  );

  // ============================================================
  // 6.3 HTML 容器检查
  // ============================================================
  section("6.3 HTML 容器");

  // 10. index.html 含 radar-schedule-container
  check(
    "10. index.html 含 radar-schedule-container",
    indexHtml.includes('id="radar-schedule-container"'),
    "找不到 radar-schedule-container",
  );

  // ============================================================
  // 6.4 回归(外部命令)
  // ============================================================
  section("6.4 回归(外部命令)");

  console.log("  [11] verify:v15 + verify:v15:e2e(外部命令)");

  // ============================================================
  // 结果汇总
  // ============================================================
  console.log("");
  console.log("=== 结果汇总 ===");
  console.log(`  PASS: ${passed}`);
  console.log(`  FAIL: ${failed}`);
  if (failures.length > 0) {
    console.log("  失败项:");
    for (const f of failures) {
      console.log(`    - ${f}`);
    }
  }
  console.log("");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n脚本异常退出:", err);
  process.exit(1);
});
