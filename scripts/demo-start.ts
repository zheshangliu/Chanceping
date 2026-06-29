/**
 * ChancePing Demo Mode 启动脚本
 *
 * V1.3 五轨道完整版。
 *
 * 一键启动最稳定演示模式：
 *   - DATA_MODE = mock（预设 5 条 AI 赛事机会，无需 API Key）
 *   - LLM_MODE  = mock（固定 Mock 响应，无需 API Key）
 *   - DEMO_MODE = true（UI 显示"Demo 模式"标识，通过 ?demo=true URL 参数触发）
 *
 * V1.3 演示能力：
 *   1. 文件上传（PDF/Word/Excel/图片 → 📎按钮）
 *   2. 一次一问需求确认（每轮 1 问，6 轮 90% 确认度）
 *   3. 来源透明（来源徽章 + 证据提取 + S/A/B/C/D 分级）
 *   4. 报告增强（来源索引第 8.5 章 + D 级排除第 7 章）
 *   5. 评分统一（90/80/65/50 阈值，全系统一处定义）
 *
 * 演示地址：http://localhost:3000/?demo=true
 * 演示剧本：docs/演示剧本.md
 *
 * 运行：npm run demo
 */

// ============================================================
// 强制设置 Mock 模式（必须在 import 服务器之前设置环境变量）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.DEMO_MODE = "true"; // UI 标识用（前端通过 ?demo=true URL 参数识别）
process.env.PORT = process.env.PORT || "3000";
// 使用 MeilisearchStore mockMode（纯内存），完全隔离开发数据
process.env.STORE_TYPE = process.env.STORE_TYPE || "meili";
process.env.MEILI_MOCK = process.env.MEILI_MOCK || "true";

// ============================================================
// 打印启动信息
// ============================================================

console.log("============================================================");
console.log("ChancePing Demo Mode 启动中...");
console.log("  DATA_MODE  = mock（预设数据，无需 API Key）");
console.log("  LLM_MODE   = mock（固定响应，无需 API Key）");
console.log("  DEMO_MODE  = true（UI 显示 Demo 标识）");
console.log("  STORE_TYPE = meili + MEILI_MOCK=true（纯内存，隔离开发数据）");
console.log("============================================================");
console.log("");
console.log(`演示地址：http://localhost:${process.env.PORT}/?demo=true`);
console.log("  （注意：?demo=true 参数会显示顶部'Demo 模式'标识）");
console.log("");
console.log("演示剧本：请参考 docs/演示剧本.md");
console.log("浏览器 E2E：npm run verify:e2e-web-demo");
console.log("");
console.log("按 Ctrl+C 停止服务器");
console.log("");

// ============================================================
// 动态 import 服务器（确保环境变量在模块加载前设置）
// ============================================================

import("../src/api/server");
