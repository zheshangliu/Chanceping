/**
 * MammothAdapter —— Word(.docx) 文件解析适配器
 *
 * 使用 mammoth（纯 npm）将 .docx 转为纯文本。
 */

import type { FileParser, FileParseResult } from "../schema/user-input-source";

export class MammothAdapter implements FileParser {
  async parse(file: Buffer, mimeType: string, fileName: string): Promise<FileParseResult> {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: file });
    return {
      text: result.value,
      source: "uploaded_docx",
      fileName,
      mimeType,
    };
  }
}
