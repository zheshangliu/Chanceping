/**
 * RadarStore + RadarRunStore —— 雷达持久化层
 *
 * V1.5-02 新增。提供雷达和运行记录的 JSON 文件持久化。
 *
 * 设计原则：
 *   - 同步 IO（readFileSync / writeFileSync），与 watch-store / opportunity-store 一致
 *   - 幂等创建（传入 id 已存在时直接返回已有记录）
 *   - 软删除（archive 设 status=archived + deletedAt）
 *   - 纯数据操作，不调 LLM
 */

import fs from "fs";
import path from "path";
import type {
  Radar,
  RadarKind,
  RadarStatus,
  RadarRun,
  RadarRunStatus,
  RunMode,
  RunTriggeredBy,
  ProviderRouting,
  RadarPrivacy,
  RadarSchedule,
  LastRunStatus,
} from "../schema/radar";
import {
  createDefaultRadar,
  generateRadarId,
  generateRunId,
} from "../schema/radar";
import type { RadarRequirementSpec } from "../schema/radar-requirement-spec";

// ============================================================
// Input / Filter 类型
// ============================================================

/**
 * 创建雷达输入。
 *
 * id 可选——内置雷达传入稳定 ID（如 builtin_ai_competition），
 * 自定义雷达不传则自动生成 radar_xxx。
 */
export interface RadarCreateInput {
  /** 雷达名称 */
  name: string;
  /** 雷达类型 */
  kind: RadarKind;
  /** 需求规格（可选，不传用默认） */
  spec?: RadarRequirementSpec;
  /** Provider 路由（可选，不传用默认） */
  providerRouting?: ProviderRouting;
  /** 所有者 ID（可选） */
  ownerId?: string;
  /** 是否内置雷达（可选） */
  isBuiltin?: boolean;
  /** 稳定 ID（可选，内置雷达用） */
  id?: string;
}

/** 更新雷达输入（全字段可选） */
export interface RadarUpdateInput {
  name?: string;
  spec?: RadarRequirementSpec;
  privacy?: RadarPrivacy;
  providerRouting?: ProviderRouting;
  /** V1.5-03 新增：支持 activate/pause */
  status?: RadarStatus;
  /** V1.5-03 新增：支持运行追踪 */
  currentRunId?: string;
  /** V1.5-03 新增：上次运行结果 */
  lastRunStatus?: LastRunStatus;
  /** V1.5-03 新增：最后运行时间 */
  lastRunAt?: string;
  /** V1.5-06 新增：定时运行配置（传 undefined 显式清空） */
  schedule?: RadarSchedule;
  /** V1.6-06 新增：Watch Rules DSL 规则列表（传 undefined 显式清空） */
  watchRules?: string[];
}

/** 列表过滤条件 */
export interface RadarListFilter {
  status?: RadarStatus;
  kind?: RadarKind;
  isBuiltin?: boolean;
  ownerId?: string;
  /** 是否包含已归档（默认 false） */
  includeArchived?: boolean;
}

/** 创建运行记录输入 */
export interface RadarRunCreateInput {
  /** 所属雷达 ID */
  radarId: string;
  /** 触发方式 */
  mode: RunMode;
  /** 触发者 */
  triggeredBy: RunTriggeredBy;
  /** 搜索查询词（可选） */
  query?: string;
}

// ============================================================
// RadarStore 接口
// ============================================================

/**
 * 雷达存储接口。
 *
 * 可插拔实现——当前提供 JsonRadarStore，未来可扩展数据库实现。
 */
export interface RadarStore {
  /** 创建雷达（返回完整 Radar，含生成的 id） */
  create(input: RadarCreateInput): Radar;
  /** 按 ID 获取单个雷达（不存在返回 null） */
  get(id: string): Radar | null;
  /** 列出所有雷达（支持过滤；不含已归档除非 includeArchived=true） */
  list(filter?: RadarListFilter): Radar[];
  /** 更新雷达（返回更新后的 Radar，不存在返回 null） */
  update(id: string, patch: RadarUpdateInput): Radar | null;
  /** 归档雷达（软删除，设 deletedAt + status=archived） */
  archive(id: string): Radar | null;
  /** 持久化到磁盘 */
  save(): void;
  /** 从磁盘加载 */
  load(): void;
}

// ============================================================
// RadarRunStore 接口
// ============================================================

/**
 * 雷达运行记录存储接口。
 */
