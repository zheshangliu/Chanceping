/**
 * FileParserRouter —— 文件解析路由器
 *
 * V1.3 新增。按 MIME 类型路由到对应的解析适配器。
 *
 * 安全约束：
 *   - 单文件上限 20MB，超限抛 FILE_TOO_LARGE
 *   - 不支持的类型抛 UNSUPPORTED_FILE_TYPE
 *   - 参赛版图片识别仅用 Qwen-VL-Max（合规）
 */

import type { FileParser, FileParseResult } from "../schema/user-input-source";
import { MAX_FILE_SIZE } from "../schema/user-input-source";
import { PdfParseAdapter } from "./pdf-parse-adapter";
import { MammothAdapter } from "./mammoth-adapter";
import { ExceljsAdapter } from "./exceljs-adapter";
import { QwenVlAdapter } from "./qwen-vl-adapter";

export class FileParserRouter implements FileParser {
  private pdfAdapter: PdfParseAdapter;
  private mammothAdapter: MammothAdapter;
  private exceljsAdapter: ExceljsAdapter;
  private qwenVlAdapter: QwenVlAdapter;

  constructor() {
    this.pdfAdapter = new PdfParseAdapter();
    this.mammothAdapter = new MammothAdapter();
    this.exceljsAdapter = new ExceljsAdapter();
    this.qwenVlAdapter = new QwenVlAdapter();
  }

  async parse(file: Buffer, mimeType: string, fileName: string): Promise<FileParseResult> {
    // 大小检查
    if (file.length > MAX_FILE_SIZE) {
      throw new Error("FILE_TOO_LARGE");
    }

    // MIME 路由
    if (mimeType === "application/pdf") {
      return this.pdfAdapter.parse(file, mimeType, fileName);
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return this.mammothAdapter.parse(file, mimeType, fileName);
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      return this.exceljsAdapter.parse(file, mimeType, fileName);
    }
    if (mimeType.startsWith("image/")) {
      return this.qwenVlAdapter.parse(file, mimeType, fileName);
    }

    throw new Error("UNSUPPORTED_FILE_TYPE");
  }
}
