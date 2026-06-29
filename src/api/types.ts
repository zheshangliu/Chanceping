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
  /** 搜索到的机会列表 */
  opportunities: ScoredOpportunity[];
}
