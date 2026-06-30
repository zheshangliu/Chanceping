import { Hono } from "hono";
import fs from "fs";
import path from "path";
import type { AppContext } from "../context";
import type { ApiResponse, ReportGenerateRequest } from "../types";
import { generateRadarReport } from "../../agents/radar-report-generator";
import type { RadarReportInput } from "../../agents/radar-report-generator";
import type { RadarRequirementSpec } from "../../schema/radar-requirement-spec";
import type { OpportunityCard } from "../../schema/opportunity-card";
import { exportReport } from "../../export/report-exporter";
import type { ExportFormat } from "../../export/report-exporter";
import { exportReview } from "../../export/review-exporter";
import { generateReview } from "../../agents/opportunity-review";
import type { ReportMeta } from "../../agents/report-store";

/** 默认高确认度 spec（用于 API 报告生成） */
function createDefaultSpec(): RadarRequirementSpec {
  return {
    product_name: "ChancePing",
    product_category: "机会雷达",
    client_profile: {
      client_name: "API 测试客户", client_type: "团队", industry: "AI",
      business_type: "AI 应用", company_stage: "初创",
      products_or_projects: ["AI 应用"], target_users: ["用户"],
      core_capabilities: ["AI"], current_assets: [], regions: ["全国"], notes: "",
    },
    core_goals: {
      primary_goal: "找 AI 比赛机会", secondary_goals: [],
      success_definition: "获得奖金", action_intent: ["报名比赛"], priority_order: ["奖金"],
    },
    opportunity_scope: {
      primary_opportunity_types: ["AI 比赛"], secondary_opportunity_types: [],
      excluded_opportunity_types: [], must_have_conditions: [], nice_to_have_conditions: [],
    },
    region_scope: {
      primary_regions: ["全国"], secondary_regions: [],
      excluded_regions: [], global_allowed: false, overseas_allowed: false,
    },
    keyword_strategy: {
      core_keywords_zh: ["AI", "比赛"], core_keywords_en: ["AI", "competition"],
      expanded_keywords_zh: [], expanded_keywords_en: [], negative_keywords: [],
    },
    filter_rules: {
      must_include: [], must_exclude: [], low_priority_signals: [],
      high_priority_signals: [], requires_manual_review: [],
    },
    scoring_rules: {
      backend_score_enabled: true, visible_level_enabled: true,
      weights: { match_score: 30, business_value: 25, timeliness: 20, credibility: 15, actionability: 10, risk_penalty: -20 },
      visible_level_mapping: { S: "90-100", A: "80-89", B: "65-79", C: "50-64", D: "0-49", hidden: "不展示" },
      level_definitions: { S: "强烈推荐", A: "高价值", B: "可关注", C: "低优先级", D: "不推荐", hidden: "不展示" },
    },
    report_requirements: {
      report_format: "markdown", report_title_prefix: "本周", report_frequency: "weekly",
      max_items_per_report: 10, min_items_per_report: 5, must_include_sections: [],
      opportunity_card_required_fields: [], link_required: true,
      contact_required_if_available: true, deadline_required_if_available: true,
    },
    requirement_confidence: {
      total: 100,
      client_identity: { score: 100, weight: 15, reason: "" },
      business_goal: { score: 100, weight: 20, reason: "" },
      opportunity_type: { score: 100, weight: 20, reason: "" },
      region_scope: { score: 100, weight: 10, reason: "" },
      exclusion_rules: { score: 100, weight: 10, reason: "" },
      action_scenario: { score: 100, weight: 15, reason: "" },
      report_format: { score: 100, weight: 10, reason: "" },
    },
    questions_to_confirm: [],
    confirmation_status: {
      status: "confirmed", user_confirmed: true, confirmed_at: "2026-06-01",
      last_user_feedback: "", revision_count: 0,
    },
  };
}

/**
 * V1.6-03 强校验：解析 effectiveRadarId 并校验 run_id 与 radar_id 一致性。
 *
 * 校验规则：
 *   1. 只传 run_id → 从 RadarRun 反查 radarId 作为 effectiveRadarId
 *   2. 只传 radar_id → effectiveRadarId = radar_id，不校验 run_id
 *   3. 同时传 → 校验 run.radarId === radar_id，不一致返回 400
 *   4. 传不存在的 run_id → 返回 400
 *   5. 都不传 → 返回 { effectiveRadarId: undefined }（向后兼容，不创建 ReportMeta）
 *
 * @param body 请求体（含 radar_id / run_id）
 * @param ctx 应用上下文
 * @param durationMs 已耗时（用于错误响应）
 * @returns 成功时 { effectiveRadarId }；失败时 { errorBody, status }
 */
