/**
 * PdfParseAdapter —— PDF 文件解析适配器
 *
 * 使用 pdf-parse（纯 npm，基于 pdf.js）解析文字版 PDF。
 * 不能 OCR 扫描件（扫描件走 QwenVlAdapter）。
 */

import type { FileParser, FileParseResult } from "../schema/user-input-source";

export class PdfParseAdapter implements FileParser {
  async parse(file: Buffer, mimeType: string, fileName: string): Promise<FileParseResult> {
    // 动态 import 避免影响不使用文件上传的场景
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(file);
    return {
      text: data.text,
      source: "uploaded_pdf",
      fileName,
      mimeType,
    };
  }
}
