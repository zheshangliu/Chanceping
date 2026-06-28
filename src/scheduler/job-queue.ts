/**
 * 任务队列（JobQueue）- once 去重 + JSON 持久化
 *
 * 来源：Task 028 第 5.4 节。
 *
 * 职责：
 *   - 记录任务执行历史（JobRecord）
 *   - once 去重：同一 schedule_id 的 once 任务只执行一次
 *   - JSON 持久化：data/scheduler.json
 *   - 历史查询：按 schedule_id / status / 时间范围查询
 *   - 自动清理：保留最近 1000 条记录
 */

import fs from "fs";
import path from "path";
import type { JobRecord } from "./types";

export class JobQueue {
  private readonly records: JobRecord[] = [];
  private readonly dataPath: string;

  constructor(dataPath?: string) {
    this.dataPath = dataPath ?? path.resolve(process.cwd(), "data", "scheduler.json");
    this.load();
  }

  /** 添加执行记录 */
  add(record: JobRecord): void {
    this.records.push(record);
    this.persist();
  }

  /** 获取最近 N 条记录（倒序，最新在前） */
  getRecent(limit: number = 100): JobRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /** 按 schedule_id 查询记录 */
  getByScheduleId(scheduleId: string): JobRecord[] {
    return this.records.filter((r) => r.schedule_id === scheduleId);
  }

  /** 按状态查询记录 */
  getByStatus(status: JobRecord["status"]): JobRecord[] {
    return this.records.filter((r) => r.status === status);
  }

  /** 获取全部记录数 */
  count(): number {
    return this.records.length;
  }

  /** once 去重：检查 schedule_id 是否已成功执行过 */
  hasExecuted(scheduleId: string): boolean {
    return this.records.some(
      (r) => r.schedule_id === scheduleId && r.status === "completed",
    );
  }

  /** 自动清理：保留最近 N 条 */
  cleanup(maxRecords: number = 1000): number {
    if (this.records.length > maxRecords) {
      const removed = this.records.length - maxRecords;
      this.records.splice(0, removed);
      this.persist();
      return removed;
    }
    return 0;
  }

  /** 清空所有记录（测试用） */
  clear(): void {
    this.records.length = 0;
    this.persist();
  }

  /** 从磁盘加载 */
  private load(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, "utf-8");
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.records.push(...parsed);
        }
      }
    } catch (err) {
      console.warn(`[JobQueue] 加载失败: ${err}`);
    }
  }

  /** 持久化到磁盘 */
  private persist(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(this.records, null, 2), "utf-8");
    } catch (err) {
      console.warn(`[JobQueue] 持久化失败: ${err}`);
    }
  }
}
