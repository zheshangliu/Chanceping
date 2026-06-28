import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppContext } from "./context";
import { createAppContext } from "./context";
import { chatRoutes } from "./routes/chat";
import { opportunityRoutes } from "./routes/opportunities";
import { searchRoutes } from "./routes/search";
import { reminderRoutes } from "./routes/reminders";
import { watchRulesRoutes } from "./routes/watch-rules";
import { reportRoutes } from "./routes/reports";
import type { ApiResponse } from "./types";

export function createApp(context?: AppContext): Hono {
  const ctx = context ?? createAppContext();
  const app = new Hono();

  // 中间件
  app.use("*", logger());
  app.use("*", cors());

  // 健康检查
  app.get("/health", (c) => {
    return c.json({
      success: true,
      data: { status: "ok", version: "0.8.0" },
      error: null,
      duration_ms: 0,
    } satisfies ApiResponse);
  });

  // 注册路由
  app.route("/api/chat", chatRoutes(ctx));
  app.route("/api/opportunities", opportunityRoutes(ctx));
  app.route("/api/search", searchRoutes(ctx));
  app.route("/api/reminders", reminderRoutes(ctx));
  app.route("/api/watch-rules", watchRulesRoutes(ctx));
  app.route("/api/reports", reportRoutes(ctx));

  // 全局错误处理
  app.onError((err, c) => {
    console.error("[API Error]", err);
    return c.json({
      success: false, data: null,
      error: { code: "INTERNAL_ERROR", message: err.message },
      duration_ms: 0,
    } satisfies ApiResponse, 500);
  });

  // 404 处理
  app.notFound((c) => {
    return c.json({
      success: false, data: null,
      error: { code: "NOT_FOUND", message: `路径不存在: ${c.req.method} ${c.req.path}` },
      duration_ms: 0,
    } satisfies ApiResponse, 404);
  });

  return app;
}
