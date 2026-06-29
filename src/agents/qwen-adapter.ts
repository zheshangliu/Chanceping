/**
 * Qwen LLM 适配器（qwen_adapter）
 *
 * 来源：Task 019b 第 4.1 节。
 *
 * 实现 LLMAdapter 接口，对接阿里云通义千问（DashScope）OpenAI 兼容模式。
 * 支持 Mock 降级：无 DASHSCOPE_API_KEY 时自动进入 Mock 模式，不抛错。
 *
 * 三条路径：
 *   1. Mock 模式（无 apiKey）：根据 user 消息关键词匹配返回预设 JSON/文本
 *   2. 真实模式（有 apiKey）：fetch 调用 dashscope API，OpenAI 兼容模式
 *   3. JSON 修复：response_format="json" 时复用 T4 parseJsonWithRepair
 *
 * 不引入新 npm 依赖，HTTP 用 Node.js 内置 fetch（Node 18+）。
 * 不修改 llm-adapter.ts 接口定义和 mock-llm-adapter.ts。
 */

import type { LLMAdapter, LLMRequest, LLMResponse } from "./llm-adapter";
import { parseJsonWithRepair } from "../utils/json-repair";

// ============================================================
// 配置
// ============================================================

/** Qwen Adapter 配置 */
export interface QwenConfig {
  /** 通义千问 API Key（从 env DASHSCOPE_API_KEY 读取） */
  apiKey: string;
  /** 模型名，默认 "qwen-plus" */
  model: string;
  /** API 基础地址，默认 "https://dashscope.aliyuncs.com/compatible-mode/v1" */
  baseUrl: string;
  /** 最大 token 数，默认 4096 */
  maxTokens?: number;
  /** Mock 模式开关，无 apiKey 时自动 true */
  mockMode?: boolean;
}

/** 默认配置常量 */
const DEFAULT_MODEL = "qwen-plus";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MAX_TOKENS = 4096;

// ============================================================
// Mock 预设响应
// ============================================================

/**
 * 机会提取预设 JSON（含"机会"/"评分"/"提取"关键词时返回）。
 *
 * 结构与 MockLLMAdapter 的机会提取响应保持一致，便于 ConversationManager 无缝替换。
 */
const MOCK_OPPORTUNITY_EXTRACTION: unknown = {
  extracted_info: {
    client_identity: {
      client_type: "团队",
      industry: "AI 游戏",
      core_capabilities: ["Unity", "设计"],
      regions: ["广州"],
    },
    business_goal: {
      primary_goal: "找 AI 游戏比赛机会",
      priority_order: ["奖金", "Demo"],
    },
    opportunity_type: {
      primary_types: ["比赛"],
    },
    region_scope: {
      primary_regions: ["大陆"],
    },
  },
  summary: "Mock 模式：识别到机会提取意图，返回预设 AI 游戏比赛机会结构。",
  confirmed_items: [
    { field: "client_identity.client_type", label: "客户类型", value: "团队" },
    { field: "client_identity.industry", label: "行业", value: "AI 游戏" },
    { field: "opportunity_type.primary_types", label: "主要机会类型", value: "比赛" },
  ],
  uncertain_items: [
    { field: "client_identity.products_or_projects", label: "产品或项目", hint: "请补充您的产品或项目" },
    { field: "business_goal.success_definition", label: "成功标准", hint: "请补充成功标准" },
  ],
};

/**
 * 需求理解预设 JSON（含"需求"/"确认"/"理解"关键词时返回）。
 *
 * 兼容现有 MockLLMAdapter 行为，返回结构化需求理解结果。
 */
const MOCK_REQUIREMENT_UNDERSTANDING: unknown = {
  extracted_info: {
    client_identity: {
      client_type: "公司",
      industry: "文创",
      regions: ["深圳"],
    },
    business_goal: {
      primary_goal: "寻找文创政策补贴",
      priority_order: ["曝光"],
    },
    opportunity_type: {
      primary_types: ["补贴"],
    },
    region_scope: {
      primary_regions: ["大陆"],
    },
  },
  summary: "Mock 模式：识别到需求理解意图，返回预设文创政策补贴需求结构。",
  confirmed_items: [
    { field: "client_identity.client_type", label: "客户类型", value: "公司" },
    { field: "client_identity.industry", label: "行业", value: "文创" },
    { field: "opportunity_type.primary_types", label: "主要机会类型", value: "补贴" },
  ],
  uncertain_items: [
    { field: "client_identity.core_capabilities", label: "核心能力", hint: "请补充您的核心能力" },
    { field: "business_goal.success_definition", label: "成功标准", hint: "请补充成功标准" },
  ],
};

/** 通用预设文本（无关键词匹配时返回） */
const MOCK_GENERIC_TEXT = "Mock 模式：未匹配到特定关键词，返回通用文本响应。请设置 DASHSCOPE_API_KEY 以启用真实 Qwen 调用。";

/** 通用预设 JSON（无关键词匹配且 response_format="json" 时返回） */
const MOCK_GENERIC_JSON: unknown = {
  summary: "Mock 模式：未匹配到特定关键词，返回通用 JSON 响应。",
  extracted_info: {},
  confirmed_items: [],
  uncertain_items: [],
};

// ============================================================
// QwenAdapter 实现
// ============================================================

