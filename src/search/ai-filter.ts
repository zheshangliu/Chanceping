/**
 * T10 第二层：AI 精筛（ai filter）
 *
 * 来源：Task 019d 第 4.2 节。
 *
 * LLM 基于用户 Spec 判断搜索结果是否值得作为机会。
 * 流程：
 *   1. 对每条 SearchResult，调用 JinaReaderFetcher.fetch(url) 抓取网页内容
 *   2. 构造 LLM prompt（system 含 spec client_profile + business_goal + opportunity_type；user 含 title + snippet + main_text）
 *   3. LLM 返回 JSON：{ relevance: number, reason: string }
 *   4. 使用 T4 parseJsonWithRepair 解析 LLM 输出
 *   5. relevance >= minRelevance（默认 50）→ passed
 *
 * 错误隔离：
 *   - 内容抓取失败 → relevance=0 + reason "内容抓取失败"
 *   - LLM 调用失败 → relevance=0 + reason "LLM 调用失败"
 *   - 不因单条失败而中断整个筛选
 *
 * Mock 模式（QwenAdapter Mock 模式下，parsed 不含 relevance 字段时）：
 *   - 含"AI"/"大赛" → relevance=80
 *   - 含"政策"/"补贴" → relevance=70
 *   - 其他 → relevance=40
 *
 * 并发控制：逐条处理（不并发），避免 Mock 模式下的状态问题。
 */

import type { SearchResult, CleanedContent } from "./types";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import type { LLMAdapter, LLMRequest } from "../agents/llm-adapter";
import { parseJsonWithRepair } from "../utils/json-repair";
import { JinaReaderFetcher } from "./content/jina-reader";

/** AI 精筛单项（通过的结果 + 清洗内容 + 相关度 + 理由） */
export interface AIFilterItem {
  /** 原始搜索结果 */
  result: SearchResult;
  /** 清洗后的内容 */
  content: CleanedContent;
  /** 相关度（0-100） */
  relevance: number;
  /** AI 判断理由 */
  reason: string;
}

/** AI 精筛结果 */
export interface AIFilterResult {
  /** 通过的结果 */
  passed: AIFilterItem[];
  /** 被拒绝的结果（含拒绝原因） */
  rejected: Array<{ result: SearchResult; reason: string }>;
}

/** AI 精筛选项 */
export interface AIFilterOptions {
  /** 最小相关度阈值，默认 50 */
  minRelevance?: number;
  /** main_text 截断字符数，默认 4000 */
  maxContentChars?: number;
  /** Jina Reader 抓取模式：true=Mock内容（默认），false=真实抓取 */
  mockContent?: boolean;
}

/** 默认相关度阈值 */
const DEFAULT_MIN_RELEVANCE = 50;

/** 默认 main_text 截断字符数 */
const DEFAULT_MAX_CONTENT_CHARS = 4000;

/** 空 CleanedContent（用于抓取失败时） */
function emptyContent(url: string, errorMsg?: string): CleanedContent {
  return {
    url,
    title: "",
    main_text: "",
    word_count: 0,
    fetch_success: false,
    fetch_error: errorMsg,
  };
}

/**
 * 从 LLM parsed 中提取 relevance 字段。
 * 如果 parsed 不含 relevance 字段（Mock 模式预设返回），按 title 关键词返回预设值。
 */
function extractRelevance(
  parsed: unknown,
  title: string,
): { relevance: number; reason: string } {
  // 优先从 LLM 输出中提取
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.relevance === "number") {
      const relevance = Math.max(0, Math.min(100, obj.relevance));
      const reason = typeof obj.reason === "string" ? obj.reason : "LLM 评估完成";
      return { relevance, reason };
    }
  }

  // Mock 模式预设：按 title 关键词返回
  if (/AI|大赛|比赛|赛事|竞赛/.test(title)) {
    return { relevance: 80, reason: "Mock 模式：AI 赛事相关，相关度较高" };
  }
  if (/政策|补贴|扶持|申报/.test(title)) {
    return { relevance: 70, reason: "Mock 模式：政策补贴相关，相关度中等" };
  }
  return { relevance: 40, reason: "Mock 模式：未匹配关键词，相关度较低" };
}

/**
 * 构造 LLM prompt。
 * system 消息：spec 的 client_profile + business_goal + opportunity_type
 * user 消息：title + snippet + cleaned main_text（截断到 maxContentChars）
 */
