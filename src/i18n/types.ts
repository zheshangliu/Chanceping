/**
 * i18n 四层数据结构 + 术语表
 *
 * 来源：Task 018 第 4.1 节。
 *
 * 四层语言架构：UI Locale / Report Locale / Search Locale / Source Locale
 * 术语表 glossary：≥12 核心术语，用于统一中英翻译。
 */

/** 用户语言偏好（四层） */
export interface UserLocaleSettings {
  /** 界面语言 */
  uiLocale: string;
  /** 报告生成语言 */
  reportLocale: string;
  /** 搜索语言（可多选） */
  searchLocales: string[];
  /** 原文语言识别（'auto' 或具体 locale） */
  sourceLocale: "auto" | string;
  /** 是否显示原文来源 */
  displayOriginalSource: boolean;
  /** 时区 */
  timezone: string;
}

/** 机会数据多语字段（V1.1 落地，V0.8 预留类型） */
export interface MultilingualOpportunity {
  /** 原文标题 */
  titleOriginal: string;
  /** 中文标题 */
  titleZh: string;
  /** 原文摘要 */
  summaryOriginal: string;
  /** 中文摘要 */
  summaryZh: string;
  /** 原文语言 */
  sourceLocale: string;
  /** 翻译状态 */
  translationStatus: "original" | "ai_translated" | "human_verified";
  /** 官方链接 */
  officialLink: string;
}

/** 术语表（glossary）：中英互译 */
export const GLOSSARY: Record<string, Record<string, string>> = {
  "zh-CN": {
    盯机会: "ChancePing",
    机会雷达: "Opportunity Radar",
    需求确认卡: "Requirement Confirmation Card",
    雷达方案: "Radar Plan",
    机会报告: "Opportunity Report",
    弱信号: "Weak Signal",
    官方来源: "Official Source",
    可信度: "Confidence Level",
    "S 级机会": "S-Tier Opportunity",
    机会等级: "Opportunity Tier",
    搜索计划: "Search Plan",
    截止日期: "Deadline",
  },
  "en-US": {
    ChancePing: "盯机会",
    "Opportunity Radar": "机会雷达",
    "Requirement Confirmation Card": "需求确认卡",
    "Radar Plan": "雷达方案",
    "Opportunity Report": "机会报告",
    "Weak Signal": "弱信号",
    "Official Source": "官方来源",
    "Confidence Level": "可信度",
    "S-Tier Opportunity": "S 级机会",
    "Opportunity Tier": "机会等级",
    "Search Plan": "搜索计划",
    Deadline: "截止日期",
  },
};
