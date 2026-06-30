/**
 * ReportStore —— 报告元数据持久化层
 *
 * 来源：Task V1.5-08 第 3.1/3.2 节。
 *
 * 设计原则：
 *   - 只存元数据（ReportMeta），正文在文件系统（reports/api/ 或 reports/export/）
 *   - 同步 IO（readFileSync / writeFileSync），与 radar-store / watch-store 一致
 *   - list 按 createdAt 降序，listByRadarId 默认 limit=50
 *   - 通过 filename 关联文件系统中的正文
 */

import fs from "fs";
import path from "path";
import type { ExportFormat } from "../export/report-exporter";

// ============================================================
// 类型定义
// ============================================================

/** 报告元数据（不存正文，正文在文件系统） */
export interface ReportMeta {
  /** 报告唯一 ID（report_ 前缀） */
  id: string;
  /** 关联的雷达 ID */
  radarId: string;
  /** 关联的运行 ID（可选，定时运行生成的报告关联 runId） */
  runId?: string;
  /** 报告标题 */
  title: string;
  /** 雷达类型（ai_competition / opc_policy / cultural_heritage / custom） */
  radarType: string;
  /** 报告格式（markdown / html / pdf） */
  format: ExportFormat;
  /** 文件名（在 reports/api/ 或 reports/export/ 目录下） */
  filename: string;
  /** 报告周期开始日期（YYYY-MM-DD） */
  periodStart: string;
  /** 报告周期结束日期（YYYY-MM-DD） */
  periodEnd: string;
  /** 机会数 */
  opportunityCount: number;
  /** 创建时间（ISO 8601） */
  createdAt: string;
}

/** 创建报告元数据输入 */
export interface ReportCreateInput {
  /** 关联的雷达 ID */
  radarId: string;
  /** 关联的运行 ID（可选） */
  runId?: string;
  /** 报告标题 */
  title: string;
  /** 雷达类型 */
  radarType: string;
  /** 报告格式 */
  format: ExportFormat;
  /** 文件名 */
  filename: string;
  /** 报告周期开始日期 */
  periodStart: string;
  /** 报告周期结束日期 */
  periodEnd: string;
  /** 机会数 */
  opportunityCount: number;
}

/** 列表过滤条件 */
export interface ReportListFilter {
  /** 按雷达 ID 过滤 */
  radarId?: string;
  /** 按雷达类型过滤 */
  radarType?: string;
  /** 按格式过滤 */
  format?: string;
  /** 返回条数上限（默认 50） */
  limit?: number;
}

// ============================================================
// ReportStore 接口
// ============================================================

/**
 * 报告存储接口。
 *
 * 可插拔实现——当前提供 JsonReportStore，未来可扩展数据库实现。
 */
export interface ReportStore {
  /** 创建报告元数据（报告正文已由 reports.ts 写入文件，这里只存 meta） */
  create(input: ReportCreateInput): ReportMeta;
  /** 按 ID 获取 */
  get(id: string): ReportMeta | null;
  /** 列出所有报告（按 createdAt 降序） */
  list(filter?: ReportListFilter): ReportMeta[];
  /** 按雷达 ID 列出报告（按 createdAt 降序，默认 limit=50） */
  listByRadarId(radarId: string, limit?: number): ReportMeta[];
  /** 删除报告元数据（返回是否删除成功；持久化由调用方负责） */
  delete(id: string): boolean;
  /** 持久化到磁盘 */
  save(): void;
  /** 从磁盘加载 */
  load(): void;
}

// ============================================================
// JsonReportStore 实现
// ============================================================

/** 默认持久化路径 */
const DEFAULT_REPORT_STORE_PATH = "data/report-index.json";

/**
 * JSON 文件实现的 ReportStore。
 *
 * 文件格式：{ "reports": ReportMeta[], "version": "1.0" }
 */
export class JsonReportStore implements ReportStore {
  private readonly filePath: string;
  private reports: Map<string, ReportMeta> = new Map();

  constructor(options: { file_path?: string } = {}) {
    const filePath = options.file_path ?? DEFAULT_REPORT_STORE_PATH;
    this.filePath = path.resolve(process.cwd(), filePath);
    this.load();
  }

  create(input: ReportCreateInput): ReportMeta {
    const meta: ReportMeta = {
      id: generateReportId(),
      radarId: input.radarId,
      ...(input.runId ? { runId: input.runId } : {}),
      title: input.title,
      radarType: input.radarType,
      format: input.format,
      filename: input.filename,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      opportunityCount: input.opportunityCount,
      createdAt: new Date().toISOString(),
    };
    this.reports.set(meta.id, meta);
    return meta;
  }

  get(id: string): ReportMeta | null {
    return this.reports.get(id) ?? null;
  }

  list(filter?: ReportListFilter): ReportMeta[] {
    let result = Array.from(this.reports.values());
    if (filter) {
      if (filter.radarId !== undefined) {
        result = result.filter((r) => r.radarId === filter.radarId);
      }
      if (filter.radarType !== undefined) {
        result = result.filter((r) => r.radarType === filter.radarType);
      }
      if (filter.format !== undefined) {
        result = result.filter((r) => r.format === filter.format);
      }
    }
    // 按 createdAt 降序
    result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = filter?.limit ?? 50;
    return result.slice(0, limit);
  }

  listByRadarId(radarId: string, limit?: number): ReportMeta[] {
    return this.list({ radarId, limit });
  }

  delete(id: string): boolean {
    // 从内存 Map 中删除；持久化由调用方负责（调用方需在删除后调用 save()）
    return this.reports.delete(id);
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      reports: Array.from(this.reports.values()),
      version: "1.0",
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  load(): void {
    this.reports.clear();
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as { reports?: ReportMeta[] };
      if (data.reports && Array.isArray(data.reports)) {
        for (const meta of data.reports) {
          this.reports.set(meta.id, meta);
        }
      }
    } catch {
      // 文件损坏时清空，不阻断启动
      this.reports.clear();
    }
  }
}

/** 生成报告 ID（report_ 前缀 + 时间戳 + 随机串） */
function generateReportId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `report_${ts}${rand}`;
}
