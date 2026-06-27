/**
 * LLM 适配器接口
 *
 * 来源：Task 007 第 4.1 节。
 *
 * 对话管理模块通过此接口调用 LLM，不直接依赖任何特定 LLM SDK。
 * 验证脚本用 MockLLMAdapter 实现，生产环境可替换为 QwenAdapter / DeepSeekAdapter 等。
 */

/** LLM 消息角色 */
export type LLMMessageRole = "system" | "user" | "assistant";

/** LLM 消息 */
export interface LLMMessage {
  role: LLMMessageRole;
  content: string;
}

/** LLM 调用请求 */
export interface LLMRequest {
  messages: LLMMessage[];
  /** 期望的响应格式（JSON 或文本） */
  response_format?: "json" | "text";
  /** 温度 */
  temperature?: number;
}

/** LLM 调用响应 */
export interface LLMResponse {
  content: string;
  /** 如果 response_format="json"，解析后的 JSON 对象 */
  parsed?: unknown;
}

/**
 * LLM 适配器接口。
 * 对话管理模块通过此接口调用 LLM，不直接依赖任何特定 LLM SDK。
 * 验证脚本用 MockLLMAdapter 实现，生产环境可替换为 QwenAdapter / DeepSeekAdapter 等。
 */
export interface LLMAdapter {
  /** 调用 LLM */
  chat(request: LLMRequest): Promise<LLMResponse>;
}
