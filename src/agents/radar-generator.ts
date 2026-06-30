/**
 * RadarGenerator —— AI 雷达规格生成器（V1.5-05 新增）
 *
 * 来源：Task V1.5-05 第 3.2 节。
 *
 * 从自然语言描述生成 RadarRequirementSpec：
 *   1. 拼接 description + uploadedText 作为 LLM 输入
 *   2. 调用 LLM 生成 ExtractedRequirementInfo JSON
 *   3. JSON 修复（parseJsonWithRepair）
 *   4. 调用 RadarSpecCompiler.compile(info, "custom") 编译 Spec
 *   5. 调用 RadarSpecValidator 校验字段完整率
 *   6. 生成建议名称（从 info.opportunity_type.primary_types 取前 2 个 + "雷达"）
 *   7. 返回 RadarGenerateResult
 *
 * Mock 模式（LLM_MODE=mock）：不调 LLM，直接返回预设的 ExtractedRequirementInfo。
 */

import type { LLMAdapter } from "./llm-adapter";
import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import { RadarSpecCompiler } from "./radar-spec-compiler";
import { RadarSpecValidator } from "../schema/radar-spec-validator";
import { parseJsonWithRepair } from "../utils/json-repair";
import { getLlmMode } from "../demo/data-mode";
import {
  RADAR_GENERATOR_SYSTEM_PROMPT,
  RADAR_GENERATOR_USER_PROMPT,
} from "../prompts/radar-generator-prompt";

// ============================================================
// 类型定义
// ============================================================

/** 雷达生成结果 */
export interface RadarGenerateResult {
  /** 生成的 RadarSpec */
  spec: RadarRequirementSpec;
  /** AI 建议的雷达名称（≤20 字） */
  suggestedName: string;
  /** 提取的结构化信息（用于调试和展示） */
  extractedInfo: ExtractedRequirementInfo;
  /** 字段完整率（0-100） */
  completeness: number;
}

// ============================================================
// 常量
// ============================================================

/** 建议名称最大长度 */
const SUGGESTED_NAME_MAX_LEN = 20;

// ============================================================
// Mock 数据
// ============================================================

/**
 * Mock 模式预设的 ExtractedRequirementInfo。
 * 用于 LLM_MODE=mock 时返回完整数据，确保 completeness ≥ 90。
 */
function createMockExtractedInfo(description: string): ExtractedRequirementInfo {
  // 从描述中提取关键词（简单实现：取描述中的非空词）
  const desc = description.trim() || "RPA 比赛";
  // 按 RPA/比赛/自动化 等关键词推断
  const primaryTypes: string[] = [];
  if (/RPA|自动化/i.test(desc)) primaryTypes.push("RPA", "自动化");
  if (/比赛|竞赛|大赛/.test(desc)) primaryTypes.push("比赛");
  if (primaryTypes.length === 0) primaryTypes.push("RPA", "自动化", "比赛");

  return {
    client_identity: {
      client_type: "个人",
      industry: "信息技术",
      business_type: "自动化",
      core_capabilities: ["RPA 开发", "流程自动化"],
      products_or_projects: [],
      company_stage: "",
      regions: ["全国"],
      notes: "",
    },
    business_goal: {
      primary_goal: "盯 RPA 相关的比赛机会",
      secondary_goals: [],
      success_definition: "及时获取 RPA 比赛信息并报名",
      priority_order: ["奖金", "知名度"],
    },
    opportunity_type: {
      primary_types: primaryTypes,
      secondary_types: ["机器人流程自动化"],
      excluded_types: [],
      must_have_conditions: [],
    },
    region_scope: {
      primary_regions: ["全国"],
      secondary_regions: [],
      excluded_regions: [],
      overseas_allowed: false,
      global_allowed: false,
    },
    exclusion_rules: {
      must_exclude: ["已过期", "需付费"],
      low_priority_signals: [],
      count: 2,
    },
    action_scenario: {
      action_intent: "报名比赛",
      priority_order: ["奖金", "知名度"],
    },
    report_format: {
      frequency: "每周",
      format: "markdown",
      must_include_sections: [],
    },
  };
}

// ============================================================
// 辅助函数
// ============================================================

