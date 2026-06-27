/**
 * 报告归档索引（report_archive）
 *
 * 来源：Task 013 第 4 节。
 *
 * 维护 reports/.archive/index.json，记录每次导出的雷达报告元数据。
 * 支持按雷达类型、日期范围查询历史报告。
 *
 * 设计要点：
 *   - 归档索引文件：reports/.archive/index.json
 *   - 同周期同雷达覆盖更新（相同 radar_type + period_start + period_end 替换旧条目）
 *   - 索引不存在时返回空数组（不报错）
 *   - 纯函数 + Node.js fs 模块，不接 LLM
 */

import fs from "fs";
import path from "path";
import type { RadarReportResult } from "./radar-report-generator";

// ============================================================
// 类型定义
// ============================================================

/** 雷达类型（与雷达报告生成器一致） */
type RadarType = "ai_competition" | "opc_policy" | "cultural_heritage";

/** 归档记录单条条目 */
export interface ArchiveEntry {
  /** 报告文件名 */
  file_name: string;
  /** 报告文件路径（相对路径，相对 reports/ 目录） */
  file_path: string;
  /** 雷达类型 */
  radar_type: RadarType;
  /** 报告周期开始（YYYY-MM-DD） */
  period_start: string;
  /** 报告周期结束（YYYY-MM-DD） */
  period_end: string;
  /** 生成时间（ISO 字符串） */
  generated_at: string;
  /** 报告统计 */
  stats: RadarReportResult["stats"];
  /** 报告版本 */
  version: string;
}

/** 归档索引文件结构 */
export interface ArchiveIndex {
  /** 索引版本 */
  version: string;
  /** 最后更新时间（ISO 字符串） */
  updated_at: string;
  /** 条目列表 */
  entries: ArchiveEntry[];
}

/** 归档查询条件 */
export interface ArchiveQuery {
  /** 按雷达类型筛选（可选） */
  radar_type?: RadarType;
  /** 按日期范围筛选 - 开始（可选，YYYY-MM-DD） */
  date_from?: string;
  /** 按日期范围筛选 - 结束（可选，YYYY-MM-DD） */
  date_to?: string;
  /** 归档索引文件路径（默认 "reports/.archive/index.json"） */
  archive_path?: string;
}

/** 归档追加输入 */
export interface ArchiveAppendInput {
  /** 归档条目 */
  entry: ArchiveEntry;
  /** 归档索引文件路径（默认 "reports/.archive/index.json"） */
  archive_path?: string;
}

/** 归档追加结果 */
export interface ArchiveAppendResult {
  /** 是否成功 */
  success: boolean;
  /** 当前索引条目数 */
  entries_count: number;
  /** 失败原因 */
  error: string | null;
}

// ============================================================
// 默认常量
// ============================================================

/** 默认归档索引文件路径 */
const DEFAULT_ARCHIVE_PATH = "reports/.archive/index.json";

/** 归档索引版本 */
const ARCHIVE_VERSION = "1.0";

// ============================================================
// 辅助函数
// ============================================================

/** 读取归档索引（文件不存在时返回空索引） */
function readArchive(archivePath: string): ArchiveIndex {
  const empty: ArchiveIndex = {
    version: ARCHIVE_VERSION,
    updated_at: new Date().toISOString(),
    entries: [],
  };
  try {
    if (!fs.existsSync(archivePath)) {
      return empty;
    }
    const raw = fs.readFileSync(archivePath, "utf-8");
    const parsed = JSON.parse(raw) as ArchiveIndex;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return empty;
    }
    return parsed;
  } catch {
    return empty;
  }
}

/** 确保归档目录存在 */
function ensureArchiveDir(archivePath: string): void {
  const dir = path.dirname(archivePath);
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 计算条目的唯一 key（用于同周期覆盖判断）。
 * 同 radar_type + period_start + period_end 视为同一报告。
 */
function entryKey(entry: ArchiveEntry): string {
  return `${entry.radar_type}|${entry.period_start}|${entry.period_end}`;
}

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 追加一条归档记录。
 *
 * 规则：
 *   - 同 radar_type + period_start + period_end 的条目会覆盖旧条目（不重复）
 *   - 不同周期的条目追加到末尾
 *   - 自动创建归档目录（如不存在）
 *   - 自动更新 updated_at
 *
 * @param input 归档追加输入
 * @returns 归档追加结果
 */
export function appendToArchive(input: ArchiveAppendInput): ArchiveAppendResult {
  const archivePath = input.archive_path ?? DEFAULT_ARCHIVE_PATH;
  const entry = input.entry;

  try {
    ensureArchiveDir(archivePath);
    const archive = readArchive(archivePath);

    // 同周期覆盖：查找是否有相同 key 的条目
    const key = entryKey(entry);
    const existingIdx = archive.entries.findIndex((e) => entryKey(e) === key);

    if (existingIdx >= 0) {
      archive.entries[existingIdx] = entry;
    } else {
      archive.entries.push(entry);
    }

    archive.updated_at = new Date().toISOString();
    archive.version = ARCHIVE_VERSION;

    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2), "utf-8");

    return {
      success: true,
      entries_count: archive.entries.length,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      entries_count: 0,
      error: `归档写入失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 查询归档记录。
 *
 * 筛选规则：
 *   - radar_type：精确匹配
 *   - date_from：只返回 period_end >= date_from 的条目
 *   - date_to：只返回 period_start <= date_to 的条目
 *   - 索引不存在时返回空数组（不报错）
 *
 * @param query 查询条件
 * @returns 匹配的归档条目列表
 */
export function queryArchive(query: ArchiveQuery = {}): ArchiveEntry[] {
  const archivePath = query.archive_path ?? DEFAULT_ARCHIVE_PATH;
  const archive = readArchive(archivePath);

  let result = archive.entries;

  // 按雷达类型筛选
  if (query.radar_type) {
    result = result.filter((e) => e.radar_type === query.radar_type);
  }

  // 按日期范围筛选
  if (query.date_from) {
    // 只返回 period_end >= date_from 的条目
    result = result.filter((e) => e.period_end >= query.date_from!);
  }
  if (query.date_to) {
    // 只返回 period_start <= date_to 的条目
    result = result.filter((e) => e.period_start <= query.date_to!);
  }

  return result;
}

/**
 * 读取完整归档索引（不筛选）。
 *
 * @param archivePath 归档索引文件路径
 * @returns 归档索引（文件不存在时返回空索引）
 */
export function readArchiveIndex(archivePath: string = DEFAULT_ARCHIVE_PATH): ArchiveIndex {
  return readArchive(archivePath);
}
