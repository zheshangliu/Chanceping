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
      visible_level_mapping: { S: "85-100", A: "70-84", B: "55-69", C: "40-54", hidden: "<40" },
      level_definitions: { S: "强烈推荐", A: "高价值", B: "可关注", C: "低优先级", hidden: "不展示" },
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

export function reportRoutes(ctx: AppContext): Hono {
  const app = new Hono();

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

      const input: RadarReportInput = {
        spec, opportunities, radar_type: radarType,
        period_start: periodStart, period_end: periodEnd,
      };
      const result = generateRadarReport(input);

      // 保存报告到文件
      if (result.success && result.markdown) {
        const reportsDir = path.resolve(process.cwd(), "reports/api");
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }
        const filename = `report-${radarType}-${today.toISOString().replace(/[:.]/g, "-")}.md`;
        fs.writeFileSync(path.join(reportsDir, filename), result.markdown, "utf-8");
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
    const filePath = path.resolve(process.cwd(), "reports", "export", filename);
    if (!fs.existsSync(filePath)) {
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
