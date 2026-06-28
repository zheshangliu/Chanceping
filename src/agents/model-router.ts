/**
 * 模型路由器（model_router）
 *
 * 来源：Task 020 第 4.3 节。
 *
 * 实现 LLMAdapter 接口，作为 ConversationManager 的 drop-in 替换。
 * 根据任务类型（TaskType）路由到不同的 LLM Provider + 模型，
 * 支持 primary → fallback 自动降级。
 *
 * 两套策略通过环境变量 LLM_STRATEGY 切换：
 *   - commercial：商业版，多 Provider 混合，追求成本最优
 *   - competition：参赛版，只用 Qwen Cloud API
 *
 * 架构：
 *   ConversationManager
 *         │
 *         ▼ (依赖注入 LLMAdapter)
 *    ModelRouter
 *    ┌───┴───┐─────────────────────┐
 *    │       │                     │
 *  chat()  chatForTask()   getAdapterForTask()
 *  (默认)  (显式任务)       (获取适配器)
 *    │       │                     │
 *    ▼       ▼                     ▼
 *  taskRouting 表           FallbackAdapter
 *  TaskType → Route         ┌──────┴──────┐
 *                          primary    fallback
 *                           │           │
 *                           ▼           ▼
 *                      适配器实例   适配器实例
 *
 * 不修改 llm-adapter.ts 接口定义和现有适配器。
 * 不引入新 npm 依赖。
 */

import type { LLMAdapter, LLMRequest, LLMResponse } from "./llm-adapter";
import { QwenAdapter } from "./qwen-adapter";
import { DeepSeekAdapter } from "./deepseek-adapter";
import { GlmAdapter } from "./glm-adapter";
import { getStrategyFromEnv, getStrategy } from "../config/llm-strategy";

// ============================================================
// 类型定义
// ============================================================

/** 任务类型（8 种） */
export type TaskType =
  | "requirement_understanding"  // 需求理解
  | "batch_screening"             // 批量初筛
  | "core_judgment"               // 核心判断
  | "high_difficulty"             // 高难判断
  | "report_generation"           // 报告生成
  | "summarization"               // 摘要/关键词扩展
  | "dedup_classification"        // 去重分类
  | "fallback";                   // 兜底

/** LLM Provider 标识 */
export type LLMProvider = "qwen" | "deepseek" | "glm";

/** 模型路由项（provider + 模型名） */
export interface ModelRoute {
  provider: LLMProvider;
  model: string;
}

/** 任务路由配置（主力 + 降级备选） */
export interface TaskRouting {
  primary: ModelRoute;
  fallback: ModelRoute | null;
}

/** 策略 profile */
export type StrategyProfile = "commercial" | "competition";

/** 完整策略定义 */
export interface ModelStrategy {
  profile: StrategyProfile;
  taskRouting: Record<TaskType, TaskRouting>;
  defaultTask: TaskType;
}

// ============================================================
// FallbackAdapter 内部类
// ============================================================

/**
 * Fallback 适配器：封装 primary + fallback，实现 LLMAdapter 接口。
 *
 * 调用 primary.chat()，失败时降级到 fallback.chat()。
 * fallback 为 null 时直接抛出 primary 的错误。
 */
class FallbackAdapter implements LLMAdapter {
  constructor(
    private readonly primary: LLMAdapter,
    private readonly fallback: LLMAdapter | null,
  ) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    try {
      return await this.primary.chat(request);
    } catch (primaryErr) {
      if (this.fallback) {
        return await this.fallback.chat(request);
      }
      throw primaryErr;
    }
  }
}

// ============================================================
// ModelRouter 实现
// ============================================================

/**
 * 模型路由器。
 *
 * 实现 LLMAdapter 接口，可被 ConversationManager 直接注入替换 QwenAdapter。
 *
 * 工作流程：
 *   1. 构造器接收 strategy?: ModelStrategy，未传时从 getStrategyFromEnv() 获取
 *   2. chat(request)：使用 defaultTask 路由（向后兼容）
 *   3. chatForTask(taskType, request)：按任务类型路由 + fallback
 *   4. getAdapterForTask(taskType)：返回 FallbackAdapter 实例
 *   5. 适配器实例懒加载 + 缓存（key = `${provider}:${model}`）
 */
