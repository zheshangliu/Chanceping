/**
 * 雷达路由 + URL 去重
 *
 * 来源：Task 026 第 5.4 节。
 *
 * 提供：
 *   - RADAR_ROUTING：雷达路由规则常量（与搜索层选型决策 V1.0 一致）
 *   - getProviderNamesForRadar：按雷达类型返回 Provider 名称数组
 *   - deduplicateByUrL：多 Provider 结果按 URL 去重（保留第一条）
 *
 * 纯函数，不引入依赖。
 */

import type { SearchResult } from "./types";
import { normalizeUrl } from "../utils/url-normalizer";

// ============================================================
// 雷达路由规则
// ============================================================

/**
 * 雷达路由规则（与搜索层选型决策 V1.0 一致）。
 *
 * 每个雷达类型对应一个 Provider 名称数组，按优先级排序：
 *   - ai_competition → Serper 主力 + Exa 语义
 *   - opc_policy → 博查主力 + Google CSE（限定 gov.cn）
 *   - cultural_heritage → 博查主力 + Serper 补充
 */
export const RADAR_ROUTING: Record<string, string[]> = {
  ai_competition: ["serper", "exa"],
  opc_policy: ["bocha", "google_cse"],
  cultural_heritage: ["bocha", "serper"],
};

/** 默认 fallback Provider（未知雷达类型时使用） */
const DEFAULT_PROVIDERS = ["serper"];

/**
 * 获取雷达类型对应的 Provider 名称列表。
 *
 * @param radarType 雷达类型
 * @returns Provider 名称数组（如 ["serper", "exa"]），未知类型 fallback 到 ["serper"]
 */
export function getProviderNamesForRadar(radarType: string): string[] {
  return RADAR_ROUTING[radarType] ?? DEFAULT_PROVIDERS;
}

// ============================================================
// URL 去重
// ============================================================

/**
 * 按 URL 去重搜索结果。
 *
 * 多 Provider 并行搜索时，同一 URL 可能被多个 Provider 返回。
 * 去重策略：按 normalizeUrl(url) 去重，保留第一条出现的结果（保留 source_provider 信息）。
 *
 * @param results 合并后的搜索结果
 * @returns 去重后的结果
 */
export function deduplicateByUrL(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const normalizedUrl = normalizeUrl(result.url);
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      deduped.push(result);
    }
  }

  return deduped;
}
