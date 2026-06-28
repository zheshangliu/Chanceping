/**
 * T9 已分析新闻去重表
 *
 * 来源：Task 024 第 4.2 节。
 *
 * 提供：
 *   - SearchDedupStore 接口：可插拔存储
 *   - LocalDedupStore：本地 JSON 文件实现（默认）
 *
 * 存储结构：URL → DedupRecord（content_hash + content_preview + cached_result + analyzed_at）
 *
 * 不引入新依赖，用 Node.js 内置 fs。
 */

import fs from "fs";
import path from "path";
import type { ScoredOpportunity } from "./types";

// ============================================================
// 类型定义
// ============================================================

/** 去重记录 */
export interface DedupRecord {
  /** URL */
  url: string;
  /** 内容 hash（SHA-256） */
  content_hash: string;
  /** 内容预览（前 500 字符，用于 change_ratio 计算） */
  content_preview: string;
  /** 缓存的分析结果 */
  cached_result: ScoredOpportunity | null;
  /** 分析时间（ISO） */
  analyzed_at: string;
}

/** 去重存储接口 */
export interface SearchDedupStore {
  /** 获取记录 */
  get(url: string): DedupRecord | null;
  /** 设置记录 */
  set(url: string, record: DedupRecord): void;
  /** 删除记录 */
  delete(url: string): boolean;
  /** 获取全部记录数 */
  count(): number;
  /** 清空 */
  clear(): void;
  /** 持久化 */
  flush(): void;
  /** 加载 */
  load(): void;
  /** 统计 */
  stats(): { total_analyzed: number; cache_hit_rate: number };
}

// ============================================================
// LocalDedupStore 实现
// ============================================================

/** 默认存储路径 */
const DEFAULT_STORE_PATH = "data/search-dedup.json";

/** 存储文件版本 */
const DEDUP_FILE_VERSION = "1.0";

/** 存储文件格式 */
interface DedupFile {
  version: string;
  records: Record<string, DedupRecord>;
}

/**
 * 本地 JSON 文件去重存储。
 *
 * 文件格式：
 *   { "version": "1.0", "records": { [url]: DedupRecord } }
 */
export class LocalDedupStore implements SearchDedupStore {
  private readonly filePath: string;
  private records: Map<string, DedupRecord> = new Map();
  private totalQueries: number = 0;
  private cacheHits: number = 0;

  constructor(options?: { file_path?: string }) {
    this.filePath = path.resolve(
      process.cwd(),
      options?.file_path ?? DEFAULT_STORE_PATH,
    );
  }

  get(url: string): DedupRecord | null {
    this.totalQueries++;
    const record = this.records.get(url) ?? null;
    if (record) this.cacheHits++;
    return record;
  }

  set(url: string, record: DedupRecord): void {
    this.records.set(url, record);
  }

  delete(url: string): boolean {
    return this.records.delete(url);
  }

  count(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.totalQueries = 0;
    this.cacheHits = 0;
  }

  flush(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: DedupFile = {
      version: DEDUP_FILE_VERSION,
      records: Object.fromEntries(this.records),
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as DedupFile;
      const records = data?.records ?? {};
      this.records = new Map(Object.entries(records));
    } catch {
      this.records = new Map();
    }
  }

  stats(): { total_analyzed: number; cache_hit_rate: number } {
    return {
      total_analyzed: this.records.size,
      cache_hit_rate: this.totalQueries > 0 ? this.cacheHits / this.totalQueries : 0,
    };
  }
}

// ============================================================
// 便捷工厂
// ============================================================

/**
 * 创建默认去重存储（本地文件实现，自动 load）。
 */
export function createDefaultDedupStore(): LocalDedupStore {
  const store = new LocalDedupStore();
  store.load();
  return store;
}
