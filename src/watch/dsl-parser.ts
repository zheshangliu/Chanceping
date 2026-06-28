/**
 * Watch Rules DSL 解析器
 *
 * 来源：Task 021 第 4.2 节。
 *
 * 提供：
 *   - parseLine：解析单行 DSL 为 WatchRule
 *   - parseWatchRules：解析多行文本为 WatchRuleSet
 *
 * 纯函数，不接 LLM，不编造信息。
 */

import type {
  WatchCondition,
  WatchOperator,
  WatchRule,
  WatchRuleSet,
  WatchParseError,
} from "./types";
import type { RadarType } from "../agents/opportunity-store";
import type { CardVisibleLevel } from "../schema/scoring-rules";

// ============================================================
// 常量
// ============================================================

/** 合法雷达类型集合 */
const VALID_RADAR_TYPES: Set<string> = new Set([
  "ai_competition",
  "opc_policy",
  "cultural_heritage",
]);

/** 合法可见等级集合 */
const VALID_LEVELS: Set<string> = new Set(["S", "A", "B", "C"]);

/** 默认组名 */
const DEFAULT_GROUP_NAME = "默认规则";

/** 前缀 → 操作符映射 */
const PREFIX_TO_OPERATOR: Record<string, WatchOperator> = {
  "+": "include",
  "!": "exclude",
  "@": "radar",
  "#": "level",
  "$": "region",
  "%": "deadline",
  "*": "starred",
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * 提取组名。
 * 查找行中第一个 [...] 模式，返回组名和移除组名后的行。
 * 无组名返回 null，行不变。
 */
function extractGroupName(line: string): { name: string | null; rest: string } {
  const match = line.match(/\[([^\]]+)\]/);
  if (!match) return { name: null, rest: line };
  const name = match[1].trim();
  const rest = line.replace(match[0], " ");
  return { name, rest };
}

/**
 * 将一行文本按条件前缀分词。
 *
 * 策略：用正则在前缀字符前插入分隔符，然后 split。
 * 前缀字符：+ ! @ # $ % *
 *
 * 注意：* 可能出现在关键词中（如 "C++"），但行首或空格后的 * 才是操作符。
 * 为简化：只在"行首或空格后紧跟前缀字符"时识别为操作符。
 */
function tokenizeConditions(text: string): Array<{ prefix: string; value: string }> {
  // 在前缀字符前插入 \x00 分隔符（仅当前面是行首或空格时）
  const withSeparators = text.replace(
    /(^|\s)([+!@#$%*])/g,
    (_match, pre, prefix) => `${pre}\x00${prefix}`,
  );
  // 按 \x00 分割
  const parts = withSeparators.split("\x00").filter((s) => s.trim().length > 0);
  return parts.map((part) => {
    const trimmed = part.trim();
    const prefix = trimmed[0];
    const value = trimmed.slice(1).trim();
    return { prefix, value };
  });
}

/**
 * 验证雷达类型值。
 */
function validateRadarType(value: string, lineNumber: number): WatchParseError | null {
  if (!VALID_RADAR_TYPES.has(value)) {
    return {
      line_number: lineNumber,
      raw_line: "",
      message: `无效的雷达类型 "${value}"，合法值：ai_competition / opc_policy / cultural_heritage`,
    };
  }
  return null;
}

/**
 * 解析等级条件值（如 "AB" → ["A", "B"]）。
 */
function parseLevelValue(value: string): { levels: CardVisibleLevel[]; error: string | null } {
  if (!value || value.length === 0) {
    return { levels: [], error: "等级条件不能为空" };
  }
  const chars = value.toUpperCase().split("");
  const levels: CardVisibleLevel[] = [];
  for (const ch of chars) {
    if (!VALID_LEVELS.has(ch)) {
      return { levels: [], error: `无效的等级 "${ch}"，合法值：S / A / B / C` };
    }
    levels.push(ch as CardVisibleLevel);
  }
  return { levels, error: null };
}

/**
 * 解析天数条件值（如 "7" → 7）。
 */
function parseDeadlineValue(value: string): { days: number; error: string | null } {
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num < 0) {
    return { days: 0, error: `无效的天数 "${value}"，必须是非负整数` };
  }
  return { days: num, error: null };
}

// ============================================================
// 核心解析函数
// ============================================================

/**
 * 解析单行 DSL 为 WatchRule。
 *
 * @param line DSL 文本行
 * @param lineNumber 行号（从 1 开始）
 * @returns WatchRule 或 null（空行/注释行返回 null，无错误）
 */
export function parseLine(line: string, lineNumber: number): WatchRule | null {
  const trimmed = line.trim();

  // 空行
  if (!trimmed) return null;

  // 注释行：# 后跟空格，或整行只有 #
  if (/^#\s/.test(trimmed) || trimmed === "#") return null;

  // 提取组名
  const { name, rest } = extractGroupName(trimmed);
  const groupName = name ?? DEFAULT_GROUP_NAME;

  // 分词
  const tokens = tokenizeConditions(rest);
  if (tokens.length === 0) {
    // 只有组名没有条件 → 无效，返回 null（错误在 parseWatchRules 中收集）
    return null;
  }

  const conditions: WatchCondition[] = [];
  for (const token of tokens) {
    const operator = PREFIX_TO_OPERATOR[token.prefix];
    if (!operator) {
      // 未知前缀，跳过（不报错，容错）
      continue;
    }

    if (operator === "starred") {
      conditions.push({ operator, value: true });
      continue;
    }

    if (token.value === "") {
      // 前缀后无值（如 "+" 单独出现），跳过
      continue;
    }

    switch (operator) {
      case "include":
      case "exclude":
      case "region":
        conditions.push({ operator, value: token.value });
        break;
      case "radar":
        conditions.push({ operator, value: token.value as RadarType });
        break;
      case "level": {
        const { levels, error } = parseLevelValue(token.value);
        if (error) {
          // 跳过无效等级，但不中断
          continue;
        }
        conditions.push({ operator, value: levels });
        break;
      }
      case "deadline": {
        const { days, error } = parseDeadlineValue(token.value);
        if (error) {
          continue;
        }
        conditions.push({ operator, value: days });
        break;
      }
    }
  }

  if (conditions.length === 0) {
    return null;
  }

  return {
    group_name: groupName,
    conditions,
    raw_text: trimmed,
    line_number: lineNumber,
  };
}

/**
 * 解析多行文本为 WatchRuleSet。
 *
 * 收集所有错误，不中断解析。
 *
 * @param text 多行 DSL 文本
 * @returns WatchRuleSet
 */
export function parseWatchRules(text: string): WatchRuleSet {
  const lines = text.split("\n");
  const rules: WatchRule[] = [];
  const errors: WatchParseError[] = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    // 空行和注释行跳过
    if (!trimmed || /^#\s/.test(trimmed) || trimmed === "#") {
      return;
    }

    const rule = parseLine(line, lineNumber);
    if (rule) {
      rules.push(rule);
    } else {
      // 有内容但解析失败
      // 检查是否只有组名
      const { name, rest } = extractGroupName(trimmed);
      if (name && rest.trim().length === 0) {
        errors.push({
          line_number: lineNumber,
          raw_line: trimmed,
          message: `规则 "${name}" 没有任何条件`,
        });
      } else if (rest.trim().length > 0) {
        // 有内容但条件解析失败
        errors.push({
          line_number: lineNumber,
          raw_line: trimmed,
          message: "条件解析失败，请检查语法",
        });
      }
    }
  });

  return { rules, errors, raw_text: text };
}
