/**
 * Demo 数据加载器（统一入口）
 *
 * 来源：Task 036 第 5 节。
 *
 * 提供：
 *   - loadDemoData(radarType, mode) → 搜索结果 + 机会元数据
 *   - loadMockLlmResponses() → Mock LLM 响应
 *   - loadDemoSearchResults(radarType, mode) → SearchResult[]（供 SearchOrchestrator 使用）
 *
 * 数据文件：
 *   - ai-events.mock.json：5 条 Mock AI 赛事（S/A/B/C 等级覆盖）
 *   - ai-events.recorded.json：5 条 Recorded AI 赛事（含来源字段）
 *   - llm-responses.mock.json：Mock LLM 响应（确认卡 + 精筛结果）
 */

import fs from "fs";
import path from "path";
import type { SearchResult } from "../search/types";
import type { DataMode } from "./data-mode";

// ============================================================
// 类型定义
// ============================================================

/** Demo 机会数据（Mock/Recorded 通用格式） */
export interface DemoOpportunity {
  title: string;
  url: string;
  snippet: string;
  source_provider: string;
  page_content: string;
  deadline: string;
  deadline_status: "confirmed" | "rolling" | "unknown" | "expired";
  deadline_source_url: string;
  reward: string;
  organizer: string;
  eligibility: string;
  expected_level: "S" | "A" | "B" | "C";
  // Recorded 模式额外字段
  recorded_at?: string;
  query?: string;
  provider?: string;
  original_url?: string;
  snapshot_note?: string;
  verified_by?: string;
  verification_status?: string;
}

/** Demo 数据文件格式 */
export interface DemoDataFile {
  radar_type: string;
  mode: string;
  opportunities: DemoOpportunity[];
}

/** Mock LLM 确认卡维度 */
export interface MockConfidenceDimension {
  score: number;
  weight: number;
}

/** Mock LLM 确认卡 */
export interface MockConfirmationCard {
  client_name: string;
  client_type: string;
  industry: string;
  business_type: string;
  primary_goal: string;
  action_intent: string;
  primary_regions: string[];
  core_keywords_zh: string[];
  total_confidence: number;
  dimensions: {
    client_identity: MockConfidenceDimension;
    business_goal: MockConfidenceDimension;
    opportunity_type: MockConfidenceDimension;
    region_scope: MockConfidenceDimension;
    exclusion_rules: MockConfidenceDimension;
    action_scenario: MockConfidenceDimension;
    report_format: MockConfidenceDimension;
  };
}

/** Mock LLM 精筛结果项 */
export interface MockAIFilterResultItem {
  title: string;
  relevant: boolean;
  reason: string;
}

/** Mock LLM 响应文件格式 */
export interface MockLlmResponses {
  requirement_confirmation: {
    questions: string[];
    confirmation_card: MockConfirmationCard;
  };
  ai_filter: {
    results: MockAIFilterResultItem[];
  };
}

// ============================================================
// 数据加载函数
// ============================================================

/** Demo 数据目录 */
const DEMO_DIR = path.resolve(__dirname);

/**
 * Task 042: Mock 数据文件按雷达类型分发映射。
 * 新增 opc_policy / cultural_heritage 的 Mock 数据文件。
 */
const MOCK_FILE_MAP: Record<string, string> = {
  ai_competition: "ai-events.mock.json",
  opc_policy: "opc-events.mock.json",
  cultural_heritage: "cultural-events.mock.json",
};

/**
 * Task 042: Recorded 数据文件按雷达类型分发映射。
 * 注意：OPC/文创的 recorded 数据 V1.2 可选录制，未录制时回退到 AI 赛事 recorded。
 */
const RECORDED_FILE_MAP: Record<string, string> = {
  ai_competition: "ai-events.recorded.json",
  // OPC/文创暂用 AI 赛事 recorded 数据兜底（V1.2 可选录制独立 recorded 数据）
  opc_policy: "ai-events.recorded.json",
  cultural_heritage: "ai-events.recorded.json",
};

/**
 * 加载 Demo 数据文件（Mock 或 Recorded）。
 *
 * Task 042 修复：按 radarType 分发文件，不再硬编码 ai-events.mock.json。
 *
 * @param radarType 雷达类型（ai_competition / opc_policy / cultural_heritage）
 * @param mode 数据模式（"mock" 或 "recorded"）
 * @returns Demo 数据文件
 */
export function loadDemoData(
  radarType: string = "ai_competition",
  mode: DataMode = "mock",
): DemoDataFile {
  const key = radarType ?? "ai_competition";
  let filename: string;
  if (mode === "recorded") {
    filename = RECORDED_FILE_MAP[key] ?? RECORDED_FILE_MAP.ai_competition;
  } else {
    filename = MOCK_FILE_MAP[key] ?? MOCK_FILE_MAP.ai_competition;
  }

  const fullPath = path.join(DEMO_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Demo 数据文件不存在: ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const data = JSON.parse(content) as DemoDataFile;
  return data;
}

/**
 * 加载 Mock LLM 响应。
 *
 * @returns Mock LLM 响应（确认卡 + 精筛结果）
 */
export function loadMockLlmResponses(): MockLlmResponses {
  const fullPath = path.join(DEMO_DIR, "llm-responses.mock.json");
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Mock LLM 响应文件不存在: ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  return JSON.parse(content) as MockLlmResponses;
}

/**
 * 将 DemoOpportunity 转换为 SearchResult（供 SearchOrchestrator 使用）。
 */
export function toSearchResult(opp: DemoOpportunity): SearchResult {
  return {
    title: opp.title,
    url: opp.url,
    snippet: opp.snippet,
    source_provider: opp.source_provider,
    source_type: "web" as const,
    published_at: opp.deadline || undefined,
  };
}

/**
 * 加载 Demo 数据并转换为 SearchResult[]（供 SearchOrchestrator 使用）。
 *
 * @param radarType 雷达类型
 * @param mode 数据模式
 * @returns SearchResult 数组
 */
export function loadDemoSearchResults(
  radarType: string = "ai_competition",
  mode: DataMode = "mock",
): SearchResult[] {
  const data = loadDemoData(radarType, mode);
  return data.opportunities.map(toSearchResult);
}

/**
 * 加载 Demo 数据并返回完整的机会列表（含 page_content 等额外字段）。
 *
 * @param radarType 雷达类型
 * @param mode 数据模式
 * @returns DemoOpportunity 数组
 */
export function loadDemoOpportunities(
  radarType: string = "ai_competition",
  mode: DataMode = "mock",
): DemoOpportunity[] {
  return loadDemoData(radarType, mode).opportunities;
}
