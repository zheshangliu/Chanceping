/**
 * 雷达方案导出器（radar_plan_exporter）
 *
 * 来源：Task 011 第 4 节。
 *
 * 输入：雷达方案 Markdown + 校验报告 Markdown
 * 输出：写入文件到 exports/ 目录
 *
 * 文件名规范：
 *   - radar-plan-{radar_type}-{YYYYMMDD-HHmmss}.md
 *   - validation-report-{radar_type}-{YYYYMMDD-HHmmss}.md
 *   - radar_type 用下划线转连字符：ai_competition → ai-competition
 *
 * 纯函数 + Node.js fs 模块，不接 LLM。
 */

import fs from "fs";
import path from "path";

// ============================================================
// 类型定义
// ============================================================

/** 导出输入 */
export interface RadarPlanExportInput {
  /** 雷达方案 Markdown */
  plan_markdown: string;
  /** 校验报告 Markdown */
  validation_report_markdown: string;
  /** 输出目录（默认 "exports"） */
  output_dir?: string;
  /** 雷达类型（影响文件名） */
  radar_type: "ai_competition" | "opc_policy" | "cultural_heritage";
  /** 生成时间（ISO 字符串，用于文件名） */
  generated_at: string;
}

/** 导出结果 */
export interface RadarPlanExportResult {
  /** 是否成功导出 */
  success: boolean;
  /** 雷达方案文件路径 */
  plan_file_path: string | null;
  /** 校验报告文件路径 */
  report_file_path: string | null;
  /** 失败原因 */
  error: string | null;
}

// ============================================================
// 辅助函数
// ============================================================

/** 将 ISO 时间字符串转为 YYYYMMDD-HHmmss 格式 */
function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    const yyyy = d.getUTCFullYear().toString();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
  } catch {
    // 解析失败时用当前时间
    const d = new Date();
    const yyyy = d.getUTCFullYear().toString();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
  }
}

/** radar_type 转文件名片段：下划线 → 连字符 */
function radarTypeToFileSegment(radarType: string): string {
  return radarType.replace(/_/g, "-");
}

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 导出雷达方案和校验报告为 Markdown 文件。
 *
 * 文件名规范：
 *   - radar-plan-{radar_type}-{YYYYMMDD-HHmmss}.md
 *   - validation-report-{radar_type}-{YYYYMMDD-HHmmss}.md
 *
 * 如输出目录不存在，自动创建（mkdirSync recursive）。
 *
 * @param input 导出输入
 * @returns 导出结果
 */
export function exportRadarPlan(input: RadarPlanExportInput): RadarPlanExportResult {
  const {
    plan_markdown,
    validation_report_markdown,
    output_dir = "exports",
    radar_type,
    generated_at,
  } = input;

  // 空内容拒绝
  if (typeof plan_markdown !== "string" || plan_markdown.trim() === "") {
    return {
      success: false,
      plan_file_path: null,
      report_file_path: null,
      error: "雷达方案 Markdown 内容为空，拒绝导出。",
    };
  }
  if (typeof validation_report_markdown !== "string" || validation_report_markdown.trim() === "") {
    return {
      success: false,
      plan_file_path: null,
      report_file_path: null,
      error: "校验报告 Markdown 内容为空，拒绝导出。",
    };
  }

  // 生成文件名
  const timestamp = formatTimestamp(generated_at);
  const radarSegment = radarTypeToFileSegment(radar_type);
  const planFileName = `radar-plan-${radarSegment}-${timestamp}.md`;
  const reportFileName = `validation-report-${radarSegment}-${timestamp}.md`;

  // 确保输出目录存在（自动创建）
  try {
    fs.mkdirSync(output_dir, { recursive: true });
  } catch (err) {
    return {
      success: false,
      plan_file_path: null,
      report_file_path: null,
      error: `创建输出目录失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 写入文件
  const planFilePath = path.resolve(output_dir, planFileName);
  const reportFilePath = path.resolve(output_dir, reportFileName);

  try {
    fs.writeFileSync(planFilePath, plan_markdown, "utf-8");
  } catch (err) {
    return {
      success: false,
      plan_file_path: null,
      report_file_path: null,
      error: `写入雷达方案文件失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    fs.writeFileSync(reportFilePath, validation_report_markdown, "utf-8");
  } catch (err) {
    return {
      success: false,
      plan_file_path: planFilePath,
      report_file_path: null,
      error: `写入校验报告文件失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    success: true,
    plan_file_path: planFilePath,
    report_file_path: reportFilePath,
    error: null,
  };
}
