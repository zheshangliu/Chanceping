import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse, OpportunityAddRequest, OpportunityUpdateRequest } from "../types";
import type { OpportunityCard } from "../../schema/opportunity-card";
import type { Feedback, ActionIntent, FeedbackEvaluation, ActionIntentType, ActionStatusType } from "../../schema/feedback";
import type { StoreQuery, StoreEntry, RadarType } from "../../agents/opportunity-store";
import { batchAutoTransition } from "../../agents/opportunity-state-machine";

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

  // GET / - 列表查询（Task 040 扩展：sort_by/sort_order/expiring_soon/deadline_from/deadline_to + 查询前自动过期）
  app.get("/", (c) => {
    const start = Date.now();
    try {
      // 查询前执行自动过期扫描（batchAutoTransition，Task 040 F6 接入）
      // V1.1 简单实现：每次查询都扫描全量（数据量小，性能可接受）
      const allEntries = ctx.store.list({ page_size: 10000 }).entries;
      const transitions = batchAutoTransition(
        allEntries.map((e) => ({ dedup_key: e.dedup_key, card: e.card })),
        new Date(),
      );
      for (const t of transitions) {
        // 回写过期/错过状态到 store（store 接口为 update）
        ctx.store.update(t.dedup_key, { status: t.to });
      }

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
      // Task 040 新增查询参数
      const sortBy = c.req.query("sort_by") as StoreQuery["sort_by"] | undefined;
      if (sortBy) q.sort_by = sortBy;
      const sortOrder = c.req.query("sort_order") as StoreQuery["sort_order"] | undefined;
      if (sortOrder) q.sort_order = sortOrder;
      const expiringSoon = c.req.query("expiring_soon");
      if (expiringSoon === "true") q.expiring_soon = true;
      const deadlineFrom = c.req.query("deadline_from");
      if (deadlineFrom) q.deadline_from = deadlineFrom;
      const deadlineTo = c.req.query("deadline_to");
      if (deadlineTo) q.deadline_to = deadlineTo;
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

  // PATCH /:key/feedback - 更新反馈评价 + 行动意图（Task 039 新增）
  app.patch("/:key/feedback", async (c) => {
    const start = Date.now();
    let body: {
      feedback?: { evaluation: FeedbackEvaluation; note?: string };
      action_intent?: {
        intent?: ActionIntentType;
        status?: ActionStatusType;
        note?: string;
        next_action_date?: string;
      };
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    try {
      const key = c.req.param("key");
      const existing = ctx.store.get(key);
      if (!existing) {
        return c.json({ success: false, data: null, error: { code: "NOT_FOUND", message: `dedup_key=${key} 不存在` }, duration_ms: Date.now() - start } satisfies ApiResponse, 404);
      }

      const updates: Partial<OpportunityCard> = {};

      // 更新反馈评价（整体覆盖，自动设置 updated_at）
      if (body.feedback) {
        const feedback: Feedback = {
          evaluation: body.feedback.evaluation,
          updated_at: new Date().toISOString(),
        };
        if (body.feedback.note !== undefined) {
          feedback.note = body.feedback.note;
        }
        updates.feedback = feedback;
      }

      // 更新行动意图（部分更新：合并已有值 + 传入值）
      if (body.action_intent) {
        const existingIntent = existing.card.action_intent;
        const actionIntent: ActionIntent = {
          intent: body.action_intent.intent ?? existingIntent?.intent ?? "considering",
          status: body.action_intent.status ?? existingIntent?.status ?? "not_started",
        };
        if (body.action_intent.note !== undefined) {
          actionIntent.note = body.action_intent.note;
        } else if (existingIntent?.note !== undefined) {
          actionIntent.note = existingIntent.note;
        }
        if (body.action_intent.next_action_date !== undefined) {
          actionIntent.next_action_date = body.action_intent.next_action_date;
        } else if (existingIntent?.next_action_date !== undefined) {
          actionIntent.next_action_date = existingIntent.next_action_date;
        }
        updates.action_intent = actionIntent;
      }

      const entry = ctx.store.update(key, updates);
      if (!entry) {
        return c.json({ success: false, data: null, error: { code: "STORE_ERROR", message: "更新失败" }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
      }
      return c.json({ success: true, data: entry, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  return app;
}
