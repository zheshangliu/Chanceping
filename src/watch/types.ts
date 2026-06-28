/**
 * Watch Rules DSL 类型定义
 *
 * 来源：Task 021 第 4.1 节。
 *
 * 纯类型定义，无运行时逻辑，不引入依赖。
 */

import type { RadarType } from "../agents/opportunity-store";
import type { CardVisibleLevel } from "../schema/scoring-rules";
import type { StoreEntry } from "../agents/opportunity-store";

/** 条件操作符（对应 DSL 前缀） */
export type WatchOperator =
  | "include"    // +
  | "exclude"    // !
  | "radar"      // @
  | "level"      // #
  | "region"     // $
  | "deadline"   // %
  | "starred";   // *

/** 单个条件 */
export interface WatchCondition {
  /** 操作符 */
  operator: WatchOperator;
  /** 条件值
   * - include/exclude/region: 关键词字符串
   * - radar: RadarType
   * - level: CardVisibleLevel[]
   * - deadline: 数字（天数）
   * - starred: true（无实际值）
   */
  value: string | string[] | number | boolean;
}

/** 单条 Watch 规则（一行 DSL 解析结果） */
export interface WatchRule {
  /** 规则组名（默认 "默认规则"） */
  group_name: string;
  /** 条件列表 */
  conditions: WatchCondition[];
  /** 原始 DSL 文本（调试用） */
  raw_text: string;
  /** 行号（从 1 开始，注释行不计） */
  line_number: number;
}

/** 规则集（多行 DSL 解析结果） */
export interface WatchRuleSet {
  /** 规则列表 */
  rules: WatchRule[];
  /** 解析错误列表（不中断解析，收集所有错误） */
  errors: WatchParseError[];
  /** 原始文本 */
  raw_text: string;
}

/** 解析错误 */
export interface WatchParseError {
  /** 行号 */
  line_number: number;
  /** 错误行内容 */
  raw_line: string;
  /** 错误信息 */
  message: string;
}

/** 单条匹配结果 */
export interface MatchResult {
  /** 匹配的规则 */
  rule: WatchRule;
  /** 是否命中 */
  matched: boolean;
  /** 命中/未命中的原因（调试用） */
  reason: string;
  /** 各条件命中详情 */
  condition_details: Array<{
    condition: WatchCondition;
    passed: boolean;
    detail: string;
  }>;
}

/** 批量匹配汇总 */
export interface MatchSummary {
  /** 输入的条目数 */
  total_entries: number;
  /** 命中的条目数 */
  matched_entries: number;
  /** 每条规则命中的条目数 */
  by_rule: Array<{
    rule: WatchRule;
    matched_count: number;
  }>;
  /** 每个条目命中的规则数 */
  by_entry: Array<{
    entry: StoreEntry;
    matched_rules: WatchRule[];
  }>;
}
