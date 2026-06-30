/**
 * 机会库基础（opportunity_store）
 *
 * 来源：Task 015 第 4.1 节。
 *
 * 提供：
 *   - OpportunityStore 接口：可插拔存储接口（V0.6 本地文件，V0.8 Meilisearch）
 *   - LocalFileStore：本地 JSON 文件实现
 *   - computeDedupKey：基于 title + official_source_url 的去重 key
 *   - createDefaultStore：便捷工厂函数
 *
 * 纯函数 + Node.js fs，不接 LLM，不编造信息。
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { OpportunityCard, OpportunityCardStatus } from "../schema/opportunity-card";
import type { CardVisibleLevel } from "../schema/scoring-rules";

// ============================================================
// 类型定义
// ============================================================

/** 雷达类型（取自 Task 003-005 三大雷达） */
export type RadarType = "ai_competition" | "opc_policy" | "cultural_heritage";

/** 机会库条目（卡片 + 元数据） */
export interface StoreEntry {
  /** 机会卡片 */
  card: OpportunityCard;
  /** 所属雷达类型 */
  radar_type: RadarType;
  /** 入库时间（ISO 字符串） */
  added_at: string;
  /** 最后更新时间（ISO 字符串） */
  updated_at: string;
  /** 去重 key（title + official_source_url 的 hash） */
  dedup_key: string;
  /** V1.5-03 新增：所属雷达 ID（向后兼容，仅存首次入库的 radarId） */
  radarId?: string;
  /** V1.5 自检新增：多雷达归属（同一机会可被多个雷达搜到） */
  radarIds?: string[];
}

/** 查询条件 */
export interface StoreQuery {
  /** 按雷达类型筛选 */
  radar_type?: RadarType;
  /** 按可见等级筛选 */
  visible_level?: CardVisibleLevel;
  /** 按状态筛选 */
  status?: OpportunityCardStatus;
  /** 按截止日期范围筛选 - 开始（YYYY-MM-DD） */
  deadline_from?: string;
  /** 按截止日期范围筛选 - 结束（YYYY-MM-DD） */
  deadline_to?: string;
  /** 仅看已收藏（status=saved） */
  starred_only?: boolean;
  /** 仅看即将截止（7 天内，含当天） */
  expiring_soon?: boolean;
  /** 排序字段 */
  sort_by?: "added_at" | "deadline" | "backend_score" | "visible_level";
  /** 排序方向 */
  sort_order?: "asc" | "desc";
  /** 分页 - 页码（从 1 开始） */
  page?: number;
  /** 分页 - 每页数量 */
  page_size?: number;
  /** V1.5-03 新增：按雷达 ID 筛选 */
  radarId?: string;
}

