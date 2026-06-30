/**
 * 对话管理器
 *
 * 来源：Task 007 第 4.4 节。
 *
 * 核心模块，串联 LLM 适配器、信息提取、确认度引擎、状态机、问题库。
 * 维护对话状态，每轮生成"已确认/不确定信息拆分 + 追问问题 + 确认度更新 + 当前状态输出"。
 *
 * processUserInput 流程（13 步，对应 4.4 节）：
 *   1. 将 userInput 加入 message_history（role=user）
 *   2. 调用 LLM 获取 extracted_info + summary
 *   3. 合并 extracted_info 到 state（字段级合并，新值覆盖旧值）
 *   4. 调用 calculateConfidence 计算新确认度
 *   5. 调用 calculateConfidenceDelta 计算变化
 *   6. 调用 getConfidenceBranch 获取分支
 *   7. 如果 branch = needs_more_info 或 continue_confirming：选择 ≤5 个问题
 *   8. 调用 getNextStatus 更新状态
 *   9. 生成 current_status_text
 *   10. 构建 TurnOutput 返回
 *   11. 将 AI 回复加入 message_history（role=assistant）
 *   12. 记录 ConversationTurn
 *   13. turn_count++
 */

import type { LLMAdapter } from "./llm-adapter";
import type { ConversationState, ConversationTurn } from "./conversation-state";
import { createInitialConversationState } from "./conversation-state";
import type { TurnOutput, ConfirmedItem, UncertainItem } from "./conversation-turn-output";
import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { RequirementConfidence } from "../schema/requirement-confidence";
import type { QuestionToConfirm } from "../schema/radar-requirement-spec";
import type { RadarType } from "../prompts/question-bank";
import type { ConfidenceBranch } from "./confidence-engine";
import {
  calculateConfidence,
  getConfidenceBranch,
  calculateConfidenceDelta,
} from "./confidence-engine";
import { getQuestionsForRadarType } from "../prompts/question-bank";
import { getNextStatus } from "../schema/conversation-state-machine";
// V1.3 新增：一次一问 + 长文本整理 + 确认卡生成
import { QuestionPlanner } from "./question-planner";
import { normalizeUserInput, type NormalizedUserInput } from "./normalize-user-input";
import { generateConfirmationCard } from "./requirement-card-generator";
import { REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT_V2 } from "../prompts/requirement-confirmation-system-prompt-v2";
import type { NextQuestion, QuestionMode } from "../schema/next-question";
import type { RequirementConfirmationCard } from "../schema/requirement-confirmation-card";

// ============================================================
// 辅助函数
// ============================================================

/** 生成对话 ID（不依赖 uuid 包） */
function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 字段路径 → 中文标签（与 mock-llm-adapter.ts 保持一致） */
const FIELD_LABELS: Record<string, string> = {
  "client_identity.client_type": "客户类型",
  "client_identity.industry": "行业",
  "client_identity.business_type": "业务类型",
  "client_identity.core_capabilities": "核心能力",
  "client_identity.products_or_projects": "产品或项目",
  "client_identity.company_stage": "公司阶段",
  "client_identity.regions": "所在地",
  "client_identity.notes": "备注",
  "business_goal.primary_goal": "主要目标",
  "business_goal.secondary_goals": "次要目标",
  "business_goal.success_definition": "成功标准",
  "business_goal.priority_order": "优先级排序",
  "opportunity_type.primary_types": "主要机会类型",
  "opportunity_type.secondary_types": "次要机会类型",
  "opportunity_type.excluded_types": "排除的机会类型",
  "opportunity_type.must_have_conditions": "必须满足的条件",
  "region_scope.primary_regions": "主要地域",
  "region_scope.secondary_regions": "次要地域",
  "region_scope.excluded_regions": "排除地域",
  "region_scope.overseas_allowed": "是否接受海外",
  "region_scope.global_allowed": "是否接受全球",
  "exclusion_rules.must_exclude": "必须排除",
  "exclusion_rules.low_priority_signals": "低优先级信号",
  "exclusion_rules.count": "排除条件总数",
  "action_scenario.action_intent": "行动意图",
  "action_scenario.priority_order": "行动优先级",
  "report_format.frequency": "报告频率",
  "report_format.format": "报告格式",
  "report_format.must_include_sections": "必须包含的章节",
};

function labelOf(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** 把任意值格式化为字符串 */
function stringifyValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join("、");
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
}

