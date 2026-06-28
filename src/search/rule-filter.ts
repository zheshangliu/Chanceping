/**
 * T10 第一层：规则粗筛（rule filter）
 *
 * 来源：Task 019d 第 4.1 节。
 *
 * 快速剔除明显无关项，降低后续 LLM 调用量。
 * 六条规则按顺序应用：
 *   1. 关键词匹配（title + snippet 含 core_keywords_zh / core_keywords_en 之一）
 *   2. 地域过滤（title + snippet 含 excluded_regions → 拒绝）
 *   3. 排除规则（title + snippet 含 filter_rules.must_exclude → 拒绝）
 *   4. URL 安全校验（T1 validateLink，invalid → 拒绝）
 *   5. URL 标准化（T3 normalizeUrl，对 passed 更新 url 字段）
 *   6. 去重（同一 url 只保留第一条）
 *
 * 纯函数，无副作用，不引入依赖。
 * 注意：spec 实际字段为 filter_rules.must_exclude（任务书 4.1 节写的 exclusion_rules 是笔误）。
 */

import type { SearchResult } from "./types";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import { validateLink } from "../utils/link-validator";
import { normalizeUrl } from "../utils/url-normalizer";

/** 规则粗筛结果 */
export interface RuleFilterResult {
  /** 通过的结果 */
  passed: SearchResult[];
  /** 被拒绝的结果 */
  rejected: SearchResult[];
  /** 拒绝原因映射：url → 原因 */
  reject_reasons: Map<string, string>;
}

/**
 * 判断文本是否含关键词数组中的任一词。
 * @param text 待检测文本
 * @param keywords 关键词数组
 * @returns true 表示命中任一关键词
 */
function containsAny(text: string, keywords: string[]): boolean {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  return keywords.some((kw) => {
    if (typeof kw !== "string" || kw === "") return false;
    return text.includes(kw);
  });
}

/**
 * T10 第一层：规则粗筛。
 *
 * @param results 原始搜索结果
 * @param spec 雷达需求规格
 * @returns RuleFilterResult（passed / rejected / reject_reasons）
 */
export function ruleFilter(
  results: SearchResult[],
  spec: RadarRequirementSpec,
): RuleFilterResult {
  const passed: SearchResult[] = [];
  const rejected: SearchResult[] = [];
  const rejectReasons = new Map<string, string>();

  // 已通过 url 集合（用于去重）
  const seenUrls = new Set<string>();

  // 边界情况：空数组
  if (!Array.isArray(results) || results.length === 0) {
    return { passed, rejected, reject_reasons: rejectReasons };
  }

  // 提取 spec 字段（兼容缺失情况）
  const coreKeywordsZh: string[] = spec?.keyword_strategy?.core_keywords_zh ?? [];
  const coreKeywordsEn: string[] = spec?.keyword_strategy?.core_keywords_en ?? [];
  const excludedRegions: string[] = spec?.region_scope?.excluded_regions ?? [];
  // 任务书 4.1 写 exclusion_rules.must_exclude，实际 schema 是 filter_rules.must_exclude
  const mustExclude: string[] = spec?.filter_rules?.must_exclude ?? [];

  // 是否启用关键词规则（无关键词策略时全部通过此规则）
  const hasKeywordStrategy = coreKeywordsZh.length > 0 || coreKeywordsEn.length > 0;

  for (const result of results) {
    // 边界情况：缺字段
    if (!result || typeof result !== "object") {
      continue;
    }
    const title = result.title ?? "";
    const snippet = result.snippet ?? "";
    const text = `${title} ${snippet}`;
    const url = result.url ?? "";

    // 规则 1：关键词匹配
    if (hasKeywordStrategy) {
      const kwMatched = containsAny(text, coreKeywordsZh) || containsAny(text, coreKeywordsEn);
      if (!kwMatched) {
        rejected.push(result);
        rejectReasons.set(url, "关键词不匹配");
        continue;
      }
    }

    // 规则 2：地域过滤
    if (excludedRegions.length > 0 && containsAny(text, excludedRegions)) {
      rejected.push(result);
      rejectReasons.set(url, "地域排除");
      continue;
    }

    // 规则 3：排除规则
    if (mustExclude.length > 0 && containsAny(text, mustExclude)) {
      rejected.push(result);
      rejectReasons.set(url, "命中排除规则");
      continue;
    }

    // 规则 4：URL 安全校验（T1）
    const linkCheck = validateLink(url);
    if (!linkCheck.valid) {
      rejected.push(result);
      rejectReasons.set(url, `URL 安全校验失败: ${linkCheck.reason ?? "unknown"}`);
      continue;
    }

    // 规则 5：URL 标准化（T3）
    const normalizedUrl = normalizeUrl(url);

    // 规则 6：去重（同一 url 只保留第一条）
    if (seenUrls.has(normalizedUrl)) {
      rejected.push(result);
      rejectReasons.set(url, "URL 重复");
      continue;
    }
    seenUrls.add(normalizedUrl);

    // 通过所有规则：加入 passed，更新 url 为标准化后的值
    passed.push({
      ...result,
      url: normalizedUrl,
    });
  }

  return { passed, rejected, reject_reasons: rejectReasons };
}
