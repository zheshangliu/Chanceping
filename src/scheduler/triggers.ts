/**
 * 触发器（Triggers）- 搜索/提醒/报告
 *
 * 来源：Task 028 第 5.5 节。
 *
 * 三种触发器：
 *   - search: 调用 SearchOrchestrator.search()
 *   - reminder: 调用 generateReminders()
 *   - report: 调用 generateRadarReport()
 *
 * 直接调用现有纯函数/类，不依赖 ctx.orchestrator/reminderEngine/reportGenerator
 * （AppContext 中不存在这些字段，按 search/reports 路由的既定模式创建实例）。
 */

import type { JobType } from "./types";
import type { AppContext } from "../api/context";
import { SearchOrchestrator } from "../search/orchestrator";
import { generateReminders } from "../agents/reminder-engine";
import { generateRadarReport } from "../agents/radar-report-generator";
import type { RadarReportInput } from "../agents/radar-report-generator";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import type { RadarSchedule } from "../schema/radar";
import { notifyReminders } from "../notify/notify-sender";
import type { NotifyChannel } from "../notify/channel-adapter";
import { getDataMode } from "../demo/data-mode";
import { computeNextRunAt } from "../api/routes/radars";
import type { RadarType } from "../agents/opportunity-store";

/**
 * 执行触发器。
 *
 * @param type 任务类型
 * @param params 任务参数
 * @param ctx 应用上下文
 * @returns 执行结果（结构化 JSON）
 */
export async function executeTrigger(
  type: JobType,
  params: Record<string, unknown>,
  ctx: AppContext,
): Promise<Record<string, unknown>> {
  switch (type) {
    case "search":
      return executeSearchTrigger(params, ctx);
    case "reminder":
      return executeReminderTrigger(params, ctx);
    case "report":
      return executeReportTrigger(params, ctx);
    default:
      throw new Error(`未知任务类型: ${type}`);
  }
}

/**
 * 搜索触发器：调用 SearchOrchestrator。
 *
 * params（V1.5-06 扩展）：
 *   - radar_id: 雷达 ID（优先，从 RadarStore 取 spec + 生成 RadarRun + 绑定 radarId）
 *   - radar_type: 雷达类型（radar_id 不存在时 fallback，默认 ai_competition）
 *   - max_results: 每个 provider 最大结果数（默认 20）
 */
async function executeSearchTrigger(
  params: Record<string, unknown>,
  ctx: AppContext,
): Promise<Record<string, unknown>> {
  const maxResults = (params.max_results as number) ?? 20;
  const radarId = params.radar_id as string | undefined;

  // V1.5-06：radar_id 优先路径
  if (radarId && ctx.radarStore) {
    const radar = ctx.radarStore.get(radarId);
    if (radar) {
      return executeScheduledRadarSearch(radar, maxResults, ctx);
    }
    // radar_id 不存在 → fallback 到旧逻辑
  }

  // 旧逻辑：radar_type + createSimpleSpec（完全不变）
  const radarType = (params.radar_type as string) ?? "ai_competition";
  const spec = createSimpleSpec(radarType);
  const orchestrator = new SearchOrchestrator({
    llmAdapter: ctx.llmAdapter,
    maxResultsPerProvider: maxResults,
    enableContentFetch: false, // 调度任务默认不抓正文，提升速度
    mockContent: true,
    dataMode: getDataMode(),
  });
  const result = await orchestrator.search(spec);

  return {
    radar_type: radarType,
    total_raw: result.total_raw,
    total_rule_passed: result.total_rule_passed,
    total_ai_passed: result.total_ai_passed,
    total_scored: result.total_scored,
    opportunities_count: result.opportunities.length,
    duration_ms: result.duration_ms,
    errors: result.errors,
  };
}

/**
 * V1.5-06：执行定时雷达搜索（radar_id 优先路径）。
 *
 * 流程：
 *   1. 创建 RadarRun（mode=scheduled, triggeredBy=scheduler）
 *   2. 更新 Radar.currentRunId
 *   3. SearchOrchestrator 执行搜索
 *   4. 结果存入 OpportunityStore，绑定 radarId
 *   5. 更新 RadarRun（status=succeeded, finishedAt, totalRaw, totalScored, opportunityKeys）
 *   6. 更新 Radar（currentRunId=undefined, lastRunStatus, lastRunAt, schedule.lastRunAt, schedule.nextRunAt）
 *   7. 返回结构化结果（含 radar_id / run_id）
 *
 * @param radar 雷达实体
 * @param maxResults 每个 provider 最大结果数
 * @param ctx 应用上下文
 * @returns 执行结果
 */
