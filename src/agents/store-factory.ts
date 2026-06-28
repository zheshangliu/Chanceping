/**
 * 机会库存储工厂
 *
 * 来源：Task 023 第 4.2 节。
 *
 * 通过 STORE_TYPE 环境变量切换存储实现：
 *   - STORE_TYPE=local（默认）：LocalFileStore
 *   - STORE_TYPE=meili：MeilisearchStore
 *
 * 业务代码通过 createStore() 获取实例，不直接 new 具体类。
 *
 * 降级策略（任务书约束 7）：
 *   - STORE_TYPE=meili 但 MEILI_HOST 未设置 → MeilisearchStore 以 mockMode 运行（纯内存）
 *   - MeilisearchStore 构造失败 → 内部降级为 mockMode
 *   - 这样保证 createStore() 永不抛错，系统始终可用
 */

import type { OpportunityStore } from "./opportunity-store";
import { createDefaultStore } from "./opportunity-store";
import { MeilisearchStore } from "./meilisearch-store";

/** 存储类型 */
export type StoreType = "local" | "meili";

/**
 * 根据环境变量创建机会库实例。
 *
 * 环境变量：
 *   - STORE_TYPE：存储类型（local|meili，默认 local）
 *   - MEILI_HOST：Meilisearch 主机（默认 http://127.0.0.1:7700）
 *   - MEILI_API_KEY：Meilisearch API Key（可选）
 *   - MEILI_MOCK：Meilisearch Mock 模式（"true" 时强制 mockMode，用于测试）
 *
 * @returns OpportunityStore 实例（LocalFileStore 或 MeilisearchStore）
 */
export function createStore(): OpportunityStore {
  const type = (process.env.STORE_TYPE ?? "local") as StoreType;

  switch (type) {
    case "meili": {
      const mockMode = process.env.MEILI_MOCK === "true";
      return new MeilisearchStore({
        host: process.env.MEILI_HOST,
        apiKey: process.env.MEILI_API_KEY,
        mockMode,
      });
    }
    case "local":
    default:
      return createDefaultStore();
  }
}

/**
 * 获取当前存储类型（调试用）。
 */
export function getStoreType(): StoreType {
  return (process.env.STORE_TYPE ?? "local") as StoreType;
}
