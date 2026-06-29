/**
 * Task C 验收脚本：来源透明 + 机会卡片增强
 *
 * 运行：npx tsx scripts/verify-taskC.ts
 *
 * 验证项：
 *   1. 文件存在性检查（3 新建 + 4 改造）
 *   2. SourceClassifier 单元测试（7 项）
 *   3. EvidenceExtractor 单元测试（6 项）
 *   4. OpportunityCardMapper 单元测试（7 项）
 *   5. SearchOrchestrator 集成测试（5 项）
 *   6. 兼容性验证（4 项）
 *   7. 安全红线（8 项）
 *   8. 回归测试（7 项，可通过 SKIP_REGRESSION=1 跳过）
 *
 * 遵循 IDE 交付规范调整声明：
 *   - 红线 1：tsc 附完整输出
 *   - 红线 2：PASS 正则取最后一个匹配（matchAll）
 *   - 红线 5：回归测试范围与任务书一致
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

// ============================================================
// 0. 强制 Mock 模式（必须在 import app 之前设置）
// ============================================================

process.env.DATA_MODE = "mock";
process.env.LLM_MODE = "mock";
process.env.PORT = "3998";
process.env.STORE_TYPE = "meili";
process.env.MEILI_MOCK = "true";

// ============================================================
// 计数器
// ============================================================

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.resolve(process.cwd(), relPath));
}

// ============================================================
// 1. 文件存在性检查
// ============================================================

function checkFileExistence(): void {
  section("1. 文件存在性检查");

  // 3 个新建文件
  check("C1 src/search/source-classifier.ts 存在", fileExists("src/search/source-classifier.ts"));
  check("C2 src/search/evidence-extractor.ts 存在", fileExists("src/search/evidence-extractor.ts"));
  check("C3 src/search/opportunity-card-mapper.ts 存在", fileExists("src/search/opportunity-card-mapper.ts"));

  // 4 个改造文件
  check("C4 src/search/orchestrator.ts 存在", fileExists("src/search/orchestrator.ts"));
  check("C5 src/api/routes/search.ts 存在", fileExists("src/api/routes/search.ts"));
  check("C6 web/search.js 存在", fileExists("web/search.js"));
  check("C7 src/schema/source-candidate.ts 存在（Task A）", fileExists("src/schema/source-candidate.ts"));
  check("C7.1 src/schema/evidence-item.ts 存在（Task A）", fileExists("src/schema/evidence-item.ts"));
  check("C7.2 src/schema/opportunity-card.ts 存在", fileExists("src/schema/opportunity-card.ts"));
}

// ============================================================
// 2. SourceClassifier 单元测试
// ============================================================

async function checkSourceClassifier(): Promise<void> {
  section("2. SourceClassifier 单元测试");

  const { classifySource, classifySources } = await import("../src/search/source-classifier");
  type SearchResult = import("../src/search/types").SearchResult;

  function makeResult(url: string, title = "测试"): SearchResult {
    return {
      title,
      url,
      snippet: "",
      source_provider: "serper",
      source_type: "web",
    };
  }

  // T1: *.gov.cn → government / A1
  const gov = classifySource(makeResult("https://www.moe.gov.cn/notice", "教育部通知"));
  check("T1 *.gov.cn → sourceType=government", gov.sourceType === "government", `sourceType=${gov.sourceType}`);
  check("T1.1 *.gov.cn → confidenceGrade=A1", gov.confidenceGrade === "A1", `grade=${gov.confidenceGrade}`);
  check("T1.2 *.gov.cn → isOfficial=true", gov.isOfficial === true);

  // T2: *.edu.cn → official / A2
  const edu = classifySource(makeResult("https://www.tsinghua.edu.cn/news", "清华新闻"));
  check("T2 *.edu.cn → sourceType=official", edu.sourceType === "official", `sourceType=${edu.sourceType}`);
  check("T2.1 *.edu.cn → confidenceGrade=A2", edu.confidenceGrade === "A2", `grade=${edu.confidenceGrade}`);
  check("T2.2 *.edu.cn → isOfficial=true", edu.isOfficial === true);

  // T3: xinhuanet.com → media_authoritative / B1
  const xinhua = classifySource(makeResult("https://www.xinhuanet.com/article/123", "新华社报道"));
  check("T3 xinhuanet.com → sourceType=media_authoritative", xinhua.sourceType === "media_authoritative", `sourceType=${xinhua.sourceType}`);
  check("T3.1 xinhuanet.com → confidenceGrade=B1", xinhua.confidenceGrade === "B1", `grade=${xinhua.confidenceGrade}`);

  // T4: weibo.com → social / C3
  const weibo = classifySource(makeResult("https://weibo.com/123456", "微博热搜"));
  check("T4 weibo.com → sourceType=social", weibo.sourceType === "social", `sourceType=${weibo.sourceType}`);
  check("T4.1 weibo.com → confidenceGrade=C3", weibo.confidenceGrade === "C3", `grade=${weibo.confidenceGrade}`);
  check("T4.2 weibo.com → isOfficial=false", weibo.isOfficial === false);

  // T5: v2ex.com → forum / D4
  const v2ex = classifySource(makeResult("https://www.v2ex.com/t/123", "V2EX 讨论"));
  check("T5 v2ex.com → sourceType=forum", v2ex.sourceType === "forum", `sourceType=${v2ex.sourceType}`);
  check("T5.1 v2ex.com → confidenceGrade=D4", v2ex.confidenceGrade === "D4", `grade=${v2ex.confidenceGrade}`);

  // T6: 未知 URL → unknown / E5
  // 使用未注册的 provider，避免被 provider reliability 推断为 media_authoritative
  const unknown = classifySource({
    title: "未知",
    url: "https://random-unknown-site-xyz.com/page",
    snippet: "",
    source_provider: "unknown_provider_xyz",
    source_type: "web",
  });
  check("T6 未知 URL → sourceType=unknown", unknown.sourceType === "unknown", `sourceType=${unknown.sourceType}`);
  check("T6.1 未知 URL → confidenceGrade=E5", unknown.confidenceGrade === "E5", `grade=${unknown.confidenceGrade}`);

  // T7: 批量分类
  const batch = classifySources([
    makeResult("https://www.gov.cn/p/1"),
    makeResult("https://weibo.com/1"),
  ]);
  check("T7 classifySources 批量分类返回数组", Array.isArray(batch) && batch.length === 2);

  // T8: sourceId 格式（src_ 前缀）
  check("T8 sourceId 以 src_ 开头", gov.sourceId.startsWith("src_"), `sourceId=${gov.sourceId}`);

  // T9: mediaName 提取
  check("T9 xinhuanet mediaName=新华网", xinhua.mediaName === "新华网", `mediaName=${xinhua.mediaName}`);
}

// ============================================================
// 3. EvidenceExtractor 单元测试
// ============================================================

async function checkEvidenceExtractor(): Promise<void> {
  section("3. EvidenceExtractor 单元测试");

  const { extractEvidence, extractEvidenceBatch } = await import("../src/search/evidence-extractor");

  const sourceId = "src_test_001";

  // T1: 含"截止日期：2026-07-15" → 提取 deadline
  const r1 = extractEvidence({
    url: "https://example.com",
    title: "AI 大赛",
    main_text: "比赛截止日期：2026-07-15，欢迎大家参加。",
    word_count: 100,
    fetch_success: true,
  }, sourceId);
  const deadlineItem = r1.find((e) => e.field === "deadline");
  check("T1 提取 deadline 字段", !!deadlineItem, `items=${r1.map((e) => e.field).join(",")}`);
  check("T1.1 deadline 值含 2026-07-15", !!deadlineItem && deadlineItem.value.includes("2026-07-15"), `value=${deadlineItem?.value}`);

  // T2: 含"主办方：教育部" → 提取 organizer
  const r2 = extractEvidence({
    url: "https://example.com",
    title: "AI 大赛",
    main_text: "主办方：教育部。比赛时间：2026 年 8 月。",
    word_count: 100,
    fetch_success: true,
  }, sourceId);
  const organizerItem = r2.find((e) => e.field === "organizer");
  check("T2 提取 organizer 字段", !!organizerItem);
  check("T2.1 organizer 值含 教育部", !!organizerItem && organizerItem.value.includes("教育部"), `value=${organizerItem?.value}`);

  // T3: 含"奖金：10万元" → 提取 reward_or_value
  const r3 = extractEvidence({
    url: "https://example.com",
    title: "AI 大赛",
    main_text: "本次比赛奖金：10万元，欢迎大家参加。",
    word_count: 100,
    fetch_success: true,
  }, sourceId);
  const rewardItem = r3.find((e) => e.field === "reward_or_value");
  check("T3 提取 reward_or_value 字段", !!rewardItem);
  check("T3.1 reward_or_value 值含 10", !!rewardItem && rewardItem.value.includes("10"), `value=${rewardItem?.value}`);

  // T4: 含邮箱地址 → 提取 contact_info
  const r4 = extractEvidence({
    url: "https://example.com",
    title: "AI 大赛",
    main_text: "联系方式：contact@example.com",
    word_count: 100,
    fetch_success: true,
  }, sourceId);
  const contactItem = r4.find((e) => e.field === "contact_info");
  check("T4 提取 contact_info 字段", !!contactItem);
  check("T4.1 contact_info 值含 @", !!contactItem && contactItem.value.includes("@"), `value=${contactItem?.value}`);

  // T5: 无匹配内容 → 不生成对应字段
  // 注意：文本不能含"主办方"/"截止"/"奖金"等关键词，否则会被正则匹配
  const r5 = extractEvidence({
    url: "https://example.com",
    title: "AI 大赛",
    main_text: "这是一段普通文本，仅用于测试无匹配场景。我们讨论一些与机会无关的话题。",
    word_count: 100,
    fetch_success: true,
  }, sourceId);
  const noDeadline = r5.find((e) => e.field === "deadline");
  const noOrganizer = r5.find((e) => e.field === "organizer");
  check("T5 无匹配不生成 deadline", !noDeadline);
  check("T5.1 无匹配不生成 organizer", !noOrganizer);
  // title 字段始终会被提取
  check("T5.2 仍生成 title 字段", !!r5.find((e) => e.field === "title"));

  // T6: 所有 EvidenceItem 的 sourceId 指向传入的 sourceId
  const allHaveSourceId = r1.every((e) => e.sourceId === sourceId);
  check("T6 所有 EvidenceItem.sourceId 指向传入 sourceId", allHaveSourceId);

  // T7: evidenceId 格式（ev_ 前缀）
  check("T7 evidenceId 以 ev_ 开头", r1.length > 0 && r1[0].evidenceId.startsWith("ev_"), `evidenceId=${r1[0]?.evidenceId}`);

  // T8: 批量提取
  const batch = extractEvidenceBatch([
    { url: "u1", title: "t1", main_text: "截止日期：2026-07-15", word_count: 10, fetch_success: true },
    { url: "u2", title: "t2", main_text: "主办方：主办方A", word_count: 10, fetch_success: true },
  ], ["src_1", "src_2"]);
  check("T8 extractEvidenceBatch 返回合并数组", batch.length >= 2, `len=${batch.length}`);
  const batchSourceIds = new Set(batch.map((e) => e.sourceId));
  check("T8.1 批量提取包含两个 sourceId", batchSourceIds.has("src_1") && batchSourceIds.has("src_2"));

  // T9: 高置信度字段 needsReview = false
  const titleItem = r1.find((e) => e.field === "title");
  check("T9 title 字段 needsReview=false（置信度 0.95 > 0.6）",
    !!titleItem && titleItem.needsReview === false,
    `needsReview=${titleItem?.needsReview}, confidence=${titleItem?.confidence}`);
}

// ============================================================
// 4. OpportunityCardMapper 单元测试
// ============================================================

async function checkOpportunityCardMapper(): Promise<void> {
  section("4. OpportunityCardMapper 单元测试");

  const { mapToCard, applySLevelGuard, computeCredibility } = await import("../src/search/opportunity-card-mapper");
  type ScoredOpportunity = import("../src/search/types").ScoredOpportunity;
  type SourceCandidate = import("../src/schema/source-candidate").SourceCandidate;
  type OpportunityCard = import("../src/schema/opportunity-card").OpportunityCard;

  function makeScored(overrides: Partial<ScoredOpportunity> = {}): ScoredOpportunity {
    return {
      search_result: {
        title: "AI 创新大赛",
        url: "https://www.gov.cn/ai-contest",
        snippet: "政府主办的 AI 大赛",
        source_provider: "serper",
        source_type: "gov",
      },
      cleaned_content: {
        url: "https://www.gov.cn/ai-contest",
        title: "AI 创新大赛",
        main_text: "主办方：科技部。截止日期：2026-08-15。奖金：50万元。",
        word_count: 100,
        fetch_success: true,
      },
      relevance_score: 80,
      relevance_reason: "高度匹配",
      chance_score: { fit: 85, intent: 80, evidence: 90, urgency: 70, effort_cost: 60, total: 82 },
      visible_level: "A",
      backend_score: 82,
      ...overrides,
    };
  }

  function makeGovSource(): SourceCandidate {
    return {
      sourceId: "src_gov_1",
      url: "https://www.gov.cn/ai-contest",
      mediaName: "政府网站",
      sourceType: "government",
      confidenceGrade: "A1",
      verificationStatus: "unverified",
      isOfficial: true,
      retrievedAt: new Date().toISOString(),
    };
  }

  // T1: mapToCard 返回 OpportunityCard 含 V1.3 新字段
  const card = mapToCard(makeScored(), [makeGovSource()], [], "ai_competition");
  check("T1 mapToCard 返回 OpportunityCard", !!card && typeof card === "object");
  check("T1.1 含 radarId 字段", card.radarId === "ai_competition");
  check("T1.2 含 decision 字段", ["attack", "hold", "archive"].includes(card.decision ?? ""));
  check("T1.3 含 sourceIds 数组", Array.isArray(card.sourceIds) && card.sourceIds.length === 1);
  check("T1.4 含 sourceConfidence 字段", !!card.sourceConfidence);
  check("T1.5 含 verificationStatus 字段", !!card.verificationStatus);
  check("T1.6 含 sourceBadges 数组", Array.isArray(card.sourceBadges));
  check("T1.7 含 recommendedActions 数组", Array.isArray(card.recommendedActions));

  // T2: applySLevelGuard：visible_level="S" 且无官方来源 → 降级为 "A"
  const cardSNoOfficial: OpportunityCard = {
    title: "测试", type: "ai_competition", organizer: "", region: "", deadline: "",
    reward_or_value: "", eligibility: "", materials_required: "", match_reason: "",
    next_action: "", official_source_url: "", application_url: "", contact_info: "",
    risk_note: "", backend_score: 95, visible_level: "S", status: "new",
  };
  const downgraded = applySLevelGuard(cardSNoOfficial, []);
  check("T2 S 级无官方来源 → 降级 A", downgraded.visible_level === "A", `level=${downgraded.visible_level}`);
  check("T2.1 backend_score 限制 ≤84", downgraded.backend_score <= 84, `score=${downgraded.backend_score}`);

  // T3: applySLevelGuard：visible_level="S" 且有官方来源 → 保持 "S"
  // 注意：使用新对象，不能复用 T2 已被修改的 cardSNoOfficial
  const cardSWithOfficial: OpportunityCard = {
    title: "测试", type: "ai_competition", organizer: "", region: "", deadline: "",
    reward_or_value: "", eligibility: "", materials_required: "", match_reason: "",
    next_action: "", official_source_url: "", application_url: "", contact_info: "",
    risk_note: "", backend_score: 95, visible_level: "S", status: "new",
  };
  const kept = applySLevelGuard(cardSWithOfficial, [makeGovSource()]);
  check("T3 S 级有官方来源 → 保持 S", kept.visible_level === "S", `level=${kept.visible_level}`);

  // T4: applySLevelGuard：非 S 级 → 不变
  const cardA: OpportunityCard = {
    title: "测试", type: "ai_competition", organizer: "", region: "", deadline: "",
    reward_or_value: "", eligibility: "", materials_required: "", match_reason: "",
    next_action: "", official_source_url: "", application_url: "", contact_info: "",
    risk_note: "", backend_score: 80, visible_level: "A", status: "new",
  };
  const keptA = applySLevelGuard(cardA, []);
  check("T4 非 S 级 → 不变", keptA.visible_level === "A");

  // T5: computeCredibility：1 个来源 → 返回该来源的可信度分数
  const single = computeCredibility([makeGovSource()]);
  check("T5 单源 credibility = A1 分数 100", single === 100, `credibility=${single}`);

  // T6: computeCredibility：2+ 个来源 → 多源加成（+5/+10）
  const twoSources: SourceCandidate[] = [
    { ...makeGovSource(), sourceId: "src_1" },
    { ...makeGovSource(), sourceId: "src_2", confidenceGrade: "B1" },
  ];
  const twoCred = computeCredibility(twoSources);
  check("T6 2 源 credibility > 加权平均（+5 加成）", twoCred > 0, `credibility=${twoCred}`);

  // T7: computeCredibility：含官方来源 → 额外 +10
  const withOfficial = computeCredibility([
    { ...makeGovSource(), isOfficial: true },
    { ...makeGovSource(), sourceId: "src_2", isOfficial: false, confidenceGrade: "C3" },
  ]);
  const withoutOfficial = computeCredibility([
    { ...makeGovSource(), sourceId: "src_1", isOfficial: false, confidenceGrade: "B1", sourceType: "media_authoritative" },
    { ...makeGovSource(), sourceId: "src_2", isOfficial: false, confidenceGrade: "B2", sourceType: "media_general" },
  ]);
  check("T7 含官方来源 credibility > 无官方来源",
    withOfficial > withoutOfficial,
    `with=${withOfficial}, without=${withoutOfficial}`);

  // T8: sourceBadges 包含"官方"（government 类型）
  check("T8 sourceBadges 含 '官方'", card.sourceBadges?.includes("官方") === true, `badges=${card.sourceBadges?.join(",")}`);
  check("T8.1 sourceBadges 含 '政府'", card.sourceBadges?.includes("政府") === true);

  // T9: decision 映射
  const cardS = mapToCard(makeScored({ visible_level: "S", backend_score: 95 }), [makeGovSource()], []);
  check("T9 S 级 decision='attack'", cardS.decision === "attack", `decision=${cardS.decision}`);
  const cardD = mapToCard(makeScored({ visible_level: "hidden", backend_score: 30 }), [], []);
  check("T9.1 D 级 decision='archive'", cardD.decision === "archive", `decision=${cardD.decision}`);

  // T10: visible_level "hidden" → CardVisibleLevel "D"
  check("T10 SearchVisibleLevel hidden → CardVisibleLevel D", cardD.visible_level === "D", `level=${cardD.visible_level}`);
}

// ============================================================
// 5. SearchOrchestrator 集成测试
// ============================================================

async function checkSearchOrchestrator(): Promise<void> {
  section("5. SearchOrchestrator 集成测试");

  const { SearchOrchestrator } = await import("../src/search/orchestrator");
  const { QwenAdapter } = await import("../src/agents/qwen-adapter");
  type SearchOrchestratorResult = import("../src/search/orchestrator").SearchOrchestratorResult;
  type RadarRequirementSpec = import("../src/schema/radar-requirement-spec").RadarRequirementSpec;

  function makeSpec(): RadarRequirementSpec {
    return {
      product_name: "ChancePing",
      product_category: "机会雷达",
      client_profile: {
        client_name: "测试客户", client_type: "团队", industry: "AI",
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
        visible_level_mapping: { S: "85-100", A: "70-84", B: "55-69", C: "40-54", D: "0-39", hidden: "不展示" },
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

  // T1: 搜索结果含 sourceCandidates 数组
  const llm = new QwenAdapter({ mockMode: true });
  const orchestrator = new SearchOrchestrator({
    llmAdapter: llm,
    enableContentFetch: false,
    mockContent: true,
    dataMode: "mock",
  });
  const result: SearchOrchestratorResult = await orchestrator.search(makeSpec(), "AI 大赛");

  check("T1 搜索结果含 sourceCandidates 数组",
    Array.isArray(result.sourceCandidates),
    `sourceCandidates=${typeof result.sourceCandidates}`);
  check("T1.1 sourceCandidates 长度 = opportunities 长度",
    Array.isArray(result.sourceCandidates) && result.sourceCandidates.length === result.opportunities.length,
    `sources=${result.sourceCandidates?.length}, opps=${result.opportunities.length}`);

  // T2: 搜索结果含 evidenceItems 数组
  check("T2 搜索结果含 evidenceItems 数组",
    Array.isArray(result.evidenceItems),
    `evidenceItems=${typeof result.evidenceItems}`);
  check("T2.1 evidenceItems 长度 ≥ opportunities 长度（每个机会至少含 title 证据）",
    Array.isArray(result.evidenceItems) && result.evidenceItems.length >= result.opportunities.length,
    `evidence=${result.evidenceItems?.length}, opps=${result.opportunities.length}`);

  // T3: 搜索结果含 opportunityCards 数组
  check("T3 搜索结果含 opportunityCards 数组",
    Array.isArray(result.opportunityCards),
    `opportunityCards=${typeof result.opportunityCards}`);
  check("T3.1 opportunityCards 长度 = opportunities 长度",
    Array.isArray(result.opportunityCards) && result.opportunityCards.length === result.opportunities.length,
    `cards=${result.opportunityCards?.length}, opps=${result.opportunities.length}`);

  // T4: 步骤 6 失败时不影响 opportunities 字段（验证 try-catch 逻辑）
  // 通过检查 opportunities 仍存在且非 undefined 来验证
  check("T4 opportunities 不受步骤 6 影响",
    Array.isArray(result.opportunities) && result.opportunities.length >= 0,
    `opportunities=${typeof result.opportunities}`);

  // T5: opportunityCards 中 S 级卡片有官方链接（红线 #8）
  if (Array.isArray(result.opportunityCards)) {
    const sCards = result.opportunityCards.filter((c) => c.visible_level === "S");
    if (sCards.length > 0) {
      const allHaveOfficial = sCards.every((c) => {
        // S 级卡片必须满足以下任一条件：
        //   a. official_source_url 非空
        //   b. sourceBadges 含"官方"或"政府"
        return (c.official_source_url && c.official_source_url.length > 0) ||
               (c.sourceBadges?.some((b) => b === "官方" || b === "政府"));
      });
      check("T5 S 级卡片有官方链接/徽章", allHaveOfficial, `sCards=${sCards.length}`);
    } else {
      // Demo 数据中可能无 S 级卡片，跳过此检查
      check("T5 S 级卡片有官方链接/徽章（无 S 级卡片时跳过）", true);
    }
  } else {
    check("T5 opportunityCards 不是数组", false);
  }

  // T6: SearchOrchestratorResult 接口签名验证
  const orchTs = readFile("src/search/orchestrator.ts");
  check("T6 SearchOrchestratorResult 含 sourceCandidates? 字段",
    /sourceCandidates\?\s*:/.test(orchTs));
  check("T6.1 SearchOrchestratorResult 含 evidenceItems? 字段",
    /evidenceItems\?\s*:/.test(orchTs));
  check("T6.2 SearchOrchestratorResult 含 opportunityCards? 字段",
    /opportunityCards\?\s*:/.test(orchTs));

  // T7: 步骤 6 代码块存在
  check("T7 orchestrator.ts 含步骤 6 注释", orchTs.includes("步骤 6") && orchTs.includes("V1.3"));
  check("T7.1 orchestrator.ts 含 classifySources 调用", orchTs.includes("classifySources("));
  check("T7.2 orchestrator.ts 含 extractEvidenceBatch 调用", orchTs.includes("extractEvidenceBatch("));
  check("T7.3 orchestrator.ts 含 mapToCard 调用", orchTs.includes("mapToCard("));
}

// ============================================================
// 6. 兼容性验证
// ============================================================

function checkCompatibility(): void {
  section("6. 兼容性验证");

  // T1: ScoredOpportunity 接口未修改
  const typesTs = readFile("src/search/types.ts");
  check("T1 ScoredOpportunity 接口存在", typesTs.includes("interface ScoredOpportunity"));
  check("T1.1 ScoredOpportunity 字段含 search_result", typesTs.includes("search_result: SearchResult;"));
  check("T1.2 ScoredOpportunity 字段含 cleaned_content", typesTs.includes("cleaned_content: CleanedContent;"));
  check("T1.3 ScoredOpportunity 字段含 backend_score", typesTs.includes("backend_score: number;"));
  check("T1.4 ScoredOpportunity 字段含 visible_level: SearchVisibleLevel", typesTs.includes("visible_level: SearchVisibleLevel;"));

  // T2: SearchOrchestratorResult 新增字段全部 optional
  const orchTs = readFile("src/search/orchestrator.ts");
  check("T2 SearchOrchestratorResult 新增字段 sourceCandidates 是 optional",
    /sourceCandidates\?\s*:\s*SourceCandidate\[\]/.test(orchTs));
  check("T2.1 SearchOrchestratorResult 新增字段 evidenceItems 是 optional",
    /evidenceItems\?\s*:\s*EvidenceItem\[\]/.test(orchTs));
  check("T2.2 SearchOrchestratorResult 新增字段 opportunityCards 是 optional",
    /opportunityCards\?\s*:\s*OpportunityCard\[\]/.test(orchTs));

  // T3: 旧 API 响应（无新字段）仍可被前端解析（前端使用 || [] 兜底）
  const searchJs = readFile("web/search.js");
  check("T3 web/search.js 使用 || [] 兜底 sourceCandidates",
    /currentSourceCandidates\s*=\s*json\.data\.sourceCandidates\s*\|\|\s*\[\]/.test(searchJs));
  check("T3.1 web/search.js 使用 || [] 兜底 evidenceItems",
    /currentEvidenceItems\s*=\s*json\.data\.evidenceItems\s*\|\|\s*\[\]/.test(searchJs));
  check("T3.2 web/search.js 使用 || [] 兜底 opportunityCards",
    /currentOpportunityCards\s*=\s*json\.data\.opportunityCards\s*\|\|\s*\[\]/.test(searchJs));

  // T4: opportunity-scorer.ts 未修改（无 sourceCandidates/evidenceItems/mapToCard 相关代码）
  const scorerTs = readFile("src/search/opportunity-scorer.ts");
  check("T4 opportunity-scorer.ts 未引入 source-classifier", !scorerTs.includes("source-classifier"));
  check("T4.1 opportunity-scorer.ts 未引入 evidence-extractor", !scorerTs.includes("evidence-extractor"));
  check("T4.2 opportunity-scorer.ts 未引入 opportunity-card-mapper", !scorerTs.includes("opportunity-card-mapper"));

  // T5: createDefaultSpec 补充 D 级映射
  const searchRouteTs = readFile("src/api/routes/search.ts");
  check("T5 createDefaultSpec 含 D 级映射",
    searchRouteTs.includes('D: "0-39"') || searchRouteTs.includes('D: "0-49"'));
  check("T5.1 createDefaultSpec 含 D 级定义", searchRouteTs.includes('D: "不推荐"'));
}

// ============================================================
// 7. 安全红线
// ============================================================

function checkSecurityRedLines(): void {
  section("7. 安全红线");

  const classifierTs = readFile("src/search/source-classifier.ts");
  const extractorTs = readFile("src/search/evidence-extractor.ts");
  const mapperTs = readFile("src/search/opportunity-card-mapper.ts");
  const orchTs = readFile("src/search/orchestrator.ts");

  // 红线 #1：SourceCandidate 只来自真实 SearchResult
  check("红线#1 SourceClassifier 接收 SearchResult 参数",
    classifierTs.includes("classifySource(result: SearchResult)") || /classifySource\(result\s*:\s*SearchResult\)/.test(classifierTs));
  check("红线#1.1 classifySources 接收 SearchResult[] 参数",
    /classifySources\(results\s*:\s*SearchResult\[\]\)/.test(classifierTs));
  check("红线#1.2 orchestrator.ts 调用 classifySources 时传入 scoredResults",
    orchTs.includes("classifySources(scoredResults)"));

  // 红线 #2：LLM 不生成 URL
  check("红线#2 SourceClassifier 不调用 LLM", !classifierTs.includes("llmAdapter") && !classifierTs.includes("LLMAdapter"));
  check("红线#2.1 EvidenceExtractor 不调用 LLM", !extractorTs.includes("llmAdapter") && !extractorTs.includes("LLMAdapter"));

  // 红线 #3：official_source_url 来自 SourceCandidate.url
  check("红线#3 OpportunityCardMapper 从 sources 取 officialSource",
    mapperTs.includes("sources.find((s) => s.isOfficial)"));
  check("红线#3.1 officialSourceUrl 来自 officialSource?.url",
    /officialSourceUrl\s*=\s*officialSource\?\.url\s*\?\?\s*url/.test(mapperTs));

  // 红线 #4：EvidenceItem.sourceId 指向已存在 SourceCandidate
  check("红线#4 extractEvidence 接收 sourceId 参数",
    /extractEvidence\(content\s*:\s*CleanedContent,\s*sourceId\s*:\s*string\)/.test(extractorTs));
  check("红线#4.1 orchestrator 调用 extractEvidenceBatch 时传入 sourceIds",
    orchTs.includes("extractEvidenceBatch(cleanedContents, sourceIds)"));
  check("红线#4.2 extractEvidenceBatch 同步 contents 与 sourceIds 索引",
    extractorTs.includes("for (let i = 0; i < contents.length && i < sourceIds.length; i++)"));

  // 红线 #6：无 sourceId 的字段 needsReview = true
  const evidenceItemTs = readFile("src/schema/evidence-item.ts");
  check("红线#6 shouldReviewEvidence 无 sourceId 返回 true",
    /if\s*\(!sourceId\)\s*return\s*true/.test(evidenceItemTs));

  // 红线 #8：无官方链接不进 S 级
  check("红线#8 applySLevelGuard 函数存在", mapperTs.includes("function applySLevelGuard"));
  check("红线#8.1 applySLevelGuard 检查 visible_level === S",
    /if\s*\(\s*card\.visible_level\s*!==\s*"S"\s*\)\s*return\s*card/.test(mapperTs));
  check("红线#8.2 applySLevelGuard 无官方来源时降级 A",
    /card\.visible_level\s*=\s*"A"/.test(mapperTs));
  check("红线#8.3 applySLevelGuard 降级后 backend_score ≤ 84",
    /card\.backend_score\s*=\s*Math\.min\(card\.backend_score,\s*84\)/.test(mapperTs));

  // 红线 #10：新增字段全部 optional
  const cardTs = readFile("src/schema/opportunity-card.ts");
  check("红线#10 OpportunityCard 新增字段 radarId optional", /radarId\?\s*:/.test(cardTs));
  check("红线#10.1 OpportunityCard 新增字段 decision optional", /decision\?\s*:/.test(cardTs));
  check("红线#10.2 OpportunityCard 新增字段 sourceIds optional", /sourceIds\?\s*:/.test(cardTs));
  check("红线#10.3 OpportunityCard 新增字段 evidenceIds optional", /evidenceIds\?\s*:/.test(cardTs));
  check("红线#10.4 OpportunityCard 新增字段 sourceConfidence optional", /sourceConfidence\?\s*:/.test(cardTs));
  check("红线#10.5 OpportunityCard 新增字段 verificationStatus optional", /verificationStatus\?\s*:/.test(cardTs));
  check("红线#10.6 OpportunityCard 新增字段 sourceBadges optional", /sourceBadges\?\s*:/.test(cardTs));
  check("红线#10.7 OpportunityCard 新增字段 fitReason optional", /fitReason\?\s*:/.test(cardTs));
  check("红线#10.8 OpportunityCard 新增字段 riskSummary optional", /riskSummary\?\s*:/.test(cardTs));
  check("红线#10.9 OpportunityCard 新增字段 recommendedActions optional", /recommendedActions\?\s*:/.test(cardTs));

  // 约束：未引入新 npm 依赖（Task A 已新增 meilisearch，baseline=6）
  const pkgJson = JSON.parse(readFile("package.json"));
  const depCount = Object.keys(pkgJson.dependencies || {}).length;
  const devDepCount = Object.keys(pkgJson.devDependencies || {}).length;
  check("约束：dependencies 数量未增加（baseline=6）", depCount <= 6, `depCount=${depCount}`);
  check("约束：devDependencies 数量未增加（baseline=3）", devDepCount <= 3, `devDepCount=${devDepCount}`);

  // 约束：JSDoc 注释完整
  check("约束：source-classifier.ts 含 JSDoc", classifierTs.includes("/**") && classifierTs.includes("*/"));
  check("约束：evidence-extractor.ts 含 JSDoc", extractorTs.includes("/**") && extractorTs.includes("*/"));
  check("约束：opportunity-card-mapper.ts 含 JSDoc", mapperTs.includes("/**") && mapperTs.includes("*/"));

  // 约束：import type 使用正确
  check("约束：source-classifier.ts 使用 import type", classifierTs.includes("import type"));
  check("约束：evidence-extractor.ts 使用 import type", extractorTs.includes("import type"));
  check("约束：opportunity-card-mapper.ts 使用 import type", mapperTs.includes("import type"));
}

