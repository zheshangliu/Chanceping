/**
 * API 层统一类型定义
 *
 * 来源：Task 022 第 4.1 节。
 *
 * 所有 API 响应统一使用 ApiResponse<T> 格式。
 */

import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";
import type { ProviderRouting, RadarPrivacy, RadarRun } from "../schema/radar";
import type { ScoredOpportunity } from "../search/types";
import type { SourceCandidate } from "../schema/source-candidate";
import type { OpportunityCard } from "../schema/opportunity-card";

/** 统一响应格式 */
export interface ApiResponse<T = unknown> {
  /** 是否成功 */
  success: boolean;
  /** 响应数据（success=true 时有值） */
  data: T | null;
  /** 错误信息（success=false 时有值） */
  error: {
    code: string;
    message: string;
  } | null;
  /** 请求耗时（毫秒） */
  duration_ms: number;
}

/** 分页响应数据 */
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** 对话请求 */
export interface ChatRequest {
  /** 用户输入文本 */
  message: string;
  /** 雷达类型（默认 ai_competition） */
  radar_type?: "ai_competition" | "opc_policy" | "cultural_heritage";
  /** 会话 ID（可选，不传则新建会话） */
  conversation_id?: string;
  /** V1.3 新增：上传文件解析后的文本（可选，追加到 message 末尾） */
  uploaded_text?: string;
  /** V1.4 新增：用户动作类型（默认 answer） */
  user_action?: "answer" | "skip_question" | "use_default" | "generate_draft_now";
}

/** 搜索请求 */
export interface SearchRequest {
  /** 查询词（可选，为空时从 spec 拼接） */
  query?: string;
  /** 雷达需求规格 JSON（可选，简化测试可不传用默认） */
  spec?: unknown;
  /** 每个 provider 最大结果数（默认 10） */
  max_results?: number;
  /** AI 精筛阈值（默认 50） */
  min_relevance?: number;
  /** 是否抓取正文（默认 true） */
  enable_content_fetch?: boolean;
  /** V1.5 新增：从 RadarStore 取 spec（优先级高于 spec 字段） */
  radar_id?: string;
}

/** Watch Rules 保存请求 */
export interface WatchRulesSaveRequest {
  /** 规则文本（多行 DSL） */
  rules_text: string;
}

/** Watch Rules 追加请求 */
export interface WatchRulesAppendRequest {
  /** 单行规则文本 */
  line: string;
}

/** Watch Rules 匹配请求 */
export interface WatchRulesMatchRequest {
  /** 规则文本（可选，不传则用已存储的规则） */
  rules_text?: string;
  /** 是否用机会库中的条目做匹配（默认 true） */
  use_store_entries?: boolean;
}

/** 报告生成请求 */
export interface ReportGenerateRequest {
  /** 机会列表（OpportunityCard[]，可选） */
  opportunities?: unknown[];
  /** 雷达需求规格（可选） */
  spec?: unknown;
  /** 雷达类型（默认 ai_competition） */
  radar_type?: "ai_competition" | "opc_policy" | "cultural_heritage";
  /** 报告周期开始日期（YYYY-MM-DD，可选，默认今天前 7 天） */
  period_start?: string;
  /** 报告周期结束日期（YYYY-MM-DD，可选，默认今天） */
  period_end?: string;
  /** V1.5-08 新增：关联到具体雷达（可选，不传则不写入 ReportStore） */
  radar_id?: string;
  /** V1.5 评审v2 新增：关联到具体运行记录（可选，传入时回写 RadarRun.reportId） */
  run_id?: string;
}

/** 机会库添加请求 */
export interface OpportunityAddRequest {
  /** 机会卡片 */
  card: unknown;
  /** 雷达类型 */
  radar_type: "ai_competition" | "opc_policy" | "cultural_heritage";
}

/** 机会库更新请求 */
export interface OpportunityUpdateRequest {
  /** 卡片字段更新（部分字段） */
  updates: Record<string, unknown>;
}

// ============================================================
// V1.5-03 新增：雷达管理请求/响应类型
// ============================================================

/** 创建雷达请求 */
export interface RadarCreateRequest {
  /** 雷达名称 */
  name: string;
  /** 雷达类型 */
  kind: "ai_competition" | "opc_policy" | "cultural_heritage" | "custom";
  /** 需求规格（可选） */
  spec?: RadarRequirementSpec;
  /** Provider 路由（可选） */
  providerRouting?: ProviderRouting;
}

/** 更新雷达请求 */
export interface RadarUpdateRequest {
  /** 雷达名称 */
  name?: string;
  /** 需求规格 */
  spec?: RadarRequirementSpec;
  /** 隐私配置 */
  privacy?: RadarPrivacy;
  /** Provider 路由 */
  providerRouting?: ProviderRouting;
  /** V1.6-06 新增：Watch Rules DSL 规则列表 */
  watchRules?: string[];
}

/** 运行雷达请求（可选） */
export interface RadarRunRequest {
  /** 覆盖 spec 里的 query */
  query?: string;
}

/** 运行雷达结果 */
export interface RadarRunResult {
  /** 运行记录 */
  run: RadarRun;
  /** 机会卡片列表（前端主数据） */
  opportunityCards?: OpportunityCard[];
  /** 来源候选列表 */
  sourceCandidates?: SourceCandidate[];
  /** 搜索到的机会列表（调试用，含评分明细） */
  opportunities: ScoredOpportunity[];
  /** V1.6b 新增：Watch Rules 过滤统计 */
  watch_rules_before?: number;
  watch_rules_after?: number;
  watch_rules_filtered_out?: number;
  /** V1.6b 新增：AI 精筛统计(增量复用) */
  ai_filter_skipped?: number;
  ai_filter_executed?: number;
  /** V1.6b 新增：provider 降级信息 */
  providerDegradation?: {
    fallbackUsed: boolean;
    primaryErrors: Record<string, string>;
    /** V1.6b 新增：fallback provider 的错误记录（provider name → 错误信息） */
    fallbackErrors: Record<string, string>;
    fallbackProviders: string[];
  };
}

// ============================================================
// V1.5-05 新增：AI 生成器请求/响应类型
// ============================================================

/** AI 生成雷达请求 */
export interface RadarGenerateRequest {
  /** 用户自然语言描述 */
  description: string;
  /** 可选的上传文件解析文本 */
  uploaded_text?: string;
}

/** AI 生成雷达响应数据 */
export interface RadarGenerateResponseData {
  /** 生成的 RadarSpec */
  spec: RadarRequirementSpec;
  /** AI 建议的雷达名称（≤20 字） */
  suggestedName: string;
  /** 字段完整率（0-100） */
  completeness: number;
}