function buildLLMRequest(
  result: SearchResult,
  content: CleanedContent,
  spec: RadarRequirementSpec,
  maxContentChars: number,
): LLMRequest {
  const clientProfile = spec?.client_profile;
  const coreGoals = spec?.core_goals;
  const oppScope = spec?.opportunity_scope;

  const systemMsg = [
    "你是一个机会筛选助手。根据用户的需求规格，判断搜索结果是否值得作为机会。",
    "",
    "【客户画像】",
    `行业：${clientProfile?.industry ?? "未指定"}`,
    `客户类型：${clientProfile?.client_type ?? "未指定"}`,
    `核心能力：${(clientProfile?.core_capabilities ?? []).join("、") || "未指定"}`,
    `地区：${(clientProfile?.regions ?? []).join("、") || "未指定"}`,
    "",
    "【核心目标】",
    `主要目标：${coreGoals?.primary_goal ?? "未指定"}`,
    `行动意图：${(coreGoals?.action_intent ?? []).join("、") || "未指定"}`,
    "",
    "【机会范围】",
    `主要机会类型：${(oppScope?.primary_opportunity_types ?? []).join("、") || "未指定"}`,
  ].join("\n");

  const mainText = content.main_text || "";
  const truncatedText =
    mainText.length > maxContentChars
      ? mainText.slice(0, maxContentChars) + "...[截断]"
      : mainText;

  const userMsg = [
    "请评估以下搜索结果的相关度。",
    "",
    `【标题】${result.title}`,
    `【摘要】${result.snippet}`,
    `【正文】${truncatedText}`,
    "",
    '请返回 JSON：{ "relevance": 0-100 的整数, "reason": "判断理由" }',
    "relevance 80 以上表示高度相关，50 以下表示不相关。",
  ].join("\n");

  return {
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
    response_format: "json",
    temperature: 0.3,
  };
}

/**
 * T10 第二层：AI 精筛。
 *
 * @param results 规则粗筛通过的搜索结果
 * @param spec 雷达需求规格
 * @param llmAdapter LLM 适配器（Mock 或真实）
 * @param options 选项（minRelevance / maxContentChars）
 * @returns AIFilterResult（passed / rejected）
 */
export async function aiFilter(
  results: SearchResult[],
  spec: RadarRequirementSpec,
  llmAdapter: LLMAdapter,
  options?: AIFilterOptions,
): Promise<AIFilterResult> {
  const minRelevance = options?.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const maxContentChars = options?.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;

  const passed: AIFilterItem[] = [];
  const rejected: Array<{ result: SearchResult; reason: string }> = [];

  // 边界情况：空数组
  if (!Array.isArray(results) || results.length === 0) {
    return { passed, rejected };
  }

  // 创建 Jina Reader 抓取器（默认 Mock 模式，可通过 options.mockContent=false 切换真实抓取）
  const fetcher = new JinaReaderFetcher({ mockMode: options?.mockContent ?? true });

  // 逐条处理（不并发，避免 Mock 模式状态问题）
  for (const result of results) {
    // 边界情况：缺字段
    if (!result || typeof result !== "object" || !result.url) {
      rejected.push({ result, reason: "结果对象无效" });
      continue;
    }

    // 步骤 1：抓取网页内容
    let content: CleanedContent;
    try {
      content = await fetcher.fetch(result.url);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      content = emptyContent(result.url, `内容抓取异常: ${errMsg}`);
    }

    // 内容抓取失败 → 用 snippet 代替正文，仍调用 LLM 精筛（不直接拒绝）
    let effectiveContent = content;
    if (!content.fetch_success) {
      // r.jina.ai 不可达时，用搜索结果的 snippet 作为 main_text 的替代
      const snippetText = result.snippet ?? "";
      effectiveContent = {
        ...content,
        main_text: snippetText,
        word_count: snippetText.length,
        fetch_success: true,  // 标记为有效内容，让后续 LLM 精筛能处理
        fetch_error: content.fetch_error,  // 保留原始错误信息
      };
    }

    // 步骤 2-4：构造 LLM prompt 并调用（用 effectiveContent 代替 content）
    let relevance = 0;
    let reason = "";
    try {
      const llmRequest = buildLLMRequest(result, effectiveContent, spec, maxContentChars);
      const llmResponse = await llmAdapter.chat(llmRequest);

      // 步骤 4：使用 T4 parseJsonWithRepair 解析
      // 优先用 parsed 字段（已解析），否则从 content 解析
      const parsed =
        llmResponse.parsed ?? parseJsonWithRepair(llmResponse.content ?? "");
      const extracted = extractRelevance(parsed, result.title);
      relevance = extracted.relevance;
      reason = extracted.reason;
    } catch (err) {
      // LLM 调用失败 → relevance=0 + reason "LLM 调用失败"
      const errMsg = err instanceof Error ? err.message : String(err);
      rejected.push({
        result,
        reason: `LLM 调用失败: ${errMsg}`,
      });
      continue;
    }

    // 步骤 5：relevance >= minRelevance → passed
    if (relevance >= minRelevance) {
      passed.push({ result, content: effectiveContent, relevance, reason });
    } else {
      rejected.push({ result, reason: `相关度 ${relevance} < ${minRelevance}: ${reason}` });
    }
  }

  return { passed, rejected };
}