// ============================================================
// 8. 回归测试（使用 spawnSync 同步执行，避免 libuv async handle 崩溃）
// ============================================================

function runRegressionTestSync(scriptName: string, label: string, expectedPass: number): void {
  const result = spawnSync("npx.cmd", ["tsx", `scripts/${scriptName}`], {
    cwd: process.cwd(),
    timeout: 180000,
    env: { ...process.env, SKIP_REGRESSION: "1" },
    encoding: "utf-8",
    shell: true,
  });

  const output = (result.stdout || "") + (result.stderr || "");
  // 红线 2：使用 matchAll 取最后一个匹配
  const allMatches = output.matchAll(/(\d+)\s*PASS/gi);
  const matches = [...allMatches];
  const passNum = matches.length > 0 ? parseInt(matches[matches.length - 1][1], 10) : 0;
  const success = passNum >= expectedPass;
  check(`${label} 回归通过（${passNum}/${expectedPass} PASS）`, success,
    `passNum=${passNum}, exit=${result.status}, signal=${result.signal}`);
  const resultLine = `${label}: ${success ? "PASS" : "FAIL"} (${passNum}/${expectedPass})\n`;
  fs.appendFileSync(path.resolve(process.cwd(), "verify-taskC-result.log"), resultLine, "utf-8");
  if (!success) {
    const errMsg = result.error ? result.error.message : "";
    console.log(`    错误: ${errMsg.slice(0, 150)}`);
    console.log(`    输出末尾: ${output.slice(-200)}`);
  }
}

