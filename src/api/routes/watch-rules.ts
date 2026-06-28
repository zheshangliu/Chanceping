import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse, WatchRulesSaveRequest, WatchRulesAppendRequest, WatchRulesMatchRequest } from "../types";
import { parseWatchRules } from "../../watch/dsl-parser";
import { filterByRules } from "../../watch/rule-matcher";

export function watchRulesRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // GET / - 获取规则文本
  app.get("/", (c) => {
    const start = Date.now();
    try {
      const text = ctx.watchStore.loadRaw();
      const ruleSet = ctx.watchStore.loadRules();
      return c.json({
        success: true,
        data: { rules_text: text, rules_count: ruleSet.rules.length, errors: ruleSet.errors },
        error: null, duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "WATCH_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // POST / - 保存规则文本
  app.post("/", async (c) => {
    const start = Date.now();
    let body: WatchRulesSaveRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    if (typeof body.rules_text !== "string") {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "缺少 rules_text 字段" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    try {
      ctx.watchStore.saveRaw(body.rules_text);
      const ruleSet = ctx.watchStore.loadRules();
      return c.json({
        success: true,
        data: { saved: true, rules_count: ruleSet.rules.length, errors: ruleSet.errors },
        error: null, duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "WATCH_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // POST /append - 追加一行规则
  app.post("/append", async (c) => {
    const start = Date.now();
    let body: WatchRulesAppendRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    if (typeof body.line !== "string") {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "缺少 line 字段" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    try {
      ctx.watchStore.appendLine(body.line);
      const ruleSet = ctx.watchStore.loadRules();
      return c.json({
        success: true,
        data: { appended: true, rules_count: ruleSet.rules.length },
        error: null, duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "WATCH_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // POST /match - 匹配测试
  app.post("/match", async (c) => {
    const start = Date.now();
    let body: WatchRulesMatchRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    try {
      const rulesText = body.rules_text ?? ctx.watchStore.loadRaw();
      const ruleSet = parseWatchRules(rulesText);
      const useStore = body.use_store_entries !== false;
      let entries: unknown[] = [];
      if (useStore) {
        entries = ctx.store.list({ page: 1, page_size: 10000 }).entries;
      }
      const filtered = filterByRules(entries as any, ruleSet, new Date());
      return c.json({
        success: true,
        data: {
          total_rules: ruleSet.rules.length,
          errors: ruleSet.errors,
          total_entries: entries.length,
          matched_entries: filtered.length,
          matched: filtered,
        },
        error: null, duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "WATCH_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // DELETE / - 清空规则
  app.delete("/", (c) => {
    const start = Date.now();
    try {
      ctx.watchStore.clear();
      return c.json({ success: true, data: { cleared: true }, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "WATCH_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  return app;
}