/**
 * 浅合并：将 delta 合并到 base，每个维度内部字段级合并，新值覆盖旧值。
 * exclusion_rules.count 字段：如果 delta 显式给了 count，用 delta；否则保留 base。
 */
function mergeExtractedInfo(
  base: ExtractedRequirementInfo,
  delta: Partial<ExtractedRequirementInfo>,
): ExtractedRequirementInfo {
  return {
    client_identity: { ...base.client_identity, ...(delta.client_identity ?? {}) },
    business_goal: { ...base.business_goal, ...(delta.business_goal ?? {}) },
    opportunity_type: { ...base.opportunity_type, ...(delta.opportunity_type ?? {}) },
    region_scope: { ...base.region_scope, ...(delta.region_scope ?? {}) },
    exclusion_rules: {
      ...base.exclusion_rules,
      ...(delta.exclusion_rules ?? {}),
      count: delta.exclusion_rules?.count ?? base.exclusion_rules.count,
    },
    action_scenario: { ...base.action_scenario, ...(delta.action_scenario ?? {}) },
    report_format: { ...base.report_format, ...(delta.report_format ?? {}) },
  };
}

/** 从累积的 ExtractedRequirementInfo 构建 confirmed_items（累积视图） */
function buildConfirmedItems(info: ExtractedRequirementInfo): ConfirmedItem[] {
  const items: ConfirmedItem[] = [];

  const collect = (prefix: string, obj: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(obj)) {
      // count=0 视为未填充
      if (k === "count" && typeof v === "number" && v === 0) continue;
      const valueStr = stringifyValue(v);
      if (valueStr !== "") {
        const field = `${prefix}.${k}`;
        items.push({ field, label: labelOf(field), value: valueStr });
      }
    }
  };

  collect("client_identity", info.client_identity);
  collect("business_goal", info.business_goal);
  collect("opportunity_type", info.opportunity_type);
  collect("region_scope", info.region_scope);
  if (info.exclusion_rules.count > 0) {
    collect("exclusion_rules", info.exclusion_rules);
  }
  collect("action_scenario", info.action_scenario);
  collect("report_format", info.report_format);

  return items;
}

/** 构建 uncertain_items（从累积 info 视角看哪些字段仍缺失）。
 * 检查 ExtractedRequirementInfo 的全部字段，确保 confidence < 100 时 uncertain_items 非空。 */
function buildUncertainItems(info: ExtractedRequirementInfo): UncertainItem[] {
  const items: UncertainItem[] = [];
  const filled = new Set(buildConfirmedItems(info).map((i) => i.field));

  const check = (field: string, hint: string): void => {
    if (!filled.has(field)) {
      items.push({ field, label: labelOf(field), hint });
    }
  };

  // client_identity 全部字段
  check("client_identity.client_type", "请补充用户类型（个人/团队/公司/机构）");
  check("client_identity.industry", "请补充您所在的行业");
  check("client_identity.business_type", "请补充业务类型（个体户/有限公司等）");
  check("client_identity.core_capabilities", "请补充您的核心能力");
  check("client_identity.products_or_projects", "请补充您的产品或项目");
  check("client_identity.company_stage", "请补充公司阶段（初创/成长/成熟）");
  check("client_identity.regions", "请补充您所在的地域");
  check("client_identity.notes", "请补充其他身份备注");

  // business_goal 全部字段
  check("business_goal.primary_goal", "请补充您的主要目标");
  check("business_goal.secondary_goals", "请补充次要目标");
  check("business_goal.success_definition", "请补充成功标准");
  check("business_goal.priority_order", "请补充优先级排序");

  // opportunity_type 全部字段
  check("opportunity_type.primary_types", "请补充主要机会类型");
  check("opportunity_type.excluded_types", "请补充排除的机会类型");
  check("opportunity_type.secondary_types", "请补充次要机会类型");
  check("opportunity_type.must_have_conditions", "请补充必须满足的条件");

  // region_scope 全部字段
  check("region_scope.primary_regions", "请补充主要地域");
  check("region_scope.excluded_regions", "请补充排除地域");
  check("region_scope.secondary_regions", "请补充次要地域");
  check("region_scope.overseas_allowed", "请明确是否接受海外机会");
  check("region_scope.global_allowed", "请明确是否接受全球机会");

  // exclusion_rules
  if (info.exclusion_rules.count === 0) {
    check("exclusion_rules.must_exclude", "请补充排除条件");
  }
  check("exclusion_rules.low_priority_signals", "请补充低优先级信号");

  // action_scenario 全部字段
  check("action_scenario.action_intent", "请补充行动意图");
  check("action_scenario.priority_order", "请补充行动优先级");

  // report_format 全部字段
  check("report_format.frequency", "请补充报告频率");
  check("report_format.format", "请补充报告格式");
  check("report_format.must_include_sections", "请补充必须包含的章节");

  return items;
}

