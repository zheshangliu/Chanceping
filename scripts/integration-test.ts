/**
 * Task 017 - V0.7.5 端到端集成测试
 *
 * 来源：Task 017 第 4.2 节。
 *
 * 用一个完整的「AI 赛事雷达」示例跑通 5 阶段 15 步骤的完整数据流：
 *   阶段 1（需求确认）：
 *     ① ExtractedRequirementInfo → ② calculateConfidence → ③ generateConfirmationCard → ④ compileSpec
 *   阶段 2（雷达方案）：
 *     ⑤ generateRadarPlan → ⑥ validateRadarPlan → ⑦ exportRadarPlan
 *   阶段 3（机会卡片与雷达报告）：
 *     ⑧ createOpportunityCards → ⑨ generateRadarReport → ⑩ exportRadarReport → ⑪ appendToArchive
 *   阶段 4（机会库与 Star 收藏）：
 *     ⑫ LocalFileStore.addBatch → ⑬ StarManager.star
 *   阶段 5（截止提醒）：
 *     ⑭ generateReminders → ⑮ renderRemindersMarkdown
 *
 * 测试隔离：
 *   - 雷达报告写入 reports/test-integration/（测试后清理）
 *   - 雷达方案写入 exports/test-integration/（测试后清理）
 *   - 机会库写入 data/test-integration-store.json（测试后清理）
 *
 * 纯 Mock 数据，不调用真实 LLM。
 */

import fs from "fs";
import path from "path";

import type { ExtractedRequirementInfo } from "../src/schema/extracted-requirement-info";
import type { OpportunityCard } from "../src/schema/opportunity-card";
import { calculateConfidence } from "../src/agents/confidence-engine";
import { generateConfirmationCard } from "../src/agents/confirmation-card-generator";
import { compileSpec } from "../src/agents/spec-compiler";
import { generateRadarPlan } from "../src/agents/radar-plan-generator";
import { validateRadarPlan } from "../src/agents/radar-plan-validator";
import { exportRadarPlan } from "../src/agents/radar-plan-exporter";
import { createOpportunityCards } from "../src/agents/card-factory";
import { generateRadarReport } from "../src/agents/radar-report-generator";
import { exportRadarReport } from "../src/agents/radar-report-exporter";
import { appendToArchive, queryArchive } from "../src/agents/report-archive";
import { LocalFileStore, computeDedupKey } from "../src/agents/opportunity-store";
import { StarManager } from "../src/agents/star-manager";
import { generateReminders } from "../src/agents/reminder-engine";
import { renderRemindersMarkdown } from "../src/agents/reminder-renderer";
import { BRAND } from "../src/brand/constants";

// ============================================================
// 测试工具
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    const msg = detail !== undefined ? `${name} (detail: ${JSON.stringify(detail)})` : name;
    failures.push(msg);
    console.log(`  FAIL: ${name}${detail !== undefined ? ` | detail: ${JSON.stringify(detail)}` : ""}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

/** 获取当前 UTC 日期 (YYYY-MM-DD) */
function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

/** 计算相对今天 N 天的日期 (YYYY-MM-DD) */
function daysFromToday(days: number): string {
  const base = new Date(`${todayUtc()}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().split("T")[0];
}

// ============================================================
// 测试隔离：临时目录
// ============================================================

const TMP_REPORTS_DIR = path.resolve(process.cwd(), "reports/test-integration");
const TMP_EXPORTS_DIR = path.resolve(process.cwd(), "exports/test-integration");
const TMP_STORE_FILE = path.resolve(process.cwd(), "data/test-integration-store.json");

