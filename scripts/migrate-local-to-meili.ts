/**
 * 数据迁移脚本：LocalFileStore → MeilisearchStore
 *
 * 来源：Task 023 第 4.4 节。
 *
 * 运行：npx tsx scripts/migrate-local-to-meili.ts
 *
 * 流程：
 *   1. 从 data/opportunity-store.json 加载全部条目（LocalFileStore）
 *   2. 连接 Meilisearch（MeilisearchStore，真实模式）
 *   3. 批量写入 Meilisearch（addDocuments）
 *   4. 验证迁移结果（条目数一致 + 抽样数据一致）
 *
 * 前置条件：
 *   - Meilisearch 服务已启动（默认 http://127.0.0.1:7700）
 *   - data/opportunity-store.json 存在
 *
 * 环境变量：
 *   - MEILI_HOST：Meilisearch 主机（默认 http://127.0.0.1:7700）
 *   - MEILI_API_KEY：Meilisearch API Key（可选）
 *   - STORE_PATH：源数据文件路径（默认 data/opportunity-store.json）
 */

import { LocalFileStore } from "../src/agents/opportunity-store";
import type { StoreEntry } from "../src/agents/opportunity-store";
import { MeilisearchStore, entryToDocument } from "../src/agents/meilisearch-store";

// 使用 require 避免 moduleResolution 兼容性问题
const MeiliSearchModule = require("meilisearch") as {
  MeiliSearch: new (config: { host: string; apiKey?: string }) => {
    health(): Promise<unknown>;
    createIndex(name: string, options?: { primaryKey: string }): Promise<unknown>;
    index(name: string): {
      updateSearchableAttributes(attrs: string[]): Promise<unknown>;
      updateFilterableAttributes(attrs: string[]): Promise<unknown>;
      updateSortableAttributes(attrs: string[]): Promise<unknown>;
      addDocuments(docs: Record<string, unknown>[]): Promise<unknown>;
    };
  };
};

const DEFAULT_HOST = "http://127.0.0.1:7700";
const INDEX_NAME = "opportunities";
const DEFAULT_STORE_PATH = "data/opportunity-store.json";

async function main(): Promise<void> {
  const sourcePath = process.env.STORE_PATH ?? DEFAULT_STORE_PATH;
  const meiliHost = process.env.MEILI_HOST ?? DEFAULT_HOST;
  const meiliApiKey = process.env.MEILI_API_KEY ?? "";

  console.log("=== 数据迁移：LocalFileStore → MeilisearchStore ===");
  console.log(`源文件：${sourcePath}`);
  console.log(`Meilisearch：${meiliHost}`);
  console.log("");

  // 步骤 1：从 LocalFileStore 加载数据
  console.log("[1/4] 从 LocalFileStore 加载数据...");
  const localStore = new LocalFileStore({ file_path: sourcePath, auto_flush: false });
  localStore.load();
  const localResult = localStore.list({ page: 1, page_size: 100000 });
  const localEntries = localResult.entries;
  console.log(`  ✓ 加载 ${localEntries.length} 条条目`);

  if (localEntries.length === 0) {
    console.log("  ⚠ 源数据为空，无需迁移");
    return;
  }

  // 步骤 2：连接 Meilisearch
  console.log("[2/4] 连接 Meilisearch...");
  type MeiliClient = InstanceType<typeof MeiliSearchModule.MeiliSearch>;
  let client: MeiliClient;
  try {
    client = new MeiliSearchModule.MeiliSearch({ host: meiliHost, apiKey: meiliApiKey });
    // 健康检查
    await client.health();
    console.log(`  ✓ Meilisearch 连接成功`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Meilisearch 连接失败：${msg}`);
    console.error("  请确保 Meilisearch 服务已启动");
    process.exit(1);
    return; // 仅为类型检查
  }

  // 步骤 3：批量写入 Meilisearch
  console.log("[3/4] 批量写入 Meilisearch...");
  try {
    // 创建索引（如不存在）
    await client.createIndex(INDEX_NAME, { primaryKey: "dedup_key" });
    const index = client.index(INDEX_NAME);

    // 设置索引属性
    await index.updateSearchableAttributes([
      "card_title",
      "card_type",
      "card_organizer",
      "card_match_reason",
      "card_reward_or_value",
    ]);
    await index.updateFilterableAttributes([
      "radar_type",
      "card_visible_level",
      "card_status",
      "card_deadline",
      "card_region",
      "dedup_key",
    ]);
    await index.updateSortableAttributes([
      "added_at",
      "card_deadline",
      "card_backend_score",
      "card_visible_level",
    ]);

    // 批量写入文档
    const docs = localEntries.map(entryToDocument);
    await index.addDocuments(docs);
    console.log(`  ✓ 写入 ${docs.length} 条文档`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ 写入失败：${msg}`);
    process.exit(1);
    return;
  }

  // 步骤 4：验证迁移结果
  console.log("[4/4] 验证迁移结果...");
  try {
    // 用 MeilisearchStore 读取（mockMode=false）
    const meiliStore = new MeilisearchStore({
      host: meiliHost,
      apiKey: meiliApiKey,
      autoFlush: false,
      mockMode: false,
    });
    await meiliStore.loadFromMeili();
    const meiliResult = meiliStore.list({ page: 1, page_size: 100000 });
    const meiliEntries = meiliResult.entries;

    console.log(`  ✓ Meilisearch 条目数：${meiliEntries.length}`);
    console.log(`  ✓ LocalFileStore 条目数：${localEntries.length}`);

    if (meiliEntries.length !== localEntries.length) {
      console.error(`  ✗ 条目数不一致`);
      process.exit(1);
      return;
    }

    // 抽样验证（第一条）
    if (meiliEntries.length > 0) {
      const localFirst = localEntries[0];
      const meiliMatch = meiliEntries.find((e) => e.dedup_key === localFirst.dedup_key);
      if (meiliMatch) {
        const titleMatch = meiliMatch.card.title === localFirst.card.title;
        const statusMatch = meiliMatch.card.status === localFirst.card.status;
        console.log(`  ✓ 抽样验证：dedup_key=${localFirst.dedup_key}`);
        console.log(`    title 一致：${titleMatch}`);
        console.log(`    status 一致：${statusMatch}`);
        if (!titleMatch || !statusMatch) {
          console.error(`  ✗ 抽样数据不一致`);
          process.exit(1);
          return;
        }
      }
    }

    console.log("");
    console.log("=== 迁移完成 ===");
    console.log(`成功迁移 ${localEntries.length} 条条目到 Meilisearch`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ 验证失败：${msg}`);
    process.exit(1);
  }
}

// 导出迁移核心函数（供 verify-task023.ts 测试用）
export async function migrateEntries(
  entries: StoreEntry[],
  meiliStore: MeilisearchStore,
): Promise<{ success: boolean; migrated: number; error?: string }> {
  try {
    // 用 addBatch 写入（mockMode 下操作内存，真实模式下操作 Meilisearch）
    const results = meiliStore.addBatch(
      entries.map((e) => e.card),
      entries[0]?.radar_type ?? "ai_competition",
    );
    return { success: true, migrated: results.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, migrated: 0, error: msg };
  }
}

main().catch((err) => {
  console.error("迁移脚本异常：", err);
  process.exit(1);
});