/** 根据 branch 生成当前状态输出文本（02 号文档第 7 节格式） */
function getStatusText(branch: ConfidenceBranch): string {
  switch (branch) {
    case "needs_more_info":
    case "continue_confirming":
      return "继续确认需求";
    case "can_generate_card_v01":
      return "可以生成需求确认卡";
    case "can_generate_plan":
      return "可以进入雷达方案生成";
  }
}

/** 按 priority 排序问题（high > medium > low） */
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** 把 TurnOutput 序列化为 AI 回复文本（加入 message_history） */
function buildAiResponseText(turn: TurnOutput): string {
  const parts: string[] = [turn.summary];
  if (turn.confirmed_items.length > 0) {
    parts.push(
      "已确认：" + turn.confirmed_items.map((c) => `${c.label}=${c.value}`).join("；"),
    );
  }
  if (turn.questions.length > 0) {
    parts.push(
      "追问：" + turn.questions.map((q, i) => `${i + 1}. ${q.question}`).join(" "),
    );
  }
  parts.push(`当前确认度：${turn.confidence.total}（${turn.current_status_text}）`);
  return parts.join("\n");
}

// ============================================================
// ConversationManager 类
// ============================================================

/**
 * 对话管理器。
 *
 * 职责：
 *   1. 接收用户输入
 *   2. 调用 LLM 提取结构化信息（通过 LLMAdapter）
 *   3. 合并到已有 ExtractedRequirementInfo
 *   4. 调用 confidence-engine 计算确认度
 *   5. 选择追问问题（≤5 个，排除已问过的）
 *   6. 调用状态机更新状态
 *   7. 生成 TurnOutput 返回给用户
 */
export class ConversationManager {
  private state: ConversationState;
  private llmAdapter: LLMAdapter;
  private questionPlanner: QuestionPlanner;  // V1.3 新增
  private useV2Prompt: boolean;               // V1.3 新增
  private confirmationCard: RequirementConfirmationCard | null = null;  // V1.3 新增

  constructor(
    llmAdapter: LLMAdapter,
    radarType: RadarType,
    conversationId?: string,
    useV2Prompt: boolean = false,  // V1.3 新增，默认 false 保持兼容
  ) {
    this.llmAdapter = llmAdapter;
    this.questionPlanner = new QuestionPlanner(radarType);
    this.useV2Prompt = useV2Prompt;
    this.state = createInitialConversationState(
      conversationId ?? generateConversationId(),
      radarType,
    );
    // 如果使用 V2 模式，替换 system prompt
    if (useV2Prompt) {
      this.state.message_history[0] = {
        role: "system",
        content: REQUIREMENT_CONFIRMATION_SYSTEM_PROMPT_V2,
      };
    }
  }

  /** 初始化对话（system prompt 已在构造时通过 createInitialConversationState 注入） */
  initialize(): void {
    // 当前无需额外初始化逻辑
  }

