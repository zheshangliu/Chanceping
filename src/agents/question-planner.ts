/**
 * QuestionPlanner —— 一次一问选问引擎
 *
 * V1.3 新增。独立模块，负责"一次一问"模式下的问题选择和草案生成决策。
 *
 * 设计依据：
 *   - NN/g Staged Disclosure 原则（一次只问 1 个问题）
 *   - GPT 调研的 QuestionPlanner 独立模块化设计
 *   - 低置信度草案逃逸（6 轮未达 90% 但 ≥70%）
 *
 * 选问算法（规则版，第一版不全交给 LLM）：
 *   priority = weight × (1 - score / 100)
 *   选 priority 最高的未问维度
 */

import type { RequirementConfidence, ConfidenceDimensionKey } from "../schema/requirement-confidence";
import {
  CONFIDENCE_DIMENSIONS,
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_DIMENSION_LABELS,
} from "../schema/requirement-confidence";
import type { QuestionToConfirm } from "../schema/radar-requirement-spec";
import { getQuestionsForRadarType, type RadarType } from "../prompts/question-bank";
import type { NextQuestion, QuestionType, DraftGenerationDecision } from "../schema/next-question";

// ============================================================
// 常量
// ============================================================

/** 最多追问轮次 */
const MAX_TURNS = 6;

/** 正常确认度阈值（≥90% 生成正式确认卡） */
const CONFIRM_THRESHOLD = 90;

/** 低置信度逃逸阈值（6 轮后 ≥70% 可生成低置信度草案） */
const LOW_CONFIDENCE_THRESHOLD = 70;

// ============================================================
// 维度 → Spec 字段路径映射
// ============================================================

/** 7 维度 → Spec 字段路径（用于 NextQuestion.relatedField） */
const DIMENSION_TO_FIELD: Record<ConfidenceDimensionKey, string> = {
  client_identity: "client_identity.client_type",
  business_goal: "business_goal.primary_goal",
  opportunity_type: "opportunity_type.primary_types",
  region_scope: "region_scope.primary_regions",
  exclusion_rules: "exclusion_rules.must_exclude",
  action_scenario: "action_scenario.action_intent",
  report_format: "report_format.frequency",
};

/** 维度分数达标阈值（≥此值才不再追问该维度） */
const DIMENSION_SCORE_THRESHOLD = 60;

// ============================================================
// QuestionPlanner 类
// ============================================================

export class QuestionPlanner {
  private askedDimensions: Set<ConfidenceDimensionKey> = new Set();
  private askedQuestions: Set<string> = new Set();
  private readonly radarType: RadarType;

  constructor(radarType: RadarType) {
    this.radarType = radarType;
  }

  /**
   * 选择下一问。
   *
   * 算法：
   *   1. 过滤掉"分数已达标"的维度（而非仅"问过"的维度）
   *   2. 计算每个维度的 priority = weight × (1 - score / 100)
   *   3. 选 priority 最高的维度
   *   4. 从 question-bank 中找到该维度对应的问题
   *   5. 如果所有维度都已达标，返回 null
   *
   * V1.4 修复：原逻辑"问过就不再问"导致用户回答"都可以"后该维度
   * 分数仍低但不再追问。现改为"分数达标才不再问"。
   *
   * @param confidence 当前确认度
   * @returns 下一问，或 null（无需继续追问）
   */
  selectNextQuestion(confidence: RequirementConfidence): NextQuestion | null {
    // 步骤 1：过滤掉"分数达标"或"所有问题都问过了"的维度（V1.4 修复）
    const allQuestions = getQuestionsForRadarType(this.radarType);
    const candidates = CONFIDENCE_DIMENSIONS
      .filter((dim) => {
        const score = confidence[dim].score;
        // 分数达标 → 不再追问
        if (score >= DIMENSION_SCORE_THRESHOLD) return false;
        // 该维度还有未问过的问题 → 继续追问
        const hasUnasked = allQuestions.some(
          (q) => !this.askedQuestions.has(q.question) && this.dimensionMatchesQuestion(dim, q),
        );
        if (!hasUnasked) return false;
        return true;
      })
      .map((dim) => {
        const dimData = confidence[dim];
        const weight = CONFIDENCE_WEIGHTS[dim];
        const score = dimData.score;
        const priority = weight * (1 - score / 100);
        return { dimension: dim, priority, score, weight };
      })
      .sort((a, b) => b.priority - a.priority);

    if (candidates.length === 0) return null;

    // 步骤 2：选 priority 最高的维度
    const target = candidates[0];

    // 步骤 3：从 question-bank 中找到该维度对应的问题
    const matchingQuestion = allQuestions.find(
      (q) =>
        !this.askedQuestions.has(q.question) &&
        this.dimensionMatchesQuestion(target.dimension, q),
    );

    if (!matchingQuestion) {
      // 理论上不会走到这里（步骤 1 已过滤），但防御性返回 null
      return null;
    }

    // 步骤 4：构建 NextQuestion
    const nextQuestion = this.buildNextQuestion(matchingQuestion, target.dimension, target.score, target.weight);

    // 步骤 5：标记已问
    this.askedDimensions.add(target.dimension);
    this.askedQuestions.add(matchingQuestion.question);

    return nextQuestion;
  }