/** 查询结果 */
export interface StoreQueryResult {
  entries: StoreEntry[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** 机会库统计 */
export interface StoreStats {
  total: number;
  by_radar_type: Record<RadarType, number>;
  by_visible_level: Record<CardVisibleLevel | "hidden", number>;
  by_status: Record<OpportunityCardStatus, number>;
  starred_count: number;
  expiring_soon_count: number;
}

/** 机会库存储接口（V0.6 本地文件实现，V0.8 Meilisearch 实现） */
export interface OpportunityStore {
  /** 添加卡片（自动去重） */
  add(card: OpportunityCard, radar_type: RadarType, radarId?: string): StoreEntry;
  /** 批量添加 */
  addBatch(cards: OpportunityCard[], radar_type: RadarType, radarId?: string): StoreEntry[];
  /** 按 dedup_key 获取 */
  get(dedup_key: string): StoreEntry | null;
  /** 查询 */
  list(query: StoreQuery): StoreQueryResult;
  /** 更新卡片（含状态转换） */
  update(dedup_key: string, updates: Partial<OpportunityCard>): StoreEntry | null;
  /** 删除 */
  delete(dedup_key: string): boolean;
  /** 获取统计 */
  stats(): StoreStats;
  /** 持久化到存储 */
  flush(): void;
  /** 从存储加载 */
  load(): void;
}

/** 存储文件格式 */
interface StoreFile {
  version: string;
  updated_at: string;
  entries: StoreEntry[];
}

// ============================================================
// 常量
// ============================================================

/** 默认存储文件路径 */
const DEFAULT_STORE_PATH = "data/opportunity-store.json";

/** 存储文件版本 */
const STORE_FILE_VERSION = "1.0";

/** 即将截止阈值（天） */
const EXPIRING_SOON_DAYS = 7;

/** 默认分页大小 */
const DEFAULT_PAGE_SIZE = 20;

/** 可见等级优先级映射（数字越小优先级越高，S > A > B > C > D） */
const VISIBLE_LEVEL_PRIORITY: Record<CardVisibleLevel | "hidden", number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  hidden: 5,
};

/** 雷达类型列表（用于 stats 初始化） */
const RADAR_TYPES: RadarType[] = ["ai_competition", "opc_policy", "cultural_heritage"];

/** 卡片状态列表（用于 stats 初始化） */
const CARD_STATUSES: OpportunityCardStatus[] = [
  "new",
  "viewed",
  "saved",
  "applied",
  "archived",
  "dismissed",
];

/** 可见等级列表（用于 stats 初始化，含 hidden） */
const VISIBLE_LEVELS: Array<CardVisibleLevel | "hidden"> = ["S", "A", "B", "C", "D", "hidden"];

// ============================================================
// 辅助函数
// ============================================================

/**
 * 计算 dedup_key（T2 升级：guid > url 去重优先级）。
 *
 * 规则（Task 019b 第 4.2 节）：
 *   - 有 guid 时：dedup_key = sha256(guid).slice(0,16)，title 和 url 不参与计算
 *   - 无 guid 时：dedup_key = sha256(title|url).slice(0,16)（现有逻辑，向后兼容）
 *
 * 理由（Task 015 附录 A.2）：
 *   - title：机会名称是核心标识
 *   - official_source_url：官方链接是唯一来源
 *   - 两者组合可区分不同机会
 *   - guid：RSS/搜索源提供的全局唯一标识，优先级最高，避免同一机会不同 URL 重复入库
 *
 * 向后兼容：不传 guid 时行为与现有完全一致（`sha256(title|url).slice(0,16)`）。
 *
 * @param title 机会名称
 * @param official_source_url 官方来源链接
 * @param guid 全局唯一标识（可选，T2 新增）
 * @returns 16 位 hex 字符串
 */
export function computeDedupKey(
  title: string,
  official_source_url: string,
  guid?: string,
): string {
  // T2: 有 guid 时优先用 guid 去重
  if (guid && guid !== "") {
    return crypto.createHash("sha256").update(guid, "utf-8").digest("hex").slice(0, 16);
  }
  // 无 guid 时使用现有逻辑（向后兼容）
  const raw = `${title}|${official_source_url}`;
  return crypto.createHash("sha256").update(raw, "utf-8").digest("hex").slice(0, 16);
}

/**
 * 计算距今天数（向下取整，负数表示已截止）。
 * 与 card-template.ts 中 daysUntilDeadline 逻辑一致，但本模块独立实现以避免循环依赖。
 *
 * @param deadline 截止日期（YYYY-MM-DD 或 ISO 字符串）
 * @param baseDate 基准日期（默认当前时间）
 * @returns 距今天数；无法解析返回 NaN
 */
function daysUntilDeadline(deadline: string, baseDate: Date = new Date()): number {
  const dateStr = (deadline ?? "").split("T")[0];
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NaN;
  }
  const target = new Date(`${dateStr}T00:00:00Z`);
  const base = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()),
  );
  const diffMs = target.getTime() - base.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * 判断是否即将截止（7 天内，含当天）。
 *
 * @param deadline 截止日期
 * @returns true 表示 0 <= 距今天数 <= 7
 */
function isExpiringSoon(deadline: string): boolean {
  const days = daysUntilDeadline(deadline);
  if (Number.isNaN(days)) return false;
  return days >= 0 && days <= EXPIRING_SOON_DAYS;
}

/** 获取当前 ISO 时间字符串 */
function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================
// LocalFileStore 实现
// ============================================================

/**
 * 本地 JSON 文件存储实现。
 *
 * 内存中维护 Map<dedup_key, StoreEntry>，flush() 写入 JSON 文件，load() 读取。
 * V0.8 替换为 MeilisearchStore 时业务代码不用改。
 */
export class LocalFileStore implements OpportunityStore {
  /** 内存索引 */
  private entries: Map<string, StoreEntry> = new Map();
  /** 存储文件绝对路径 */
  private readonly filePath: string;
  /** 是否自动 flush */
  private readonly autoFlush: boolean;