  /**
   * 处理用户输入，返回本轮输出。
   * 这是核心方法，完整执行一轮对话流程（13 步）。
   */
  async processUserInput(userInput: string): Promise<TurnOutput> {
    // 步骤 0：保存上一轮的 confidence 快照（首轮为 null）
    const previousConfidence: RequirementConfidence | null =
      this.state.turn_count === 0 ? null : this.state.confidence;

    // 步骤 1：将 userInput 加入 message_history
    this.state.message_history.push({ role: "user", content: userInput });

    // 步骤 2：调用 LLM，要求返回 JSON
    const llmResponse = await this.llmAdapter.chat({
      messages: this.state.message_history,
      response_format: "json",
      temperature: 0.2,
    });

    let parsed: {
      extracted_info?: Partial<ExtractedRequirementInfo>;
      summary?: string;
      confirmed_items?: ConfirmedItem[];
      uncertain_items?: UncertainItem[];
    };
    try {
      // V1.6.5 修复：清理 LLM 返回的 JSON（移除 markdown 代码块标记 + 前后空白）
      let jsonStr = llmResponse.content.trim();
      // 移除 ```json ... ``` 或 ``` ... ``` 包裹
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      // V1.6.5 修复：记录解析失败的原始内容，便于调试
      console.warn("[ConversationManager] LLM 返回内容 JSON 解析失败，原始内容（前 200 字符）:", llmResponse.content.substring(0, 200));
      parsed = {};
    }

    const deltaInfo = parsed.extracted_info ?? {};

    // 步骤 3：合并 extracted_info 到 state（字段级合并，新值覆盖旧值）
    this.state.extracted_info = mergeExtractedInfo(this.state.extracted_info, deltaInfo);

    // 步骤 4：计算新确认度
    const newConfidence = calculateConfidence(this.state.extracted_info);

    // 步骤 5：计算确认度变化（首轮为 null）
    let confidence_delta: TurnOutput["confidence_delta"] = null;
    if (previousConfidence) {
      const delta = calculateConfidenceDelta(previousConfidence, newConfidence);
      const improved = delta.dimension_deltas
        .filter((d) => d.delta > 0)
        .map((d) => d.dimension);
      confidence_delta = {
        total_delta: delta.total_delta,
        improved_dimensions: improved,
      };
    }
    this.state.confidence = newConfidence;

    // 步骤 6：获取分支
    const branch = getConfidenceBranch(newConfidence.total);
    this.state.branch = branch;

    // 步骤 7：选择下一问（一次一问模式）
    let questions: QuestionToConfirm[] = [];
    let nextQuestion: NextQuestion | null = null;
    let canGenerateDraft = false;
    let maxTurnsReached = false;
    const questionMode: QuestionMode = this.useV2Prompt ? "single" : "multi";

    // V1.3 长文本整理
    const normalized: NormalizedUserInput = normalizeUserInput(userInput);

    if (this.useV2Prompt) {
      // 一次一问模式
      const draftDecision = this.questionPlanner.shouldGenerateDraft(newConfidence, this.state.turn_count + 1);
      canGenerateDraft = draftDecision.should;

      if (draftDecision.should) {
        // 生成确认卡
        this.confirmationCard = generateConfirmationCard(
          this.state.conversation_id,
          newConfidence,
          this.state.extracted_info,
          this.state.turn_count + 1,
        );
      } else if (this.state.turn_count + 1 >= this.questionPlanner.getMaxTurns()) {
        maxTurnsReached = true;
      } else {
        // 选择下一问
        nextQuestion = this.questionPlanner.selectNextQuestion(newConfidence);
        if (nextQuestion) {
          // 同时填充 questions 数组（兼容旧前端）
          questions = [{
            question: nextQuestion.question,
            why_it_matters: nextQuestion.whyItMatters,
            related_field: nextQuestion.relatedField,
            priority: "high",
          }];
          this.state.asked_questions.push(nextQuestion.question);
        }
      }
    } else {
      // 旧模式：一次多问（fallback）
      if (branch === "needs_more_info" || branch === "continue_confirming") {
        const allQuestions = getQuestionsForRadarType(this.state.radar_type);
        // 过滤掉已问过的问题
        const unasked = allQuestions.filter(
          (q) => !this.state.asked_questions.includes(q.question),
        );
        // 按 priority 排序（high > medium > low）
        unasked.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
        // 取前 5 个
        questions = unasked.slice(0, 5);
        // 把追问问题加入 asked_questions
        for (const q of questions) {
          this.state.asked_questions.push(q.question);
        }
      }
    }

    // 步骤 8：更新状态（不传 userAction，纯靠 confidence 驱动）
    this.state.current_status = getNextStatus(
      this.state.current_status,
      newConfidence.total,
    );

    // 步骤 9：生成 current_status_text
    const current_status_text = getStatusText(branch);

    // 步骤 10：构建 TurnOutput
    const summary = parsed.summary ?? `已收到您的输入："${userInput}"。`;
    // V1.3：如果长文本整理生效，把整理后的文本附加到 summary
    const finalSummary = normalized.wasNormalized
      ? `${summary}（已整理：${normalized.normalizedText}）`
      : summary;
    const turnOutput: TurnOutput = {
      summary: finalSummary,
      confirmed_items: buildConfirmedItems(this.state.extracted_info),
      uncertain_items: buildUncertainItems(this.state.extracted_info),
      questions,
      confidence: newConfidence,
      confidence_delta,
      current_status_text,
      status: this.state.current_status,
      // V1.3 新增字段
      nextQuestion,
      canGenerateDraft,
      maxTurnsReached,
      questionMode,
    };

    // 步骤 11：将 AI 回复加入 message_history
    const aiResponse = buildAiResponseText(turnOutput);
    this.state.message_history.push({ role: "assistant", content: aiResponse });

    // 步骤 12：记录 ConversationTurn
    const turn: ConversationTurn = {
      turn_number: this.state.turn_count + 1,
      user_input: userInput,
      ai_response: aiResponse,
      extracted_info_snapshot: this.state.extracted_info,
      confidence_snapshot: newConfidence,
      branch,
      status: this.state.current_status,
      questions_asked: questions.map((q) => q.question),
    };
    this.state.turns.push(turn);

    // 步骤 13：turn_count++
    this.state.turn_count++;

    return turnOutput;
  }