export class ModelRouter implements LLMAdapter {
  private readonly strategy: ModelStrategy;
  /** 适配器实例缓存，key = `${provider}:${model}` */
  private readonly adapterCache: Map<string, LLMAdapter> = new Map();

  constructor(strategy?: ModelStrategy) {
    this.strategy = strategy ?? getStrategyFromEnv();
  }

  /**
   * 向后兼容：使用 defaultTask 路由。
   *
   * 等价于 chatForTask(this.strategy.defaultTask, request)。
   * ConversationManager 可直接注入 ModelRouter 替换 QwenAdapter，无需修改。
   */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    return this.chatForTask(this.strategy.defaultTask, request);
  }

  /**
   * 按任务类型路由（含 fallback）。
   *
   * 1. 查 strategy.taskRouting[taskType] 获取 TaskRouting
   * 2. 获取 primary 对应的适配器实例（懒加载 + 缓存）
   * 3. 调用 primary.chat(request)
   * 4. 成功 → 返回响应
   * 5. 失败（抛异常）且 fallback != null → 获取 fallback 适配器，调用 fallback.chat(request)
   * 6. fallback 也失败 → 抛出 fallback 的错误
   * 7. fallback == null → 抛出 primary 的错误
   */
  async chatForTask(taskType: TaskType, request: LLMRequest): Promise<LLMResponse> {
    const routing = this.strategy.taskRouting[taskType];
    const primaryAdapter = this.getOrCreateAdapter(routing.primary);

    try {
      return await primaryAdapter.chat(request);
    } catch (primaryErr) {
      if (routing.fallback) {
        const fallbackAdapter = this.getOrCreateAdapter(routing.fallback);
        return await fallbackAdapter.chat(request);
      }
      throw primaryErr;
    }
  }

  /**
   * 获取任务对应的适配器（含 fallback 封装）。
   *
   * 返回一个 FallbackAdapter 实例，封装 primary + fallback，实现 LLMAdapter 接口。
   * 搜索层 aiFilter / scoreOpportunities 接收 LLMAdapter，
   * 通过此方法获取的适配器已内置 fallback，调用方无需感知降级发生。
   */
  getAdapterForTask(taskType: TaskType): LLMAdapter {
    const routing = this.strategy.taskRouting[taskType];
    const primary = this.getOrCreateAdapter(routing.primary);
    const fallback = routing.fallback
      ? this.getOrCreateAdapter(routing.fallback)
      : null;
    return new FallbackAdapter(primary, fallback);
  }

  /** 获取当前策略 profile */
  getProfile(): StrategyProfile {
    return this.strategy.profile;
  }

  /** 获取当前策略定义 */
  getStrategy(): ModelStrategy {
    return this.strategy;
  }

  // ============================================================
  // 适配器实例管理
  // ============================================================

  /**
   * 获取或创建适配器实例（懒加载 + 缓存）。
   *
   * key = `${provider}:${model}`，同一 provider:model 多次获取返回同一实例（引用相等）。
   * 所有适配器通过构造器自动读取对应 env 变量，无 key 时自动 Mock。
   */
  private getOrCreateAdapter(route: ModelRoute): LLMAdapter {
    const key = `${route.provider}:${route.model}`;
    const cached = this.adapterCache.get(key);
    if (cached) {
      return cached;
    }

    let adapter: LLMAdapter;
    switch (route.provider) {
      case "qwen":
        adapter = new QwenAdapter({ model: route.model });
        break;
      case "deepseek":
        adapter = new DeepSeekAdapter({ model: route.model });
        break;
      case "glm":
        adapter = new GlmAdapter({ model: route.model });
        break;
      default:
        throw new Error(`Unknown LLM provider: ${route.provider}`);
    }

    this.adapterCache.set(key, adapter);
    return adapter;
  }
}