/** 清理临时文件（双重保险，应对 Windows 文件句柄占用 + 隐藏子目录） */
function cleanupTempFiles(): void {
  const targets = [TMP_REPORTS_DIR, TMP_EXPORTS_DIR, TMP_STORE_FILE];
  for (const target of targets) {
    try {
      if (!fs.existsSync(target)) continue;
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        // 第 1 重：尝试递归删除
        fs.rmSync(target, { recursive: true, force: true });
        // 第 2 重：若仍存在（Windows 文件句柄占用或隐藏子目录），递归清空再删
        if (fs.existsSync(target)) {
          clearDirectoryRecursive(target);
          try { fs.rmdirSync(target); } catch {}
        }
      } else {
        // 文件：第 1 重删除
        fs.rmSync(target, { force: true });
        // 第 2 重：若仍存在，写入空内容覆盖
        if (fs.existsSync(target)) {
          try { fs.writeFileSync(target, "", "utf-8"); } catch {}
        }
      }
    } catch {
      // 最终兜底：忽略
    }
  }
}

/** 递归清空目录内所有内容（含隐藏文件/子目录，如 .archive/） */
function clearDirectoryRecursive(dirPath: string): void {
  // readdirSync 默认不返回以 . 开头的文件/目录，需要特殊处理
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        // 递归清空子目录
        clearDirectoryRecursive(entryPath);
        try { fs.rmdirSync(entryPath); } catch {}
      } else {
        fs.rmSync(entryPath, { force: true });
        if (fs.existsSync(entryPath)) {
          try { fs.writeFileSync(entryPath, "", "utf-8"); } catch {}
        }
      }
    } catch {
      // 忽略单个文件清理失败
    }
  }
  // 额外检查隐藏目录（readdirSync 在某些 Windows 环境可能遗漏）
  const hiddenEntries = fs.readdirSync(dirPath);
  for (const name of hiddenEntries) {
    if (name.startsWith(".")) {
      const hiddenPath = path.join(dirPath, name);
      try {
        fs.rmSync(hiddenPath, { recursive: true, force: true });
      } catch {}
    }
  }
}

// ============================================================
// Mock 数据：高确认度 ExtractedRequirementInfo（≥95%）
// ============================================================

function buildHighConfidenceInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {
      client_type: "公司",
      industry: "人工智能",
      business_type: "AI 应用开发",
      core_capabilities: ["大模型应用", "AI Agent 开发", "RAG 系统"],
      products_or_projects: ["智能助手产品", "AI 客服系统"],
      company_stage: "成长期",
      regions: ["上海"],
      notes: "聚焦企业服务",
    },
    business_goal: {
      primary_goal: "通过参与 AI 赛事获取品牌曝光和融资机会",
      secondary_goals: ["寻找合作伙伴", "验证产品技术能力"],
      success_definition: "进入决赛或获得投资机构关注",
      priority_order: ["品牌曝光", "融资对接", "技术验证"],
    },
    opportunity_type: {
      primary_types: ["AI 创新大赛", "AI 黑客松"],
      secondary_types: ["AI 应用征集"],
      excluded_types: ["学术论文会议"],
      must_have_conditions: ["有奖金", "允许企业参赛"],
    },
    region_scope: {
      primary_regions: ["上海", "全国"],
      secondary_regions: ["杭州", "苏州"],
      excluded_regions: ["海外"],
      overseas_allowed: false,
      global_allowed: false,
    },
    exclusion_rules: {
      must_exclude: ["纯学术会议", "无奖金赛事", "海外赛事", "需现场参赛且无差旅支持"],
      low_priority_signals: ["报名费过高", "周期过长"],
      count: 4,
    },
    action_scenario: {
      action_intent: "报名比赛",
      priority_order: ["品牌曝光赛事", "融资对接赛事", "技术验证赛事"],
    },
    report_format: {
      frequency: "weekly",
      format: "markdown",
      must_include_sections: ["本周一句话判断", "本周 S 级机会", "即将截止机会"],
    },
  };
}

// ============================================================
// Mock 数据：5 条 OpportunityCard 输入
// S/A/B/C 各级别 + 1 条即将截止
// ============================================================

