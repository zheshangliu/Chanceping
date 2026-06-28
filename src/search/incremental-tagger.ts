/**
 * T9 增量标签管理
 *
 * 来源：Task 024 第 4.1 节。
 *
 * 核心：
 *   - hashContent：计算内容 hash（SHA-256，用 Node.js 内置 crypto）
 *   - isAnalyzed：检查 URL + contentHash 是否已分析过
 *   - markAnalyzed：记录已分析
 *   - computeChangeRatio：计算内容变化比例（0-1）
 *   - needsReanalysis：是否需要重新分析（change_ratio > 阈值）
 *
 * 设计：
 *   - 纯逻辑层，不依赖具体存储（接 SearchDedupStore 接口）
 *   - hash 算法用 SHA-256（crypto.createHash）
 *   - change_ratio 用简单字符差异比例（Levenshtein 简化版）
 *
 * 不引入新依赖，用 Node.js 内置 crypto。
 */

import crypto from "crypto";
import type { ScoredOpportunity } from "./types";
import type { SearchDedupStore, DedupRecord } from "./search-dedup-store";

// ============================================================
// 类型定义
// ============================================================

/** 增量标签结果 */
export interface IncrementalTagResult {
  /** 搜索结果 URL */
  url: string;
  /** 内容 hash */
  content_hash: string;
  /** 是否已分析过（hash 命中） */
  is_analyzed: boolean;
  /** 是否需要重新分析（change_ratio > 阈值） */
  needs_reanalysis: boolean;
  /** 内容变化比例（0-1，1 表示完全不同） */
  change_ratio: number;
  /** 缓存的分析结果（is_analyzed=true 时有值） */
  cached_result: ScoredOpportunity | null;
}

/** 增量标签配置 */
export interface IncrementalTaggerOptions {
  /** 内容变化阈值（0-1，默认 0.3，超过此比例需重新分析） */
  change_threshold?: number;
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 计算内容 hash（SHA-256）。
 *
 * @param content 文本内容
 * @returns 64 字符十六进制 hash
 */
export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * 计算两个字符串的变化比例（0-1）。
 *
 * 简化算法：基于字符级差异比例。
 * 0 = 完全相同，1 = 完全不同。
 *
 * @param oldContent 旧内容
 * @param newContent 新内容
 * @returns 变化比例
 */
export function computeChangeRatio(oldContent: string, newContent: string): number {
  if (oldContent === newContent) return 0;
  if (!oldContent || !newContent) return 1;

  // 简化：用长度差异 + 共同字符比例估算
  const maxLen = Math.max(oldContent.length, newContent.length);
  const minLen = Math.min(oldContent.length, newContent.length);
  if (maxLen === 0) return 0;

  // 长度差异比例
  const lengthDiffRatio = (maxLen - minLen) / maxLen;

  // 字符集差异（用 Set 交集，取前 1000 字符避免大文本性能问题）
  const oldChars = new Set(oldContent.slice(0, 1000).split(""));
  const newChars = new Set(newContent.slice(0, 1000).split(""));
  const intersection = new Set([...oldChars].filter((c) => newChars.has(c)));
  const union = new Set([...oldChars, ...newChars]);
  const charDiffRatio = union.size > 0 ? 1 - intersection.size / union.size : 0;

  // 无任何共同字符 → 完全不同，直接返回 1
  if (intersection.size === 0 && oldChars.size > 0 && newChars.size > 0) {
    return 1;
  }

  // 加权平均（长度差异权重 0.4，字符差异权重 0.6）
  return Math.min(1, lengthDiffRatio * 0.4 + charDiffRatio * 0.6);
}

// ============================================================
// IncrementalTagger 类
// ============================================================

/**
 * 增量标签管理器。
 *
 * 配合 SearchDedupStore 使用：
 *   - tagOpportunity：标记单个搜索结果，返回是否需要重新分析
 *   - tagBatch：批量标记
 *   - markAnalyzed：记录分析结果（供下次复用）
 *
 * 通过 change_threshold 阈值控制是否需要重新分析：
 *   - change_ratio <= threshold：复用缓存（is_analyzed=true, needs_reanalysis=false）
 *   - change_ratio > threshold：需重新分析（is_analyzed=false, needs_reanalysis=true）
 */
export class IncrementalTagger {
  private readonly store: SearchDedupStore;
  private readonly changeThreshold: number;

