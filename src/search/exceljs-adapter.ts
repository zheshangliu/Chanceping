/**
 * ExceljsAdapter —— Excel(.xlsx) 文件解析适配器
 *
 * 使用 exceljs（纯 npm）读取 xlsx 单元格内容。
 */

import type { FileParser, FileParseResult } from "../schema/user-input-source";

export class ExceljsAdapter implements FileParser {
  async parse(file: Buffer, mimeType: string, fileName: string): Promise<FileParseResult> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    // exceljs 的 load 方法接受 ArrayBuffer，Node.js Buffer 兼容
    await workbook.xlsx.load(file as unknown as ArrayBuffer);

    const rows: string[] = [];
    const structuredData: Record<string, unknown> = {};

    workbook.eachSheet((worksheet) => {
      const sheetRows: string[][] = [];
      worksheet.eachRow((row) => {
        const cells = (row.values as unknown[]).slice(1).map((v) => String(v ?? ""));
        sheetRows.push(cells);
        rows.push(cells.join("\t"));
      });
      structuredData[worksheet.name] = sheetRows;
    });

    return {
      text: rows.join("\n"),
      structuredData,
      source: "uploaded_xlsx",
      fileName,
      mimeType,
    };
  }
}
