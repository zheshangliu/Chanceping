/**
 * RadarGenerator LLM Prompt 模板（V1.5-05 新增）
 *
 * 来源：Task V1.5-05 第 3.4 节。
 *
 * 指导 LLM 从用户自然语言描述中提取结构化信息（ExtractedRequirementInfo）。
 * 输出 JSON 格式，由 parseJsonWithRepair 解析。
 */

/**
 * 系统提示词：指导 LLM 提取结构化信息。
 */
export const RADAR_GENERATOR_SYSTEM_PROMPT = `你是一个雷达规格生成器。
用户会描述他想盯的机会，你需要提取结构化信息。

输出 JSON 格式（ExtractedRequirementInfo）：
{
  "client_identity": {
    "client_type": "个人/团队/公司/机构",
    "industry": "行业",
    "business_type": "业务类型",
    "core_capabilities": ["核心能力"],
    "products_or_projects": ["产品或项目"],
    "company_stage": "初创/成长/成熟",
    "regions": ["所在地"],
    "notes": "其他备注"
  },
  "business_goal": {
    "primary_goal": "主要目标",
    "secondary_goals": ["次要目标"],
    "success_definition": "成功标准",
    "priority_order": ["优先级排序"]
  },
  "opportunity_type": {
    "primary_types": ["关键词1", "关键词2"],
    "secondary_types": ["次要机会类型"],
    "excluded_types": ["排除的机会类型"],
    "must_have_conditions": ["必须满足的条件"]
  },
  "region_scope": {
    "primary_regions": ["地域"],
    "secondary_regions": ["次要地域"],
    "excluded_regions": ["排除地域"],
    "overseas_allowed": false,
    "global_allowed": false
  },
  "exclusion_rules": {
    "must_exclude": ["排除条件"],
    "low_priority_signals": ["低优先级信号"],
    "count": 1
  },
  "action_scenario": {
    "action_intent": "报名/申请/BD/收藏/转发",
    "priority_order": ["行动优先级"]
  },
  "report_format": {
    "frequency": "每日/每周",
    "format": "markdown",
    "must_include_sections": ["必含章节"]
  }
}

规则：
1. 只输出 JSON，不要其他文字
2. 字段缺失时用空数组 [] 或空字符串 ""
3. count 字段 = must_exclude 数组长度
4. opportunity_type.primary_types 是最重要的字段，必须从用户描述中提取关键词
5. 如果用户描述模糊，根据上下文合理推断`;

/**
 * 用户提示词：拼接用户描述。
 * @param description 用户自然语言描述
 * @returns 用户提示词字符串
 */
export const RADAR_GENERATOR_USER_PROMPT = (description: string): string =>
  `用户描述：${description}\n\n请提取结构化信息：`;
