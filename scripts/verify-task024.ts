/**
 * Task 024 验收脚本：Watch Rules 搜索集成 + T9 增量标签管理
 *
 * 来源：Task 024 第 4.4 节。
 *
 * 验证内容：
 *   4.4.1 增量标签管理测试（15 项）
 *   4.4.2 去重存储测试（8 项）
 *   4.4.3 Watch Rules 搜索集成测试（6 项）
 *   4.4.4 端到端集成测试（6 项）
 *   4.4.5 工程约束自检（5 项）
 *
 * 测试策略：
 *   - 用 Mock ScoredOpportunity，不接 LLM，不接真实搜索
 *   - 临时文件用 data/search-dedup-test.json，测试后清理
 *   - 所有测试都能 PASS
 */

import fs from "fs";
import path from "path";
import {
  hashContent,
  computeChangeRatio,
  IncrementalTagger,
} from "../src/search/incremental-tagger";
import {
  LocalDedupStore,
  createDefaultDedupStore,
} from "../src/search/search-dedup-store";
import type { ScoredOpportunity } from "../src/search/types";
import {
  scoredOpportunityToCard,
  scoredOpportunityToStoreEntry,
  filterByWatchRules,
  integrateSearchWithWatchRules,
} from "../src/watch/search-integration";
import { parseWatchRules } from "../src/watch/dsl-parser";
import { LocalFileStore } from "../src/agents/opportunity-store";
import type { RadarType } from "../src/agents/opportunity-store";

// ============================================================
// 测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(cond: boolean, label: string): void {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

// ============================================================
// Mock 数据
// ============================================================

/** 构造 Mock ScoredOpportunity */
function makeScoredOpportunity(
  overrides: Partial<ScoredOpportunity> & { url?: string; title?: string; snippet?: string; main_text?: string } = {},
): ScoredOpportunity {
  const url = overrides.url ?? "https://example.com/opp-1";
  const title = overrides.title ?? "AI 创新大赛 2026";
  const snippet = overrides.snippet ?? "全国 AI 创新大赛报名中";
  const mainText = overrides.main_text ?? "这是 AI 创新大赛的正文内容，包含详细的赛事介绍。";
  return {
    search_result: {
      title,
      url,
      snippet,
      source_provider: "serper",
      source_type: "web",
      published_at: "2026-06-01T00:00:00Z",
    },
    cleaned_content: {
      url,
      title,
      main_text: mainText,
      word_count: mainText.length,
      fetch_success: true,
    },
    relevance_score: 85,
    relevance_reason: "与 AI 赛事雷达高度匹配",
    chance_score: {
      fit: 80,
      intent: 75,
      evidence: 70,
      urgency: 85,
      effort_cost: 30,
      total: 78,
    },
    visible_level: "A",
    backend_score: 78,
    guid: overrides.guid,
  };
}

/** 构造 5 条 Mock ScoredOpportunity */
function makeMockOpportunities(): ScoredOpportunity[] {
  return [
    makeScoredOpportunity({ url: "https://example.com/opp-1", title: "AI 创新大赛 2026", guid: "guid-1" }),
    makeScoredOpportunity({ url: "https://example.com/opp-2", title: "上海 AI 黑客松", guid: "guid-2" }),
    makeScoredOpportunity({ url: "https://example.com/opp-3", title: "政策补贴申报指南", guid: "guid-3" }),
    makeScoredOpportunity({ url: "https://example.com/opp-4", title: "文创设计大赛", guid: "guid-4" }),
    makeScoredOpportunity({ url: "https://example.com/opp-5", title: "开发者技术竞赛", guid: "guid-5" }),
  ];
}

/** 临时文件路径 */
const TEMP_DEDUP_FILE = "data/search-dedup-test.json";
const TEMP_STORE_FILE = "data/opportunity-store-task024-test.json";

/** 清理临时文件 */
function cleanupTempFiles(): void {
  for (const f of [TEMP_DEDUP_FILE, TEMP_STORE_FILE]) {
    const abs = path.resolve(process.cwd(), f);
    if (fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        // 忽略删除失败
      }
    }
  }
}

