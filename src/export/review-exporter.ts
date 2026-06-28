/**
 * 复盘报告导出器（ReviewSummary → Markdown / HTML / PDF）
 *
 * 来源：Task 031 第 5.4 节。
 *
 * 设计要点：
 *   - 将 ReviewSummary 转换为 Markdown 报告
 *   - 复用 `markdownToHtml` 生成 HTML
 *   - 支持按等级分组表格 + 错过原因分析
 *   - PDF 导出复用 report-exporter 的 renderPdf（含降级策略）
 */

import type { ReviewSummary } from "../agents/opportunity-review";
import { markdownToHtml } from "./template-engine";
import { BRAND } from "../brand/constants";
import type { ExportFormat, ExportResult } from "./report-exporter";

/** 生成时间戳（用于文件名） */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * 将复盘统计转换为 Markdown 报告。
 *
 * @param review 复盘统计
 * @returns Markdown 文本
 */
export function reviewToMarkdown(review: ReviewSummary): string {
  const lines: string[] = [
    `# ${BRAND.product_name} 机会复盘报告`,
    ``,
    `**统计周期**：${review.period_start.slice(0, 10)} 至 ${review.period_end.slice(0, 10)}`,
    `**生成时间**：${new Date().toISOString()}`,
    ``,
    `## 总体统计`,
    ``,
    `- 总机会数：${review.total_opportunities}`,
    `- 已报名数：${review.applied_count}`,
    `- 错过数：${review.missed_count}`,
    `- 命中率：${(review.hit_rate * 100).toFixed(1)}%`,
    `- 错过率：${(review.miss_rate * 100).toFixed(1)}%`,
    ``,
    `## 按等级分组`,
    ``,
    `| 等级 | 总数 | 已报名 | 错过 | 命中率 |`,
    `|---|---|---|---|---|`,
  ];

  for (const [level, stats] of Object.entries(review.by_level)) {
    lines.push(
      `| ${level} | ${stats.total} | ${stats.applied} | ${stats.missed} | ${(stats.hit_rate * 100).toFixed(1)}% |`,
    );
  }

  // 按雷达类型分组（如果有）
  const radarTypes = Object.keys(review.by_radar_type);
  if (radarTypes.length > 0) {
    lines.push(``, `## 按雷达类型分组`, ``);
    lines.push(`| 雷达类型 | 总数 | 已报名 | 错过 | 命中率 |`);
    lines.push(`|---|---|---|---|---|`);
    for (const [rt, stats] of Object.entries(review.by_radar_type)) {
      lines.push(
        `| ${rt} | ${stats.total} | ${stats.applied} | ${stats.missed} | ${(stats.hit_rate * 100).toFixed(1)}% |`,
      );
    }
  }

  // 错过原因分析
  if (review.miss_reasons.length > 0) {
    lines.push(``, `## 错过原因分析`, ``);
    for (const reason of review.miss_reasons) {
      lines.push(
        `- ${reason.reason}：${reason.count} 次（${(reason.percentage * 100).toFixed(1)}%）`,
      );
    }
  }

  // 改进建议
  if (review.suggestions.length > 0) {
    lines.push(``, `## 改进建议`, ``);
    for (const suggestion of review.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines.join("\n");
}

/**
 * 导出复盘报告。
 *
 * @param review 复盘统计
 * @param format 导出格式
 * @returns 导出结果
 */
export async function exportReview(
  review: ReviewSummary,
  format: ExportFormat,
): Promise<ExportResult> {
  const markdown = reviewToMarkdown(review);
  const ts = timestamp();
  const title = `${BRAND.product_name} 机会复盘报告`;

  switch (format) {
    case "markdown":
      return {
        filename: `chanceping-review-${ts}.md`,
        contentType: "text/markdown; charset=utf-8",
        content: Buffer.from(markdown, "utf-8"),
        actualFormat: "markdown",
      };

    case "html": {
      const html = markdownToHtml(markdown, { title, darkMode: true });
      return {
        filename: `chanceping-review-${ts}.html`,
        contentType: "text/html; charset=utf-8",
        content: Buffer.from(html, "utf-8"),
        actualFormat: "html",
      };
    }

    case "pdf": {
      // 复盘 PDF 复用 report-exporter 的 renderPdf（含降级策略）
      const { exportReport } = await import("./report-exporter");
      return exportReport(markdown, "pdf", title);
    }

    default:
      throw new Error(`未知导出格式: ${format}`);
  }
}