  constructor(store: SearchDedupStore, options?: IncrementalTaggerOptions) {
    this.store = store;
    this.changeThreshold = options?.change_threshold ?? 0.3;
  }

  /**
   * 标记单个搜索结果。
   *
   * 逻辑：
   *   1. 计算 content hash
   *   2. 查询去重表
   *   3. 如果 hash 完全匹配 → is_analyzed=true, needs_reanalysis=false
   *   4. 如果 URL 匹配但 hash 不同 → 计算 change_ratio，判断是否需重新分析
   *   5. 如果完全没匹配 → needs_reanalysis=true
   *
   * @param url 搜索结果 URL
   * @param content 内容（title + snippet 或正文）
   * @param opportunity 可选的评分结果（用于缓存）
   */
  tagOpportunity(
    url: string,
    content: string,
    opportunity?: ScoredOpportunity,
  ): IncrementalTagResult {
    const contentHash = hashContent(content);
    const existing = this.store.get(url);

    // 情况 1：URL + hash 完全匹配 → 直接复用
    if (existing && existing.content_hash === contentHash) {
      return {
        url,
        content_hash: contentHash,
        is_analyzed: true,
        needs_reanalysis: false,
        change_ratio: 0,
        cached_result: existing.cached_result ?? null,
      };
    }

    // 情况 2：URL 匹配但 hash 不同 → 计算 change_ratio
    if (existing) {
      const changeRatio = computeChangeRatio(existing.content_preview, content);
      const needsReanalysis = changeRatio > this.changeThreshold;
      return {
        url,
        content_hash: contentHash,
        is_analyzed: !needsReanalysis,
        needs_reanalysis: needsReanalysis,
        change_ratio: changeRatio,
        cached_result: needsReanalysis ? null : existing.cached_result ?? null,
      };
    }

    // 情况 3：完全没匹配 → 需要分析
    return {
      url,
      content_hash: contentHash,
      is_analyzed: false,
      needs_reanalysis: true,
      change_ratio: 1,
      cached_result: null,
    };
  }

  /**
   * 批量标记搜索结果。
   *
   * @param opportunities ScoredOpportunity 列表
   * @returns 每条结果的标签
   */
  tagBatch(opportunities: ScoredOpportunity[]): IncrementalTagResult[] {
    return opportunities.map((opp) => {
      const url = opp.search_result.url;
      const content = [
        opp.search_result.title,
        opp.search_result.snippet,
        opp.cleaned_content.main_text,
      ].join("\n");
      return this.tagOpportunity(url, content, opp);
    });
  }

  /**
   * 记录分析结果（供下次复用）。
   *
   * @param url URL
   * @param content 内容
   * @param result 分析结果
   */
  markAnalyzed(url: string, content: string, result: ScoredOpportunity): void {
    const contentHash = hashContent(content);
    const record: DedupRecord = {
      url,
      content_hash: contentHash,
      content_preview: content.slice(0, 500),
      cached_result: result,
      analyzed_at: new Date().toISOString(),
    };
    this.store.set(url, record);
  }

  /**
   * 批量记录分析结果。
   */
  markBatchAnalyzed(opportunities: ScoredOpportunity[]): void {
    for (const opp of opportunities) {
      const url = opp.search_result.url;
      const content = [
        opp.search_result.title,
        opp.search_result.snippet,
        opp.cleaned_content.main_text,
      ].join("\n");
      this.markAnalyzed(url, content, opp);
    }
  }

  /**
   * 获取去重统计。
   */
  getStats(): { total_analyzed: number; cache_hit_rate: number } {
    return this.store.stats();
  }
}
