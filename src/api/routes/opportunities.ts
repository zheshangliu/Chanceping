import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse, OpportunityAddRequest, OpportunityUpdateRequest } from "../types";
import type { OpportunityCard } from "../../schema/opportunity-card";
import type { StoreQuery, StoreEntry, RadarType } from "../../agents/opportunity-store";

export function opportunityRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // GET /stats - 统计
  app.get("/stats", (c) => {
    const start = Date.now();
    try {
      const stats = ctx.store.stats();
      return c.json({ success: true, data: stats, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // GET /starred/stats - 收藏统计
  app.get("/starred/stats", (c) => {
    const start = Date.now();
    try {
      const stats = ctx.starManager.starStats();
      return c.json({ success: true, data: stats, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STAR_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // GET / - 列表查询
  app.get("/", (c) => {
    const start = Date.now();
    try {
      const q: StoreQuery = {};
      const radarType = c.req.query("radar_type");
      if (radarType) q.radar_type = radarType as RadarType;
      const visibleLevel = c.req.query("visible_level");
      if (visibleLevel) q.visible_level = visibleLevel as StoreQuery["visible_level"];
      const status = c.req.query("status");
      if (status) q.status = status as StoreQuery["status"];
      const starredOnly = c.req.query("starred_only");
      if (starredOnly === "true") q.starred_only = true;
      const page = c.req.query("page");
      if (page) q.page = parseInt(page, 10);
      const pageSize = c.req.query("page_size");
      if (pageSize) q.page_size = parseInt(pageSize, 10);
      const result = ctx.store.list(q);
      return c.json({ success: true, data: result, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // POST / - 添加卡片
  app.post("/", async (c) => {
    const start = Date.now();
    let body: OpportunityAddRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    try {
      const card = body.card as OpportunityCard;
      const entry = ctx.store.add(card, body.radar_type);
      return c.json({ success: true, data: entry, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // GET /:key - 按 dedup_key 获取
  app.get("/:key", (c) => {
    const start = Date.now();
    try {
      const key = c.req.param("key");
      const entry = ctx.store.get(key);
      if (!entry) {
        return c.json({ success: false, data: null, error: { code: "NOT_FOUND", message: `dedup_key=${key} 不存在` }, duration_ms: Date.now() - start } satisfies ApiResponse, 404);
      }
      return c.json({ success: true, data: entry, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // PUT /:key - 更新卡片
  app.put("/:key", async (c) => {
    const start = Date.now();
    let body: OpportunityUpdateRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    try {
      const key = c.req.param("key");
      const entry = ctx.store.update(key, body.updates as Partial<OpportunityCard>);
      if (!entry) {
        return c.json({ success: false, data: null, error: { code: "NOT_FOUND", message: `dedup_key=${key} 不存在` }, duration_ms: Date.now() - start } satisfies ApiResponse, 404);
      }
      return c.json({ success: true, data: entry, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // DELETE /:key - 删除
  app.delete("/:key", (c) => {
    const start = Date.now();
    try {
      const key = c.req.param("key");
      const deleted = ctx.store.delete(key);
      if (!deleted) {
        return c.json({ success: false, data: null, error: { code: "NOT_FOUND", message: `dedup_key=${key} 不存在` }, duration_ms: Date.now() - start } satisfies ApiResponse, 404);
      }
      return c.json({ success: true, data: { deleted: true }, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // POST /:key/star - 收藏
  app.post("/:key/star", (c) => {
    const start = Date.now();
    try {
      const key = c.req.param("key");
      const result = ctx.starManager.star(key);
      if (!result.success) {
        return c.json({ success: false, data: null, error: { code: "STAR_ERROR", message: result.error ?? "收藏失败" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
      }
      return c.json({ success: true, data: result.entry, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STAR_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // DELETE /:key/star - 取消收藏
  app.delete("/:key/star", (c) => {
    const start = Date.now();
    try {
      const key = c.req.param("key");
      const result = ctx.starManager.unstar(key);
      if (!result.success) {
        return c.json({ success: false, data: null, error: { code: "STAR_ERROR", message: result.error ?? "取消收藏失败" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
      }
      return c.json({ success: true, data: result.entry, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STAR_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  return app;
}
