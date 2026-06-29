/**
 * Meilisearch 机会库实现
 *
 * 来源：Task 023 第 4.1 节。
 *
 * 实现 OpportunityStore 接口，用 Meilisearch 作为后端存储。
 * 支持 STORE_TYPE=meili 时自动启用。
 *
 * 设计原则：
 *   - 接口完全兼容 LocalFileStore，业务代码零改动
 *   - dedup_key 作为主键（primaryKey）
 *   - 搜索字段索引：title / type / organizer / region / match_reason
 *   - 筛选字段索引：radar_type / visible_level / status / deadline
 *   - 排序字段索引：added_at / deadline / backend_score / visible_level
 *
 * 设计决策（任务书约束 2 + 5 优先级高于 4.1 节代码示例）：
 *   OpportunityStore 接口的方法是同步的（add 返回 StoreEntry，非 Promise），
 *   且约束 2 禁止修改 opportunity-store.ts。因此 MeilisearchStore 采用
 *   "内存缓存 + 可选 Meilisearch 后端"模式：
 *     - 同步方法操作内存 Map（与 LocalFileStore 逻辑一致）
 *     - 异步方法 syncToMeili() / loadFromMeili() 与 Meilisearch 同步
 *     - 异步方法 search() 提供 Meilisearch 全文搜索能力
 *     - mockMode=true 时纯内存运行，search() 用 substring 匹配（用于测试）
 *   这样既能通过 tsc 编译（接口同步），又能保留 Meilisearch 全文搜索能力。
 */

// 使用 require 避免 moduleResolution 兼容性问题（meilisearch 类型声明需要 node16）
// 定义最小类型接口，不依赖 meilisearch 包的类型声明
/* eslint-disable @typescript-eslint/no-explicit-any */
const MeiliSearchModule = require("meilisearch") as {
  MeiliSearch: new (config: { host: string; apiKey?: string }) => MeiliSearchClient;
};

/** Meilisearch 客户端最小接口（仅覆盖本模块用到的方法） */
interface MeiliSearchClient {
  createIndex(name: string, options?: { primaryKey: string }): Promise<unknown>;
  index(name: string): MeiliSearchIndex;
  health(): Promise<unknown>;
}

/** Meilisearch 索引最小接口 */
interface MeiliSearchIndex {
  updateSearchableAttributes(attrs: string[]): Promise<unknown>;
  updateFilterableAttributes(attrs: string[]): Promise<unknown>;
  updateSortableAttributes(attrs: string[]): Promise<unknown>;
  addDocuments(docs: Record<string, unknown>[]): Promise<unknown>;
  deleteDocument(key: string): Promise<unknown>;
  getDocument<T>(key: string): Promise<T>;
  search(
    query: string,
    options?: Record<string, unknown>,
  ): Promise<{
    hits: Record<string, unknown>[];
    estimatedTotalHits: number;
  }>;
}

import type {
  OpportunityStore,
  StoreEntry,
  StoreQuery,
  StoreQueryResult,
  StoreStats,
  RadarType,
} from "./opportunity-store";
import { computeDedupKey } from "./opportunity-store";
import type { OpportunityCard, OpportunityCardStatus } from "../schema/opportunity-card";
import type { CardVisibleLevel } from "../schema/scoring-rules";

// ============================================================
// 常量
// ============================================================

/** 索引名称 */
const INDEX_NAME = "opportunities";

/** 默认 Meilisearch 主机 */
const DEFAULT_HOST = "http://127.0.0.1:7700";

/** 默认分页大小 */
const DEFAULT_PAGE_SIZE = 20;

/** 即将截止阈值（天） */
const EXPIRING_SOON_DAYS = 7;

/** 可见等级优先级（数字越小优先级越高） */
const VISIBLE_LEVEL_PRIORITY: Record<CardVisibleLevel | "hidden", number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  hidden: 5,
};

/** 雷达类型列表 */
const RADAR_TYPES: RadarType[] = ["ai_competition", "opc_policy", "cultural_heritage"];

/** 可见等级列表（含 hidden） */
const VISIBLE_LEVELS: Array<CardVisibleLevel | "hidden"> = ["S", "A", "B", "C", "D", "hidden"];