export interface RadarRunStore {
  /** 创建运行记录 */
  create(input: RadarRunCreateInput): RadarRun;
  /** 按 ID 获取 */
  get(id: string): RadarRun | null;
  /** 按雷达 ID 列出运行记录（默认最近 50 条，按 startedAt 降序） */
  listByRadarId(radarId: string, limit?: number): RadarRun[];
  /** 更新运行记录（用于状态流转） */
  update(id: string, patch: Partial<RadarRun>): RadarRun | null;
  /** 持久化 */
  save(): void;
  /** 加载 */
  load(): void;
}

// ============================================================
// JsonRadarStore 实现
// ============================================================

/** 持久化文件格式 */
interface RadarStoreFile {
  radars: Radar[];
  version: string;
}

const DEFAULT_RADAR_STORE_PATH = "data/radars.json";
const DEFAULT_RADAR_RUN_STORE_PATH = "data/radar-runs.json";

/**
 * JSON 文件雷达存储实现。
 *
 * 持久化路径：data/radars.json
 * 文件格式：{ "radars": Radar[], "version": "1.0" }
 *
 * 构造时自动调用 load()。
 */
export class JsonRadarStore implements RadarStore {
  private readonly filePath: string;
  private radars: Map<string, Radar> = new Map();

  constructor(options: { file_path?: string } = {}) {
    const filePath = options.file_path ?? DEFAULT_RADAR_STORE_PATH;
    this.filePath = path.resolve(process.cwd(), filePath);
    this.load();
  }

  create(input: RadarCreateInput): Radar {
    // 幂等：如果传入 id 已存在，直接返回已有记录
    if (input.id) {
      const existing = this.radars.get(input.id);
      if (existing) {
        return existing;
      }
    }

    // 用工厂函数生成完整对象
    const radar = createDefaultRadar(input.name, input.kind, input.spec, {
      isBuiltin: input.isBuiltin,
      ownerId: input.ownerId,
      providerRouting: input.providerRouting,
    });

    // 覆盖稳定 ID（内置雷达）
    if (input.id) {
      radar.id = input.id;
    }

    // 内置雷达默认激活（createDefaultRadar 返回 draft，内置需 active）
    if (input.isBuiltin) {
      radar.status = "active";
    }

    this.radars.set(radar.id, radar);
    return radar;
  }

  get(id: string): Radar | null {
    return this.radars.get(id) ?? null;
  }

  list(filter?: RadarListFilter): Radar[] {
    let result = Array.from(this.radars.values());

    if (filter) {
      // 默认不含 archived
      if (!filter.includeArchived) {
        result = result.filter((r) => r.status !== "archived");
      }
      if (filter.status !== undefined) {
        result = result.filter((r) => r.status === filter.status);
      }
      if (filter.kind !== undefined) {
        result = result.filter((r) => r.kind === filter.kind);
      }
      if (filter.isBuiltin !== undefined) {
        result = result.filter((r) => r.isBuiltin === filter.isBuiltin);
      }
      if (filter.ownerId !== undefined) {
        result = result.filter((r) => r.ownerId === filter.ownerId);
      }
    } else {
      // 无 filter 时默认也不含 archived
      result = result.filter((r) => r.status !== "archived");
    }

    return result;
  }

  update(id: string, patch: RadarUpdateInput): Radar | null {
    const radar = this.radars.get(id);
    if (!radar) {
      return null;
    }

    const updated: Radar = {
      ...radar,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.spec !== undefined ? { spec: patch.spec } : {}),
      ...(patch.privacy !== undefined ? { privacy: patch.privacy } : {}),
      ...(patch.providerRouting !== undefined ? { providerRouting: patch.providerRouting } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      // currentRunId 使用 in 检查 key 是否存在，传 undefined 表示显式清空
      ...("currentRunId" in patch ? { currentRunId: patch.currentRunId } : {}),
      ...(patch.lastRunStatus !== undefined ? { lastRunStatus: patch.lastRunStatus } : {}),
      ...(patch.lastRunAt !== undefined ? { lastRunAt: patch.lastRunAt } : {}),
      // V1.5-06：schedule 使用 in 检查 key 是否存在，传 undefined 表示显式清空
      ...("schedule" in patch ? { schedule: patch.schedule } : {}),
      // V1.6-06 watchRules 使用 in 检查 key 是否存在，传 undefined 表示显式清空
      ...("watchRules" in patch ? { watchRules: patch.watchRules } : {}),
      updatedAt: new Date().toISOString(),
    };

    this.radars.set(id, updated);
    return updated;
  }

