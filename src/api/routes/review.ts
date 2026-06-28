/**
 * 复盘 API 路由
 *
 * 来源：Task 030 第 5.4 节。
 *
 * 端点：
 *   GET /                  - 获取复盘报告（默认 30 天，可通过 ?days=N 调整）
 *   GET /summary           - 获取精简复盘摘要
 *   POST /auto-transition  - 手动触发自动过期/错过检查
 */

import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse } from "../types";
import { generateReview } from "../../agents/opportunity-review";
import { batchAutoTransition } from "../../agents/opportunity-state-machine";

export function reviewRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // GET / - 获取复盘报告
  app.get("/", (c) => {
    const start = Date.now();
    try {
      const periodDays = parseInt(c.req.query("days") ?? "30", 10);
      const entries = ctx.store.list({ page: 1, page_size: 10000 }).entries;
      const review = generateReview(entries, periodDays);
      return c.json({
        success: true,
        data: review,
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "REVIEW_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // GET /summary - 精简摘要
  app.get("/summary", (c) => {
    const start = Date.now();
    try {
      const entries = ctx.store.list({ page: 1, page_size: 10000 }).entries;
      const review = generateReview(entries, 30);
      return c.json({
        success: true,
        data: {
          total: review.total_opportunities,
          applied: review.applied_count,
          missed: review.missed_count,
          hit_rate: review.hit_rate,
          miss_rate: review.miss_rate,
        },
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "REVIEW_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // POST /auto-transition - 手动触发自动过期/错过
  app.post("/auto-transition", (c) => {
    const start = Date.now();
    try {
      const entries = ctx.store.list({ page: 1, page_size: 10000 }).entries;
      const results = batchAutoTransition(entries);

      // 批量更新
      for (const r of results) {
        ctx.store.update(r.dedup_key, { status: r.to });
      }

      return c.json({
        success: true,
        data: {
          checked: entries.length,
          transitioned: results.length,
          transitions: results.map((r) => ({
            dedup_key: r.dedup_key,
            from: r.from,
            to: r.to,
            title: r.card.title,
          })),
        },
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "REVIEW_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  return app;
}
