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
   *
   * Task 042 扩展：AI 精筛时从消息中提取【标题】，在 ai_filter.results 中
   * 按 title 匹配，返回 { relevance, reason }。这样三雷达数据都能正确精筛。
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
      // Task 042: 从消息中提取【标题】后的 title，按 title 匹配预设精筛结果
      const titleMatch = allContent.match(/【标题】(.+?)(\n|$)/);
      const title = titleMatch ? titleMatch[1].trim() : "";

      if (title) {
        // 在 ai_filter.results 中查找匹配的 title
        const matched = this.responses.ai_filter.results.find(
          (r) => r.title === title,
        );
        if (matched) {
          // 返回含 relevance 字段的响应，让 extractRelevance 能直接提取
          const relevanceResult = {
            relevance: matched.relevant ? 80 : 30,
            reason: matched.reason,
          };
          return {
            content: JSON.stringify(relevanceResult),
            parsed: relevanceResult,
          };
        }
      }

      // 兜底：未匹配到 title，返回整个 ai_filter 对象（保持向后兼容）
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