/** 卡片状态列表 */
const CARD_STATUSES: OpportunityCardStatus[] = [
  "new",
  "viewed",
  "saved",
  "applied",
  "archived",
  "dismissed",
];

// ============================================================
// 辅助函数
// ============================================================

/** 获取当前 ISO 时间 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 计算距今天数（向下取整，负数表示已截止）。
 * 与 opportunity-store.ts 中 daysUntilDeadline 逻辑一致，独立实现避免循环依赖。
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

/** 判断是否即将截止（7 天内，含当天） */
function isExpiringSoon(deadline: string): boolean {
  const days = daysUntilDeadline(deadline);
  if (Number.isNaN(days)) return false;
  return days >= 0 && days <= EXPIRING_SOON_DAYS;
}

/**
 * 将 StoreEntry 转换为 Meilisearch 文档（扁平化，便于搜索和筛选）。
 *
 * Meilisearch 文档结构：
 *   - 主键：dedup_key
 *   - 卡片字段扁平化：card_title / card_type / card_visible_level / ...
 *   - 元数据：radar_type / added_at / updated_at / dedup_key
 */
export function entryToDocument(entry: StoreEntry): Record<string, unknown> {
  const card = entry.card;
  return {
    dedup_key: entry.dedup_key,
    radar_type: entry.radar_type,
    added_at: entry.added_at,
    updated_at: entry.updated_at,
    // 扁平化卡片字段（便于 Meilisearch 搜索和筛选）
    card_title: card.title,
    card_type: card.type,
    card_organizer: card.organizer,
    card_region: card.region,
    card_deadline: card.deadline,
    card_reward_or_value: card.reward_or_value,
    card_eligibility: card.eligibility,
    card_official_source_url: card.official_source_url,
    card_visible_level: card.visible_level,
    card_backend_score: card.backend_score,
    card_status: card.status,
    card_match_reason: card.match_reason ?? "",
    card_guid: card.guid ?? "",
    // 保留完整 card JSON（用于还原，避免字段丢失）
    _card_json: JSON.stringify(card),
  };
}

// ============================================================
// MeilisearchStore 实现
// ============================================================

export interface MeilisearchStoreOptions {
  /** Meilisearch 主机地址（默认 http://127.0.0.1:7700） */
  host?: string;
  /** API Key（本地嵌入式可为空） */
  apiKey?: string;
  /** 索引名称（默认 opportunities） */
  indexName?: string;
  /** 是否自动 flush（默认 true，与 LocalFileStore 一致） */
  autoFlush?: boolean;
  /**
   * Mock 模式：true=纯内存运行（不连接 Meilisearch），false=连接真实 Meilisearch。
   * 默认 false。验证脚本使用 true 避免依赖外部服务。
   */
  mockMode?: boolean;
}

export class MeilisearchStore implements OpportunityStore {
  /** 内存缓存（与 LocalFileStore 相同的内存 Map 模式） */
  private readonly entries: Map<string, StoreEntry> = new Map();
  /** Meilisearch 客户端（mockMode=true 时为 null） */
  private readonly client: MeiliSearchClient | null;
  /** 索引名称 */
  private readonly indexName: string;
  /** 是否自动 flush */
  private readonly autoFlush: boolean;
  /** 是否为 Mock 模式（纯内存） */
  private mockMode: boolean;
  /** 是否已初始化索引配置 */
  private initialized: boolean = false;

  constructor(options: MeilisearchStoreOptions = {}) {
    this.indexName = options.indexName ?? INDEX_NAME;
    this.autoFlush = options.autoFlush ?? true;
    this.mockMode = options.mockMode ?? false;

    if (this.mockMode) {
      // Mock 模式：不创建 MeiliSearch 客户端
      this.client = null;
    } else {
      // 真实模式：创建 MeiliSearch 客户端
      const host = options.host ?? process.env.MEILI_HOST ?? DEFAULT_HOST;
      const apiKey = options.apiKey ?? process.env.MEILI_API_KEY ?? "";
      try {
        this.client = new MeiliSearchModule.MeiliSearch({ host, apiKey });
      } catch {
        // 构造失败降级为 Mock 模式
        this.mockMode = true;
        this.client = null;
        console.warn("[MeilisearchStore] 客户端创建失败，降级为 Mock 模式");
      }
    }
  }

