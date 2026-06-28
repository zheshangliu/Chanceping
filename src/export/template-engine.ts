/**
 * 报告模板引擎（Markdown → HTML）
 *
 * 来源：Task 031 第 5.1 节。
 *
 * 设计要点：
 *   - 纯 JS 实现 Markdown → HTML 转换（不引入 marked 等依赖）
 *   - 支持标题（#/##/###）、列表（-）、链接、表格、代码块、粗体/斜体
 *   - 自包含 CSS（暗色主题 + 打印友好）
 *   - 品牌头部 + 页脚
 */

import { BRAND } from "../brand/constants";

/** 模板选项 */
export interface TemplateOptions {
  /** 标题 */
  title?: string;
  /** 副标题 */
  subtitle?: string;
  /** 是否暗色主题（默认 true） */
  darkMode?: boolean;
  /** 是否打印友好 */
  printFriendly?: boolean;
}

/**
 * 将 Markdown 转换为自包含 HTML（含内联 CSS）。
 *
 * @param markdown Markdown 文本
 * @param options 模板选项
 * @returns 自包含 HTML 文档
 */
export function markdownToHtml(markdown: string, options?: TemplateOptions): string {
  const title = options?.title ?? `${BRAND.product_name} 雷达报告`;
  const subtitle = options?.subtitle ?? "";
  const darkMode = options?.darkMode ?? true;
  const printFriendly = options?.printFriendly ?? false;

  const body = parseMarkdown(markdown);
  const css = getReportCss(darkMode);
  const printCss = printFriendly ? getPrintCss() : "";

  const header = buildHeader(title, subtitle);
  const footer = buildFooter();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${css}
${printCss}
</style>
</head>
<body>
${header}
<main class="report-content">
${body}
</main>
${footer}
</body>
</html>`;
}

/**
 * 获取报告 CSS 样式（暗色主题 + 打印友好）。
 *
 * @param darkMode 是否暗色主题
 * @returns CSS 文本
 */
export function getReportCss(darkMode?: boolean): string {
  const dark = darkMode ?? true;
  if (dark) {
    return `:root {
  --bg: #1a1a1a;
  --fg: #e6e6e6;
  --accent: #4a9eff;
  --border: #333;
  --code-bg: #2d2d2d;
  --table-stripe: #222;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.7;
}
.report-header {
  border-bottom: 2px solid var(--accent);
  padding-bottom: 16px;
  margin-bottom: 24px;
}
.report-header h1 {
  color: var(--accent);
  margin: 0 0 8px 0;
  font-size: 24px;
}
.report-header .subtitle {
  color: var(--fg);
  opacity: 0.8;
  font-size: 14px;
}
.report-content h1 { color: var(--accent); font-size: 22px; margin-top: 24px; }
.report-content h2 { color: var(--accent); font-size: 18px; margin-top: 20px; }
.report-content h3 { color: var(--fg); font-size: 16px; margin-top: 16px; }
.report-content p { margin: 8px 0; }
.report-content ul { padding-left: 24px; }
.report-content li { margin: 4px 0; }
.report-content a { color: var(--accent); text-decoration: none; }
.report-content a:hover { text-decoration: underline; }
.report-content code {
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 13px;
}
.report-content pre {
  background: var(--code-bg);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}
.report-content pre code {
  background: transparent;
  padding: 0;
}
.report-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}
.report-content th, .report-content td {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}
.report-content th {
  background: var(--table-stripe);
  color: var(--accent);
}
.report-content tr:nth-child(even) {
  background: var(--table-stripe);
}
.report-content hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}
.report-footer {
  border-top: 1px solid var(--border);
  margin-top: 32px;
  padding-top: 16px;
  text-align: center;
  color: var(--fg);
  opacity: 0.6;
  font-size: 12px;
}
strong { color: var(--accent); font-weight: 600; }
em { font-style: italic; }`;
  }
  // 浅色主题
  return `:root {
  --bg: #ffffff;
  --fg: #333;
  --accent: #0066cc;
  --border: #ddd;
  --code-bg: #f5f5f5;
  --table-stripe: #f9f9f9;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.7;
}
.report-header {
  border-bottom: 2px solid var(--accent);
  padding-bottom: 16px;
  margin-bottom: 24px;
}
.report-header h1 { color: var(--accent); margin: 0 0 8px 0; font-size: 24px; }
.report-header .subtitle { color: var(--fg); opacity: 0.8; font-size: 14px; }
.report-content h1 { color: var(--accent); font-size: 22px; margin-top: 24px; }
.report-content h2 { color: var(--accent); font-size: 18px; margin-top: 20px; }
.report-content h3 { color: var(--fg); font-size: 16px; margin-top: 16px; }
.report-content p { margin: 8px 0; }
.report-content ul { padding-left: 24px; }
.report-content li { margin: 4px 0; }
.report-content a { color: var(--accent); text-decoration: none; }
.report-content a:hover { text-decoration: underline; }
.report-content code {
  background: var(--code-bg); padding: 2px 6px; border-radius: 3px;
  font-family: "Consolas", "Monaco", monospace; font-size: 13px;
}
.report-content pre { background: var(--code-bg); padding: 12px; border-radius: 6px; overflow-x: auto; }
.report-content pre code { background: transparent; padding: 0; }
.report-content table { border-collapse: collapse; width: 100%; margin: 12px 0; }
.report-content th, .report-content td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
.report-content th { background: var(--table-stripe); color: var(--accent); }
.report-content tr:nth-child(even) { background: var(--table-stripe); }
.report-content hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.report-footer {
  border-top: 1px solid var(--border); margin-top: 32px; padding-top: 16px;
  text-align: center; color: var(--fg); opacity: 0.6; font-size: 12px;
}
strong { color: var(--accent); font-weight: 600; }
em { font-style: italic; }`;
}

/** 获取打印友好 CSS */
function getPrintCss(): string {
  return `@media print {
  body { padding: 0; }
  .report-content { page-break-inside: avoid; }
  h1, h2, h3 { page-break-after: avoid; }
  a { color: inherit; text-decoration: none; }
}`;
}

/** 构建品牌头部 */
function buildHeader(title: string, subtitle: string): string {
  const subtitleHtml = subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : "";
  return `<header class="report-header">
