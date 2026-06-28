/**
 * LLM 策略配置文件（llm_strategy）
 *
 * 来源：Task 020 第 4.4 节。
 *
 * 定义两套 LLM API 策略：
 *   - COMMERCIAL_STRATEGY（商业版）：追求成本最优，多 Provider 混合
 *   - COMPETITION_STRATEGY（参赛版）：只用 Qwen Cloud API，部署在阿里云
 *
 * 通过 LLM_STRATEGY 环境变量切换，与现有 DASHSCOPE_API_KEY 模式一致，
 * 适配云部署（阿里云环境变量注入），无需文件 IO。
 *
 * 策略用代码常量而非 JSON 文件：编译时检查 TaskType 完整性，无需运行时解析。
 */

import type {
  TaskType,
  LLMProvider,
  ModelRoute,
  TaskRouting,
  StrategyProfile,
  ModelStrategy,
} from "../agents/model-router";

// ============================================================
// 商业版策略（追求成本最优）
// ============================================================

/**
 * 商业版策略。
 *
 * 核心思路：能用免费的不用付费的，能用便宜的不用贵的。
 *   - GLM-4.7-Flash 完全免费且支持工具调用，批量初筛层零成本
 *   - DeepSeek V4-Pro 性价比远高于 Qwen3.7-Max（便宜 5.7 倍）
 *   - Qwen3.7-Plus 仅用于报告生成和兜底，最小化 Qwen 用量
 *
 * 预估单次雷达成本约 $0.05-$0.10
 */
export const COMMERCIAL_STRATEGY: ModelStrategy = {
  profile: "commercial",
  defaultTask: "requirement_understanding",
  taskRouting: {
    batch_screening: {
      primary: { provider: "glm", model: "glm-4.7-flash" },
      fallback: { provider: "deepseek", model: "deepseek-v4-flash" },
    },
    core_judgment: {
      primary: { provider: "deepseek", model: "deepseek-v4-pro" },
      fallback: { provider: "qwen", model: "qwen3.7-plus" },
    },
    high_difficulty: {
      primary: { provider: "deepseek", model: "deepseek-v4-pro" },
      fallback: { provider: "qwen", model: "qwen3.7-plus" },
    },
    report_generation: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: { provider: "deepseek", model: "deepseek-v4-pro" },
    },
    requirement_understanding: {
      primary: { provider: "deepseek", model: "deepseek-v4-flash" },
      fallback: { provider: "glm", model: "glm-4.7-flash" },
    },
    summarization: {
      primary: { provider: "deepseek", model: "deepseek-v4-flash" },
      fallback: { provider: "glm", model: "glm-4.7-flash" },
    },
    dedup_classification: {
      primary: { provider: "glm", model: "glm-4.7-flash" },
      fallback: { provider: "deepseek", model: "deepseek-v4-flash" },
    },
    fallback: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: null,
    },
  },
};

// ============================================================
// 参赛版策略（只用 Qwen Cloud API，部署在阿里云）
// ============================================================

/**
 * 参赛版策略。
 *
 * 按 Qwen Cloud Hackathon 比赛要求，只用 Qwen Cloud API。
 *   - qwen3.7-plus 作为主力（$0.40/$1.60）
 *   - qwen3.7-max 仅用于高难判断（$2.50/$7.50）
 *   - fallback 在同 provider 内降级（max → plus），不跨 provider
 *
 * 预估 $40 voucher 可支撑约 400-500 次雷达扫描。
 */
export const COMPETITION_STRATEGY: ModelStrategy = {
  profile: "competition",
  defaultTask: "requirement_understanding",
  taskRouting: {
    batch_screening: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: null,
    },
    core_judgment: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: { provider: "qwen", model: "qwen3.7-max" },
    },
    high_difficulty: {
      primary: { provider: "qwen", model: "qwen3.7-max" },
      fallback: { provider: "qwen", model: "qwen3.7-plus" },
    },
    report_generation: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: { provider: "qwen", model: "qwen3.7-max" },
    },
    requirement_understanding: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: null,
    },
    summarization: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: null,
    },
    dedup_classification: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: null,
    },
    fallback: {
      primary: { provider: "qwen", model: "qwen3.7-plus" },
      fallback: null,
    },
  },
};

// ============================================================
// 策略选择函数
// ============================================================

/** 按 profile 名称获取策略 */
export function getStrategy(profile: StrategyProfile): ModelStrategy {
  if (profile === "competition") {
    return COMPETITION_STRATEGY;
  }
  return COMMERCIAL_STRATEGY;
}

/**
 * 从环境变量获取策略。
 *
 * - LLM_STRATEGY=commercial → 商业版策略
 * - LLM_STRATEGY=competition → 参赛版策略
 * - 未设置 → 默认 commercial
 */
export function getStrategyFromEnv(): ModelStrategy {
  const profile = typeof process !== "undefined"
    ? process.env?.LLM_STRATEGY ?? ""
    : "";
  if (profile === "competition") {
    return COMPETITION_STRATEGY;
  }
  return COMMERCIAL_STRATEGY;
}
