/**
 * pdf-parse 类型声明
 * pdf-parse 没有自带 TypeScript 类型声明，这里提供最小化声明。
 */

declare module "pdf-parse" {
  interface PdfData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    text: string;
    version: string;
  }

  function pdfParse(data: Buffer): Promise<PdfData>;
  export default pdfParse;
}
