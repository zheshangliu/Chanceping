import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse, SearchRequest } from "../types";
import { SearchOrchestrator } from "../../search/orchestrator";
import type { RadarRequirementSpec } from "../../schema/radar-requirement-spec";
import { getDataMode } from "../../demo/data-mode";

/** 默认 mock spec（当请求未提供 spec 时使用） */
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
      total: 80,
      client_identity: { score: 80, weight: 15, reason: "" },
      business_goal: { score: 80, weight: 20, reason: "" },
      opportunity_type: { score: 80, weight: 20, reason: "" },
      region_scope: { score: 80, weight: 10, reason: "" },
      exclusion_rules: { score: 80, weight: 10, reason: "" },
      action_scenario: { score: 80, weight: 15, reason: "" },
      report_format: { score: 80, weight: 10, reason: "" },
    },
    questions_to_confirm: [],
    confirmation_status: {
      status: "confirmed", user_confirmed: true, confirmed_at: "2026-06-01",
      last_user_feedback: "", revision_count: 0,
    },
  };
}

export function searchRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // POST / - 搜索
  app.post("/", async (c) => {
    const start = Date.now();
    let body: SearchRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, data: null, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, duration_ms: Date.now() - start } satisfies ApiResponse, 400);
    }
    try {
      // V1.5-03 新增：radar_id 优先级 > spec > 默认 spec
      let spec: RadarRequirementSpec;
      let radarId: string | undefined;
      if (body.radar_id) {
        const radar = ctx.radarRegistry.getRadarById(body.radar_id);
        if (!radar) {
          return c.json({ success: false, data: null, error: { code: "RADAR_NOT_FOUND", message: `雷达 ${body.radar_id} 不存在` }, duration_ms: Date.now() - start } satisfies ApiResponse, 404);
        }
        spec = radar.spec;
        radarId = body.radar_id;
      } else {
        spec = (body.spec as RadarRequirementSpec) ?? createDefaultSpec();
      }

      const orchestrator = new SearchOrchestrator({
        llmAdapter: ctx.llmAdapter,
        maxResultsPerProvider: body.max_results,
        minRelevance: body.min_relevance,
        enableContentFetch: body.enable_content_fetch ?? true,
        mockContent: true,
        dataMode: getDataMode(),
      });
      const result = await orchestrator.search(spec, body.query);

      // V1.5-03：如果有 radar_id，给返回结果的 opportunities 附加 radarId
      if (radarId && result.opportunities) {
        result.opportunities = result.opportunities.map((opp) => ({
          ...opp,
          radarId,
        }));
      }

      return c.json({ success: true, data: result, error: null, duration_ms: Date.now() - start } satisfies ApiResponse);
    } catch (err) {
      return c.json({ success: false, data: null, error: { code: "SEARCH_ERROR", message: err instanceof Error ? err.message : String(err) }, duration_ms: Date.now() - start } satisfies ApiResponse, 500);
    }
  });

  return app;
}
