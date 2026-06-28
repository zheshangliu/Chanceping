/**
 * 报告导出器（Markdown / HTML / PDF）
 *
 * 来源：Task 031 第 5.2 节。
 *
 * 设计要点：
 *   - 3 格式分发：markdown（直接返回）/ html（模板引擎）/ pdf（Puppeteer）
 *   - PDF 导出可选（无 Puppeteer 时降级为 HTML + 提示）
 *   - 返回 Buffer + Content-Type + filename
 *   - 文件名规范：chanceping-{type}-{timestamp}.{ext}
 */

import { markdownToHtml } from "./template-engine";
import { renderPdf } from "./pdf-renderer";
import { BRAND } from "../brand/constants";

/** 导出格式 */
export type ExportFormat = "markdown" | "html" | "pdf";

/** 导出结果 */
export interface ExportResult {
  /** 文件名 */
  filename: string;
  /** MIME 类型 */
  contentType: string;
  /** 文件内容 */
  content: Buffer;
  /** 实际导出格式（pdf 降级时可能为 html） */
  actualFormat: ExportFormat;
}

/** 生成时间戳（用于文件名） */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * 导出雷达报告。
 *
 * @param markdown 报告 Markdown
 * @param format 导出格式
 * @param title 报告标题
 * @returns 导出结果
 */
export async function exportReport(
  markdown: string,
  format: ExportFormat,
  title?: string,
): Promise<ExportResult> {
  const ts = timestamp();
  const baseTitle = title ?? `${BRAND.product_name} 雷达报告`;

  switch (format) {
    case "markdown":
      return {
        filename: `chanceping-report-${ts}.md`,
        contentType: "text/markdown; charset=utf-8",
        content: Buffer.from(markdown, "utf-8"),
        actualFormat: "markdown",
      };

    case "html": {
      const html = markdownToHtml(markdown, { title: baseTitle, darkMode: true });
      return {
        filename: `chanceping-report-${ts}.html`,
        contentType: "text/html; charset=utf-8",
        content: Buffer.from(html, "utf-8"),
        actualFormat: "html",
      };
    }

    case "pdf": {
      const html = markdownToHtml(markdown, {
        title: baseTitle,
        darkMode: true,
        printFriendly: true,
      });
      try {
        const pdfBuffer = await renderPdf(html);
        return {
          filename: `chanceping-report-${ts}.pdf`,
          contentType: "application/pdf",
          content: pdfBuffer,
          actualFormat: "pdf",
        };
      } catch (err) {
        // Puppeteer 不可用时降级为 HTML
        // eslint-disable-next-line no-console
        console.warn(`[ReportExporter] PDF 渲染失败，降级为 HTML: ${err instanceof Error ? err.message : err}`);
        return {
          filename: `chanceping-report-${ts}.html`,
          contentType: "text/html; charset=utf-8",
          content: Buffer.from(html, "utf-8"),
          actualFormat: "html",
        };
      }
    }

    default:
      throw new Error(`未知导出格式: ${format}`);
  }
}
