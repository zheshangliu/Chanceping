/**
 * Watch Rules 存储层
 *
 * 来源：Task 021 第 4.4 节。
 *
 * 提供：
 *   - WatchStore 接口：可插拔存储接口
 *   - LocalWatchStore：本地 JSON 文件实现
 *   - createDefaultWatchStore：便捷工厂函数
 *
 * 纯函数 + Node.js fs，不接 LLM，不编造信息。
 */

import fs from "fs";
import path from "path";
import type { WatchRuleSet } from "./types";
import { parseWatchRules } from "./dsl-parser";

// ============================================================
// 类型定义
// ============================================================

/** Watch 规则存储接口 */
export interface WatchStore {
  /** 加载规则文本 */
  loadRaw(): string;
  /** 保存规则文本 */
  saveRaw(text: string): void;
  /** 加载并解析为 WatchRuleSet */
  loadRules(): WatchRuleSet;
  /** 追加一行规则 */
  appendLine(line: string): void;
  /** 清空所有规则 */
  clear(): void;
  /** 获取存储文件路径 */
  getFilePath(): string;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_STORE_PATH = "data/watch-rules.txt";

// ============================================================
// LocalWatchStore 实现
// ============================================================

/**
 * 本地文本文件存储实现。
 *
 * 规则以纯文本形式存储（每行一条），便于用户直接编辑。
 */
export class LocalWatchStore implements WatchStore {
  private readonly filePath: string;

  constructor(options: { file_path?: string } = {}) {
    const filePath = options.file_path ?? DEFAULT_STORE_PATH;
    this.filePath = path.resolve(process.cwd(), filePath);
  }

  getFilePath(): string {
    return this.filePath;
  }

  loadRaw(): string {
    if (!fs.existsSync(this.filePath)) {
      return "";
    }
    return fs.readFileSync(this.filePath, "utf-8");
  }

  saveRaw(text: string): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, text, "utf-8");
  }

  loadRules(): WatchRuleSet {
    const raw = this.loadRaw();
    return parseWatchRules(raw);
  }

  appendLine(line: string): void {
    const current = this.loadRaw();
    const newContent = current
      ? current.endsWith("\n")
        ? current + line + "\n"
        : current + "\n" + line + "\n"
      : line + "\n";
    this.saveRaw(newContent);
  }

  clear(): void {
    this.saveRaw("");
  }
}

// ============================================================
// 便捷工厂函数
// ============================================================

export function createDefaultWatchStore(): LocalWatchStore {
  return new LocalWatchStore({});
}