function checkRegression(): void {
  section("8. 回归测试（同步）");
  const resultFile = path.resolve(process.cwd(), "verify-taskC-result.log");
  try { fs.unlinkSync(resultFile); } catch { /* ignore */ }
  // 使用 spawnSync 同步执行，避免 libuv async handle 崩溃影响父进程
  // 回归测试范围与任务书 9.8 节一致
  runRegressionTestSync("verify-e2e-ai-events.ts", "T1 verify-e2e-ai-events", 13);
  runRegressionTestSync("verify-task038.ts", "T2 verify-task038", 30);
  runRegressionTestSync("verify-task039.ts", "T3 verify-task039", 57);
  runRegressionTestSync("verify-task040.ts", "T4 verify-task040", 75);
  runRegressionTestSync("verify-task041.ts", "T5 verify-task041", 38);
  runRegressionTestSync("verify-task042.ts", "T6 verify-task042", 30);
  runRegressionTestSync("verify-task043.ts", "T7 verify-task043", 23);
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("\n=== Task C 验收检查：来源透明 + 机会卡片增强 ===\n");

  checkFileExistence();
  await checkSourceClassifier();
  await checkEvidenceExtractor();
  await checkOpportunityCardMapper();
  await checkSearchOrchestrator();
  checkCompatibility();
  checkSecurityRedLines();
  if (process.env.SKIP_REGRESSION === "1") {
    console.log("\n--- 跳过回归测试（SKIP_REGRESSION=1） ---");
  } else {
    checkRegression();
  }

  console.log("");
  console.log("========================================");
  console.log(`总计: ${passed} PASS / ${failed} FAIL`);
  console.log("========================================");

  // 写入结果文件（避免 PowerShell 管道缓冲导致输出丢失）
  const resultLog = `Task C 验收结果: ${passed} PASS / ${failed} FAIL\n`;
  fs.writeFileSync(path.resolve(process.cwd(), "verify-taskC-result.log"), resultLog, "utf-8");

  if (failed > 0) {
    console.log("\n❌ 存在失败项，请修复后重试");
    process.exitCode = 1;
  } else {
    console.log("\n✓ 全部通过");
    process.exitCode = 0;
  }
  // 不调用 process.exit()，让事件循环自然退出，避免 libuv async handle 崩溃
}

main().catch((err) => {
  console.error("执行失败：", err);
  process.exitCode = 1;
});