function buildCardInputs() {
  return [
    {
      // S 级 + 即将截止（3 天后 → urgent 组）
      title: "全国 AI 创新大赛 2026",
      type: "AI 创新大赛",
      organizer: "科技部",
      official_source_url: "https://example.com/ai-innovation-2026",
      deadline: daysFromToday(3),
      region: "全国",
      reward_or_value: "奖金 100 万元",
      eligibility: "企业 / 团队",
      match_reason: "高奖金 + 全国曝光，匹配公司品牌目标",
      next_action: "本周内完成报名并准备 Demo",
      backend_score: 92,
      visible_level: "S" as const,
    },
    {
      // A 级 + 远期（30 天后）
      title: "AI 黑客松华东赛",
      type: "AI 黑客松",
      organizer: "阿里云",
      official_source_url: "https://example.com/ai-hackathon-east",
      deadline: daysFromToday(30),
      region: "上海",
      reward_or_value: "奖金 30 万元 + 云资源",
      eligibility: "企业 / 团队",
      match_reason: "华东区域 + 云资源，匹配公司技术栈",
      next_action: "组建参赛团队，准备技术方案",
      backend_score: 85,
      visible_level: "A" as const,
    },
    {
      // B 级 + 远期（60 天后）
      title: "AI 应用征集大赛",
      type: "AI 应用征集",
      organizer: "工信部",
      official_source_url: "https://example.com/ai-app-contest",
      deadline: daysFromToday(60),
      region: "全国",
      reward_or_value: "政策扶持 + 行业曝光",
      eligibility: "企业",
      match_reason: "应用征集类，匹配公司产品方向",
      next_action: "整理产品案例，准备申报材料",
      backend_score: 72,
      visible_level: "B" as const,
    },
    {
      // C 级 + 远期（90 天后）
      title: "AI 创业计划书征集",
      type: "创业征集",
      organizer: "某投资机构",
      official_source_url: "https://example.com/ai-startup-plan",
      deadline: daysFromToday(90),
      region: "全国",
      reward_or_value: "投资机构对接机会",
      eligibility: "创业公司",
      match_reason: "融资对接机会，但与公司当前阶段部分匹配",
      next_action: "评估是否参与，准备计划书",
      backend_score: 55,
      visible_level: "C" as const,
    },
    {
      // 第二张 S 级 + 远期（45 天后）
      title: "全球 AI 顶会论文征集",
      type: "AI 论文比赛",
      organizer: "某学术组织",
      official_source_url: "https://example.com/global-ai-paper",
      deadline: daysFromToday(45),
      region: "全球",
      reward_or_value: "学术声誉",
      eligibility: "研究人员",
      match_reason: "全球赛事但偏学术，与公司业务匹配度较低",
      next_action: "暂不投入，关注后续赛事",
      backend_score: 95,
      visible_level: "S" as const,
    },
  ];
}

// ============================================================
// 主测试入口
// ============================================================