  constructor(options: { file_path?: string; auto_flush?: boolean } = {}) {
    const filePath = options.file_path ?? DEFAULT_STORE_PATH;
    this.filePath = path.resolve(process.cwd(), filePath);
    this.autoFlush = options.auto_flush ?? true;
  }

  /** 添加卡片（自动去重） */
  add(card: OpportunityCard, radar_type: RadarType, radarId?: string): StoreEntry {
    const dedupKey = computeDedupKey(card.title, card.official_source_url, card.guid);
    const existing = this.entries.get(dedupKey);
    const now = nowIso();

    let entry: StoreEntry;
    if (existing) {
      // 已存在：更新卡片内容，保留 added_at，更新 updated_at
      // V1.5 自检：radarIds 多雷达归属去重追加
      const existingRadarIds = existing.radarIds ?? (existing.radarId ? [existing.radarId] : []);
      const mergedRadarIds = radarId && !existingRadarIds.includes(radarId)
        ? [...existingRadarIds, radarId]
        : existingRadarIds;
      entry = {
        ...existing,
        card: { ...card },
        updated_at: now,
        ...(radarId !== undefined ? { radarId } : {}),
        radarIds: mergedRadarIds,
      };
    } else {
      // 不存在：新增条目
      entry = {
        card: { ...card },
        radar_type,
        added_at: now,
        updated_at: now,
        dedup_key: dedupKey,
        ...(radarId !== undefined ? { radarId } : {}),
        ...(radarId !== undefined ? { radarIds: [radarId] } : {}),
      };
    }
    this.entries.set(dedupKey, entry);

    if (this.autoFlush) {
      this.flush();
    }
    return entry;
  }

  /** 批量添加 */
  addBatch(cards: OpportunityCard[], radar_type: RadarType, radarId?: string): StoreEntry[] {
    const results: StoreEntry[] = [];
    for (const card of cards) {
      // 批量添加时暂不自动 flush，最后统一 flush
      const dedupKey = computeDedupKey(card.title, card.official_source_url, card.guid);
      const existing = this.entries.get(dedupKey);
      const now = nowIso();
      let entry: StoreEntry;
      if (existing) {
        // V1.5 自检：radarIds 多雷达归属去重追加
        const existingRadarIds = existing.radarIds ?? (existing.radarId ? [existing.radarId] : []);
        const mergedRadarIds = radarId && !existingRadarIds.includes(radarId)
          ? [...existingRadarIds, radarId]
          : existingRadarIds;
        entry = {
          ...existing,
          card: { ...card },
          updated_at: now,
          ...(radarId !== undefined ? { radarId } : {}),
          radarIds: mergedRadarIds,
        };
      } else {
        entry = {
          card: { ...card },
          radar_type,
          added_at: now,
          updated_at: now,
          dedup_key: dedupKey,
          ...(radarId !== undefined ? { radarId } : {}),
          ...(radarId !== undefined ? { radarIds: [radarId] } : {}),
        };
      }
      this.entries.set(dedupKey, entry);
      results.push(entry);
    }
    if (this.autoFlush) {
      this.flush();
    }
    return results;
  }

  /** 按 dedup_key 获取 */
  get(dedup_key: string): StoreEntry | null {
    return this.entries.get(dedup_key) ?? null;
  }