async function executeScheduledRadarSearch(
  radar: { id: string; name: string; kind: string; spec: RadarRequirementSpec; schedule?: RadarSchedule },
  maxResults: number,
  ctx: AppContext,
): Promise<Record<string, unknown>> {
  const spec = radar.spec;
  const run = ctx.radarRunStore.create({
    radarId: radar.id,
    mode: "scheduled",
    triggeredBy: "scheduler",
  });
  ctx.radarStore.update(radar.id, { currentRunId: run.id });

  try {
    const orchestrator = new SearchOrchestrator({
      llmAdapter: ctx.llmAdapter,
      maxResultsPerProvider: maxResults,
      enableContentFetch: false,
      mockContent: true,
      dataMode: getDataMode(),
    });
    const result = await orchestrator.search(spec);

    // 结果存入 OpportunityStore，绑定 radarId
    const radarType = kindToRadarType(radar.kind);
    const opportunityKeys: string[] = [];
    if (result.opportunityCards && result.opportunityCards.length > 0) {
      const entries = ctx.store.addBatch(result.opportunityCards, radarType, radar.id);
      for (const entry of entries) opportunityKeys.push(entry.dedup_key);
    }

    const now = new Date().toISOString();
    ctx.radarRunStore.update(run.id, {
      status: "succeeded",
      finishedAt: now,
      totalRaw: result.total_raw,
      totalScored: result.total_scored,
      opportunityKeys,
      sourceCandidateCount: result.sourceCandidates?.length,
    });
    ctx.radarRunStore.save();

    // 更新 Radar：currentRunId 清空 + lastRunStatus + lastRunAt + schedule 更新
    const schedulePatch: {
      currentRunId: undefined;
      lastRunStatus: "succeeded";
      lastRunAt: string;
      schedule?: RadarSchedule;
    } = {
      currentRunId: undefined,
      lastRunStatus: "succeeded",
      lastRunAt: now,
    };
    if (radar.schedule && radar.schedule.enabled) {
      schedulePatch.schedule = {
        ...radar.schedule,
        lastRunAt: now,
        nextRunAt: computeNextRunAt(radar.schedule.cron, radar.schedule.timezone, new Date(now)),
      };
    }
    ctx.radarStore.update(radar.id, schedulePatch);
    ctx.radarStore.save();

    return {
      radar_id: radar.id,
      radar_name: radar.name,
      run_id: run.id,
      total_raw: result.total_raw,
      total_rule_passed: result.total_rule_passed,
      total_ai_passed: result.total_ai_passed,
      total_scored: result.total_scored,
      opportunities_count: result.opportunities.length,
      duration_ms: result.duration_ms,
      errors: result.errors,
    };
  } catch (err) {
    const now = new Date().toISOString();
    ctx.radarRunStore.update(run.id, {
      status: "failed",
      finishedAt: now,
      error: err instanceof Error ? err.message : String(err),
    });
    ctx.radarRunStore.save();
    ctx.radarStore.update(radar.id, {
      currentRunId: undefined,
      lastRunStatus: "failed",
      lastRunAt: now,
    });
    ctx.radarStore.save();
    throw err;
  }
}

/** 从 RadarKind 推断 RadarType（custom 默认 ai_competition，同 radars.ts 的 kindToRadarType） */
function kindToRadarType(kind: string): RadarType {
  if (kind === "ai_competition" || kind === "opc_policy" || kind === "cultural_heritage") {
    return kind;
  }
  return "ai_competition";
}

/**
 * 提醒触发器：调用 generateReminders。
 *
 * params:
 *   - levels: 提醒级别筛选（默认全部）
 */
async function executeReminderTrigger(
  params: Record<string, unknown>,
  ctx: AppContext,
): Promise<Record<string, unknown>> {
  const allEntries = ctx.store.list({ page: 1, page_size: 10000 }).entries;
  const result = generateReminders(allEntries);

  const levels = params.levels as string[] | undefined;
  let totalReminders = result.summary.total;
  if (levels && levels.length > 0) {
    totalReminders = 0;
    if (levels.includes("urgent")) totalReminders += result.urgent.length;
    if (levels.includes("soon")) totalReminders += result.soon.length;
    if (levels.includes("warning")) totalReminders += result.warning.length;
    if (levels.includes("expired")) totalReminders += result.expired.length;
  }

  // 发送提醒到多渠道（Mock 模式不真实发送）
  const notifyChannels = (params.notify_channels as string[]) ?? ["wechat"];
  const notifyResults = await notifyReminders(
    result,
    notifyChannels as NotifyChannel[],
  );

  return {
    total_reminders: totalReminders,
    urgent: result.urgent.length,
    soon: result.soon.length,
    warning: result.warning.length,
    expired: result.expired.length,
    no_reminder: result.no_reminder.length,
    base_date: result.base_date,
    notify_channels: notifyChannels,
    notify_results: notifyResults,
  };
}