/** 取数组值，缺失返回空数组 */
function arrOrEmpty<T>(v: T[] | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

/**
 * 从 ExtractedRequirementInfo 生成建议名称（≤20 字）。
 * 规则：取 opportunity_type.primary_types 前 2 个 + "雷达"。
 */
function generateSuggestedName(info: ExtractedRequirementInfo): string {
  const primaryTypes = arrOrEmpty(info.opportunity_type?.primary_types);
  if (primaryTypes.length === 0) {
    return "我的自定义雷达";
  }
  const top2 = primaryTypes.slice(0, 2).join("");
  const name = `${top2}雷达`;
  // 截断到最大长度
  return name.length > SUGGESTED_NAME_MAX_LEN
    ? name.slice(0, SUGGESTED_NAME_MAX_LEN)
    : name;
}

/**
 * 规范化 LLM 返回的 ExtractedRequirementInfo。
 * 确保所有必需字段存在（缺失时用空值填充）。
 */
function normalizeExtractedInfo(raw: unknown): ExtractedRequirementInfo {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const er = (obj.exclusion_rules ?? {}) as Record<string, unknown>;
  const mustExclude = arrOrEmpty(er.must_exclude as string[] | undefined);

  return {
    client_identity: (obj.client_identity ?? {}) as ExtractedRequirementInfo["client_identity"],
    business_goal: (obj.business_goal ?? {}) as ExtractedRequirementInfo["business_goal"],
    opportunity_type: (obj.opportunity_type ?? {}) as ExtractedRequirementInfo["opportunity_type"],
    region_scope: (obj.region_scope ?? {}) as ExtractedRequirementInfo["region_scope"],
    exclusion_rules: {
      must_exclude: mustExclude,
      low_priority_signals: arrOrEmpty(er.low_priority_signals as string[] | undefined),
      count: typeof er.count === "number" ? er.count : mustExclude.length,
    },
    action_scenario: (obj.action_scenario ?? {}) as ExtractedRequirementInfo["action_scenario"],
    report_format: (obj.report_format ?? {}) as ExtractedRequirementInfo["report_format"],
  };
}

// ============================================================
// RadarGenerator 类
// ============================================================

/**
 * AI 雷达规格生成器。
 * 从自然语言描述生成 RadarRequirementSpec。
 */
export class RadarGenerator {
  private readonly llmAdapter: LLMAdapter;
  private readonly specCompiler: RadarSpecCompiler;
  private readonly validator: RadarSpecValidator;

  constructor(llmAdapter: LLMAdapter) {
    this.llmAdapter = llmAdapter;
    this.specCompiler = new RadarSpecCompiler();
    this.validator = new RadarSpecValidator();
  }

  /**
   * 从自然语言生成 RadarRequirementSpec。
   *
   * @param description 用户自然语言描述（如"我要盯 RPA 相关的比赛"）
   * @param uploadedText 可选的上传文件解析文本（追加到 description）
   * @returns 生成结果：spec + suggestedName + extractedInfo + completeness
   */
  async generate(
    description: string,
    uploadedText?: string,
  ): Promise<RadarGenerateResult> {
    // 拼接描述
    const fullDescription = uploadedText
      ? `${description}\n\n[上传文件内容]\n${uploadedText}`
      : description;

    // 判断 Mock 模式（V1.6a 自检修复:用 getLlmMode() 替代 process.env,确保默认值一致）
    const isMockMode = getLlmMode() === "mock";

    let extractedInfo: ExtractedRequirementInfo;

    if (isMockMode) {
      // Mock 模式：返回预设数据
      extractedInfo = createMockExtractedInfo(fullDescription);
    } else {
      // 真实模式：调用 LLM
      extractedInfo = await this.extractInfoViaLLM(fullDescription);
    }

    // 编译 Spec
    const spec = this.specCompiler.compile(extractedInfo, "custom");

    // 校验完整率
    const validation = this.validator.validate(spec);

    // 生成建议名称
    const suggestedName = generateSuggestedName(extractedInfo);

    return {
      spec,
      suggestedName,
      extractedInfo,
      completeness: validation.completeness,
    };
  }

  /**
   * 调用 LLM 提取 ExtractedRequirementInfo。
   * @param description 用户描述
   * @returns ExtractedRequirementInfo
   */
  private async extractInfoViaLLM(description: string): Promise<ExtractedRequirementInfo> {
    try {
      const response = await this.llmAdapter.chat({
        messages: [
          { role: "system", content: RADAR_GENERATOR_SYSTEM_PROMPT },
          { role: "user", content: RADAR_GENERATOR_USER_PROMPT(description) },
        ],
        response_format: "json",
        temperature: 0.3,
      });

      // JSON 修复解析
      const parsed = parseJsonWithRepair<Record<string, unknown>>(response.content);
      return normalizeExtractedInfo(parsed);
    } catch (err) {
      // LLM 调用失败：mock 模式降级返回空 info，live 模式必须抛错（不能静默 fallback）
      if (getLlmMode() === "mock") {
        return createMockExtractedInfo(description);
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`RadarGenerator LLM 调用失败: ${errMsg}`);
    }
  }
}
