/**
 * 雷达管理 API 路由（V1.5-03 新增）
 *
 * 7 个端点：
 *   POST   /api/radars          创建雷达
 *   GET    /api/radars          列出雷达
 *   GET    /api/radars/:id      获取详情
 *   PUT    /api/radars/:id      更新雷达
 *   DELETE /api/radars/:id      归档雷达
 *   POST   /api/radars/:id/run  手动运行
 *   POST   /api/radars/:id/activate 激活雷达
 *
 * 错误码：
 *   RADAR_NOT_FOUND       404
 *   RADAR_NOT_EDITABLE    403
 *   RADAR_NOT_DELETABLE   403
 *   RADAR_NOT_ACTIVE      400
 *   RADAR_ALREADY_RUNNING 409
 */

import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse, RadarCreateRequest, RadarUpdateRequest, RadarRunRequest, RadarRunResult, RadarGenerateRequest, RadarGenerateResponseData } from "../types";
import { SearchOrchestrator } from "../../search/orchestrator";
import { getDataMode } from "../../demo/data-mode";
import type { RadarType } from "../../agents/opportunity-store";
import type { RadarKind, RadarStatus, RadarSchedule } from "../../schema/radar";
import { RadarGenerator } from "../../agents/radar-generator";
import { getCurrentUser } from "../../agents/user-context";
import { RadarQuotaChecker } from "../../agents/radar-quota";

/** 从 RadarKind 推断 RadarType（custom 默认 ai_competition） */
function kindToRadarType(kind: RadarKind): RadarType {
  if (kind === "ai_competition" || kind === "opc_policy" || kind === "cultural_heritage") {
    return kind;
  }
  return "ai_competition";
}

/** 构造错误响应 */
function errorResponse(code: string, message: string, durationMs: number, status: number) {
  return { success: false, data: null, error: { code, message }, duration_ms: durationMs } satisfies ApiResponse;
}

// ============================================================
// V1.6-02 HH:MM 校验与 nextRunAt 计算（替代 V1.5-06 的 cron 实现）
// ============================================================

/**
 * V1.6-02：验证 HH:MM 时间格式。
 *
 * @param time 时间字符串（如 "08:00"）
 * @returns true=合法，false=非法
 */
export function validateScheduleTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/**
 * V1.6-02：计算下次执行时间（基于 HH:MM + frequency + weekdays）。
 *
 * 简化实现：
 *   1. 从 from 当天的 time 时刻开始，若已过则从次日同时刻开始
 *   2. weekly 模式下，向后查找直到 weekday 匹配（最多 7 天）
 *   3. timezone 参数保留接口（当前用本地时间匹配，V1.6b 可补 timezone-aware）
 *
 * @param schedule 定时配置（含 time/frequency/weekdays）
 * @param from 起始时间（默认当前时间）
 * @returns 下次执行时间（ISO 8601）
 */
export function computeNextRunAt(schedule: RadarSchedule, from: Date = new Date()): string {
  const now = from;
  const [hour, minute] = schedule.time.split(":").map(Number);
  let next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  // 若当日 time 已过，从次日同时刻开始
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  // weekly 模式：向后查找直到 weekday 匹配
  if (schedule.frequency === "weekly" && schedule.weekdays && schedule.weekdays.length > 0) {
    for (let i = 0; i < 8; i++) {
      // JS getDay(): 0=周日, 1=周一...6=周六；本接口约定 1-7=周一到周日，周日=7
      const dow = next.getDay() === 0 ? 7 : next.getDay();
      if (schedule.weekdays.includes(dow)) break;
      next.setDate(next.getDate() + 1);
    }
  }
  return next.toISOString();
}