/**
 * 报告触发器：调用 generateRadarReport。
 *
 * params:
 *   - report_type: 报告类型（默认 weekly）
 *   - max_items: 最大条目数
 *   - radar_type: 雷达类型（默认 ai_competition）
 */
async function executeReportTrigger(
  params: Record<string, unknown>,
  ctx: AppContext,
): Promise<Record<string, unknown>> {
  const reportType = (params.report_type as string) ?? "weekly";
  const radarType = (params.radar_type as string) ?? "ai_competition";

  const allEntries = ctx.store.list({ page: 1, page_size: 10000 }).entries;
  const opportunities = allEntries.map((e) => e.card);
  const spec = createSimpleSpec(radarType);

  const today = new Date();
  const periodEnd = today.toISOString().split("T")[0];
  const periodStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const input: RadarReportInput = {
    spec,
    opportunities,
    radar_type: radarType as "ai_competition" | "opc_policy" | "cultural_heritage",
    period_start: periodStart,
    period_end: periodEnd,
  };
  const report = generateRadarReport(input);

  return {
    report_type: reportType,
    success: report.success,
    markdown_length: report.markdown?.length ?? 0,
    sections_count: report.sections_count,
    stats: report.stats,
    error: report.error,
    generated_at: report.generated_at,
  };
}

/**
 * 创建简易 spec（参考 reports.ts / search.ts 的 createDefaultSpec）。
 *
 * @param radarType 雷达类型
 */
function createSimpleSpec(radarType: string): RadarRequirementSpec {
  const primaryOpportunityTypes =
    radarType === "opc_policy"
      ? ["政策补贴"]
      : radarType === "cultural_heritage"
        ? ["文创非遗"]
        : ["AI 比赛"];

  const coreKeywordsZh =
    radarType === "opc_policy"
      ? ["政策", "补贴"]
      : radarType === "cultural_heritage"
        ? ["文创", "非遗"]
        : ["AI", "比赛"];

  return {
    product_name: "ChancePing",
    product_category: "机会雷达",
    client_profile: {
      client_name: "调度器客户",
      client_type: "团队",
      industry: "AI",
      business_type: "AI 应用",
      company_stage: "初创",
      products_or_projects: ["AI 应用"],
      target_users: ["用户"],
      core_capabilities: ["AI"],
      current_assets: [],
      regions: ["全国"],
      notes: "",
    },
    core_goals: {
      primary_goal: "找机会",
      secondary_goals: [],
      success_definition: "获得收益",
      action_intent: ["报名比赛"],
      priority_order: ["价值"],
    },
    opportunity_scope: {
      primary_opportunity_types: primaryOpportunityTypes,
      secondary_opportunity_types: [],
      excluded_opportunity_types: [],
      must_have_conditions: [],
      nice_to_have_conditions: [],
    },
    region_scope: {
      primary_regions: ["全国"],
      secondary_regions: [],
      excluded_regions: [],
      global_allowed: false,
      overseas_allowed: false,
    },
    keyword_strategy: {
      core_keywords_zh: coreKeywordsZh,
      core_keywords_en: ["AI", "competition"],
      expanded_keywords_zh: [],
      expanded_keywords_en: [],
      negative_keywords: [],
    },
    filter_rules: {
      must_include: [],
      must_exclude: [],
      low_priority_signals: [],
      high_priority_signals: [],
      requires_manual_review: [],
    },
    scoring_rules: {
      backend_score_enabled: true,
      visible_level_enabled: true,
      weights: {
        match_score: 30,
        business_value: 25,
        timeliness: 20,
        credibility: 15,
        actionability: 10,
        risk_penalty: -20,
      },
      visible_level_mapping: {
        S: "85-100",
        A: "70-84",
        B: "55-69",
        C: "40-54",
        hidden: "<40",
      },
      level_definitions: {
        S: "强烈推荐",
        A: "高价值",
        B: "可关注",
        C: "低优先级",
        hidden: "不展示",
      },
    },
    report_requirements: {
      report_format: "markdown",
      report_title_prefix: "本周",
      report_frequency: "weekly",
      max_items_per_report: 10,
      min_items_per_report: 5,
      must_include_sections: [],
      opportunity_card_required_fields: [],
      link_required: true,
      contact_required_if_available: true,
      deadline_required_if_available: true,
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
      status: "confirmed",
      user_confirmed: true,
      confirmed_at: "2026-06-01",
      last_user_feedback: "",
      revision_count: 0,
    },
  };
}