// ============================================================
// 4.4.1 增量标签管理测试
// ============================================================

function testIncrementalTagger(): void {
  section("4.4.1 增量标签管理测试");

  // 测试 1-3：hashContent
  const hash1 = hashContent("hello world");
  const hash2 = hashContent("hello world");
  const hash3 = hashContent("hello WORLD");

  check(
    hash1.length === 64 && /^[0-9a-f]+$/.test(hash1),
    "1. hashContent 返回 64 字符 hex",
  );
  check(hash1 === hash2, "2. hashContent 相同内容 hash 一致");
  check(hash1 !== hash3, "3. hashContent 不同内容 hash 不同");

  // 测试 4-6：computeChangeRatio
  check(computeChangeRatio("same", "same") === 0, "4. computeChangeRatio 相同内容返回 0");
  check(computeChangeRatio("abc", "xyz") === 1, "5. computeChangeRatio 完全不同返回 1");
  const partialRatio = computeChangeRatio("hello world", "hello worlD!");
  check(
    partialRatio > 0 && partialRatio < 1,
    "6. computeChangeRatio 部分变化返回 0-1",
  );

  // 测试 7-11：tagOpportunity
  const store = new LocalDedupStore({ file_path: TEMP_DEDUP_FILE });
  const tagger = new IncrementalTagger(store, { change_threshold: 0.3 });

  // 测试 7：全新 URL
  const tag1 = tagger.tagOpportunity("https://new-url.com", "新内容");
  check(
    tag1.needs_reanalysis === true && tag1.is_analyzed === false,
    "7. tagOpportunity 全新 URL needs_reanalysis=true",
  );

  // 测试 8：hash 匹配（先 markAnalyzed，再 tag）
  tagger.markAnalyzed("https://hash-match.com", "固定内容", makeScoredOpportunity({ url: "https://hash-match.com" }));
  const tag2 = tagger.tagOpportunity("https://hash-match.com", "固定内容");
  check(
    tag2.is_analyzed === true && tag2.needs_reanalysis === false,
    "8. tagOpportunity hash 匹配 is_analyzed=true",
  );

  // 测试 9：URL 匹配但 hash 不同
  tagger.markAnalyzed("https://change-url.com", "旧内容旧内容旧内容", makeScoredOpportunity({ url: "https://change-url.com" }));
  const tag3 = tagger.tagOpportunity("https://change-url.com", "新内容新内容新内容");
  check(
    tag3.change_ratio > 0,
    "9. tagOpportunity URL 匹配 hash 不同 change_ratio>0",
  );

  // 测试 10：change_ratio < 阈值 needs_reanalysis=false
  // 用相似内容（仅末尾微调），确保字符集差异小
  tagger.markAnalyzed("https://small-change.com", "hello world hello world", makeScoredOpportunity({ url: "https://small-change.com" }));
  const tag4 = tagger.tagOpportunity("https://small-change.com", "hello world hello worlD");
  check(
    tag4.needs_reanalysis === false && tag4.is_analyzed === true,
    "10. tagOpportunity change_ratio < 阈值 needs_reanalysis=false",
  );

  // 测试 11：change_ratio > 阈值 needs_reanalysis=true
  tagger.markAnalyzed("https://big-change.com", "aaaaaaaaaa", makeScoredOpportunity({ url: "https://big-change.com" }));
  const tag5 = tagger.tagOpportunity("https://big-change.com", "zzzzzzzzzzzzzzzzzzzzzz");
  check(
    tag5.needs_reanalysis === true && tag5.is_analyzed === false,
    "11. tagOpportunity change_ratio > 阈值 needs_reanalysis=true",
  );

  // 测试 12：tagBatch
  const opps = makeMockOpportunities();
  const batchTags = tagger.tagBatch(opps);
  check(
    batchTags.length === opps.length,
    "12. tagBatch 批量标记",
  );

  // 测试 13：markAnalyzed 后再 tagOpportunity
  const tagger2 = new IncrementalTagger(new LocalDedupStore({ file_path: TEMP_DEDUP_FILE }));
  tagger2.markAnalyzed("https://after-mark.com", "内容X", makeScoredOpportunity({ url: "https://after-mark.com" }));
  const tagAfter = tagger2.tagOpportunity("https://after-mark.com", "内容X");
  check(
    tagAfter.is_analyzed === true,
    "13. markAnalyzed 后再 tagOpportunity is_analyzed=true",
  );

  // 测试 14：markBatchAnalyzed
  const store3 = new LocalDedupStore({ file_path: TEMP_DEDUP_FILE });
  store3.clear();
  const tagger3 = new IncrementalTagger(store3);
  const opps3 = makeMockOpportunities();
  tagger3.markBatchAnalyzed(opps3);
  const stats3 = tagger3.getStats();
  check(
    stats3.total_analyzed === opps3.length,
    "14. markBatchAnalyzed 批量记录",
  );

  // 测试 15：getStats
  check(
    typeof stats3.total_analyzed === "number" && typeof stats3.cache_hit_rate === "number",
    "15. getStats 返回统计",
  );
}

