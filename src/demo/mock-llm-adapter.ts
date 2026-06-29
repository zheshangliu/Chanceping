/**
 * Mock LLM 适配器
 *
 * 来源：Task 036 第 6.4 节。
 *
 * LLM_MODE=mock 时使用此适配器，返回预设响应。
 * 用于 E2E 测试和演示，确保结果稳定可复现。
 *
 * 支持的响应类型：
 *   1. 需求确认（消息含"确认"）→ 返回确认卡 JSON
 *   2. AI 精筛（消息含"精筛"/"filter"/"相关"）→ 返回精筛结果 JSON
 *   3. 默认 → 返回通用 Mock 响应
 */

import type {
  LLMAdapter,
  LLMRequest,
  LLMResponse,
} from "../agents/llm-adapter";
import { loadMockLlmResponses } from "./index";

export class MockLlmAdapter implements LLMAdapter {
  private readonly responses: ReturnType<typeof loadMockLlmResponses>;

  constructor() {
    this.responses = loadMockLlmResponses();
  }

  /**
   * 调用 Mock LLM。
   * 根据消息内容匹配预设响应。
   */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const allContent = request.messages
      .map((m) => m.content)
      .join(" ");

    // 需求确认响应
    if (allContent.includes("确认") || allContent.includes("confirmation")) {
      const card = this.responses.requirement_confirmation.confirmation_card;
      return {
        content: JSON.stringify(card),
        parsed: card,
      };
    }

    // AI 精筛响应
    if (
      allContent.includes("精筛") ||
      allContent.includes("filter") ||
      allContent.includes("相关")
    ) {
      const filterResult = this.responses.ai_filter;
      return {
        content: JSON.stringify(filterResult),
        parsed: filterResult,
      };
    }

    // 默认响应
    const defaultResponse = {
      message: "Mock LLM response",
      mode: "mock",
    };
    return {
      content: JSON.stringify(defaultResponse),
      parsed: defaultResponse,
    };
  }
}