  /** 获取当前对话状态 */
  getState(): ConversationState {
    return this.state;
  }

  /** 获取对话历史 */
  getTurns(): ConversationTurn[] {
    return this.state.turns;
  }

  /**
   * 用户确认确认卡。
   * 仅在 confirmation_card_generated 状态下生效。
   * 状态转换链：
   *   1. confirmation_card_generated → confirmed（userAction=confirmed）
   *   2. 如果 confidence >= 95：confirmed → ready_for_radar_plan
   */
  userConfirm(): TurnOutput {
    if (this.state.current_status !== "confirmation_card_generated") {
      return this.buildNoOpTurnOutput("当前状态不可执行确认操作");
    }
    // 步骤 1：confirmation_card_generated → confirmed
    let newStatus = getNextStatus(
      this.state.current_status,
      this.state.confidence.total,
      "confirmed",
    );
    // 步骤 2：如果新状态是 confirmed 且 confidence >= 95，再走一次状态机
    if (newStatus === "confirmed") {
      newStatus = getNextStatus(newStatus, this.state.confidence.total);
    }
    this.state.current_status = newStatus;
    this.state.branch = getConfidenceBranch(this.state.confidence.total);

    return this.buildNoOpTurnOutput("用户已确认需求确认卡");
  }

  /**
   * 用户要求修改。
   * 仅在 confirmation_card_generated 状态下生效。
   * 状态转换：confirmation_card_generated → user_revision_requested
   */
  userRequestRevision(): TurnOutput {
    if (this.state.current_status !== "confirmation_card_generated") {
      return this.buildNoOpTurnOutput("当前状态不可执行修改操作");
    }
    this.state.current_status = getNextStatus(
      this.state.current_status,
      this.state.confidence.total,
      "requested_revision",
    );
    // 修改请求后需要更多信息，分支设为 needs_more_info
    this.state.branch = "needs_more_info";

    return this.buildNoOpTurnOutput("用户要求修改需求确认卡");
  }

  /** 是否可以生成确认卡（确认度 ≥90%） */
  canGenerateCard(): boolean {
    return this.state.confidence.total >= 90;
  }

  /**
   * 是否可以进入雷达方案（确认度 ≥95% 且已确认）。
   * 接受 status = "confirmed" 或 "ready_for_radar_plan"（后者是 chained 转换的结果）。
   */
  canGeneratePlan(): boolean {
    return (
      this.state.confidence.total >= 95 &&
      (this.state.current_status === "confirmed" ||
        this.state.current_status === "ready_for_radar_plan")
    );
  }

  /** 构建"无操作"的 TurnOutput（用于 userConfirm / userRequestRevision） */
  private buildNoOpTurnOutput(summary: string): TurnOutput {
    return {
      summary,
      confirmed_items: buildConfirmedItems(this.state.extracted_info),
      uncertain_items: buildUncertainItems(this.state.extracted_info),
      questions: [],
      confidence: this.state.confidence,
      confidence_delta: null,
      current_status_text: getStatusText(this.state.branch),
      status: this.state.current_status,
      // V1.3 新增字段（无操作时不携带一次一问数据）
      nextQuestion: null,
      canGenerateDraft: this.confirmationCard !== null,
      maxTurnsReached: false,
      questionMode: this.useV2Prompt ? "single" : "multi",
    };
  }

  /** V1.3 新增：获取确认卡（如果已生成） */
  getConfirmationCard(): RequirementConfirmationCard | null {
    return this.confirmationCard;
  }

  /** V1.3 新增：是否使用 V2 一次一问模式 */
  isV2Mode(): boolean {
    return this.useV2Prompt;
  }

  /** V1.3 新增：获取 QuestionPlanner 实例（供单元测试使用） */
  getQuestionPlanner(): QuestionPlanner {
    return this.questionPlanner;
  }
}