function main(): void {
  console.log("================================");
  console.log("Task 017 - V0.7.5 端到端集成测试");
  console.log("================================");

  // 清理上次残留
  cleanupTempFiles();

  const today = todayUtc();
  console.log(`基准日期（UTC）：${today}`);

  // ============================================================
  // 阶段 1：需求确认
  // ============================================================
  section("阶段 1：需求确认");

  // ① ExtractedRequirementInfo
  const info = buildHighConfidenceInfo();
  check("① ExtractedRequirementInfo 构造完成", info !== null && info.client_identity.client_type === "公司");
  check("① exclusion_rules.count=4（保证 exclusion_rules 维度满分）", info.exclusion_rules.count === 4);

  // ② calculateConfidence
  const confidence = calculateConfidence(info);
  check("② confidence.total ≥ 95", confidence.total >= 95, { total: confidence.total });
  check(
    "② confidence 7 维度都有 reason",
    confidence.client_identity.reason.length > 0 &&
      confidence.business_goal.reason.length > 0 &&
      confidence.opportunity_type.reason.length > 0 &&
      confidence.region_scope.reason.length > 0 &&
      confidence.exclusion_rules.reason.length > 0 &&
      confidence.action_scenario.reason.length > 0 &&
      confidence.report_format.reason.length > 0,
  );
  check("② confidence 7 维度都得分 ≥ 55",
    confidence.client_identity.score >= 55 &&
      confidence.business_goal.score >= 55 &&
      confidence.opportunity_type.score >= 55 &&
      confidence.region_scope.score >= 55 &&
      confidence.exclusion_rules.score >= 55 &&
      confidence.action_scenario.score >= 55 &&
      confidence.report_format.score >= 55,
  );

  // ③ generateConfirmationCard
  const cardResult = generateConfirmationCard(info, confidence);
  check("③ confirmation card success=true", cardResult.success === true, { error: cardResult.error });
  check("③ confirmation card version=V1.0", cardResult.version === "V1.0", { version: cardResult.version });
  check("③ confirmation card markdown 非空", typeof cardResult.markdown === "string" && cardResult.markdown!.length > 0);
  check("③ confirmation card markdown 含品牌名", cardResult.markdown?.includes(BRAND.product_name) ?? false);

  // ④ compileSpec
  const specResult = compileSpec({
    extracted_info: info,
    confidence,
    confirmation_status: "ready_for_radar_plan",
    radar_type: "ai_competition",
    confirmed_at: new Date().toISOString(),
  });
  check("④ spec compile success=true", specResult.success === true, { error: specResult.error });
  check("④ spec 非 null", specResult.spec !== null);
  if (specResult.spec) {
    const spec = specResult.spec;
    check("④ spec.product_name = BRAND.product_name", spec.product_name === BRAND.product_name);
    check("④ spec.client_profile.client_type 来自 info", spec.client_profile.client_type === "公司");
    check("④ spec.core_goals.primary_goal 来自 info", spec.core_goals.primary_goal.includes("AI 赛事"));
    check("④ spec.confirmation_status.status = ready_for_radar_plan", spec.confirmation_status.status === "ready_for_radar_plan");
    check("④ spec.requirement_confidence.total ≥ 95", spec.requirement_confidence.total >= 95);
    check("④ spec.keyword_strategy.core_keywords_zh 非空", spec.keyword_strategy.core_keywords_zh.length > 0);
    check("④ spec.core_goals.action_intent 含「报名比赛」", spec.core_goals.action_intent.includes("报名比赛"));
  }

  // ============================================================
  // 阶段 2：雷达方案生成与校验
  // ============================================================
  section("阶段 2：雷达方案生成与校验");

  const spec = specResult.spec!;

  // ⑤ generateRadarPlan
  const planResult = generateRadarPlan({
    spec,
    radar_type: "ai_competition",
    generated_at: new Date().toISOString(),
  });
  check("⑤ radar plan success=true", planResult.success === true, { error: planResult.error });
  check("⑤ radar plan markdown 非空", typeof planResult.markdown === "string" && planResult.markdown!.length > 0);
  check("⑤ radar plan sections_count=8", planResult.sections_count === 8, { count: planResult.sections_count });
  check("⑤ radar plan version=V1.0", planResult.version === "V1.0");
  check("⑤ radar plan markdown 含品牌名", planResult.markdown?.includes(BRAND.product_name) ?? false);
  check("⑤ radar plan markdown 含雷达名「AI 赛事雷达」", planResult.markdown?.includes("AI 赛事雷达") ?? false);

  // ⑥ validateRadarPlan
  const validationResult = validateRadarPlan({
    plan_result: planResult,
    spec,
  });
  check("⑥ validation valid=true", validationResult.valid === true, {
    critical_count: validationResult.summary.critical_count,
  });
  check("⑥ structure sections_complete", validationResult.structure.sections_complete === true);
  check("⑥ structure sections_count=8", validationResult.structure.sections_count === 8);
  check("⑥ brand_compliance has_product_name", validationResult.brand_compliance.has_product_name === true);
  check("⑥ brand_compliance has_version", validationResult.brand_compliance.has_version === true);
  check("⑥ brand_compliance has_radar_name", validationResult.brand_compliance.has_radar_name === true);
  check("⑥ validation report_markdown 非空", typeof validationResult.report_markdown === "string" && validationResult.report_markdown.length > 0);
  check("⑥ validation critical_count=0", validationResult.summary.critical_count === 0, { count: validationResult.summary.critical_count });

  // ⑦ exportRadarPlan
  const planExportResult = exportRadarPlan({
    plan_markdown: planResult.markdown!,
    validation_report_markdown: validationResult.report_markdown,
    output_dir: TMP_EXPORTS_DIR,
    radar_type: "ai_competition",
    generated_at: new Date().toISOString(),
  });
  check("⑦ export plan success=true", planExportResult.success === true, { error: planExportResult.error });
  check("⑦ export plan_file_path 非 null", planExportResult.plan_file_path !== null);
  check("⑦ export report_file_path 非 null", planExportResult.report_file_path !== null);
  check("⑦ plan 文件实际存在", planExportResult.plan_file_path !== null && fs.existsSync(planExportResult.plan_file_path));
  check("⑦ validation 报告文件实际存在", planExportResult.report_file_path !== null && fs.existsSync(planExportResult.report_file_path));

  // ============================================================
  // 阶段 3：机会卡片与雷达报告
  // ============================================================
  section("阶段 3：机会卡片与雷达报告");

  // ⑧ createOpportunityCards
  const cardInputs = buildCardInputs();
  const cards: OpportunityCard[] = createOpportunityCards(cardInputs);
  check("⑧ cards.length=5", cards.length === 5, { length: cards.length });
  const sCount = cards.filter((c) => c.visible_level === "S").length;
  const aCount = cards.filter((c) => c.visible_level === "A").length;
  const bCount = cards.filter((c) => c.visible_level === "B").length;
  const cCount = cards.filter((c) => c.visible_level === "C").length;
  check("⑧ S/A/B/C 各级数量正确（S=2, A=1, B=1, C=1）", sCount === 2 && aCount === 1 && bCount === 1 && cCount === 1, { s: sCount, a: aCount, b: bCount, c: cCount });
  check("⑧ 所有卡片有 official_source_url", cards.every((c) => c.official_source_url.startsWith("https://")));
  check("⑧ 所有卡片 status=new", cards.every((c) => c.status === "new"));
  check("⑧ 所有卡片有 deadline（YYYY-MM-DD）", cards.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.deadline)));

  // 即将截止的卡片：deadline 在 7 天内（含当天）
  const expiringSoon = cards.filter((c) => {
    const days = Math.floor((new Date(c.deadline + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / (24 * 60 * 60 * 1000));
    return days >= 0 && days <= 7;
  });
  check("⑧ 至少 1 条即将截止（≤7 天）", expiringSoon.length >= 1, { count: expiringSoon.length });

  // ⑨ generateRadarReport
  const periodStart = today;
  const periodEnd = daysFromToday(7);
  const reportResult = generateRadarReport({
    spec,
    opportunities: cards,
    radar_type: "ai_competition",
    period_start: periodStart,
    period_end: periodEnd,
    generated_at: new Date().toISOString(),
  });
  check("⑨ radar report success=true", reportResult.success === true, { error: reportResult.error });
  check("⑨ radar report markdown 非空", typeof reportResult.markdown === "string" && reportResult.markdown!.length > 0);
  check("⑨ radar report sections_count=9", reportResult.sections_count === 9);
  check("⑨ radar report version=V0.4", reportResult.version === "V0.4");
  check("⑨ radar report stats.total_opportunities=5", reportResult.stats.total_opportunities === 5, { total: reportResult.stats.total_opportunities });
  check("⑨ radar report stats.s_count=2", reportResult.stats.s_count === 2, { count: reportResult.stats.s_count });
  check("⑨ radar report stats.a_count=1", reportResult.stats.a_count === 1);
  check("⑨ radar report stats.expiring_soon_count ≥ 1", reportResult.stats.expiring_soon_count >= 1, { count: reportResult.stats.expiring_soon_count });
  check("⑨ radar report markdown 含品牌名", reportResult.markdown?.includes(BRAND.product_name) ?? false);
  check("⑨ radar report markdown 含「AI 赛事雷达」", reportResult.markdown?.includes("AI 赛事雷达") ?? false);

  // ⑩ exportRadarReport
  const reportExportResult = exportRadarReport({
    report_result: reportResult,
    radar_type: "ai_competition",
    period_start: periodStart,
    period_end: periodEnd,
    output_dir: TMP_REPORTS_DIR,
  });
  check("⑩ export report success=true", reportExportResult.success === true, { error: reportExportResult.error });
  check("⑩ export report_file_path 非 null", reportExportResult.report_file_path !== null);
  check("⑩ export archived=true", reportExportResult.archived === true);
  check("⑩ report 文件实际存在", reportExportResult.report_file_path !== null && fs.existsSync(reportExportResult.report_file_path));

  // ⑪ appendToArchive（额外追加一条归档以验证去重/覆盖）
  const archivePath = path.resolve(TMP_REPORTS_DIR, ".archive/index.json");
  const appendResult = appendToArchive({
    entry: {
      file_name: "radar-report-ai-competition-test-extra.md",
      file_path: "radar-report-ai-competition-test-extra.md",
      radar_type: "ai_competition",
      period_start: periodStart,
      period_end: periodEnd,
      generated_at: new Date().toISOString(),
      stats: reportResult.stats,
      version: "V0.4",
    },
    archive_path: archivePath,
  });
  check("⑪ archive append success=true", appendResult.success === true);
  check("⑪ archive entries_count ≥ 1", appendResult.entries_count >= 1, { count: appendResult.entries_count });
  // 查询归档
  const queried = queryArchive({ archive_path: archivePath, radar_type: "ai_competition" });
  check("⑪ archive query 返回 ≥ 1 条", queried.length >= 1, { count: queried.length });

  // ============================================================
  // 阶段 4：机会库与 Star 收藏
  // ============================================================
  section("阶段 4：机会库与 Star 收藏");

  // ⑫ LocalFileStore.addBatch
  const store = new LocalFileStore({
    file_path: "data/test-integration-store.json",
    auto_flush: true,
  });
  const addedEntries = store.addBatch(cards, "ai_competition");
  check("⑫ store addBatch 返回 5 条", addedEntries.length === 5, { length: addedEntries.length });
  const storeStats = store.stats();
  check("⑫ store stats.total=5", storeStats.total === 5, { total: storeStats.total });
  check("⑫ store stats.by_radar_type.ai_competition=5", storeStats.by_radar_type.ai_competition === 5);
  check("⑫ store 文件实际存在", fs.existsSync(TMP_STORE_FILE));
  // 验证 dedup_key 计算
  const firstCard = cards[0];
  const expectedKey = computeDedupKey(firstCard.title, firstCard.official_source_url);
  check("⑫ store 第一条 dedup_key 正确", addedEntries[0].dedup_key === expectedKey);
  // 验证 store.list 查询
  const listResult = store.list({ radar_type: "ai_competition", page_size: 100 });
  check("⑫ store.list 返回 5 条", listResult.total === 5, { total: listResult.total });

  // ⑬ StarManager.star
  const starManager = new StarManager(store);
  const targetKey = addedEntries[0].dedup_key; // 第一张是 S 级即将截止的卡片
  const starResult = starManager.star(targetKey);
  check("⑬ star success=true", starResult.success === true, { error: starResult.error });
  check("⑬ star 后 entry.card.status=saved", starResult.entry?.card.status === "saved");
  // 验证幂等
  const starAgain = starManager.star(targetKey);
  check("⑬ star 幂等：再次 star 也 success=true", starAgain.success === true);
  // 验证已收藏列表
  const starred = starManager.getStarred();
  check("⑬ getStarred 长度=1", starred.length === 1, { count: starred.length });
  // 验证 isStarred
  check("⑬ isStarred=true", starManager.isStarred(targetKey) === true);
  // 验证 starStats
  const starStats = starManager.starStats();
  check("⑬ starStats.total=1", starStats.total === 1, { total: starStats.total });
  check("⑬ starStats.by_radar_type.ai_competition=1", starStats.by_radar_type.ai_competition === 1);
  // 验证 store 中卡片状态确实更新为 saved
  const updatedEntry = store.get(targetKey);
  check("⑬ store.get 返回的 card.status=saved", updatedEntry?.card.status === "saved");

  // ============================================================
  // 阶段 5：截止提醒
  // ============================================================
  section("阶段 5：截止提醒");

  // 取所有 store 条目（注意：被 starred 的卡片 status=saved，仍可参与提醒）
  const allEntries = store.list({ page_size: 10000 }).entries;
  check("store 中有 5 条条目", allEntries.length === 5, { count: allEntries.length });

  // ⑭ generateReminders
  const reminders = generateReminders(allEntries, { base_date: today });
  // 第一张卡片 deadline 在 3 天后 → urgent
  check("⑭ reminders.summary.urgent_count ≥ 1", reminders.summary.urgent_count >= 1, { count: reminders.summary.urgent_count });
  check("⑭ reminders.summary.total ≥ 1", reminders.summary.total >= 1, { total: reminders.summary.total });
  check("⑭ reminders.base_date = today", reminders.base_date === today);
  // 第一张卡片（被 starred）的标题应出现在 urgent 组
  const urgentTitles = reminders.urgent.map((r) => r.title);
  check("⑭ urgent 组含「全国 AI 创新大赛 2026」", urgentTitles.includes("全国 AI 创新大赛 2026"), { titles: urgentTitles });
  // urgent 组按 days 升序
  const urgentDays = reminders.urgent.map((r) => r.days_until_deadline);
  const isAsc = urgentDays.every((d, i) => i === 0 || urgentDays[i - 1] <= d);
  check("⑭ urgent 组按 days 升序", isAsc, { days: urgentDays });
  // reminders.summary.total = urgent+soon+warning+expired
  const sumTotal = reminders.summary.urgent_count + reminders.summary.soon_count + reminders.summary.warning_count + reminders.summary.expired_count;
  check("⑭ summary.total = urgent+soon+warning+expired", reminders.summary.total === sumTotal, { total: reminders.summary.total, sum: sumTotal });
  // archived/dismissed 不进任何提醒组（本次测试无 archived/dismissed）
  check("⑭ no_reminder_count ≥ 0", reminders.summary.no_reminder_count >= 0);

  // ⑮ renderRemindersMarkdown
  const md = renderRemindersMarkdown(reminders);
  check("⑮ markdown 非空", typeof md === "string" && md.length > 0);
  check("⑮ markdown 含品牌名", md.includes(BRAND.product_name));
  check("⑮ markdown 含「截止提醒」", md.includes("截止提醒"));
  check("⑮ markdown 含「紧急提醒」", md.includes("紧急提醒"));
  check("⑮ markdown 含「全国 AI 创新大赛 2026」", md.includes("全国 AI 创新大赛 2026"));
  check("⑮ markdown 含建议行动文案「立即处理」", md.includes("立即处理"));

  // ============================================================
  // 测试隔离：清理临时文件
  // ============================================================
  section("测试隔离：清理临时文件");
  cleanupTempFiles();
  check("临时目录 reports/test-integration 已清理", !fs.existsSync(TMP_REPORTS_DIR));
  check("临时目录 exports/test-integration 已清理", !fs.existsSync(TMP_EXPORTS_DIR));
  check("临时文件 data/test-integration-store.json 已清理", !fs.existsSync(TMP_STORE_FILE));

  // ============================================================
  // 汇总
  // ============================================================
  console.log("");
  console.log("================================");
  console.log(`PASS: ${passCount} / FAIL: ${failCount}`);
  console.log("================================");
  if (failCount > 0) {
    console.log("");
    console.log("失败项：");
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
  } else {
    console.log("");
    console.log("全部 5 阶段 15 步骤端到端集成测试通过。");
  }
}

main();
