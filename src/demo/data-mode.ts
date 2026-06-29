/**
 * 数据模式 + LLM 模式切换逻辑
 *
 * 来源：Task 036 第 6.1 节。
 *
 * 模式组合矩阵：
 *   DATA_MODE  | LLM_MODE | 用途
 *   -----------+----------+---------------------------
 *   mock       | mock     | 最稳定演示 / CI 测试
 *   recorded   | mock     | 固定真实数据回放
 *   recorded   | live     | 验证模型判断
 *   live       | live     | 后续真实运行（V1.4）
 *
 * 默认：DATA_MODE=mock, LLM_MODE=mock（最稳定演示模式）
 */

/** 数据模式 */
export type DataMode = "mock" | "recorded" | "live";

/** LLM 模式 */
export type LlmMode = "mock" | "live";

/**
 * 获取当前数据模式。
 * 环境变量 DATA_MODE 未设置时默认 "mock"（最稳定演示模式）。
 */
export function getDataMode(): DataMode {
  const mode = process.env.DATA_MODE ?? "mock";
  if (mode === "live") return "live";
  if (mode === "recorded") return "recorded";
  return "mock";
}

/**
 * 获取当前 LLM 模式。
 * 环境变量 LLM_MODE 未设置时默认 "mock"。
 */
export function getLlmMode(): LlmMode {
  const mode = process.env.LLM_MODE ?? "mock";
  if (mode === "live") return "live";
  return "mock";
}

/** 是否 Mock 数据模式 */
export function isMockData(): boolean {
  return getDataMode() === "mock";
}

/** 是否 Recorded 数据模式 */
export function isRecordedData(): boolean {
  return getDataMode() === "recorded";
}

/** 是否 Live 数据模式 */
export function isLiveData(): boolean {
  return getDataMode() === "live";
}

/** 是否 Mock LLM 模式 */
export function isMockLlm(): boolean {
  return getLlmMode() === "mock";
}

/** 是否 Live LLM 模式 */
export function isLiveLlm(): boolean {
  return getLlmMode() === "live";
}
