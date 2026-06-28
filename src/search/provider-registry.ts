/**
 * T6 机会源注册表（provider registry）
 *
 * 来源：Task 019c 第 4.2 节。
 *
 * 搜索层第一层（全网搜索 API）的 Provider 管理中心：
 *   - 注册 / 注销 / 查询 Provider
 *   - 按雷达类型 / 可靠性等级筛选 Provider
 *   - 并行健康检查
 *
 * 可靠性评级（Admiralty Code）：
 *   A = 官方来源（gov.cn）
 *   B = 权威媒体
 *   C = 平台自发布
 *   D = 用户上传
 *   F = 不可信
 *
 * 纯 TS，不引入依赖。providerRegistry 单例在模块加载时自动注册 SerperProvider。
 */

import type { SearchResult, SearchOptions } from "./types";
import { SerperProvider } from "./providers/serper";

/** provider 可靠性评级（对接 Admiralty Code） */
export type ReliabilityGrade = "A" | "B" | "C" | "D" | "F";

/** 可靠性等级排序值（数字越大越可靠） */
const RELIABILITY_ORDER: Record<ReliabilityGrade, number> = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  F: 1,
};

/**
 * 搜索 Provider 接口。
 *
 * 所有搜索源（Serper / 博查 / Exa 等）都需实现此接口。
 */
export interface SearchProvider {
  /** provider 标识（如 "serper"） */
  name: string;
  /** 显示名（如 "Serper (Google SERP)"） */
  display_name: string;
  /** 来源类型 */
  source_type: "web" | "rss" | "social" | "gov";
  /** T6: 可靠性评级 */
  reliability: ReliabilityGrade;
  /** 是否启用 */
  enabled: boolean;
  /** 适用的雷达类型（如 ["ai_competition", "opc_policy"]） */
  radar_types: string[];

  /** 执行搜索 */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  /** 健康检查 */
  healthCheck(): Promise<boolean>;
}

/**
 * T6: Provider 注册表。
 *
 * 管理所有已注册的 SearchProvider，提供按雷达类型 / 可靠性筛选的能力。
 */
export class ProviderRegistry {
  private providers: Map<string, SearchProvider> = new Map();

  /** 注册 provider（同名覆盖） */
  register(provider: SearchProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** 注销 provider */
  unregister(name: string): void {
    this.providers.delete(name);
  }

  /** 按 name 获取 provider */
  get(name: string): SearchProvider | undefined {
    return this.providers.get(name);
  }

  /** 获取所有已启用的 provider */
  getEnabled(): SearchProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.enabled);
  }

  /** 按雷达类型获取 provider（radar_types 数组包含指定类型） */
  getByRadarType(radarType: string): SearchProvider[] {
    return Array.from(this.providers.values()).filter((p) =>
      p.radar_types.includes(radarType),
    );
  }

  /** 按最低可靠性等级获取 provider（返回 reliability ≥ minGrade 的） */
  getByReliability(minGrade: ReliabilityGrade): SearchProvider[] {
    const threshold = RELIABILITY_ORDER[minGrade];
    return Array.from(this.providers.values()).filter(
      (p) => RELIABILITY_ORDER[p.reliability] >= threshold,
    );
  }

  /** 并行健康检查所有 provider，返回 Map<name, healthy> */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const entries = Array.from(this.providers.values());
    const results = await Promise.all(
      entries.map(async (p) => {
        try {
          const healthy = await p.healthCheck();
          return [p.name, healthy] as const;
        } catch {
          return [p.name, false] as const;
        }
      }),
    );
    return new Map(results);
  }
}

/**
 * 全局注册表单例。
 *
 * 模块加载时创建，并自动注册 SerperProvider。
 */
export const providerRegistry: ProviderRegistry = new ProviderRegistry();

// 自动注册 SerperProvider（无 SERPER_API_KEY 时为 Mock 模式，不影响注册）
providerRegistry.register(new SerperProvider());
