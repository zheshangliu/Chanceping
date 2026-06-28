/**
 * 字节拆分算法（T11）
 *
 * 来源：Task 029 第 5.1 节。
 *
 * 将长文本按字节拆分为多条消息，避免中文截断。
 *
 * 算法：
 *   1. 按行分割（\n）
 *   2. 识别原子块：标题行（## / ### / 【开头）+ 紧跟的首条内容不可分离
 *   3. 逐块累加，当前段 + 下一块超限时结束当前段
 *   4. 每段追加 footer（续接提示，含 {page}/{total} 占位符）
 *   5. 第 2+ 段添加 header（续接标识，含 {page}/{total} 占位符）
 *
 * 字节计算用 Buffer.byteLength(str, "utf-8")，中文 3 字节精确计算。
 */

/** 拆分选项 */
export interface SplitOptions {
  /** 最大字节数（默认 2048） */
  maxBytes?: number;
  /** footer 模板（含 {page}/{total} 占位符） */
  footerTemplate?: string;
  /** header 续接模板（含 {page}/{total} 占位符） */
  headerTemplate?: string;
}

/** 拆分结果 */
export interface SplitResult {
  /** 拆分后的消息数组 */
  messages: string[];
  /** 总段数 */
  totalParts: number;
  /** 原始字节数 */
  originalBytes: number;
}

/** 默认最大字节数（与 WECHAT_MAX_LENGTH 一致） */
const DEFAULT_MAX_BYTES = 2048;

/** 默认 footer 模板 */
const DEFAULT_FOOTER_TEMPLATE = "（{page}/{total}）";

/** 默认 header 模板 */
const DEFAULT_HEADER_TEMPLATE = "【续接 {page}/{total}】\n";

/**
 * 判断是否为标题行（## / ### / 【开头）。
 */
function isTitleLine(line: string): boolean {
  return (
    line.startsWith("##") ||
    line.startsWith("###") ||
    line.startsWith("【")
  );
}

/**
 * 将文本按原子块分割。
 *
 * 原子块规则：
 *   - 标题行 + 紧跟的首条内容行不可分离（至少含标题 + 1 行内容）
 *   - 非标题行独立成块
 */
function splitIntoBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTitleLine(line)) {
      const block: string[] = [line];
      i++;
      // 紧跟的首条内容（直到下一个标题或已收集 2 行）
      while (i < lines.length && !isTitleLine(lines[i])) {
        block.push(lines[i]);
        i++;
        if (block.length >= 2) break;
      }
      blocks.push(block.join("\n"));
    } else {
      blocks.push(line);
      i++;
    }
  }
  return blocks;
}

/**
 * 将长文本按字节拆分为多条消息。
 *
 * @param text 原始文本
 * @param options 拆分选项
 * @returns 拆分结果
 */
export function splitByBytes(text: string, options?: SplitOptions): SplitResult {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const footerTemplate = options?.footerTemplate ?? DEFAULT_FOOTER_TEMPLATE;
  const headerTemplate = options?.headerTemplate ?? DEFAULT_HEADER_TEMPLATE;

  const originalBytes = Buffer.byteLength(text, "utf-8");

  // 短文本不拆分
  if (originalBytes <= maxBytes) {
    return { messages: [text], totalParts: 1, originalBytes };
  }

  // 1. 按行分割
  const lines = text.split("\n");

  // 2. 识别原子块（标题 + 首条不可分离）
  const blocks = splitIntoBlocks(lines);

  // 3. 逐块累加，超限时结束当前段
  const chunks: string[] = [];
  let currentChunk = "";
  let currentBytes = 0;

  // 预估 footer + header 字节数（用 "1/N" 占位，N 最多 2 位数）
  // 第 2+ 段会有 header，每段都有 footer，所以预留两者之和确保不超限
  const footerPlaceholder = footerTemplate
    .replace("{page}", "1")
    .replace("{total}", "99");
  const headerPlaceholder = headerTemplate
    .replace("{page}", "1")
    .replace("{total}", "99");
  const overheadBytes =
    Buffer.byteLength(footerPlaceholder + "\n", "utf-8") +
    Buffer.byteLength(headerPlaceholder, "utf-8");

  for (const block of blocks) {
    const blockBytes = Buffer.byteLength(block + "\n", "utf-8");

    // 当前段 + 此块 + overhead 超限 → 结束当前段
    if (currentBytes + blockBytes + overheadBytes > maxBytes && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = "";
      currentBytes = 0;
    }

    // 单块本身超限（极端情况）→ 强制按行拆
    if (blockBytes + overheadBytes > maxBytes) {
      const subLines = block.split("\n");
      for (const subLine of subLines) {
        const subBytes = Buffer.byteLength(subLine + "\n", "utf-8");
        if (currentBytes + subBytes + overheadBytes > maxBytes && currentChunk) {
          chunks.push(currentChunk);
          currentChunk = "";
          currentBytes = 0;
        }
        currentChunk += subLine + "\n";
        currentBytes += subBytes;
      }
    } else {
      currentChunk += block + "\n";
      currentBytes += blockBytes;
    }
  }

  // 最后一段
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  // 4. 追加 footer + header
  const totalParts = chunks.length;
  const messages = chunks.map((chunk, idx) => {
    const page = idx + 1;
    const footer = footerTemplate
      .replace("{page}", String(page))
      .replace("{total}", String(totalParts));
    const trimmed = chunk.trimEnd();
    if (page === 1) {
      return trimmed + "\n" + footer;
    } else {
      const header = headerTemplate
        .replace("{page}", String(page))
        .replace("{total}", String(totalParts));
      return header + trimmed + "\n" + footer;
    }
  });

  return { messages, totalParts, originalBytes };
}
