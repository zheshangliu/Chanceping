import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse } from "../types";
import { generateReminders } from "../../agents/reminder-engine";
import type { ReminderQuery } from "../../agents/reminder-engine";
import type { RadarType } from "../../agents/opportunity-store";
import type { CardVisibleLevel } from "../../schema/scoring-rules";

export function reminderRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // GET / - 提醒查询
  app.get("/", (c) => {
    const start = Date.now();
    try {
      const query: ReminderQuery = {};
      const radarType = c.req.query("radar_type");
      if (radarType) query.radar_type = radarType as RadarType;
      const visibleLevel = c.req.query("visible_level");
      if (visibleLevel) query.visible_level = visibleLevel as CardVisibleLevel;
      const starredOnly = c.req.query("starred_only");
      if (starredOnly === "true") query.starred_only = true;
      const baseDate = c.req.query("base_date");
      if (baseDate) query.base_date = baseDate;

      const allEntries = ctx.store.list({ page: 1, page_size: 10000 }).entries;
      const result = generateReminders(allEntries, query);
      return c.json({ success: true, data: result, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "REMINDER_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  return app;
}
