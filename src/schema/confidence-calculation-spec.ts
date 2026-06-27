/**
 * 确认度计算逻辑规格（打分指引）
 *
 * 来源：02 号文档第 2 节第四步 + 第 4 节问题库 + Task 002 第 4.4 节。
 *
 * 本任务不实现"从对话推断各维度 score"的逻辑（那是 Task 006 的职责）。
 * 本文件只定义规格——每个维度的判断标准和打分指引，供 Task 006 实现时参考。
 *
 * 权重值与 Task 001 的 CONFIDENCE_WEIGHTS 完全一致，不重复定义常量，通过 import 引用。
 */

import {
  CONFIDENCE_WEIGHTS,
  type ConfidenceDimensionKey,
} from "./requirement-confidence";

/** 确认度维度打分指引 */
export interface ConfidenceDimensionSpec {
  /** 维度键（已在 Task 001 定义） */
  dimension: ConfidenceDimensionKey;
  /** 权重（与 CONFIDENCE_WEIGHTS 一致） */
  weight: number;
  /** 该维度衡量什么 */
  what_it_measures: string;
  /** 分档打分指引 */
  scoring_guide: {
    /** 0–49 分：什么情况打这个区间 */
    score_0_to_49: string;
    /** 50–69 分 */
    score_50_to_69: string;
    /** 70–89 分 */
    score_70_to_89: string;
    /** 90–100 分 */
    score_90_to_100: string;
  };
  /** 关联的追问问题（来自 question-bank） */
  related_questions: string[];
}

/**
 * 确认度计算规格（7 个维度）。
 * 判断标准基于 02 号文档第 2 节第四步 + Task 002 第 4.4 节表格。
 * weight 值与 CONFIDENCE_WEIGHTS 一致。
 */
export const CONFIDENCE_CALCULATION_SPEC: ConfidenceDimensionSpec[] = [
  {
    dimension: "client_identity",
    weight: CONFIDENCE_WEIGHTS.client_identity,
    what_it_measures: "是否知道用户是谁、做什么行业",
    scoring_guide: {
      score_0_to_49: "完全不知道用户身份",
      score_50_to_69: "知道是个人/公司但行业不明",
      score_70_to_89: "知道身份+行业但细节不全",
      score_90_to_100: "身份、行业、能力、作品均清晰",
    },
    related_questions: [
      "你是个人、团队、公司，还是机构？",
      "你目前主要做什么业务？",
      "你是个人参赛，还是团队 / 公司参赛？",
      "你是个人创业、个体户、有限公司，还是准备注册公司？",
      "你是个人设计师、工作室，还是公司参赛？",
    ],
  },
  {
    dimension: "business_goal",
    weight: CONFIDENCE_WEIGHTS.business_goal,
    what_it_measures: "是否知道用户想通过雷达获得什么",
    scoring_guide: {
      score_0_to_49: "目标完全不明",
      score_50_to_69: "知道大概方向但不含具体目标",
      score_70_to_89: "有明确目标但成功标准未定义",
      score_90_to_100: "目标+成功标准+优先级均清晰",
    },
    related_questions: [
      "你最想通过这个雷达获得什么？",
      "你希望优先找奖金高的比赛，还是适合快速做 Demo 的比赛？",
      "你希望优先找「容易申请」的政策，还是「金额更高」的政策？",
      "你更重视奖金、政府背书、曝光，还是实际合作机会？",
    ],
  },
  {
    dimension: "opportunity_type",
    weight: CONFIDENCE_WEIGHTS.opportunity_type,
    what_it_measures: "是否知道要找比赛/政策/补贴/客户/项目",
    scoring_guide: {
      score_0_to_49: "机会类型完全不明",
      score_50_to_69: "知道大类但子类不明",
      score_70_to_89: "知道子类但排除条件未定义",
      score_90_to_100: "主类型+次类型+排除类型均清晰",
    },
    related_questions: [
      "你希望雷达主要搜索哪几类机会？",
      "你更关注 AI 视频、AI 动漫、AI 游戏、AI 应用，还是 AI Agent？",
      "你目前最想找创业补贴、社保补贴、人才补贴、科技项目，还是场地补贴？",
      "你希望找比赛、展会、政策、品牌合作，还是城市礼物征集？",
    ],
  },
  {
    dimension: "region_scope",
    weight: CONFIDENCE_WEIGHTS.region_scope,
    what_it_measures: "是否知道搜索范围",
    scoring_guide: {
      score_0_to_49: "地域完全不明",
      score_50_to_69: "知道国内/海外但不确定",
      score_70_to_89: "知道主要地域但边界模糊",
      score_90_to_100: "主要+次要+排除地域均清晰",
    },
    related_questions: [
      "你只看中国大陆机会，还是也看海外机会？",
      "你的公司注册在哪个城市？",
      "你是否接受英文比赛和海外平台？",
      "你是否只关注大湾区，还是全国政策也可以？",
    ],
  },
  {
    dimension: "exclusion_rules",
    weight: CONFIDENCE_WEIGHTS.exclusion_rules,
    what_it_measures: "是否知道哪些机会不要推",
    scoring_guide: {
      score_0_to_49: "无任何排除条件",
      score_50_to_69: "有1条排除条件",
      score_70_to_89: "有2–3条排除条件",
      score_90_to_100: "排除条件全面且合理",
    },
    related_questions: [
      "哪些机会你完全不想看？",
      "学生类比赛是否要排除？",
    ],
  },
  {
    dimension: "action_scenario",
    weight: CONFIDENCE_WEIGHTS.action_scenario,
    what_it_measures: "是否知道用户拿到机会后的行动",
    scoring_guide: {
      score_0_to_49: "行动意图完全不明",
      score_50_to_69: "知道大概但不确定",
      score_70_to_89: "知道主要行动但优先级不明",
      score_90_to_100: "行动意图+优先级均清晰",
    },
    related_questions: [
      "你拿到机会后，是准备报名、申请、BD、收藏，还是转发给团队？",
    ],
  },
  {
    dimension: "report_format",
    weight: CONFIDENCE_WEIGHTS.report_format,
    what_it_measures: "是否知道交付频率、格式、报告结构",
    scoring_guide: {
      score_0_to_49: "形式完全不明",
      score_50_to_69: "知道频率但格式不明",
      score_70_to_89: "知道频率+格式但结构未定义",
      score_90_to_100: "频率+格式+结构均清晰",
    },
    related_questions: [
      "你希望每周收到一份报告，还是每天更新？",
    ],
  },
];
