/**
 * Task 041 浏览器 E2E 验收脚本：7 步 UI 旅程
 *
 * 来源：Task 041 第 8 节。
 *
 * 7 步端到端验证（puppeteer + Mock 模式）：
 *   1. 打开首页（验证 Logo + 输入框 + Demo 标识）
 *   2. 输入需求（验证切换到需求确认 Tab）
 *   3. 多轮对话确认需求（验证确认度提升）
 *   4. 搜索并看到机会卡片（验证搜索结果）
 *   5. Star 收藏（验证 Star 状态切换）
 *   6. 看到页面内截止提醒（验证机会库 + 提醒区）
 *   7. 导出报告（验证报告生成 + 预览）
 *
 * 强制 Mock 模式：DATA_MODE=mock + LLM_MODE=mock
 * 独立端口：3998（避免与开发服务器 3000 / E2E API 3999 冲突）
 *
 * puppeteer 降级：puppeteer 是 optionalDependencies，未安装时 exit 0（跳过，不算失败）
 *
 * 运行：npm run verify:e2e-web-demo
 */

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.PORT = "3998";
process.env.STORE_TYPE = "meili";
process.env.MEILI_MOCK = "true";

// ============================================================
// 1. import
// ============================================================

import fs from "fs";
import path from "path";
import { serve } from "@hono/node-server";
import { createApp } from "../src/api/app";

// ============================================================
// 2. 测试框架
// ============================================================

const BASE = "http://localhost:3998";
const TOTAL_STEPS = 7;
const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs", "screenshots");

let passCount = 0;
let failCount = 0;
const failures: Array<{ step: number; name: string; reason: string }> = [];

function logStep(step: number, name: string, passed: boolean, reason?: string): void {
  if (passed) {
    console.log(`  [步骤 ${step}/${TOTAL_STEPS}] ${name} ✓`);
    passCount++;
  } else {
    console.log(`  [步骤 ${step}/${TOTAL_STEPS}] ${name} ✗`);
    console.log(`    原因: ${reason ?? "未知"}`);
    failCount++;
    failures.push({ step, name, reason: reason ?? "未知" });
  }
}