<h1>${escapeHtml(title)}</h1>
${subtitleHtml}
</header>`;
}

/** 构建品牌页脚 */
function buildFooter(): string {
  const year = new Date().getFullYear();
  return `<footer class="report-footer">
<div>${escapeHtml(BRAND.product_name)} | ${escapeHtml(BRAND.chinese_slogan)}</div>
<div>Generated at ${new Date().toISOString()} | © ${year}</div>
</footer>`;
}

// ============================================================
// Markdown 解析（简化版，覆盖报告用到的语法）
// ============================================================

/**
 * 将 Markdown 文本转换为 HTML 片段（不含外层文档结构）。
 *
 * 支持语法：
 *   - 标题 # / ## / ###
 *   - 列表 - / *
 *   - 表格（| 列1 | 列2 | + 分隔行 |---|---|）
 *   - 代码块 ```
 *   - 分隔线 ---
 *   - 粗体 **text**
 *   - 斜体 *text*
 *   - 链接 [text](url)
 *   - 行内代码 `text`
 */
export function parseMarkdown(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];

  let inCodeBlock = false;
  let inList = false;
  let inTable = false;
  let tableHeader: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        html.push("</code></pre>");
        inCodeBlock = false;
      } else {
        // 关闭未结束的列表/表格
        if (inList) { html.push("</ul>"); inList = false; }
        if (inTable) { html.push("</tbody></table>"); inTable = false; }
        html.push("<pre><code>");
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      html.push(escapeHtml(line));
      continue;
    }

    // 表格检测：当前行以 | 开头且下一行是分隔行 |---|
    if (line.trim().startsWith("|") && !inTable && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? "";
      if (/^\s*\|[\s:|-]+\|\s*$/.test(nextLine) && nextLine.includes("-")) {
        // 关闭未结束的列表
        if (inList) { html.push("</ul>"); inList = false; }
        inTable = true;
        tableHeader = parseTableRow(line);
        html.push("<table>");
        html.push("<thead><tr>");
        for (const h of tableHeader) {
          html.push(`<th>${inline(h)}</th>`);
        }
        html.push("</tr></thead>");
        html.push("<tbody>");
        i++; // 跳过分隔行
        continue;
      }
    }

    // 表格行
    if (inTable) {
      if (line.trim().startsWith("|")) {
        const cells = parseTableRow(line);
        html.push("<tr>");
        for (const cell of cells) {
          html.push(`<td>${inline(cell)}</td>`);
        }
        html.push("</tr>");
        continue;
      } else {
        // 表格结束
        html.push("</tbody></table>");
        inTable = false;
      }
    }

    // 标题
    if (line.startsWith("### ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h3>${inline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h2>${inline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h1>${inline(line.slice(2))}</h1>`);
      continue;
    }

    // 列表（- 或 *）
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    } else if (inList) {
      html.push("</ul>");
      inList = false;
    }

    // 分隔线（至少 3 个 -）
    if (/^---+\s*$/.test(line)) {
      html.push("<hr>");
      continue;
    }

    // 空行
    if (line.trim() === "") {
      html.push("");
      continue;
    }

    // 普通段落
    html.push(`<p>${inline(line)}</p>`);
  }

  // 收尾
  if (inList) html.push("</ul>");
  if (inCodeBlock) html.push("</code></pre>");
  if (inTable) html.push("</tbody></table>");

  return html.join("\n");
}

/** 解析表格行（返回单元格数组） */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  // 去掉首尾的 |
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/** 行内格式化（粗体/斜体/链接/代码） */
function inline(text: string): string {
  // 转义 HTML 实体（避免 XSS，但保留后续替换的占位符）
  let result = escapeHtml(text);
  // 粗体 **text**
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // 斜体 *text*
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // 链接 [text](url)
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  // 行内代码 `text`
  result = result.replace(/`(.+?)`/g, "<code>$1</code>");
  return result;
}

/** HTML 转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