// ============================================================
// 4.4.2 去重存储测试
// ============================================================

function testDedupStore(): void {
  section("4.4.2 去重存储测试");

  const store = new LocalDedupStore({ file_path: TEMP_DEDUP_FILE });
  store.clear();

  // 测试 16：set + get
  store.set("https://url1.com", {
    url: "https://url1.com",
    content_hash: "abc123",
    content_preview: "preview1",
    cached_result: null,
    analyzed_at: "2026-06-01T00:00:00Z",
  });
  const got = store.get("https://url1.com");
  check(
    got !== null && got.content_hash === "abc123",
    "16. LocalDedupStore set + get",
  );

  // 测试 17：get 不存在返回 null
  const notExist = store.get("https://not-exist.com");
  check(notExist === null, "17. LocalDedupStore get 不存在返回 null");

  // 测试 18：delete
  const deleted = store.delete("https://url1.com");
  check(deleted === true && store.get("https://url1.com") === null, "18. LocalDedupStore delete");

  // 测试 19：count
  store.set("https://a.com", {
    url: "https://a.com",
    content_hash: "h1",
    content_preview: "p1",
    cached_result: null,
    analyzed_at: "2026-06-01T00:00:00Z",
  });
  store.set("https://b.com", {
    url: "https://b.com",
    content_hash: "h2",
    content_preview: "p2",
    cached_result: null,
    analyzed_at: "2026-06-01T00:00:00Z",
  });
  check(store.count() === 2, "19. LocalDedupStore count");

  // 测试 20：clear
  store.clear();
  check(store.count() === 0, "20. LocalDedupStore clear");

  // 测试 21：flush + load 持久化
  const persistStore = new LocalDedupStore({ file_path: TEMP_DEDUP_FILE });
  persistStore.clear();
  persistStore.set("https://persist.com", {
    url: "https://persist.com",
    content_hash: "persist-hash",
    content_preview: "persist-preview",
    cached_result: null,
    analyzed_at: "2026-06-01T00:00:00Z",
  });
  persistStore.flush();

  const loadStore = new LocalDedupStore({ file_path: TEMP_DEDUP_FILE });
  loadStore.load();
  const loaded = loadStore.get("https://persist.com");
  check(
    loaded !== null && loaded.content_hash === "persist-hash",
    "21. LocalDedupStore flush + load 持久化",
  );

  // 测试 22：stats cache_hit_rate
  const statsStore = new LocalDedupStore({ file_path: TEMP_DEDUP_FILE });
  statsStore.clear();
  statsStore.set("https://stats.com", {
    url: "https://stats.com",
    content_hash: "h",
    content_preview: "p",
    cached_result: null,
    analyzed_at: "2026-06-01T00:00:00Z",
  });
  statsStore.get("https://stats.com"); // hit
  statsStore.get("https://not-exist.com"); // miss
  const stats = statsStore.stats();
  check(
    stats.cache_hit_rate === 0.5,
    "22. LocalDedupStore stats cache_hit_rate",
  );

  // 测试 23：createDefaultDedupStore 工厂
  const defaultStore = createDefaultDedupStore();
  check(
    defaultStore instanceof LocalDedupStore,
    "23. createDefaultDedupStore 工厂",
  );
}

