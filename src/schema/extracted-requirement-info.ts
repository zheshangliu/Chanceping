/**
 * 从对话中已提取的结构化需求信息（extracted_requirement_info）
 *
 * 来源：Task 006 第 4.1 节。
 *
 * 这是确认度计算引擎的输入——每个字段的有无和详细程度决定对应维度的得分。
 * LLM 从对话中提取这些信息的逻辑属于 Task 007，本任务只接收这个结构作为输入。
 */

/**
 * 从对话中已提取的结构化需求信息。
 * 每个维度对应 RequirementConfidence 的一个确认度维度。
 * 字段的有无和详细程度决定对应维度的得分（基于 Task 002 的 CONFIDENCE_CALCULATION_SPEC 4 档标准）。
 */
export interface ExtractedRequirementInfo {
  /** 客户身份相关（对应 client_identity 维度） */
  client_identity: {
    client_type?: string;           // 个人/团队/公司/机构
    industry?: string;              // 行业
    business_type?: string;         // 业务类型
    core_capabilities?: string[];   // 核心能力
    products_or_projects?: string[];// 产品或项目
    company_stage?: string;         // 公司阶段
    regions?: string[];             // 所在地
    notes?: string;                 // 其他备注
  };

  /** 业务目标相关（对应 business_goal 维度） */
  business_goal: {
    primary_goal?: string;          // 主要目标
    secondary_goals?: string[];     // 次要目标
    success_definition?: string;    // 成功标准
    priority_order?: string[];      // 优先级排序
  };

  /** 机会类型相关（对应 opportunity_type 维度） */
  opportunity_type: {
    primary_types?: string[];       // 主要机会类型
    secondary_types?: string[];     // 次要机会类型
    excluded_types?: string[];      // 排除的机会类型
    must_have_conditions?: string[];// 必须满足的条件
  };

  /** 地域范围相关（对应 region_scope 维度） */
  region_scope: {
    primary_regions?: string[];     // 主要地域
    secondary_regions?: string[];   // 次要地域
    excluded_regions?: string[];    // 排除地域
    overseas_allowed?: boolean;     // 是否接受海外
    global_allowed?: boolean;       // 是否接受全球
  };

  /** 排除条件相关（对应 exclusion_rules 维度） */
  exclusion_rules: {
    must_exclude?: string[];        // 必须排除
    low_priority_signals?: string[];// 低优先级信号
    count: number;                  // 排除条件总数
  };

  /** 行动场景相关（对应 action_scenario 维度） */
  action_scenario: {
    action_intent?: string;         // 行动意图（报名/申请/BD/收藏/转发）
    priority_order?: string[];      // 行动优先级
  };

  /** 报告形式相关（对应 report_format 维度） */
  report_format: {
    frequency?: string;             // 报告频率
    format?: string;                // 报告格式
    must_include_sections?: string[];// 必须包含的章节
  };
}

/** 生成一份全空的 ExtractedRequirementInfo（所有字段未填充） */
export function createEmptyExtractedInfo(): ExtractedRequirementInfo {
  return {
    client_identity: {},
    business_goal: {},
    opportunity_type: {},
    region_scope: {},
    exclusion_rules: { count: 0 },
    action_scenario: {},
    report_format: {},
  };
}