  /**
   * 判断是否应该生成草案（确认卡）。
   *
   * 规则：
   *   - total >= 90 → should: true, isLowConfidence: false
   *   - turnCount >= 6 && total >= 70 → should: true, isLowConfidence: true
   *   - turnCount >= 6 && total < 70 → should: false（信息不足）
   *   - else → should: false（继续追问）
   *
   * @param confidence 当前确认度
   * @param turnCount 当前轮次
   */
  shouldGenerateDraft(confidence: RequirementConfidence, turnCount: number): DraftGenerationDecision {
    const total = confidence.total;

    if (total >= CONFIRM_THRESHOLD) {
      return { should: true, isLowConfidence: false };
    }

    if (turnCount >= MAX_TURNS && total >= LOW_CONFIDENCE_THRESHOLD) {
      return { should: true, isLowConfidence: true };
    }

    return { should: false, isLowConfidence: false };
  }

  /** 获取最大轮次 */
  getMaxTurns(): number {
    return MAX_TURNS;
  }

  /** 获取已问维度列表 */
  getAskedDimensions(): ConfidenceDimensionKey[] {
    return Array.from(this.askedDimensions);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 判断问题是否属于指定维度。
   * 通过 related_field 前缀匹配。
   */
  private dimensionMatchesQuestion(dimension: ConfidenceDimensionKey, question: QuestionToConfirm): boolean {
    const field = question.related_field;
    const dimField = DIMENSION_TO_FIELD[dimension];

    // related_field 的前缀匹配维度
    // 例如 "client_profile.client_type" 匹配 "client_identity" 维度
    // 注意：question-bank 中 related_field 使用旧命名（client_profile），而维度使用新命名（client_identity）
    const fieldPrefix = field.split(".")[0];
    const dimPrefix = dimField.split(".")[0];

    // 兼容旧命名：client_profile → client_identity, core_goals → business_goal, opportunity_scope → opportunity_type
    const aliasMap: Record<string, string> = {
      client_profile: "client_identity",
      core_goals: "business_goal",
      opportunity_scope: "opportunity_type",
      report_requirements: "report_format",
      filter_rules: "exclusion_rules",
    };

    const normalizedFieldPrefix = aliasMap[fieldPrefix] ?? fieldPrefix;
    return normalizedFieldPrefix === dimPrefix;
  }

  /**
   * 构建 NextQuestion 对象。
   */
  private buildNextQuestion(
    question: QuestionToConfirm,
    dimension: ConfidenceDimensionKey,
    currentScore: number,
    weight: number,
  ): NextQuestion {
    const questionType = this.inferQuestionType(question);
    const estimatedGain = Math.round(weight * (1 - currentScore / 100));

    return {
      question: question.question,
      questionType,
      options: this.inferOptions(question, dimension),
      whyItMatters: question.why_it_matters,
      relatedField: question.related_field,
      targetDimension: dimension,
      estimatedConfidenceGain: estimatedGain,
    };
  }

  /**
   * 推断问题类型。
   *
   * 规则：
   *   - 问题中包含"是个人/团队/公司"等选项 → single_choice
   *   - 问题中包含"哪几类" → multi_choice
   *   - 问题中包含"是否" → yes_no
   *   - 其他 → open_text
   */
  private inferQuestionType(question: QuestionToConfirm): QuestionType {
    const q = question.question;
    if (q.includes("是否") || q.includes("你是不是") || q.includes("你有没有")) {
      return "yes_no";
    }
    if (q.includes("哪几类") || q.includes("哪些") || q.includes("哪几个")) {
      return "multi_choice";
    }
    if (q.includes("还是") || q.match(/个人|团队|公司|机构/)) {
      return "single_choice";
    }
    return "open_text";
  }

  /**
   * 推断问题选项（仅 single_choice / multi_choice / yes_no 时有值）。
   */
  private inferOptions(question: QuestionToConfirm, dimension: ConfidenceDimensionKey): string[] | undefined {
    const q = question.question;

    // 是非题
    if (q.includes("是否") || q.includes("你是不是") || q.includes("你有没有")) {
      return ["是", "否"];
    }

    // 单选题：从问题文本中提取选项
    if (q.includes("还是")) {
      // "你是个人、团队、公司，还是机构？" → ["个人", "团队", "公司", "机构"]
      const match = q.match(/你是(.+?)？/);
      if (match) {
        const parts = match[1].split(/[、，,还是]+/).filter((s) => s.trim() && s !== "还是");
        if (parts.length >= 2) return parts.map((s) => s.trim());
      }
    }

    // 多选题
    if (q.includes("哪几类") || q.includes("哪些")) {
      return undefined; // 多选题选项由前端动态生成或留空
    }

    // 防止未使用参数告警（dimension 保留为扩展点）
    void dimension;
    return undefined;
  }
}

// ============================================================
// 调试辅助：导出常量与标签（供 verify 脚本和单元测试使用）
// ============================================================

export { MAX_TURNS, CONFIRM_THRESHOLD, LOW_CONFIDENCE_THRESHOLD, CONFIDENCE_DIMENSION_LABELS };