// ============================================================
// 4.4.3 Watch Rules 搜索集成测试
// ============================================================

function testWatchRulesSearchIntegration(): void {
  section("4.4.3 Watch Rules 搜索集成测试");

  const opps = makeMockOpportunities();
  const radarType: RadarType = "ai_competition";

  // 测试 24：scoredOpportunityToCard 转换正确
  const card = scoredOpportunityToCard(opps[0]);
  check(
    card.title === opps[0].search_result.title &&
    card.official_source_url === opps[0].search_result.url &&
    card.backend_score === opps[0].backend_score &&
    card.status === "new" &&
    card.visible_level === "A",
    "24. scoredOpportunityToCard 转换正确",
  );

  // 测试 25：scoredOpportunityToStoreEntry 转换正确
  const entry = scoredOpportunityToStoreEntry(opps[0], radarType);
  check(
    entry.card.title === opps[0].search_result.title &&
    entry.radar_type === radarType &&
    typeof entry.dedup_key === "string" && entry.dedup_key.length > 0,
    "25. scoredOpportunityToStoreEntry 转换正确",
  );

  // 测试 26：filterByWatchRules 规则匹配
  // 规则：+AI（含关键词 AI）
  const ruleSetMatch = parseWatchRules("+AI");
  const resultMatch = filterByWatchRules(opps, ruleSetMatch, radarType);
  check(
    resultMatch.filtered.length > 0 && resultMatch.filtered.every((o) =>
      o.search_result.title.includes("AI") || o.search_result.snippet.includes("AI"),
    ),
    "26. filterByWatchRules 规则匹配",
  );

  // 测试 27：filterByWatchRules 规则不匹配
  // 规则：+不存在的关键词
  const ruleSetNoMatch = parseWatchRules("+zzzznotexist");
  const resultNoMatch = filterByWatchRules(opps, ruleSetNoMatch, radarType);
  check(
    resultNoMatch.filtered.length === 0 && resultNoMatch.filtered_out === opps.length,
    "27. filterByWatchRules 规则不匹配",
  );

  // 测试 28：filterByWatchRules 空规则集返回全部
  const ruleSetEmpty = parseWatchRules("");
  const resultEmpty = filterByWatchRules(opps, ruleSetEmpty, radarType);
  check(
    resultEmpty.filtered.length === opps.length && resultEmpty.filtered_out === 0,
    "28. filterByWatchRules 空规则集返回全部",
  );

  // 测试 29：filterByWatchRules filtered_out 计数
  // 规则：+AI（只匹配含 AI 的）
  const ruleSetCount = parseWatchRules("+AI");
  const resultCount = filterByWatchRules(opps, ruleSetCount, radarType);
  check(
    resultCount.filtered.length + resultCount.filtered_out === opps.length,
    "29. filterByWatchRules filtered_out 计数",
  );
}

// ============================================================
// 4.4.4 端到端集成测试
// ============================================================

function testEndToEndIntegration(): void {
  section("4.4.4 端到端集成测试");

  cleanupTempFiles();

  const opps = makeMockOpportunities();
  const radarType: RadarType = "ai_competition";
  const ruleSet = parseWatchRules("+AI"); // 只保留含 AI 的
  const store = new LocalFileStore({ file_path: TEMP_STORE_FILE, auto_flush: true });
  const dedupStore = new LocalDedupStore({ file_path: TEMP_DEDUP_FILE });
  dedupStore.clear();
  const tagger = new IncrementalTagger(dedupStore);

  // 测试 30：integrateSearchWithWatchRules 完整流程
  const result = integrateSearchWithWatchRules(opps, ruleSet, store, tagger, radarType);
  check(
    typeof result.total_opportunities === "number" &&
    typeof result.stored === "number" &&
    Array.isArray(result.stored_entries) &&
    Array.isArray(result.tags),
    "30. integrateSearchWithWatchRules 完整流程",
  );

  // 测试 31：total_opportunities 正确
  check(
    result.total_opportunities === opps.length,
    "31. total_opportunities 正确",
  );

  // 测试 32：cache_reused 正确（首次运行为 0）
  check(
    result.cache_reused === 0,
    "32. cache_reused 正确（首次运行为 0）",
  );

  // 测试 33：watch_filtered 正确
  check(
    result.watch_filtered > 0 && result.watch_filtered + result.watch_filtered_out === opps.length,
    "33. watch_filtered 正确",
  );

  // 测试 34：stored 正确（入库数 = 过滤后数）
  check(
    result.stored === result.watch_filtered && result.stored_entries.length === result.stored,
    "34. stored 正确（入库数 = 过滤后数）",
  );

  // 测试 35：二次运行 cache_reused > 0（去重生效）
  const result2 = integrateSearchWithWatchRules(opps, ruleSet, store, tagger, radarType);
  check(
    result2.cache_reused > 0,
    "35. 二次运行 cache_reused > 0（去重生效）",
  );
}

