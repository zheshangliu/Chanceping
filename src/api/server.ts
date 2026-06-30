import { serve } from "@hono/node-server";
import fs from "fs";
import path from "path";
import { createApp } from "./app";
import { createAppContext } from "./context";
import { Scheduler } from "../scheduler/scheduler";
import { getDataMode, getLlmMode } from "../demo/data-mode";

// ============================================================
// V1.6.5 修复：手动加载 .env 文件（项目未使用 dotenv）
// 原因：server.ts 未加载 .env，导致 DATA_MODE/LLM_MODE 默认为 mock，
// 需求确认不调用真实 LLM，confidence.total 永远为 0，无法生成雷达。
// 必须在 createAppContext() 之前执行，确保 createAdapter() 能读到环境变量。
// ============================================================
function loadEnvFile(): void {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.warn("[ChancePing API] .env 文件不存在，使用默认配置（mock 模式）");
    return;
  }
  const content = fs.readFileSync(envPath, "utf-8");
  let loaded = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = val;
      loaded++;
    }
  }
  console.log(`[ChancePing API] 已加载 .env 文件（${loaded} 个变量）`);
}

loadEnvFile();
console.log(`[ChancePing API] 数据模式: ${getDataMode()} | LLM 模式: ${getLlmMode()}`);

const port = parseInt(process.env.PORT ?? "3000", 10);
// V1.6-02: 显式创建 ctx，供 Scheduler 复用
const ctx = createAppContext();
const app = createApp(ctx);

console.log(`[ChancePing API] 服务器启动中...`);
console.log(`[ChancePing API] 端口: ${port}`);
console.log(`[ChancePing API] 健康检查: http://localhost:${port}/health`);

// V1.6-02 新增：启动 Scheduler tick 循环（60s 间隔）
// V1.6a 自检修复:增加 isTicking 守卫,避免 tick 重叠执行
const scheduler = new Scheduler(ctx);
let isTicking = false;
setInterval(() => {
  if (isTicking) return; // 前一个 tick 未完成,跳过
  isTicking = true;
  scheduler.tick().catch((err) => {
    console.error("[Scheduler] tick 异常:", err);
  }).finally(() => {
    isTicking = false;
  });
}, 60_000);
console.log(`[Scheduler] 已启动，间隔 60s`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`[ChancePing API] 服务器已启动`);
