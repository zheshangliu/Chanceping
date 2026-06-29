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
import type { RadarKind, RadarStatus } from "../../schema/radar";
import { RadarGenerator } from "../../agents/radar-generator";

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