  /** 查询 */
  list(query: StoreQuery): StoreQueryResult {
    // 1. 筛选
    let filtered = Array.from(this.entries.values());
    if (query.radar_type) {
      filtered = filtered.filter((e) => e.radar_type === query.radar_type);
    }
    if (query.visible_level) {
      filtered = filtered.filter((e) => e.card.visible_level === query.visible_level);
    }
    if (query.status) {
      filtered = filtered.filter((e) => e.card.status === query.status);
    }
    if (query.deadline_from) {
      filtered = filtered.filter((e) => e.card.deadline >= query.deadline_from!);
    }
    if (query.deadline_to) {
      filtered = filtered.filter((e) => e.card.deadline <= query.deadline_to!);
    }
    if (query.starred_only) {
      filtered = filtered.filter((e) => e.card.status === "saved");
    }
    if (query.expiring_soon) {
      filtered = filtered.filter((e) => isExpiringSoon(e.card.deadline));
    }
    if (query.radarId) {
      // V1.5 自检：同时检查 radarId（旧字段）和 radarIds（多雷达归属）
      filtered = filtered.filter((e) =>
        e.radarId === query.radarId || (e.radarIds && e.radarIds.includes(query.radarId!)),
      );
    }

    // 2. 排序
    const sortBy = query.sort_by ?? "added_at";
    const sortOrder = query.sort_order ?? (sortBy === "added_at" ? "desc" : "asc");
    const dir = sortOrder === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "added_at") {
        cmp = a.added_at.localeCompare(b.added_at);
      } else if (sortBy === "deadline") {
        cmp = a.card.deadline.localeCompare(b.card.deadline);
      } else if (sortBy === "backend_score") {
        cmp = a.card.backend_score - b.card.backend_score;
      } else if (sortBy === "visible_level") {
        const aPri = VISIBLE_LEVEL_PRIORITY[a.card.visible_level];
        const bPri = VISIBLE_LEVEL_PRIORITY[b.card.visible_level];
        cmp = aPri - bPri;
      }
      return cmp * dir;
    });

    // 3. 分页
    const total = filtered.length;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const page = query.page ?? 1;
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const start = (page - 1) * pageSize;
    const pageEntries = filtered.slice(start, start + pageSize);

    return {
      entries: pageEntries,
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
    };
  }

  /** 更新卡片（含状态转换） */
  update(dedup_key: string, updates: Partial<OpportunityCard>): StoreEntry | null {
    const existing = this.entries.get(dedup_key);
    if (!existing) return null;
    const updated: StoreEntry = {
      ...existing,
      card: { ...existing.card, ...updates },
      updated_at: nowIso(),
    };
    this.entries.set(dedup_key, updated);
    if (this.autoFlush) {
      this.flush();
    }
    return updated;
  }

  /** 删除 */
  delete(dedup_key: string): boolean {
    const existed = this.entries.delete(dedup_key);
    if (existed && this.autoFlush) {
      this.flush();
    }
    return existed;
  }

  /** 获取统计 */
  stats(): StoreStats {
    const all = Array.from(this.entries.values());
    const byRadarType = {} as Record<RadarType, number>;
    const byVisibleLevel = {} as Record<CardVisibleLevel | "hidden", number>;
    const byStatus = {} as Record<OpportunityCardStatus, number>;
    for (const rt of RADAR_TYPES) byRadarType[rt] = 0;
    for (const vl of VISIBLE_LEVELS) byVisibleLevel[vl] = 0;
    for (const st of CARD_STATUSES) byStatus[st] = 0;

    let starredCount = 0;
    let expiringSoonCount = 0;

    for (const e of all) {
      byRadarType[e.radar_type]++;
      byVisibleLevel[e.card.visible_level]++;
      byStatus[e.card.status]++;
      if (e.card.status === "saved") starredCount++;
      if (isExpiringSoon(e.card.deadline)) expiringSoonCount++;
    }

    return {
      total: all.length,
      by_radar_type: byRadarType,
      by_visible_level: byVisibleLevel,
      by_status: byStatus,
      starred_count: starredCount,
      expiring_soon_count: expiringSoonCount,
    };
  }

  /** 持久化到存储 */
  flush(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const file: StoreFile = {
      version: STORE_FILE_VERSION,
      updated_at: nowIso(),
      entries: Array.from(this.entries.values()),
    };
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
  }

  /** 从存储加载 */
  load(): void {
    if (!fs.existsSync(this.filePath)) {
      this.entries.clear();
      return;
    }
    const raw = fs.readFileSync(this.filePath, "utf-8");
    try {
      const file = JSON.parse(raw) as StoreFile;
      this.entries.clear();
      if (file && Array.isArray(file.entries)) {
        for (const e of file.entries) {
          if (e && typeof e.dedup_key === "string") {
            this.entries.set(e.dedup_key, e);
          }
        }
      }
    } catch {
      // 文件损坏：清空内存，避免脏数据
      this.entries.clear();
    }
  }
}

// ============================================================
// 便捷工厂函数
// ============================================================

/**
 * 创建默认机会库实例。
 *
 * 默认配置：
 *   - file_path: data/opportunity-store.json
 *   - auto_flush: true
 */
export function createDefaultStore(): LocalFileStore {
  return new LocalFileStore({});
}
