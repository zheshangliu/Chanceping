/**
 * API 应用上下文
 *
 * 来源：Task 022 第 4.2 节。
 *
 * 共享 store/manager/adapter 实例，避免每个路由重复创建。
 * 服务器启动时初始化一次，所有路由共享。
 */

import { ModelRouter } from "../agents/model-router";
import { LocalFileStore, createDefaultStore } from "../agents/opportunity-store";
import { StarManager } from "../agents/star-manager";
import { ConversationManager } from "../agents/conversation-manager";
import { createDefaultWatchStore } from "../watch/watch-store";

/** 会话池中的条目 */
interface ConversationEntry {
  manager: ConversationManager;
  radar_type: string;
}

/** 应用上下文 */
export interface AppContext {
  /** LLM 路由器 */
  modelRouter: ModelRouter;
  /** 机会库（本地文件实现） */
  store: LocalFileStore;
  /** 收藏管理器 */
  starManager: StarManager;
  /** Watch Rules 存储 */
  watchStore: ReturnType<typeof createDefaultWatchStore>;
  /** 会话管理器池（conversation_id → ConversationManager） */
  conversations: Map<string, ConversationEntry>;
}

/**
 * 创建应用上下文（单例）。
 */
export function createAppContext(): AppContext {
  const modelRouter = new ModelRouter();
  const store = createDefaultStore();
  store.load();
  const starManager = new StarManager(store);
  const watchStore = createDefaultWatchStore();

  return {
    modelRouter,
    store,
    starManager,
    watchStore,
    conversations: new Map(),
  };
}
