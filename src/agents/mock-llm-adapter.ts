/**
 * Mock LLM 适配器
 *
 * 来源：Task 007 第 4.5 节。
 *
 * 不调用真实 LLM，而是用规则匹配模拟信息提取。
 * 用于验证对话管理流程，不用于生产。
 *
 * 工作流程：
 *   1. 提取 message_history 中最后一条 user 消息
 *   2. 优先匹配构造器传入的 responseMap（用 includes() 匹配 key）
 *   3. 无匹配则使用关键词规则（4.5 节表）从用户输入中提取信息
 *   4. 生成 summary / confirmed_items / uncertain_items
 *   5. 返回 JSON 字符串
 *
 * Mock 规则（关键词 → 字段映射，取自 4.5 节表）：
 *   | 用户输入关键词              | 填充字段                              |
 *   |---------------------------|-------------------------------------|
 *   | 个人/团队/公司/机构          | client_identity.client_type         |
 *   | AI 游戏/文创/政策/电商       | client_identity.industry            |
 *   | Unity/设计/开发             | client_identity.core_capabilities   |
 *   | 广州/深圳/杭州/北京          | client_identity.regions             |
 *   | 报名/申请/BD/收藏           | action_scenario.action_intent       |
 *   | 每周/每天                   | report_format.frequency             |
 *   | 比赛/补贴/征集              | opportunity_type.primary_types      |
 *   | 大陆/海外/全球              | region_scope.primary_regions        |
 *   | 不要/排除 + 内容            | exclusion_rules.must_exclude + count |
 *   | 奖金/Demo/曝光             | business_goal.priority_order        |
 */

import type { LLMAdapter, LLMRequest, LLMResponse } from "./llm-adapter";
import type { ExtractedRequirementInfo } from "../schema/extracted-requirement-info";
import type { ConfirmedItem, UncertainItem } from "./conversation-turn-output";

/** Mock LLM 返回的结构化内容（与 4.4 节 processUserInput 步骤 2 一致） */
export interface MockLLMResponseContent {
  extracted_info: Partial<ExtractedRequirementInfo>;
  summary: string;
  confirmed_items: ConfirmedItem[];
  uncertain_items: UncertainItem[];
}

type PartialInfo = Partial<ExtractedRequirementInfo>;

/** 字段路径 → 中文标签 */
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

/** 字段路径 → 中文标签 */
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
 * Mock LLM 适配器。
 *
 * 不调用真实 LLM，而是用规则匹配模拟信息提取。
 * 验证脚本通过 responseMap 注入预设响应，可精确控制每轮提取的字段，
 * 从而驱动多轮对话达到指定的确认度区间。
 */
export class MockLLMAdapter implements LLMAdapter {
  /**
   * @param responseMap 预设的用户回复序列：key 为用户输入中包含的子串，
   *                    value 为该子串匹配时返回的部分 ExtractedRequirementInfo。
   *                    优先级按 Map 插入顺序。
   */
  constructor(private responseMap?: Map<string, PartialInfo>) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    // 1. 提取最后一条 user 消息
    const lastUserMsg = [...request.messages]
      .reverse()
      .find((m) => m.role === "user");
    const userInput = lastUserMsg?.content ?? "";

    // 2. 优先匹配 responseMap
    let info: PartialInfo | undefined;
    if (this.responseMap) {
      for (const [key, value] of this.responseMap) {
        if (userInput.includes(key)) {
          info = value;
          break;
        }
      }
    }

    // 3. 无匹配则使用关键词规则
    if (!info) {
      info = this.keywordMatch(userInput);
    }

    // 4. 生成 summary / confirmed_items / uncertain_items
    const confirmed_items = this.buildConfirmedItems(info);
    const uncertain_items = this.buildUncertainItems(info);
    const summary = this.buildSummary(userInput, confirmed_items);

    const content: MockLLMResponseContent = {
      extracted_info: info,
      summary,
      confirmed_items,
      uncertain_items,
    };

