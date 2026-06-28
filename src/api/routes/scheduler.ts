/**
 * 调度 API 路由（Scheduler Routes）
 *
 * 来源：Task 028 第 5.6 节。
 *
 * 端点：
 *   GET    /              - 列出所有调度任务
 *   POST   /              - 创建调度任务
 *   DELETE /:id           - 删除调度任务
 *   POST   /:id/trigger   - 手动触发任务
 *   GET    /jobs          - 获取任务执行历史
 *   GET    /presets       - 获取预设模板列表
 *   POST   /presets/:id/apply - 应用预设模板
 *   GET    /status        - 获取调度器状态
 */

import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse } from "../types";
import type { Schedule, Period, CreateScheduleRequest } from "../../scheduler/types";
import { Scheduler } from "../../scheduler/scheduler";
import { listPresets, getPresetById } from "../../scheduler/presets";

/** 全局调度器单例（首次调用路由时创建） */
let schedulerInstance: Scheduler | null = null;

/** 获取调度器单例 */
function getScheduler(ctx: AppContext): Scheduler {
  if (!schedulerInstance) {
    schedulerInstance = new Scheduler(ctx);
  }
  return schedulerInstance;
}

export function schedulerRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // GET /status - 调度器状态
  app.get("/status", (c) => {
    const start = Date.now();
    try {
      const scheduler = getScheduler(ctx);
      const status = scheduler.getStatus();
      return c.json({
        success: true,
        data: status,
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "SCHEDULER_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // GET /presets - 预设模板列表
  app.get("/presets", (c) => {
    const start = Date.now();
    return c.json({
      success: true,
      data: { presets: listPresets(), total: listPresets().length },
      error: null,
      duration_ms: Date.now() - start,
    } satisfies ApiResponse);
  });

  // POST /presets/:id/apply - 应用预设模板
  app.post("/presets/:id/apply", (c) => {
    const start = Date.now();
    try {
      const presetId = c.req.param("id");
      const preset = getPresetById(presetId);
      if (!preset) {
        return c.json({
          success: false,
          data: null,
          error: { code: "PRESET_NOT_FOUND", message: `预设模板不存在: ${presetId}` },
          duration_ms: Date.now() - start,
        } satisfies ApiResponse, 404);
      }

      const scheduler = getScheduler(ctx);
      const created: Schedule[] = [];
      for (const period of preset.periods) {
        const schedule: Schedule = {
          id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: `${preset.name} - ${period.id}`,
          mode: "recurring",
          preset: preset.id,
          period,
          created_at: new Date().toISOString(),
          enabled: true,
        };
        scheduler.addSchedule(schedule);
        created.push(schedule);
      }

      return c.json({
        success: true,
        data: { applied: created.length, schedules: created },
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "APPLY_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // GET / - 列出所有调度任务
  app.get("/", (c) => {
    const start = Date.now();
    try {
      const scheduler = getScheduler(ctx);
      const schedules = scheduler.listSchedules();
      return c.json({
        success: true,
        data: { schedules, total: schedules.length },
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "SCHEDULER_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // POST / - 创建调度任务
  app.post("/", async (c) => {
    const start = Date.now();
    let body: CreateScheduleRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        success: false,
        data: null,
        error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }
    try {
      if (!body.name || !body.period) {
        return c.json({
          success: false,
          data: null,
          error: { code: "VALIDATION_ERROR", message: "name 和 period 必填" },
          duration_ms: Date.now() - start,
        } satisfies ApiResponse, 400);
      }

      const scheduler = getScheduler(ctx);
      const schedule: Schedule = {
        id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: body.name,
        mode: body.mode ?? "recurring",
        preset: body.preset,
        period: body.period,
        created_at: new Date().toISOString(),
        enabled: body.enabled ?? true,
      };
      scheduler.addSchedule(schedule);

      return c.json({
        success: true,
        data: schedule,
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 201);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "CREATE_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // DELETE /:id - 删除调度任务
  app.delete("/:id", (c) => {
    const start = Date.now();
    try {
      const id = c.req.param("id");
      const scheduler = getScheduler(ctx);
      const removed = scheduler.removeSchedule(id);
      if (!removed) {
        return c.json({
          success: false,
          data: null,
          error: { code: "NOT_FOUND", message: `调度任务不存在: ${id}` },
          duration_ms: Date.now() - start,
        } satisfies ApiResponse, 404);
      }
      return c.json({
        success: true,
        data: { removed: true, id },
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "DELETE_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // POST /:id/trigger - 手动触发任务
  app.post("/:id/trigger", async (c) => {
    const start = Date.now();
    try {
      const id = c.req.param("id");
      const scheduler = getScheduler(ctx);
      const record = await scheduler.triggerManually(id);
      return c.json({
        success: true,
        data: record,
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "TRIGGER_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // GET /jobs - 任务执行历史
  app.get("/jobs", (c) => {
    const start = Date.now();
    try {
      const scheduler = getScheduler(ctx);
      const limit = parseInt(c.req.query("limit") ?? "100", 10);
      const scheduleId = c.req.query("schedule_id");
      const queue = scheduler.getQueue();
      const records = scheduleId
        ? queue.getByScheduleId(scheduleId)
        : queue.getRecent(limit);
      return c.json({
        success: true,
        data: { jobs: records, total: records.length },
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false,
        data: null,
        error: { code: "JOBS_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  return app;
}