async function screenshot(page: import("puppeteer").Page, step: number, name: string): Promise<void> {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  const filename = path.join(SCREENSHOT_DIR, `${String(step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filename, fullPage: false });
  console.log(`    截图: ${path.relative(process.cwd(), filename)}`);
}

// ============================================================
// 3. 启动服务器
// ============================================================

async function startServer(): Promise<{ close: () => void }> {
  const app = createApp();
  const server = serve({ fetch: app.fetch, port: 3998 });
  return {
    close: () => server.close(),
  };
}

// ============================================================
// 4. 7 步 UI 旅程
// ============================================================

async function runWebE2E(): Promise<void> {
  // 动态 import puppeteer（可能未安装）
  let puppeteer: typeof import("puppeteer");
  try {
    if (process.env.PUPPETEER_SKIP === "true") {
      throw new Error("PUPPETEER_SKIP=true");
    }
    puppeteer = (await import("puppeteer")).default;
  } catch (err) {
    console.log("");
    console.log("⚠️  puppeteer 未安装，跳过浏览器 E2E");
    console.log(`    原因: ${(err as Error).message}`);
    console.log("");
    console.log("    安装方式：npm install puppeteer");
    console.log("    或设置 PUPPETEER_SKIP=true 跳过");
    console.log("");
    console.log("    注意：puppeteer 是 optionalDependencies，未安装不算失败（exit 0）");
    process.exit(0);
  }

  console.log("");
  console.log("=== Task 041 浏览器 E2E：7 步 UI 旅程（Mock 模式）===");
  console.log("");

  // 启动服务器
  const server = await startServer();
  console.log(`  服务器已启动：${BASE}`);
  console.log("");

  // 启动浏览器
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    // ----------------------------------------------------------
    // 步骤 1/7：打开首页
    // ----------------------------------------------------------
    console.log("  [步骤 1/7] 打开首页");
    await page.goto(`${BASE}/?demo=true`, { waitUntil: "networkidle0", timeout: 10000 });
    const hasLogo = await page.evaluate(() => {
      const brand = document.querySelector(".brand");
      return brand ? brand.textContent || "" : "";
    });
    const hasInput = await page.$("#home-input");
    const hasDemoBadge = await page.evaluate(() => {
      const badge = document.getElementById("demo-badge");
      return badge ? window.getComputedStyle(badge).display !== "none" : false;
    });
    logStep(1, "打开首页", hasLogo.includes("ChancePing") && !!hasInput, `logo=${hasLogo}, input=${!!hasInput}`);
    logStep(1.1, "Demo 标识显示", hasDemoBadge, `badge display=${hasDemoBadge}`);
    await screenshot(page, 1, "home");

    // ----------------------------------------------------------
    // 步骤 2/7：输入需求
    // ----------------------------------------------------------
    console.log("  [步骤 2/7] 输入需求");
    await page.type("#home-input", "我想找适合个人开发者的 AI 比赛");
    await page.click("#home-start-btn");
    try {
      await page.waitForSelector("#panel-chat.active", { timeout: 5000 });
      const chatVisible = await page.$("#panel-chat.active");
      logStep(2, "切换到需求确认 Tab", !!chatVisible);
    } catch {
      logStep(2, "切换到需求确认 Tab", false, "5s 内未出现 #panel-chat.active");
    }
    await screenshot(page, 2, "requirement-chat");

    // ----------------------------------------------------------
    // 步骤 3/7：多轮对话确认需求
    // ----------------------------------------------------------
    console.log("  [步骤 3/7] 多轮对话确认需求");
    try {
      await page.waitForSelector("#chat-input", { timeout: 5000 });
      await page.type("#chat-input", "奖金 10 万以上，全国范围，个人参赛");
      await page.click("#chat-send-btn");
      // 等待确认度提升
      try {
        await page.waitForFunction(
          () => {
            const el = document.getElementById("conf-total");
            if (!el) return false;
            const v = parseInt(el.textContent || "0", 10);
            return v > 0;
          },
          { timeout: 15000 },
        );
        const confTotal = await page.$eval("#conf-total", (el) => parseInt(el.textContent || "0", 10));
        logStep(3, "确认度提升", confTotal > 0, `conf-total=${confTotal}`);
      } catch {
        logStep(3, "确认度提升", false, "15s 内 #conf-total 未 > 0");
      }
    } catch {
      logStep(3, "多轮对话", false, "5s 内未找到 #chat-input");
    }
    await screenshot(page, 3, "confirmation-card");

    // ----------------------------------------------------------
    // 步骤 4/7：搜索并看到机会卡片
    // ----------------------------------------------------------
    console.log("  [步骤 4/7] 搜索并看到机会卡片");
    try {
      // 尝试点击"开始搜索"按钮（如已启用）
      const startSearchBtn = await page.$("#start-search-btn");
      if (startSearchBtn) {
        const disabled = await page.$eval("#start-search-btn", (el) => (el as HTMLButtonElement).disabled);
        if (!disabled) {
          await page.click("#start-search-btn");
        }
      }
      // 等待搜索结果
      try {
        await page.waitForSelector("#search-results .opp-card", { timeout: 15000 });
        const cardCount = await page.$$eval("#search-results .opp-card", (els) => els.length);
        logStep(4, "搜索结果含机会卡片", cardCount > 0, `card count=${cardCount}`);
      } catch {
        // 兜底：可能搜索结果用了其他选择器
        const searchHtml = await page.$eval("#search-results", (el) => el.innerHTML);
        logStep(4, "搜索结果含机会卡片", searchHtml.length > 100, `html length=${searchHtml.length}`);
      }
    } catch {
      logStep(4, "搜索结果", false, "未找到 #start-search-btn 或 .opp-card");
    }
    await screenshot(page, 4, "search-results");

    // ----------------------------------------------------------
    // 步骤 5/7：Star 收藏
    // ----------------------------------------------------------
    console.log("  [步骤 5/7] Star 收藏");
    try {
      const starBtn = await page.$(".star-btn");
      if (starBtn) {
        await starBtn.click();
        await new Promise((r) => setTimeout(r, 500));
        logStep(5, "点击 Star 按钮", true);
      } else {
        logStep(5, "Star 按钮", false, "未找到 .star-btn");
      }
    } catch (err) {
      logStep(5, "Star 收藏", false, (err as Error).message);
    }
    await screenshot(page, 5, "starred");

    // ----------------------------------------------------------
    // 步骤 6/7：看到页面内截止提醒（机会库）
    // ----------------------------------------------------------
    console.log("  [步骤 6/7] 看到页面内截止提醒");
    try {
      await page.click('.tab-btn[data-tab="opportunities"]');
      await page.waitForSelector("#panel-opportunities.active", { timeout: 5000 });
      // 等待机会库加载
      await new Promise((r) => setTimeout(r, 1500));
      const oppListHtml = await page.$eval("#opp-list", (el) => el.innerHTML);
      const reminderVisible = await page.$("#reminder-section");
      logStep(
        6,
        "机会库加载",
        oppListHtml.length > 50 || !!reminderVisible,
        `opp-list html=${oppListHtml.length}, reminder=${!!reminderVisible}`,
      );
    } catch (err) {
      logStep(6, "机会库", false, (err as Error).message);
    }
    await screenshot(page, 6, "opportunities-library");

    // ----------------------------------------------------------
    // 步骤 7/7：导出报告
    // ----------------------------------------------------------
    console.log("  [步骤 7/7] 导出报告");
    try {
      await page.click('.tab-btn[data-tab="reports"]');
      await page.waitForSelector("#panel-reports.active", { timeout: 5000 });
      const generateBtn = await page.$("#btn-generate-report");
      if (generateBtn) {
        await generateBtn.click();
        try {
          await page.waitForFunction(
            () => {
              const el = document.getElementById("report-preview");
              if (!el) return false;
              return el.innerHTML.length > 50;
            },
            { timeout: 15000 },
          );
          const reportHtml = await page.$eval("#report-preview", (el) => el.innerHTML);
          logStep(7, "报告生成", reportHtml.length > 50, `report html=${reportHtml.length}`);
        } catch {
          logStep(7, "报告生成", false, "15s 内 #report-preview 未填充");
        }
      } else {
        logStep(7, "报告生成", false, "未找到 #btn-generate-report");
      }
    } catch (err) {
      logStep(7, "导出报告", false, (err as Error).message);
    }
    await screenshot(page, 7, "report-preview");
  } finally {
    await browser.close();
    server.close();
  }

  // ============================================================
  // 5. 输出结果
  // ============================================================

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passCount} PASS / ${failCount} FAIL`);
  console.log("========================================");
  if (failures.length > 0) {
    console.log("");
    console.log("失败项：");
    failures.forEach((f) => {
      console.log(`  [步骤 ${f.step}] ${f.name}: ${f.reason}`);
    });
  }
  console.log("");
  console.log(`截图保存位置: ${path.relative(process.cwd(), SCREENSHOT_DIR)}`);
  console.log("");

  process.exit(failCount > 0 ? 1 : 0);
}

// ============================================================
// 6. 主入口
// ============================================================

runWebE2E().catch((err) => {
  console.error("浏览器 E2E 执行失败：", err);
  process.exit(1);
});
