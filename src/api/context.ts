/**
 * API 应用上下文
 *
 * 来源：Task 022 第 4.2 节。
 *
 * 共享 store/manager/adapter 实例，避免每个路由重复创建。
 * 服务器启动时初始化一次，所有路由共享。
 */

import { createAdapter } from "../agents/model-router";
import type { LLMAdapter } from "../agents/llm-adapter";
import type { OpportunityStore } from "../agents/opportunity-store";
import { createStore } from "../agents/store-factory";
import { StarManager } from "../agents/star-manager";
import { ConversationManager } from "../agents/conversation-manager";
import { createDefaultWatchStore } from "../watch/watch-store";
import type { FileParser } from "../schema/user-input-source";
import { FileParserRouter } from "../search/file-parser-router";
import { JsonRadarStore, JsonRadarRunStore } from "../agents/radar-store";
import type { RadarStore, RadarRunStore } from "../agents/radar-store";
import { RadarRegistry } from "../agents/radar-registry";
import { JsonReportStore } from "../agents/report-store";
import type { ReportStore } from "../agents/report-store";

/** 会话池中的条目 */
interface ConversationEntry {
  manager: ConversationManager;
  radar_type: string;
}

/** 应用上下文 */
export interface AppContext {
  /** LLM 适配器（Mock 或真实，由 LLM_MODE 环境变量控制） */
  llmAdapter: LLMAdapter;
  /** 机会库（按 STORE_TYPE 切换 local/meili） */
  store: OpportunityStore;
  /** 收藏管理器 */
  starManager: StarManager;
  /** Watch Rules 存储 */
  watchStore: ReturnType<typeof createDefaultWatchStore>;
  /** 会话管理器池（conversation_id → ConversationManager） */
  conversations: Map<string, ConversationEntry>;
  /** V1.3 新增：文件解析器（文件上传功能） */
  fileParser?: FileParser;
  /** V1.5 新增：雷达存储 */
  radarStore: RadarStore;
  /** V1.5 新增：运行记录存储 */
  radarRunStore: RadarRunStore;
  /** V1.5 新增：雷达注册表（单例） */
  radarRegistry: RadarRegistry;
  /** V1.5-08 新增：报告元数据存储 */
  reportStore: ReportStore;
}

/**
 * 创建应用上下文（单例）。
 *
 * LLM 适配器通过 createAdapter() 工厂函数创建（Task 036）：
 *   - LLM_MODE=mock（默认）：返回 MockLlmAdapter
 *   - LLM_MODE=live：返回 ModelRouter
 */
export function createAppContext(): AppContext {
  const llmAdapter = createAdapter();
  const store = createStore();
  store.load();
  const starManager = new StarManager(store);
  const watchStore = createDefaultWatchStore();

  // V1.5 新增：雷达存储 + 注册表
  const radarStore = new JsonRadarStore();
  const radarRunStore = new JsonRadarRunStore();
  const radarRegistry = new RadarRegistry(radarStore);
  radarRegistry.initialize(); // 初始化 3 个内置雷达

  // V1.5-08 新增：报告元数据存储（构造时自动 load）
  const reportStore = new JsonReportStore();

  return {
    llmAdapter,
    store,
    starManager,
    watchStore,
    conversations: new Map(),
    fileParser: new FileParserRouter(),
    radarStore,
    radarRunStore,
    radarRegistry,
    reportStore,
  };
}
