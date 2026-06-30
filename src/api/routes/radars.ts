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
// V1.5-06 cron 校验与 nextRunAt 计算（导出供 triggers.ts / 验收脚本复用）
// ============================================================

/**
 * V1.5-06：cron 表达式校验（5 字段 unix 格式）。
 *
 * 支持 `*` / 数字 / `* / n`（步进）/ `a-b` / `a,b` 组合。
 *
 * @param cron cron 表达式
 * @returns 校验结果（valid=false 时含 error）
 */
export function validateCron(cron: string): { valid: boolean; error?: string } {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, error: "cron 必须为 5 字段格式（分 时 日 月 周）" };
  }
  const ranges = [
    { min: 0, max: 59 },  // 分钟
    { min: 0, max: 23 },  // 小时
    { min: 1, max: 31 },  // 日
    { min: 1, max: 12 },  // 月
    { min: 0, max: 7 },   // 周（0 和 7 都表示周日）
  ];
  for (let i = 0; i < 5; i++) {
    if (!validateCronField(fields[i], ranges[i].min, ranges[i].max)) {
      return { valid: false, error: `cron 字段 ${i + 1}（"${fields[i]}"）格式或范围非法` };
    }
  }
  return { valid: true };
}

/** 校验单个 cron 字段（支持 * / 数字 / 步进 n / a-b / a,b 组合） */
function validateCronField(field: string, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.startsWith("*/")) {
      const n = Number(part.slice(2));
      if (!Number.isInteger(n) || n < 1 || n > max) return false;
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < min || b > max || a > b) return false;
    } else {
      const n = Number(part);
      if (!Number.isInteger(n) || n < min || n > max) return false;
    }
  }
  return true;
}

/**
 * V1.5-06：计算下次执行时间。
 *
 * 简化实现：从 from 的下一分钟开始，逐分钟遍历未来 7 天，
 * 找到第一个匹配 cron 5 字段的时刻。timezone 参数保留接口（当前用本地时间匹配）。
 *
 * @param cron cron 表达式
 * @param timezone 时区（IANA 格式）
 * @param from 起始时间（默认当前时间）
 * @returns 下次执行时间（ISO 8601）
 */
export function computeNextRunAt(cron: string, timezone: string, from: Date = new Date()): string {
  const fields = cron.trim().split(/\s+/);
  const minuteField = fields[0];
  const hourField = fields[1];
  const dayField = fields[2];
  const monthField = fields[3];
  const dowField = fields[4];
  // 从下一分钟开始，秒/毫秒清零
  const start = new Date(from.getTime() + 60 * 1000);
  start.setSeconds(0, 0);
  // 最多遍历 7 天（7 * 24 * 60 = 10080 分钟）
  for (let i = 0; i < 7 * 24 * 60; i++) {
    const candidate = new Date(start.getTime() + i * 60 * 1000);
    if (
      matchCronField(minuteField, candidate.getMinutes(), 0, 59) &&
      matchCronField(hourField, candidate.getHours(), 0, 23) &&
      matchCronField(dayField, candidate.getDate(), 1, 31) &&
      matchCronField(monthField, candidate.getMonth() + 1, 1, 12) &&
      matchCronField(dowField, candidate.getDay(), 0, 7)
    ) {
      return candidate.toISOString();
    }
  }
  // 7 天内未找到（不应发生，兜底返回明天同一时刻）
  const fallback = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return fallback.toISOString();
}

/** 匹配单个 cron 字段值（内部使用） */
function matchCronField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.startsWith("*/")) {
      const n = Number(part.slice(2));
      if (n > 0 && value % n === 0) return true;
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (value >= a && value <= b) return true;
    } else {
      const n = Number(part);
      if (n === value) return true;
      // 周日：0 和 7 都表示周日
      if (min === 0 && max === 7 && n === 7 && value === 0) return true;
    }
  }
  return false;
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
    if (radar.status !== "draft") {
      return c.json(errorResponse("BAD_REQUEST", `仅 draft 状态可激活，当前状态: ${radar.status}`, Date.now() - start, 400), 400);
    }
    const updated = ctx.radarStore.update(id, { status: "active" });
    if (updated) {
      ctx.radarStore.save();
    }
    return c.json({ success: true, data: updated, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // ============================================================
  // PUT /:id/schedule - 设置/更新定时（V1.5-06 新增）
  // ============================================================
  app.put("/:id/schedule", async (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const radar = ctx.radarRegistry.getRadarById(id);
    if (!radar) {
      return c.json(errorResponse("RADAR_NOT_FOUND", `雷达 ${id} 不存在`, Date.now() - start, 404), 404);
    }
    let body: { cron?: string; timezone?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorResponse("BAD_REQUEST", "请求体不是合法 JSON", Date.now() - start, 400), 400);
    }
    if (!body.cron || typeof body.cron !== "string") {
      return c.json(errorResponse("BAD_REQUEST", "cron 必填", Date.now() - start, 400), 400);
    }
    const cronValidation = validateCron(body.cron);
    if (!cronValidation.valid) {
      return c.json(errorResponse("INVALID_CRON", cronValidation.error ?? "cron 格式非法", Date.now() - start, 400), 400);
    }
    const timezone = body.timezone ?? "Asia/Shanghai";
    const nextRunAt = computeNextRunAt(body.cron, timezone);
    const schedule: RadarSchedule = {
      cron: body.cron,
      timezone,
      enabled: true,
      nextRunAt,
    };
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
      const searchResult = await orchestrator.search(radar.spec, body.query);

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

      // 7. 返回结果（opportunities 每条附加 radarId）
      const opportunitiesWithRadarId = searchResult.opportunities.map((opp) => ({
        ...opp,
        radarId: id,
      }));

      const result: RadarRunResult = {
        run: updatedRun ?? run,
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