function resolveRadarIdFromRun(
  body: { radar_id?: string; run_id?: string },
  ctx: AppContext,
  durationMs: number,
): { effectiveRadarId: string | undefined } | { errorBody: ApiResponse; status: 400 } {
  let effectiveRadarId = body.radar_id;

  if (body.run_id && ctx.radarRunStore) {
    const run = ctx.radarRunStore.get(body.run_id);
    if (!run) {
      return {
        errorBody: {
          success: false, data: null,
          error: { code: "BAD_REQUEST", message: `run_id ${body.run_id} 不存在` },
          duration_ms: durationMs,
        },
        status: 400,
      };
    }
    // 同时传了 radar_id，校验一致
    if (body.radar_id && run.radarId !== body.radar_id) {
      return {
        errorBody: {
          success: false, data: null,
          error: { code: "BAD_REQUEST", message: `radar_id(${body.radar_id}) 与 run_id(${body.run_id}) 关联的 radarId(${run.radarId}) 不一致` },
          duration_ms: durationMs,
        },
        status: 400,
      };
    }
    // 只传 run_id，从 RadarRun 反查 radarId
    if (!body.radar_id) {
      effectiveRadarId = run.radarId;
    }
  }

  return { effectiveRadarId };
}

export function reportRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // GET / - 列出报告元数据（V1.5-08 新增，支持 ?radar_id=xxx 过滤）
  app.get("/", (c) => {
    const start = Date.now();
    const radarId = c.req.query("radar_id");
    const reports = radarId
      ? ctx.reportStore.listByRadarId(radarId)
      : ctx.reportStore.list();
    return c.json({
      success: true,
      data: reports,
      error: null,
      duration_ms: Date.now() - start,
    } satisfies ApiResponse<ReportMeta[]>);
  });

  // POST /generate - 生成报告
  app.post("/generate", async (c) => {
    const start = Date.now();
    let body: ReportGenerateRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    try {
      const spec = (body.spec as RadarRequirementSpec) ?? createDefaultSpec();
      const opportunities = (body.opportunities as OpportunityCard[]) ?? [];
      const radarType = body.radar_type ?? "ai_competition";
      const today = new Date();
      const periodEnd = body.period_end ?? today.toISOString().split("T")[0];
      const periodStart = body.period_start ?? new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      // V1.6-03 强校验：解析 effectiveRadarId + 校验 run_id 一致性（校验失败时不生成报告，避免孤立文件）
      const resolved = resolveRadarIdFromRun(body, ctx, Date.now() - start);
      if ("errorBody" in resolved) {
        return c.json(resolved.errorBody, resolved.status);
      }
      const effectiveRadarId = resolved.effectiveRadarId;

      const input: RadarReportInput = {
        spec, opportunities, radar_type: radarType,
        period_start: periodStart, period_end: periodEnd,
      };
      const result = generateRadarReport(input);

      // 保存报告到文件
      let savedFilename: string | undefined;
      if (result.success && result.markdown) {
        const reportsDir = path.resolve(process.cwd(), "reports/api");
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }
        const filename = `report-${radarType}-${today.toISOString().replace(/[:.]/g, "-")}.md`;
        fs.writeFileSync(path.join(reportsDir, filename), result.markdown, "utf-8");
        savedFilename = filename;
      }

      // V1.5-08 + V1.6-03：写入报告元数据（当 effectiveRadarId 存在时）
      if (result.success && savedFilename && effectiveRadarId) {
        const meta = ctx.reportStore.create({
          radarId: effectiveRadarId,
          title: `${radarType} 报告 ${periodStart} ~ ${periodEnd}`,
          radarType,
          format: "markdown",
          filename: savedFilename,
          periodStart,
          periodEnd,
          opportunityCount: opportunities.length,
        });
        ctx.reportStore.save();
        (result as { reportId?: string }).reportId = meta.id;

        // V1.6-03：回写 RadarRun.reportId（只要 body.run_id 存在且 RadarRun 存在就回写，不依赖 radar_id）
        if (body.run_id && ctx.radarRunStore) {
          ctx.radarRunStore.update(body.run_id, { reportId: meta.id });
          ctx.radarRunStore.save();
        }
      }

      return c.json({ success: result.success, data: result, error: result.error ? { code: "REPORT_ERROR", message: result.error } : null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "REPORT_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // POST /export - 导出雷达报告（format=markdown/html/pdf）
  app.post("/export", async (c) => {
    const start = Date.now();
    const format = (c.req.query("format") ?? "markdown") as ExportFormat;
    let body: ReportGenerateRequest;
    try {
      body = await c.req.json();
    } catch {
      body = {} as ReportGenerateRequest;
    }

    try {
      const spec = (body.spec as RadarRequirementSpec) ?? createDefaultSpec();
      const opportunities = (body.opportunities as OpportunityCard[]) ?? [];
      const radarType = body.radar_type ?? "ai_competition";
      const today = new Date();
      // V1.6-03 强校验：解析 effectiveRadarId + 校验 run_id 一致性（校验失败时不生成报告，避免孤立文件）
      const resolved = resolveRadarIdFromRun(body, ctx, Date.now() - start);
      if ("errorBody" in resolved) {
        return c.json(resolved.errorBody, resolved.status);
      }
      const effectiveRadarId = resolved.effectiveRadarId;

      const input: RadarReportInput = {
        spec,
        opportunities,
        radar_type: radarType,
        period_start: body.period_start ?? new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10),
        period_end: body.period_end ?? today.toISOString().slice(0, 10),
      };

      const result = generateRadarReport(input);
      if (!result.success || !result.markdown) {
        return c.json({ success: false, data: null, error: { code: "REPORT_ERROR", message: result.error ?? "生成失败" }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
      }

      const exported = await exportReport(result.markdown, format);

      // 保存到 reports/export/ 目录
      const exportDir = path.resolve(process.cwd(), "reports", "export");
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      fs.writeFileSync(path.join(exportDir, exported.filename), exported.content);

      // V1.5-08 + V1.6-03：写入报告元数据（当 effectiveRadarId 存在时）
      if (effectiveRadarId) {
        const meta = ctx.reportStore.create({
          radarId: effectiveRadarId,
          title: `${radarType} 导出报告 ${input.period_start} ~ ${input.period_end}`,
          radarType,
          format,
          filename: exported.filename,
          periodStart: input.period_start,
          periodEnd: input.period_end,
          opportunityCount: opportunities.length,
        });
        ctx.reportStore.save();

        // V1.6-03：回写 RadarRun.reportId（只要 body.run_id 存在且 RadarRun 存在就回写，不依赖 radar_id）
        if (body.run_id && ctx.radarRunStore) {
          ctx.radarRunStore.update(body.run_id, { reportId: meta.id });
          ctx.radarRunStore.save();
        }
      }

      // 返回文件
      c.header("Content-Disposition", `attachment; filename="${exported.filename}"`);
      c.header("Content-Type", exported.contentType);
      return c.body(exported.content as unknown as ArrayBuffer);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "EXPORT_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // POST /review/export - 导出复盘报告（format=markdown/html/pdf）
  app.post("/review/export", async (c) => {
    const start = Date.now();
    const format = (c.req.query("format") ?? "markdown") as ExportFormat;
    try {
      const entries = ctx.store.list({ page: 1, page_size: 10000 }).entries;
      const review = generateReview(entries, 30);
      const exported = await exportReview(review, format);

      const exportDir = path.resolve(process.cwd(), "reports", "export");
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      fs.writeFileSync(path.join(exportDir, exported.filename), exported.content);

      c.header("Content-Disposition", `attachment; filename="${exported.filename}"`);
      c.header("Content-Type", exported.contentType);
      return c.body(exported.content as unknown as ArrayBuffer);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "EXPORT_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  // GET /export/list - 列出已导出报告文件
  app.get("/export/list", (c) => {
    const start = Date.now();
    const exportDir = path.resolve(process.cwd(), "reports", "export");
    const files: Array<{ filename: string; size: number; created_at: string }> = [];
    if (fs.existsSync(exportDir)) {
      const list = fs.readdirSync(exportDir);
      for (const filename of list) {
        const stat = fs.statSync(path.join(exportDir, filename));
        files.push({ filename, size: stat.size, created_at: stat.mtime.toISOString() });
      }
    }
    return c.json({ success: true, data: { files, total: files.length }, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
  });

  // GET /export/:filename - 下载指定报告文件
  app.get("/export/:filename", (c) => {
    const start = Date.now();
    const filename = c.req.param("filename");
    // 优先查 reports/export/，找不到再查 reports/api/（/generate 产出的报告存于此）
    const exportPath = path.resolve(process.cwd(), "reports", "export", filename);
    const apiPath = path.resolve(process.cwd(), "reports", "api", filename);
    const filePath = fs.existsSync(exportPath) ? exportPath : fs.existsSync(apiPath) ? apiPath : null;
    if (!filePath) {
      return c.json({ success: false, data: null, error: { code: "NOT_FOUND", message: "文件不存在" }, duration_ms: Date.now() - start } satisfies ApiResponse, 404);
    }
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === ".pdf" ? "application/pdf" : ext === ".html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8";
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Content-Type", contentType);
    return c.body(content as unknown as ArrayBuffer);
  });

  return app;
}