/**
 * Qwen LLM 适配器。
 *
 * 实现 LLMAdapter 接口，可被 ConversationManager 直接注入替换 MockLLMAdapter。
 *
 * 工作流程：
 *   1. 构造器读取 config 或 env DASHSCOPE_API_KEY，无 key 时进入 Mock 模式
 *   2. Mock 模式：根据 user 消息关键词匹配返回预设 JSON/文本
 *   3. 真实模式：fetch 调用 dashscope API（OpenAI 兼容模式）
 *   4. response_format="json" 时使用 parseJsonWithRepair 解析 content
 */
export class QwenAdapter implements LLMAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly mockMode: boolean;

  constructor(config?: Partial<QwenConfig>) {
    const envKey = typeof process !== "undefined" ? process.env?.DASHSCOPE_API_KEY ?? "" : "";
    this.apiKey = config?.apiKey ?? envKey;
    this.model = config?.model ?? DEFAULT_MODEL;
    // baseUrl 优先级：显式 config > DASHSCOPE_BASE_URL 环境变量 > 默认值
    const envBaseUrl = typeof process !== "undefined" ? process.env?.DASHSCOPE_BASE_URL ?? "" : "";
    this.baseUrl = config?.baseUrl ?? (envBaseUrl || DEFAULT_BASE_URL);
    this.maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS;
    // 显式 mockMode 优先，否则无 apiKey 时自动 Mock
    this.mockMode = config?.mockMode ?? this.apiKey === "";
  }

  /** 调用 LLM */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    if (this.mockMode) {
      return this.chatMock(request);
    }
    return this.chatReal(request);
  }

  // ============================================================
  // Mock 模式
  // ============================================================

  /**
   * Mock 模式调用。
   *
   * 根据 user 消息关键词匹配返回预设：
   *   - 含"机会"/"评分"/"提取" → 机会提取预设 JSON
   *   - 含"需求"/"确认"/"理解" → 需求理解预设 JSON
   *   - 其他 → 通用预设
   *
   * response_format="json" 时填充 parsed 字段；response_format="text" 时返回文本。
   */
  private chatMock(request: LLMRequest): LLMResponse {
    const userText = this.extractLastUserMessage(request);
    const preset = this.matchMockPreset(userText);
    const wantJson = request.response_format === "json";

    if (wantJson) {
      const content = JSON.stringify(preset);
      // Mock 模式下也走 parseJsonWithRepair，确保与真实模式行为一致
      const parsed = parseJsonWithRepair(content);
      return { content, parsed };
    }

    // text 模式：返回 summary 字段或通用文本
    if (typeof preset === "object" && preset !== null && "summary" in preset) {
      return { content: String((preset as { summary: string }).summary) };
    }
    return { content: MOCK_GENERIC_TEXT };
  }

  /** 提取最后一条 user 消息内容 */
  private extractLastUserMessage(request: LLMRequest): string {
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user");
    return lastUserMsg?.content ?? "";
  }

  /**
   * 根据 user 消息关键词匹配 Mock 预设。
   *
   * 匹配优先级（与任务书 4.1 节一致）：
   *   1. 含"机会"/"评分"/"提取" → 机会提取预设
   *   2. 含"需求"/"确认"/"理解" → 需求理解预设
   *   3. 其他 → 通用预设
   */
  private matchMockPreset(userText: string): unknown {
    if (/机会|评分|提取/.test(userText)) {
      return MOCK_OPPORTUNITY_EXTRACTION;
    }
    if (/需求|确认|理解/.test(userText)) {
      return MOCK_REQUIREMENT_UNDERSTANDING;
    }
    return MOCK_GENERIC_JSON;
  }

  // ============================================================
  // 真实模式
  // ============================================================

  /**
   * 真实模式调用：fetch dashscope API（OpenAI 兼容模式）。
   *
   * 请求：
   *   POST {baseUrl}/chat/completions
   *   Headers: Authorization: Bearer {apiKey}, Content-Type: application/json
   *   Body: { model, messages, temperature, max_tokens, response_format? }
   *
   * 响应解析：data.choices[0].message.content
   * 错误处理：网络错误重试 1 次，仍失败抛错并附带状态码
   * JSON 修复：response_format="json" 时使用 parseJsonWithRepair
   */
  private async chatReal(request: LLMRequest): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = this.buildRequestBody(request);

    let lastError: Error | null = null;
    // 网络错误重试 1 次（共 2 次尝试）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `Qwen API error: status=${response.status}, body=${errorText.slice(0, 200)}`,
          );
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data?.choices?.[0]?.message?.content ?? "";
        if (content === "") {
          throw new Error("Qwen API returned empty content");
        }

        // response_format="json" 时使用 T4 parseJsonWithRepair 解析
        if (request.response_format === "json") {
          const parsed = parseJsonWithRepair(content);
          return { content, parsed };
        }
        return { content };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // 网络错误才重试，HTTP 4xx/5xx 错误不重试
        const isNetworkError = this.isNetworkError(lastError);
        if (!isNetworkError) {
          break;
        }
        // 第 1 次失败后继续重试
      }
    }

    throw new Error(
      `Qwen API call failed after retry: ${lastError?.message ?? "unknown error"}`,
    );
  }

  /** 构造请求体 */
  private buildRequestBody(request: LLMRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
      max_tokens: this.maxTokens,
    };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.response_format === "json") {
      // OpenAI 兼容模式：response_format 指定 json_object
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  /** 判断是否为网络错误（可重试） */
  private isNetworkError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    // 网络错误特征：fetch failed / network / timeout / econnreset
    if (/fetch failed|network|timeout|econnreset|enotfound/.test(msg)) {
      return true;
    }
    // HTTP 错误（status=xxx）不重试
    if (/status=\d/.test(msg)) {
      return false;
    }
    // 默认不重试
    return false;
  }
}
