/**
 * 雷达报告导出器（radar_report_exporter）
 *
 * 来源：Task 013 第 4 节。
 *
 * 输入：Task 012 产出的 RadarReportResult
 * 输出：写入文件到 reports/ 目录 + 调用归档索引
 *
 * 文件名规范：
 *   radar-report-{radar_type}-{period_start}-{period_end}.md
 *   radar_type 用下划线转连字符：ai_competition → ai-competition
 *
 * 不复用 Task 011 的 exportRadarPlan()（导出内容/目录/文件名/归档需求不同）。
 * 纯函数 + Node.js fs 模块，不接 LLM。
 */

import fs from "fs";
import path from "path";
import type { RadarReportResult } from "./radar-report-generator";
import { BRAND } from "../brand/constants";
import { appendToArchive } from "./report-archive";
import type { ArchiveEntry } from "./report-archive";

// ============================================================
// 类型定义
// ============================================================

/** 雷达类型（与雷达报告生成器一致） */
type RadarType = "ai_competition" | "opc_policy" | "cultural_heritage";

/** 导出输入 */
export interface RadarReportExportInput {
  /** Task 012 产出的雷达报告结果 */
  report_result: RadarReportResult;
  /** 雷达类型（影响文件名） */
  radar_type: RadarType;
  /** 报告周期开始日期（YYYY-MM-DD，影响文件名） */
  period_start: string;
  /** 报告周期结束日期（YYYY-MM-DD，影响文件名） */
  period_end: string;
  /** 输出目录（默认 "reports"） */
  output_dir?: string;
}

/** 导出结果 */
export interface RadarReportExportResult {
  /** 是否成功导出 */
  success: boolean;
  /** 雷达报告文件路径 */
  report_file_path: string | null;
  /** 失败原因 */
  error: string | null;
  /** 是否已归档 */
  archived: boolean;
}

// ============================================================
// 辅助函数
// ============================================================

/** radar_type 转文件名片段：下划线 → 连字符 */
function radarTypeToFileSegment(radarType: string): string {
  return radarType.replace(/_/g, "-");
}

/** 生成报告文件名：radar-report-{radar_type}-{period_start}-{period_end}.md */
function buildReportFileName(
  radarType: RadarType,
  periodStart: string,
  periodEnd: string,
): string {
  const segment = radarTypeToFileSegment(radarType);
  return `radar-report-${segment}-${periodStart}-${periodEnd}.md`;
}

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 导出雷达报告为 Markdown 文件，并追加到归档索引。
 *
 * 规则：
 *   - 文件名：radar-report-{radar_type}-{period_start}-{period_end}.md
 *   - 输出目录：reports/（默认），自动创建
 *   - 空内容拒绝：report_result.markdown 为空时拒绝
 *   - success=false 拒绝：report_result.success=false 时拒绝
 *   - 同周期覆盖：相同 radar_type + period_start + period_end 的报告，文件覆盖，归档索引覆盖
 *   - 自动归档：导出成功后调用 appendToArchive()
 *
 * @param input 导出输入
 * @returns 导出结果
 */
export function exportRadarReport(input: RadarReportExportInput): RadarReportExportResult {
  const {
    report_result,
    radar_type,
    period_start,
    period_end,
    output_dir = "reports",
  } = input;

  // 拒绝条件 1：report_result.success=false
  if (!report_result.success) {
    return {
      success: false,
      report_file_path: null,
      error: `雷达报告生成失败（success=false），拒绝导出。原因：${report_result.error ?? "未知"}`,
      archived: false,
    };
  }

  // 拒绝条件 2：markdown 为空
  if (typeof report_result.markdown !== "string" || report_result.markdown.trim() === "") {
    return {
      success: false,
      report_file_path: null,
      error: "雷达报告 Markdown 内容为空，拒绝导出。",
      archived: false,
    };
  }

  // 拒绝条件 3：品牌合规校验（markdown 必须含 BRAND.product_name）
  if (!report_result.markdown.includes(BRAND.product_name)) {
    return {
      success: false,
      report_file_path: null,
      error: `雷达报告 Markdown 不含品牌名「${BRAND.product_name}」，品牌合规校验失败，拒绝导出。`,
      archived: false,
    };
  }

  // 生成文件名
  const fileName = buildReportFileName(radar_type, period_start, period_end);

  // 确保输出目录存在（自动创建）
  try {
    fs.mkdirSync(output_dir, { recursive: true });
  } catch (err) {
    return {
      success: false,
      report_file_path: null,
      error: `创建输出目录失败：${err instanceof Error ? err.message : String(err)}`,
      archived: false,
    };
  }

  // 写入文件（同周期覆盖）
  const filePath = path.resolve(output_dir, fileName);
  try {
    fs.writeFileSync(filePath, report_result.markdown, "utf-8");
  } catch (err) {
    return {
      success: false,
      report_file_path: null,
      error: `写入雷达报告文件失败：${err instanceof Error ? err.message : String(err)}`,
      archived: false,
    };
  }

  // 追加归档索引
  const entry: ArchiveEntry = {
    file_name: fileName,
    file_path: fileName,
    radar_type,
    period_start,
    period_end,
    generated_at: report_result.generated_at,
    stats: report_result.stats,
    version: report_result.version,
  };

  // 归档索引文件路径：{output_dir}/.archive/index.json
  const archivePath = path.resolve(output_dir, ".archive", "index.json");
  const archiveResult = appendToArchive({
    entry,
    archive_path: archivePath,
  });

  return {
    success: true,
    report_file_path: filePath,
    error: null,
    archived: archiveResult.success,
  };
}
