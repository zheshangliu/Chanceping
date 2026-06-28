/**
 * API 层统一类型定义
 *
 * 来源：Task 022 第 4.1 节。
 *
 * 所有 API 响应统一使用 ApiResponse<T> 格式。
 */

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