// ============================================================
// 4.4.5 工程约束自检
// ============================================================

function testEngineeringConstraints(): void {
  section("4.4.5 工程约束自检");

  // 测试 36：不引入新依赖（用 crypto + fs）
  // 检查 package.json 中 dependencies 不含新增包
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  // Task 024 不应引入新依赖，已有依赖：@hono/node-server, ajv, ajv-formats, hono, i18next, meilisearch
  const expectedDeps = ["@hono/node-server", "ajv", "ajv-formats", "hono", "i18next", "meilisearch"];
  const hasNewDeps = deps.some((d) => !expectedDeps.includes(d));
  check(
    !hasNewDeps,
    "36. 不引入新依赖（用 crypto + fs）",
  );

  // 测试 37：不修改 orchestrator.ts
  const orchestratorPath = path.resolve(process.cwd(), "src/search/orchestrator.ts");
  const orchestratorContent = fs.readFileSync(orchestratorPath, "utf-8");
  check(
    orchestratorContent.includes("SearchOrchestrator") && !orchestratorContent.includes("Task 024"),
    "37. 不修改 orchestrator.ts",
  );

  // 测试 38：不修改 rule-matcher.ts
  const ruleMatcherPath = path.resolve(process.cwd(), "src/watch/rule-matcher.ts");
  const ruleMatcherContent = fs.readFileSync(ruleMatcherPath, "utf-8");
  check(
    ruleMatcherContent.includes("filterByRules") && !ruleMatcherContent.includes("Task 024"),
    "38. 不修改 rule-matcher.ts",
  );

  // 测试 39：不修改 opportunity-store.ts
  const storePath = path.resolve(process.cwd(), "src/agents/opportunity-store.ts");
  const storeContent = fs.readFileSync(storePath, "utf-8");
  check(
    storeContent.includes("OpportunityStore") && !storeContent.includes("Task 024"),
    "39. 不修改 opportunity-store.ts",
  );

  // 测试 40：临时文件清理
  cleanupTempFiles();
  const dedupFileExists = fs.existsSync(path.resolve(process.cwd(), TEMP_DEDUP_FILE));
  const storeFileExists = fs.existsSync(path.resolve(process.cwd(), TEMP_STORE_FILE));
  check(
    !dedupFileExists && !storeFileExists,
    "40. 临时文件清理",
  );
}

// ============================================================
// 主函数
// ============================================================

function main(): void {
  console.log("Task 024 验收脚本：Watch Rules 搜索集成 + T9 增量标签管理");
  console.log("============================================================");

  cleanupTempFiles();

  testIncrementalTagger();
  testDedupStore();
  testWatchRulesSearchIntegration();
  testEndToEndIntegration();
  testEngineeringConstraints();

  cleanupTempFiles();

  console.log("");
  console.log("=== 汇总 ===");
  console.log(`PASS: ${passCount}`);
  console.log(`FAIL: ${failCount}`);
  if (failures.length > 0) {
    console.log("失败项：");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log(failCount === 0 ? "✓ 全部通过" : "✗ 存在失败");

  process.exit(failCount === 0 ? 0 : 1);
}

main();