    return {
      content: JSON.stringify(content),
      parsed: content,
    };
  }

  /**
   * 关键词匹配规则（4.5 节表）。
   * 从用户输入中按关键词匹配填充对应字段。
   */
  private keywordMatch(input: string): PartialInfo {
    const info: PartialInfo = {};
    const ci: NonNullable<ExtractedRequirementInfo["client_identity"]> = {};
    const bg: NonNullable<ExtractedRequirementInfo["business_goal"]> = {};
    const ot: NonNullable<ExtractedRequirementInfo["opportunity_type"]> = {};
    const rs: NonNullable<ExtractedRequirementInfo["region_scope"]> = {};
    const er: NonNullable<ExtractedRequirementInfo["exclusion_rules"]> = {
      must_exclude: [],
      count: 0,
    };
    const as: NonNullable<ExtractedRequirementInfo["action_scenario"]> = {};
    const rf: NonNullable<ExtractedRequirementInfo["report_format"]> = {};

    // client_identity
    const clientTypeMatch = input.match(/个人|团队|公司|机构/);
    if (clientTypeMatch) ci.client_type = clientTypeMatch[0];

    const industryMatch = input.match(/AI 游戏|文创|政策|电商/);
    if (industryMatch) ci.industry = industryMatch[0];

    const capsMatches = input.match(/Unity|设计|开发/g);
    if (capsMatches) ci.core_capabilities = [...new Set(capsMatches)];

    const regionMatches = input.match(/广州|深圳|杭州|北京/g);
    if (regionMatches) ci.regions = [...new Set(regionMatches)];

    // business_goal —— "找...比赛/机会/政策" → primary_goal
    const goalMatch = input.match(/(找|找找|想要|想找)([^，。]*)/);
    if (goalMatch && /比赛|机会|政策|征集/.test(input)) {
      bg.primary_goal = goalMatch[0];
    }

    const priorityMatches = input.match(/奖金|Demo|曝光/g);
    if (priorityMatches) bg.priority_order = [...new Set(priorityMatches)];

    // opportunity_type
    const primaryMatches = input.match(/比赛|补贴|征集/g);
    if (primaryMatches) ot.primary_types = [...new Set(primaryMatches)];

    // region_scope
    const scopeMatches = input.match(/大陆|海外|全球/g);
    if (scopeMatches) rs.primary_regions = [...new Set(scopeMatches)];

    // exclusion_rules
    const excludeMatch = input.match(/(不要|排除)([^，。]*)/);
    if (excludeMatch) {
      er.must_exclude = [excludeMatch[2]];
      er.count = 1;
    }

    // action_scenario
    const intentMatch = input.match(/报名|申请|BD|收藏|转发/);
    if (intentMatch) as.action_intent = intentMatch[0];

    // report_format
    const freqMatch = input.match(/每周|每天/);
    if (freqMatch) rf.frequency = freqMatch[0];

    // 组装（仅保留有值的维度）
    if (Object.keys(ci).length > 0) info.client_identity = ci;
    if (Object.keys(bg).length > 0) info.business_goal = bg;
    if (Object.keys(ot).length > 0) info.opportunity_type = ot;
    if (Object.keys(rs).length > 0) info.region_scope = rs;
    if ((er.must_exclude?.length ?? 0) > 0) info.exclusion_rules = er;
    if (Object.keys(as).length > 0) info.action_scenario = as;
    if (Object.keys(rf).length > 0) info.report_format = rf;

    return info;
  }

  /** 从本次提取的 info 生成 confirmed_items */
  private buildConfirmedItems(info: PartialInfo): ConfirmedItem[] {
    const items: ConfirmedItem[] = [];

    const collect = (prefix: string, obj: Record<string, unknown> | undefined): void => {
      if (!obj || typeof obj !== "object") return;
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
    if (info.exclusion_rules && (info.exclusion_rules.count ?? 0) > 0) {
      collect("exclusion_rules", info.exclusion_rules);
    }
    collect("action_scenario", info.action_scenario);
    collect("report_format", info.report_format);

    return items;
  }

  /** 生成 uncertain_items（列出本次未提取的关键字段） */
  private buildUncertainItems(info: PartialInfo): UncertainItem[] {
    const items: UncertainItem[] = [];
    const filled = new Set(this.buildConfirmedItems(info).map((i) => i.field));

    const checkField = (field: string, hint: string): void => {
      if (!filled.has(field)) {
        items.push({ field, label: labelOf(field), hint });
      }
    };

    // client_identity 关键字段
    checkField("client_identity.client_type", "请补充用户类型（个人/团队/公司/机构）");
    checkField("client_identity.industry", "请补充您所在的行业");
    checkField("client_identity.core_capabilities", "请补充您的核心能力");
    checkField("client_identity.products_or_projects", "请补充您的产品或项目");

    // business_goal 关键字段
    checkField("business_goal.primary_goal", "请补充您的主要目标");
    checkField("business_goal.success_definition", "请补充成功标准");
    checkField("business_goal.priority_order", "请补充优先级排序");

    // opportunity_type 关键字段
    checkField("opportunity_type.primary_types", "请补充主要机会类型");
    checkField("opportunity_type.excluded_types", "请补充排除的机会类型");
    checkField("opportunity_type.secondary_types", "请补充次要机会类型");

    // region_scope 关键字段
    checkField("region_scope.primary_regions", "请补充主要地域");
    checkField("region_scope.excluded_regions", "请补充排除地域");
    checkField("region_scope.secondary_regions", "请补充次要地域");

    // exclusion_rules
    if (!info.exclusion_rules || (info.exclusion_rules.count ?? 0) === 0) {
      checkField("exclusion_rules.must_exclude", "请补充排除条件");
    }

    // action_scenario 关键字段
    checkField("action_scenario.action_intent", "请补充行动意图");
    checkField("action_scenario.priority_order", "请补充行动优先级");

    // report_format 关键字段
    checkField("report_format.frequency", "请补充报告频率");
    checkField("report_format.format", "请补充报告格式");
    checkField("report_format.must_include_sections", "请补充必须包含的章节");

    return items;
  }

  /** 生成 summary */
  private buildSummary(userInput: string, confirmed: ConfirmedItem[]): string {
    if (confirmed.length === 0) {
      return `已收到您的输入："${userInput}"，但暂未从中提取到明确信息，请补充更多细节。`;
    }
    const summary = confirmed.map((c) => c.value).join("，");
    return `初步理解：您提到${summary}。`;
  }
}
