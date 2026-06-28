import { Hono } from "hono";
import fs from "fs";
import path from "path";
import type { AppContext } from "../context";
import type { ApiResponse, ReportGenerateRequest } from "../types";
import { generateRadarReport } from "../../agents/radar-report-generator";
import type { RadarReportInput } from "../../agents/radar-report-generator";
import type { RadarRequirementSpec } from "../../schema/radar-requirement-spec";
import type { OpportunityCard } from "../../schema/opportunity-card";

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

  return app;
}
