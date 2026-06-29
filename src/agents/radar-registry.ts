/**
 * RadarRegistry —— 雷达注册表（单例）
 *
 * V1.5-02 新增。管理内置雷达和自定义雷达的注册、查询、provider 路由。
 *
 * 设计原则：
 *   - 内置雷达幂等初始化（先 get 检查，已存在则跳过，不覆盖用户修改）
 *   - 内置雷达不可编辑/不可删除（updateRadar / archiveRadar 抛错）
 *   - getProvidersForRadar 兼容旧式 radar_type 字符串
 *   - 纯数据操作，不调 LLM
 */

import type { RadarKind, ProviderRouting } from "../schema/radar";
import type { Radar } from "../schema/radar";
import type {
  RadarStore,
  RadarCreateInput,
  RadarUpdateInput,
  RadarListFilter,
} from "./radar-store";

// ============================================================
// 内置雷达定义
// ============================================================

/** 内置雷达配置（稳定 ID + 默认 provider 路由） */
interface BuiltinRadarConfig {
  id: string;
  name: string;
  kind: RadarKind;
  providerRouting: ProviderRouting;
}

/**
 * 3 个内置雷达配置。
 *
 * 使用稳定 ID（builtin_xxx），确保多次初始化不重复创建。
 */
const BUILTIN_RADARS: BuiltinRadarConfig[] = [
  {
    id: "builtin_ai_competition",
    name: "AI 赛事雷达",
    kind: "ai_competition",
    providerRouting: { primary: ["serper", "exa"], fallback: [] },
  },
  {
    id: "builtin_opc_policy",
    name: "OPC 政策雷达",
    kind: "opc_policy",
    providerRouting: { primary: ["bocha", "google_cse"], fallback: [] },
  },
  {
    id: "builtin_cultural_heritage",
    name: "文创非遗雷达",
    kind: "cultural_heritage",
    providerRouting: { primary: ["bocha", "serper"], fallback: [] },
  },
];

/** 默认 fallback provider（未知雷达类型时使用） */
const DEFAULT_FALLBACK_PROVIDERS = ["serper"];

// ============================================================
// RadarRegistry 类
// ============================================================

/**
 * 雷达注册表。
 *
 * 封装 RadarStore，提供内置雷达管理、内置保护、provider 路由兼容。
 */
export class RadarRegistry {
  private readonly store: RadarStore;

  constructor(store: RadarStore) {
    this.store = store;
  }

  /**
   * 初始化：确保 3 个内置雷达存在（幂等）。
   *
   * 幂等逻辑：
   *   1. 对每个内置雷达 ID，先 store.get(id)
   *   2. 如果已存在，跳过（不覆盖，防止用户修改丢失）
   *   3. 如果不存在，用 store.create() 创建，传入 isBuiltin=true + ownerId="system"
   *   4. 调用 store.save() 持久化
   */
  initialize(): void {
    let created = false;
    for (const config of BUILTIN_RADARS) {
      const existing = this.store.get(config.id);
      if (existing) {
        continue;
      }
      const input: RadarCreateInput = {
        id: config.id,
        name: config.name,
        kind: config.kind,
        isBuiltin: true,
        ownerId: "system",
        providerRouting: config.providerRouting,
      };
      this.store.create(input);
      created = true;
    }
    if (created) {
      this.store.save();
    }
  }

  /** 按 ID 获取雷达 */
  getRadarById(id: string): Radar | null {
    return this.store.get(id);
  }

  /** 列出所有雷达（支持过滤） */
  listRadars(filter?: RadarListFilter): Radar[] {
    return this.store.list(filter);
  }

  /** 列出内置雷达 */
  getBuiltinRadars(): Radar[] {
    return this.store.list({ isBuiltin: true, includeArchived: false });
  }

  /** 列出自定义雷达（非内置，非归档） */
  getCustomRadars(): Radar[] {
    const all = this.store.list({ includeArchived: false });
    return all.filter((r) => !r.isBuiltin);
  }

  /** 创建自定义雷达 */
  createCustomRadar(input: RadarCreateInput): Radar {
    return this.store.create({
      ...input,
      isBuiltin: false,
    });
  }

  /**
   * 更新雷达（内置雷达抛错）。
   *
   * @throws Error 如果 id 对应内置雷达
   */
  updateRadar(id: string, patch: RadarUpdateInput): Radar | null {
    const radar = this.store.get(id);
    if (!radar) {
      return null;
    }
    if (radar.isBuiltin) {
      throw new Error(`内置雷达 ${id} 不可编辑`);
    }
    const updated = this.store.update(id, patch);
    if (updated) {
      this.store.save();
    }
    return updated;
  }

  /**
   * 归档雷达（内置雷达抛错）。
   *
   * @throws Error 如果 id 对应内置雷达
   */
  archiveRadar(id: string): Radar | null {
    const radar = this.store.get(id);
    if (!radar) {
      return null;
    }
    if (radar.isBuiltin) {
      throw new Error(`内置雷达 ${id} 不可删除`);
    }
    const archived = this.store.archive(id);
    if (archived) {
      this.store.save();
    }
    return archived;
  }

  /**
   * 获取雷达的 provider 列表（兼容旧 getProviderNamesForRadar）。
   *
   * 兼容逻辑：
   *   - 传入 radarId（如 "builtin_ai_competition"）→ 查 store 取 Radar → 返回 providerRouting.primary
   *   - 传入旧式 radar_type（如 "ai_competition"）→ 查 list 找 kind 匹配的内置雷达 → 返回其 providerRouting.primary
   *   - 都找不到 → fallback 到 ["serper"]
   */
  getProvidersForRadar(radarIdOrType: string): string[] {
    // 1. 先按 ID 查
    const radar = this.store.get(radarIdOrType);
    if (radar && radar.providerRouting) {
      return radar.providerRouting.primary;
    }

    // 2. 按旧式 radar_type 查（找 kind 匹配的内置雷达）
    const builtins = this.store.list({ isBuiltin: true, includeArchived: false });
    const matched = builtins.find((r) => r.kind === radarIdOrType);
    if (matched && matched.providerRouting) {
      return matched.providerRouting.primary;
    }

    // 3. fallback
    return DEFAULT_FALLBACK_PROVIDERS;
  }
}