  /**
   * 初始化索引配置（设置主键 + 搜索属性 + 筛选属性 + 排序属性）。
   * 幂等操作，重复调用无副作用。Mock 模式下空操作。
   */
  async ensureInit(): Promise<void> {
    if (this.mockMode || !this.client || this.initialized) return;

    try {
      // 创建索引（如不存在），设置主键为 dedup_key
      await this.client.createIndex(this.indexName, { primaryKey: "dedup_key" });

      const index = this.client.index(this.indexName);

      // 设置可搜索属性
      await index.updateSearchableAttributes([
        "card_title",
        "card_type",
        "card_organizer",
        "card_match_reason",
        "card_reward_or_value",
      ]);

      // 设置可筛选属性
      await index.updateFilterableAttributes([
        "radar_type",
        "card_visible_level",
        "card_status",
        "card_deadline",
        "card_region",
        "dedup_key",
      ]);

      // 设置可排序属性
      await index.updateSortableAttributes([
        "added_at",
        "card_deadline",
        "card_backend_score",
        "card_visible_level",
      ]);

      this.initialized = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MeilisearchStore] 索引初始化失败: ${msg}`);
    }
  }

  /** 添加卡片（自动去重） */
  add(card: OpportunityCard, radar_type: RadarType, radarId?: string): StoreEntry {
    const dedupKey = computeDedupKey(card.title, card.official_source_url, card.guid);
    const existing = this.entries.get(dedupKey);
    const now = nowIso();

    let entry: StoreEntry;
    if (existing) {
      entry = {
        ...existing,
        card: { ...card },
        updated_at: now,
        ...(radarId !== undefined ? { radarId } : {}),
      };
    } else {
      entry = {
        card: { ...card },
        radar_type,
        added_at: now,
        updated_at: now,
        dedup_key: dedupKey,
        ...(radarId !== undefined ? { radarId } : {}),
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
      const dedupKey = computeDedupKey(card.title, card.official_source_url, card.guid);
      const existing = this.entries.get(dedupKey);
      const now = nowIso();
      let entry: StoreEntry;
      if (existing) {
        entry = {
          ...existing,
          card: { ...card },
          updated_at: now,
          ...(radarId !== undefined ? { radarId } : {}),
        };
      } else {
        entry = {
          card: { ...card },
          radar_type,
          added_at: now,
          updated_at: now,
          dedup_key: dedupKey,
          ...(radarId !== undefined ? { radarId } : {}),
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
      filtered = filtered.filter((e) => e.radarId === query.radarId);
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

  /**
   * 持久化到存储。
   * Mock 模式下空操作（纯内存）。真实模式下异步同步到 Meilisearch（fire-and-forget）。
   */
  flush(): void {
    if (this.mockMode || !this.client) return;
    // fire-and-forget 异步同步，不阻塞同步调用方
    void this.syncToMeili().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MeilisearchStore] flush 同步失败: ${msg}`);
    });
  }

  /**
   * 从存储加载。
   * Mock 模式下空操作。真实模式下异步从 Meilisearch 加载（fire-and-forget）。
   * 注意：由于 load() 是 void 接口，无法等待异步完成。如需确保加载完成，请用 loadFromMeili()。
   */
  load(): void {
    if (this.mockMode || !this.client) return;
    // fire-and-forget 异步加载
    void this.loadFromMeili().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MeilisearchStore] load 失败: ${msg}`);
    });
  }

  // ============================================================
  // Meilisearch 独有能力（异步方法，不在 OpportunityStore 接口中）
  // ============================================================

  /**
   * 全文搜索（Meilisearch 独有能力，LocalFileStore 没有）。
   *
   * 真实模式：调用 Meilisearch 全文搜索（中文分词 + 拼写纠错 + 相关度排序）。
   * Mock 模式：内存 substring 匹配（用于测试，无真实分词）。
   */
  async search(
    keyword: string,
    options?: { limit?: number; radar_type?: RadarType },
  ): Promise<StoreEntry[]> {
    const limit = options?.limit ?? 20;

    if (this.mockMode || !this.client) {
      // Mock 模式：内存 substring 匹配
      const kw = keyword.toLowerCase();
      let results = Array.from(this.entries.values()).filter((e) => {
        const title = (e.card.title ?? "").toLowerCase();
        const type = (e.card.type ?? "").toLowerCase();
        const organizer = (e.card.organizer ?? "").toLowerCase();
        const region = (e.card.region ?? "").toLowerCase();
        const matchReason = (e.card.match_reason ?? "").toLowerCase();
        return (
          title.includes(kw) ||
          type.includes(kw) ||
          organizer.includes(kw) ||
          region.includes(kw) ||
          matchReason.includes(kw)
        );
      });
      if (options?.radar_type) {
        results = results.filter((e) => e.radar_type === options.radar_type);
      }
      return results.slice(0, limit);
    }

    // 真实模式：Meilisearch 全文搜索
    await this.ensureInit();
    const index = this.client.index(this.indexName);
    const filter = options?.radar_type ? `radar_type = "${options.radar_type}"` : undefined;
    const result = await index.search(keyword, { filter, limit });
    return result.hits
      .map((hit) => this.documentToEntry(hit as unknown as Record<string, unknown>))
      .filter((e): e is StoreEntry => e !== null);
  }

  /**
   * 将内存数据异步同步到 Meilisearch（批量写入）。
   * 真实模式独有，Mock 模式空操作。
   */
  async syncToMeili(): Promise<void> {
    if (this.mockMode || !this.client) return;
    await this.ensureInit();
    const index = this.client.index(this.indexName);
    const docs = Array.from(this.entries.values()).map(entryToDocument);
    if (docs.length > 0) {
      await index.addDocuments(docs);
    }
  }

  /**
   * 从 Meilisearch 异步加载到内存。
   * 真实模式独有，Mock 模式空操作。
   */
  async loadFromMeili(): Promise<void> {
    if (this.mockMode || !this.client) return;
    await this.ensureInit();
    const index = this.client.index(this.indexName);
    const result = await index.search("", { limit: 100000 });
    this.entries.clear();
    for (const hit of result.hits) {
      const entry = this.documentToEntry(hit as unknown as Record<string, unknown>);
      if (entry) {
        this.entries.set(entry.dedup_key, entry);
      }
    }
  }

  /**
   * 将 Meilisearch 文档还原为 StoreEntry。
   * 真实模式独有（Mock 模式不调用）。
   * 优先从 _card_json 还原完整 card，避免字段丢失。
   */
  private documentToEntry(doc: Record<string, unknown>): StoreEntry | null {
    if (!doc || typeof doc.dedup_key !== "string") return null;
    const radarType = doc.radar_type as RadarType;
    if (!radarType) return null;

    // 优先从 _card_json 还原完整 card
    const cardJson = doc._card_json;
    let card: OpportunityCard | null = null;
    if (typeof cardJson === "string") {
      try {
        card = JSON.parse(cardJson) as OpportunityCard;
      } catch {
        card = null;
      }
    }

    // 如果 _card_json 不存在或解析失败，从扁平字段重建（补充默认值）
    if (!card) {
      card = {
        title: (doc.card_title as string) ?? "",
        type: (doc.card_type as string) ?? "",
        organizer: (doc.card_organizer as string) ?? "",
        region: (doc.card_region as string) ?? "",
        deadline: (doc.card_deadline as string) ?? "",
        reward_or_value: (doc.card_reward_or_value as string) ?? "",
        eligibility: (doc.card_eligibility as string) ?? "",
        materials_required: "",
        match_reason: (doc.card_match_reason as string) ?? "",
        next_action: "",
        official_source_url: (doc.card_official_source_url as string) ?? "",
        application_url: "",
        contact_info: "",
        risk_note: "",
        backend_score: (doc.card_backend_score as number) ?? 0,
        visible_level: ((doc.card_visible_level as CardVisibleLevel) ?? "C"),
        status: ((doc.card_status as OpportunityCardStatus) ?? "new"),
        guid: (doc.card_guid as string) || undefined,
      };
    }

    return {
      dedup_key: doc.dedup_key as string,
      radar_type: radarType,
      added_at: (doc.added_at as string) ?? nowIso(),
      updated_at: (doc.updated_at as string) ?? nowIso(),
      card,
    };
  }

  /** 是否为 Mock 模式（调试用） */
  isMockMode(): boolean {
    return this.mockMode;
  }
}