  archive(id: string): Radar | null {
    const radar = this.radars.get(id);
    if (!radar) {
      return null;
    }

    const now = new Date().toISOString();
    const archived: Radar = {
      ...radar,
      status: "archived",
      deletedAt: now,
      updatedAt: now,
    };

    this.radars.set(id, archived);
    return archived;
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: RadarStoreFile = {
      radars: Array.from(this.radars.values()),
      version: "1.0",
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  load(): void {
    this.radars.clear();
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as RadarStoreFile;
      if (data.radars && Array.isArray(data.radars)) {
        for (const radar of data.radars) {
          // V1.6-02 兼容：旧 cron 格式降级为 HH:MM
          if (radar.schedule && (radar.schedule as { cron?: string }).cron) {
            radar.schedule = normalizeLegacySchedule(
              radar.schedule as unknown as { cron: string; timezone: string; enabled: boolean },
            );
          }
          this.radars.set(radar.id, radar);
        }
      }
    } catch {
      // 文件损坏时从空开始
      this.radars.clear();
    }
  }
}

/**
 * V1.6-02 内部：旧 cron schedule 降级为 HH:MM schedule。
 *
 * 解析 cron "m h * * *" → time "HH:MM"，frequency 默认 daily。
 * 复杂 cron（含步进/范围/列表）降级为 "08:00" daily，保留 enabled。
 */
function normalizeLegacySchedule(legacy: {
  cron: string;
  timezone: string;
  enabled: boolean;
}): RadarSchedule {
  const parts = legacy.cron.trim().split(/\s+/);
  // 仅处理简单 "m h * * *" 格式，复杂 cron 兜底为 08:00
  const isSimple = parts.length === 5
    && /^\d+$/.test(parts[0])
    && /^\d+$/.test(parts[1])
    && parts[2] === "*"
    && parts[3] === "*"
    && parts[4] === "*";
  const minute = isSimple ? parts[0] : "0";
  const hour = isSimple ? parts[1] : "8";
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  return {
    time,
    frequency: "daily",
    timezone: legacy.timezone,
    enabled: legacy.enabled,
  };
}

// ============================================================
// JsonRadarRunStore 实现
// ============================================================

/** 持久化文件格式 */
interface RadarRunStoreFile {
  runs: RadarRun[];
  version: string;
}

/**
 * JSON 文件雷达运行记录存储实现。
 *
 * 持久化路径：data/radar-runs.json
 * 文件格式：{ "runs": RadarRun[], "version": "1.0" }
 *
 * 构造时自动调用 load()。
 */
export class JsonRadarRunStore implements RadarRunStore {
  private readonly filePath: string;
  private runs: Map<string, RadarRun> = new Map();

  constructor(options: { file_path?: string } = {}) {
    const filePath = options.file_path ?? DEFAULT_RADAR_RUN_STORE_PATH;
    this.filePath = path.resolve(process.cwd(), filePath);
    this.load();
  }

  create(input: RadarRunCreateInput): RadarRun {
    const now = new Date().toISOString();
    const run: RadarRun = {
      id: generateRunId(),
      radarId: input.radarId,
      status: "running",
      mode: input.mode,
      triggeredBy: input.triggeredBy,
      startedAt: now,
      finishedAt: null,
      totalRaw: 0,
      totalScored: 0,
      opportunityKeys: [],
      ...(input.query !== undefined ? { query: input.query } : {}),
    };

    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): RadarRun | null {
    return this.runs.get(id) ?? null;
  }

  listByRadarId(radarId: string, limit: number = 50): RadarRun[] {
    const result = Array.from(this.runs.values())
      .filter((r) => r.radarId === radarId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return result.slice(0, limit);
  }

  update(id: string, patch: Partial<RadarRun>): RadarRun | null {
    const run = this.runs.get(id);
    if (!run) {
      return null;
    }

    const updated: RadarRun = { ...run, ...patch };
    this.runs.set(id, updated);
    return updated;
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: RadarRunStoreFile = {
      runs: Array.from(this.runs.values()),
      version: "1.0",
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  load(): void {
    this.runs.clear();
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as RadarRunStoreFile;
      if (data.runs && Array.isArray(data.runs)) {
        for (const run of data.runs) {
          this.runs.set(run.id, run);
        }
      }
    } catch {
      this.runs.clear();
    }
  }
}