export function radarsRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // ============================================================
  // POST / - 创建雷达
  // ============================================================
  app.post("/", async (c) => {
    const start = Date.now();
    let body: RadarCreateRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorResponse("BAD_REQUEST", "请求体不是合法 JSON", Date.now() - start, 400), 400);
    }
    if (!body.name || !body.kind) {
      return c.json(errorResponse("BAD_REQUEST", "name 和 kind 必填", Date.now() - start, 400), 400);
    }
    // V1.5-07 新增：配额检查
    const user = getCurrentUser();
    const quotaChecker = new RadarQuotaChecker(ctx.radarStore);
    const quotaCheck = quotaChecker.check(user);
    if (!quotaCheck.allowed) {
      return c.json(
        errorResponse(
          "RADAR_QUOTA_EXCEEDED",
          `已达到免费用户雷达上限（${quotaCheck.quota}个），当前已有 ${quotaCheck.current} 个自定义雷达。归档旧雷达或升级套餐以创建更多。`,
          Date.now() - start,
          403,
        ),
        403,
      );
    }
    const radar = ctx.radarRegistry.createCustomRadar({
      name: body.name,
      kind: body.kind,
      spec: body.spec,
      providerRouting: body.providerRouting,
    });
    return c.json({ success: true, data: radar, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // POST /generate - AI 生成雷达 Spec（V1.5-05 新增）
  // ============================================================
  app.post("/generate", async (c) => {
    const start = Date.now();
    let body: RadarGenerateRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorResponse("BAD_REQUEST", "请求体不是合法 JSON", Date.now() - start, 400), 400);
    }
    if (!body.description || !body.description.trim()) {
      return c.json(errorResponse("BAD_REQUEST", "description 必填", Date.now() - start, 400), 400);
    }

    try {
      const generator = new RadarGenerator(ctx.llmAdapter);
      const result = await generator.generate(body.description, body.uploaded_text);
      const data: RadarGenerateResponseData = {
        spec: result.spec,
        suggestedName: result.suggestedName,
        completeness: result.completeness,
      };
      return c.json({ success: true, data, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json(
        errorResponse("GENERATE_ERROR", err instanceof Error ? err.message : String(err), Date.now() - start, 500),
        500,
      );
    }
  });

  // ============================================================
  // GET / - 列出雷达
  // ============================================================
  app.get("/", (c) => {
    const start = Date.now();
    const status = c.req.query("status") as RadarStatus | undefined;
    const kind = c.req.query("kind") as RadarKind | undefined;
    const includeArchived = c.req.query("includeArchived") === "true";

    const radars = ctx.radarRegistry.listRadars({
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
      includeArchived,
    });
    return c.json({ success: true, data: radars, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // GET /quota - 配额查询（V1.5-07 新增，须在 /:id 之前注册）
  // ============================================================
  app.get("/quota", (c) => {
    const start = Date.now();
    const user = getCurrentUser();
    const quotaChecker = new RadarQuotaChecker(ctx.radarStore);
    const result = quotaChecker.check(user);
    return c.json({
      success: true,
      data: {
        current: result.current,
        quota: result.quota,
        plan: user.plan,
        allowed: result.allowed,
      },
      error: null,
      duration_ms: Date.now() - start,
    } satisfies ApiResponse);
  });

  // ============================================================
  // GET /:id - 获取详情
  // ============================================================
  app.get("/:id", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    return c.json({ success: true, data: radar, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // PUT /:id - 更新雷达
  // ============================================================
  app.put("/:id", async (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    if (radar.isBuiltin) {
      return c.json(errorResponse("RADAR_NOT_EDITABLE", "内置雷达不可编辑", Date.now() - start, 403), 403);
    }
    let body: RadarUpdateRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorResponse("BAD_REQUEST", "请求体不是合法 JSON", Date.now() - start, 400), 400);
    }
    const updated = ctx.radarStore.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.spec !== undefined ? { spec: body.spec } : {}),
      ...(body.privacy !== undefined ? { privacy: body.privacy } : {}),
      ...(body.providerRouting !== undefined ? { providerRouting: body.providerRouting } : {}),
    });
    if (updated) {
      ctx.radarStore.save();
    }
    return c.json({ success: true, data: updated, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // DELETE /:id - 归档雷达
  // ============================================================
  app.delete("/:id", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    if (radar.isBuiltin) {
      return c.json(errorResponse("RADAR_NOT_DELETABLE", "内置雷达不可删除", Date.now() - start, 403), 403);
    }
    if (radar.status === "archived") {
      return c.json(errorResponse("BAD_REQUEST", `已归档的雷达不可重复归档`, Date.now() - start, 400), 400);
    }
    const archived = ctx.radarStore.archive(id);
    if (archived) {
      ctx.radarStore.save();
    }
    return c.json({ success: true, data: archived, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // POST /:id/activate - 激活雷达
  // ============================================================
  app.post("/:id/activate", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    if (radar.isBuiltin) {
      return c.json(errorResponse("RADAR_NOT_EDITABLE", "内置雷达不可修改状态", Date.now() - start, 403), 403);
    }
    if (radar.status !== "draft" && radar.status !== "paused") {
      return c.json(errorResponse("BAD_REQUEST", `仅 draft 或 paused 状态可激活，当前状态: ${radar.status}`, Date.now() - start, 400), 400);
    }
    const updated = ctx.radarStore.update(id, { status: "active" });
    if (updated) {
      ctx.radarStore.save();
    }
    return c.json({ success: true, data: updated, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // POST /:id/pause - 暂停雷达（active → paused）
  // ============================================================
  app.post("/:id/pause", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    if (radar.isBuiltin) {
      return c.json(errorResponse("RADAR_NOT_EDITABLE", "内置雷达不可修改状态", Date.now() - start, 403), 403);
    }
    if (radar.status !== "active") {
      return c.json(errorResponse("BAD_REQUEST", `仅 active 状态可暂停，当前状态: ${radar.status}`, Date.now() - start, 400), 400);
    }
    const updated = ctx.radarStore.update(id, { status: "paused" });
    if (updated) {
      ctx.radarStore.save();
    }
    return c.json({ success: true, data: updated, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // POST /:id/resume - 恢复雷达（paused → active）
  // ============================================================
  app.post("/:id/resume", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    if (radar.isBuiltin) {
      return c.json(errorResponse("RADAR_NOT_EDITABLE", "内置雷达不可修改状态", Date.now() - start, 403), 403);
    }
    if (radar.status !== "paused") {
      return c.json(errorResponse("BAD_REQUEST", `仅 paused 状态可恢复，当前状态: ${radar.status}`, Date.now() - start, 400), 400);
    }
    const updated = ctx.radarStore.update(id, { status: "active" });
    if (updated) {
      ctx.radarStore.save();
    }
    return c.json({ success: true, data: updated, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // PUT /:id/schedule - 设置/更新定时（V1.5-06 新增，V1.6-02 改为 HH:MM）
  // ============================================================
  app.put("/:id/schedule", async (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    let body: {
      time?: string;
      frequency?: "daily" | "weekly";
      weekdays?: number[];
      timezone?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorResponse("BAD_REQUEST", "请求体不是合法 JSON", Date.now() - start, 400), 400);
    }
    if (!body.time || typeof body.time !== "string") {
      return c.json(errorResponse("BAD_REQUEST", "time 必填（HH:MM 格式）", Date.now() - start, 400), 400);
    }
    if (!validateScheduleTime(body.time)) {
      return c.json(errorResponse("INVALID_TIME", `time "${body.time}" 格式非法，应为 HH:MM（如 08:00）`, Date.now() - start, 400), 400);
    }
    const frequency = body.frequency ?? "daily";
    if (frequency !== "daily" && frequency !== "weekly") {
      return c.json(errorResponse("BAD_REQUEST", `frequency 必须为 daily 或 weekly，当前: ${frequency}`, Date.now() - start, 400), 400);
    }
    // weekly 模式下校验 weekdays
    if (frequency === "weekly") {
      if (!Array.isArray(body.weekdays) || body.weekdays.length === 0) {
        return c.json(errorResponse("BAD_REQUEST", "weekly 模式下 weekdays 必填（1-7 数组）", Date.now() - start, 400), 400);
      }
      const invalid = body.weekdays.filter((d) => !Number.isInteger(d) || d < 1 || d > 7);
      if (invalid.length > 0) {
        return c.json(errorResponse("BAD_REQUEST", `weekdays 必须为 1-7 整数，非法值: ${invalid.join(",")}`, Date.now() - start, 400), 400);
      }
    }
    const timezone = body.timezone ?? "Asia/Shanghai";
    const schedule: RadarSchedule = {
      time: body.time,
      frequency,
      ...(frequency === "weekly" && body.weekdays ? { weekdays: body.weekdays } : {}),
      timezone,
      enabled: true,
    };
    schedule.nextRunAt = computeNextRunAt(schedule);
    const updated = ctx.radarStore.update(id, { schedule });
    if (updated) ctx.radarStore.save();
    return c.json({ success: true, data: updated, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // DELETE /:id/schedule - 清除定时（V1.5-06 新增）
  // ============================================================
  app.delete("/:id/schedule", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    const updated = ctx.radarStore.update(id, { schedule: undefined });
    if (updated) ctx.radarStore.save();
    return c.json({ success: true, data: updated, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // POST /:id/run - 手动运行雷达
  // ============================================================
  app.post("/:id/run", async (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    if (radar.status !== "active") {
      return c.json(errorResponse("RADAR_NOT_ACTIVE", `雷达未激活，当前状态: ${radar.status}`, Date.now() - start, 400), 400);
    }
    if (radar.currentRunId) {
      return c.json(errorResponse("RADAR_ALREADY_RUNNING", "雷达正在运行中", Date.now() - start, 409), 409);
    }

    // 解析请求体（可选）
    let body: RadarRunRequest = {};
    try {
      body = await c.req.json();
    } catch {
      // 请求体可选，无 body 时用空对象
    }

    // 1. 创建 RadarRun 记录
    const run = ctx.radarRunStore.create({
      radarId: id,
      mode: "manual",
      triggeredBy: "user",
      ...(body.query !== undefined ? { query: body.query } : {}),
    });

    // 2. 更新 Radar.currentRunId
    ctx.radarStore.update(id, { currentRunId: run.id });

    try {
      // 3. 执行搜索
      const orchestrator = new SearchOrchestrator({
        llmAdapter: ctx.llmAdapter,
        mockContent: true,
        dataMode: getDataMode(),
      });
      const searchResult = await orchestrator.search(radar.spec, body.query, radar.providerRouting);

      // 4. 搜索结果存入 OpportunityStore，绑定 radarId
      const radarType = kindToRadarType(radar.kind);
      const opportunityKeys: string[] = [];
      if (searchResult.opportunityCards && searchResult.opportunityCards.length > 0) {
        const entries = ctx.store.addBatch(searchResult.opportunityCards, radarType, id);
        for (const entry of entries) {
          opportunityKeys.push(entry.dedup_key);
        }
      }

      // 5. 更新 RadarRun: status=succeeded
      const now = new Date().toISOString();
      const updatedRun = ctx.radarRunStore.update(run.id, {
        status: "succeeded",
        finishedAt: now,
        totalRaw: searchResult.total_raw,
        totalScored: searchResult.total_scored,
        opportunityKeys,
        sourceCandidateCount: searchResult.sourceCandidates?.length,
      });
      ctx.radarRunStore.save();

      // 6. 更新 Radar: currentRunId=undefined, lastRunStatus=succeeded, lastRunAt=now
      ctx.radarStore.update(id, {
        currentRunId: undefined,
        lastRunStatus: "succeeded",
        lastRunAt: now,
      });
      ctx.radarStore.save();

      // 7. 返回结果（opportunityCards 为前端主数据，opportunities 为调试字段）
      const opportunitiesWithRadarId = searchResult.opportunities.map((opp) => ({
        ...opp,
        radarId: id,
      }));

      const result: RadarRunResult = {
        run: updatedRun ?? run,
        opportunityCards: searchResult.opportunityCards,
        sourceCandidates: searchResult.sourceCandidates,
        opportunities: opportunitiesWithRadarId,
      };
      return c.json({ success: true, data: result, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      // 搜索失败：更新 RadarRun 为 failed
      const now = new Date().toISOString();
      ctx.radarRunStore.update(run.id, {
        status: "failed",
        finishedAt: now,
        error: err instanceof Error ? err.message : String(err),
      });
      ctx.radarRunStore.save();
      ctx.radarStore.update(id, { currentRunId: undefined, lastRunStatus: "failed", lastRunAt: now });
      ctx.radarStore.save();
      return c.json(errorResponse("RUN_ERROR", err instanceof Error ? err.message : String(err), Date.now() - start, 500), 500);
    }
  });

  return app;
}
