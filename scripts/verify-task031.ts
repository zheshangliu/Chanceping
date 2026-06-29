/**
 * Task 031 验收脚本：报告导出（PDF/Markdown/HTML）
 *
 * 来源：Task 031 第 6 节验收标准。
 *
 * 7 组验证：
 *   1. 文件存在性检查
 *   2. template-engine.ts Markdown 解析（F11/F12/F13/F14）
 *   3. pdf-renderer.ts PDF 渲染器（F15）
 *   4. report-exporter.ts 报告导出器（F1/F2/F3/F5）
 *   5. review-exporter.ts 复盘导出器（F10）
 *   6. API 路由测试（F6/F7/F8/F9）
 *   7. 工程约束（T2 puppeteer 在 optionalDependencies）
 */

import fs from "fs";
import path from "path";
import { markdownToHtml, parseMarkdown, getReportCss } from "../src/export/template-engine";
import { isPdfAvailable, renderPdf } from "../src/export/pdf-renderer";
import { exportReport } from "../src/export/report-exporter";
import { reviewToMarkdown, exportReview } from "../src/export/review-exporter";
import { reportRoutes } from "../src/api/routes/reports";
import { BRAND } from "../src/brand/constants";
import type { ReviewSummary } from "../src/agents/opportunity-review";

// ============================================================
// 测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];
let sectionCount = 1;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passCount++;
  } else {
    console.log(`  FAIL  ${message}`);
    failCount++;
    failures.push(message);
  }
}

function section(title: string): void {
  console.log(`\n[验收 ${sectionCount}] ${title}\n`);
  sectionCount++;
}

// ============================================================
// Mock AppContext（用于 API 测试）
// ============================================================

function createMockCtx(): any {
  return {
    store: {
      list: () => ({ entries: [], total: 0, page: 1, page_size: 10000, total_pages: 0 }),
    },
  };
}

// ============================================================
// 测试用 Markdown（覆盖所有语法）
// ============================================================

const TEST_MARKDOWN = `# 标题1
## 标题2
### 标题3

**粗体** 和 *斜体* 和 \`代码\`

- 列表项 1
- 列表项 2

[链接](https://example.com)

---

| 列1 | 列2 |
|---|---|
| 值1 | 值2 |
| 值3 | 值4 |

\`\`\`
代码块内容
\`\`\`
`;

// ============================================================
// 测试用 ReviewSummary
// ============================================================

const TEST_REVIEW: ReviewSummary = {
  period_start: new Date(Date.now() - 30 * 86400000).toISOString(),
  period_end: new Date().toISOString(),
  total_opportunities: 10,
  applied_count: 3,
  missed_count: 5,
  hit_rate: 0.3,
  miss_rate: 0.5,
  by_level: {
    S: { total: 2, applied: 1, missed: 1, hit_rate: 0.5 },
    A: { total: 3, applied: 1, missed: 2, hit_rate: 0.333 },
    B: { total: 3, applied: 1, missed: 1, hit_rate: 0.333 },
    C: { total: 2, applied: 0, missed: 1, hit_rate: 0 },
  },
  by_radar_type: {
    ai_competition: { total: 5, applied: 2, missed: 3, hit_rate: 0.4 },
  },
  miss_reasons: [
    { reason: "未查看就过期", count: 3, percentage: 0.6 },
    { reason: "查看后未跟踪", count: 2, percentage: 0.4 },
  ],
  suggestions: ["建议增加搜索频率", "建议设置截止提醒"],
};

// ============================================================
// 1. 文件存在性检查
// ============================================================

function checkFileExists(): void {
  section("文件存在性检查");
  const files = [
    "src/export/template-engine.ts",
    "src/export/report-exporter.ts",
    "src/export/pdf-renderer.ts",
    "src/export/review-exporter.ts",
    "scripts/verify-task031.ts",
  ];
  for (const file of files) {
    const fullPath = path.resolve(process.cwd(), file);
    assert(fs.existsSync(fullPath), `文件存在: ${file}`);
  }

  // 检查 reports.ts 含导出端点
  const reportsPath = path.resolve(process.cwd(), "src/api/routes/reports.ts");
  const reportsContent = fs.readFileSync(reportsPath, "utf-8");
  assert(reportsContent.includes('app.post("/export"'), "reports.ts 含 POST /export 端点");
  assert(reportsContent.includes('app.post("/review/export"'), "reports.ts 含 POST /review/export 端点");
  assert(reportsContent.includes('app.get("/export/list"'), "reports.ts 含 GET /export/list 端点");
  assert(reportsContent.includes('app.get("/export/:filename"'), "reports.ts 含 GET /export/:filename 端点");
  assert(reportsContent.includes("import { exportReport }"), "reports.ts 导入 exportReport");
  assert(reportsContent.includes("import { exportReview }"), "reports.ts 导入 exportReview");

  // 检查 package.json 含 verify:export 脚本
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkgContent = fs.readFileSync(pkgPath, "utf-8");
  assert(
    pkgContent.includes('"verify:export": "tsx scripts/verify-task031.ts"'),
    "package.json 含 verify:export 脚本",
  );
}

// ============================================================
// 2. template-engine.ts Markdown 解析（F11/F12/F13/F14）
// ============================================================

function checkTemplateEngine(): void {
  section("template-engine.ts Markdown 解析（F11/F12/F13/F14）");

  // F11: Markdown 解析 - 标题/列表/粗体/链接正确转换为 HTML
  const html = markdownToHtml(TEST_MARKDOWN, { title: "测试报告" });

  assert(html.includes("<h1>标题1</h1>"), "F11: H1 标题转换");
  assert(html.includes("<h2>标题2</h2>"), "F11: H2 标题转换");
  assert(html.includes("<h3>标题3</h3>"), "F11: H3 标题转换");
  assert(html.includes("<strong>粗体</strong>"), "F11: 粗体转换");
  assert(html.includes("<em>斜体</em>"), "F11: 斜体转换");
  assert(html.includes("<code>代码</code>"), "F11: 行内代码转换");
  assert(html.includes("<li>列表项 1</li>"), "F11: 列表项 1");
  assert(html.includes("<li>列表项 2</li>"), "F11: 列表项 2");
  assert(html.includes('<a href="https://example.com">链接</a>'), "F11: 链接转换");
  assert(html.includes("<hr>"), "F11: 分隔线转换");

  // F12: 模板 CSS - HTML 含暗色主题 CSS
  assert(html.includes("<style>"), "F12: HTML 含 <style> 标签");
  assert(html.includes("--bg:") || html.includes("background:"), "F12: CSS 含背景色");
  const darkCss = getReportCss(true);
  assert(darkCss.includes("#1a1a1a") || darkCss.includes("var(--bg)"), "F12: 暗色主题 CSS 含深色背景");

  // F13: 表格支持 - Markdown 表格转换为 HTML 表格
  assert(html.includes("<table>"), "F13: HTML 含 <table>");
  assert(html.includes("<thead>"), "F13: HTML 含 <thead>");
  assert(html.includes("<th>列1</th>"), "F13: 表头列1");
  assert(html.includes("<th>列2</th>"), "F13: 表头列2");
  assert(html.includes("<td>值1</td>"), "F13: 单元格值1");
  assert(html.includes("<td>值4</td>"), "F13: 单元格值4");
  assert(html.includes("<tbody>"), "F13: HTML 含 <tbody>");

  // F14: 品牌头部 - HTML 含 ChancePing 品牌名
  assert(html.includes(BRAND.product_name), "F14: HTML 含品牌名");
  assert(html.includes("report-header"), "F14: HTML 含 report-header 类");
  assert(html.includes("report-footer"), "F14: HTML 含 report-footer 类");

  // 代码块支持
  assert(html.includes("<pre><code>"), "代码块开始标签");
  assert(html.includes("</code></pre>"), "代码块结束标签");

  // 自包含 HTML
  assert(html.startsWith("<!DOCTYPE html>"), "HTML 以 <!DOCTYPE html> 开头");
  assert(html.includes("</html>"), "HTML 含 </html> 结束标签");

  // parseMarkdown 单独测试
  const fragment = parseMarkdown("# 测试\n- 项1");
  assert(fragment.includes("<h1>测试</h1>"), "parseMarkdown: H1 转换");
  assert(fragment.includes("<li>项1</li>"), "parseMarkdown: 列表转换");
}

// ============================================================
// 3. pdf-renderer.ts PDF 渲染器（F15）
// ============================================================

async function checkPdfRenderer(): Promise<void> {
  section("pdf-renderer.ts PDF 渲染器（F15）");

  // F15: isPdfAvailable - 无 puppeteer 时返回 false
  // 测试环境通常未安装 puppeteer 或 PDF_EXPORT_ENABLED 未设置
  const originalPdfEnabled = process.env.PDF_EXPORT_ENABLED;
  // 临时禁用 PDF
  process.env.PDF_EXPORT_ENABLED = "false";
  assert(isPdfAvailable() === false, "F15: PDF_EXPORT_ENABLED=false 时 isPdfAvailable 返回 false");

  // renderPdf 在 PDF 关闭时应抛错
  try {
    await renderPdf("<html></html>");
    assert(false, "F15: PDF 关闭时 renderPdf 应抛错");
  } catch (err) {
    assert(
      err instanceof Error && err.message.includes("PDF 导出未启用"),
      "F15: renderPdf 抛出 PDF 未启用错误",
    );
  }

  // 恢复环境变量
  if (originalPdfEnabled !== undefined) {
    process.env.PDF_EXPORT_ENABLED = originalPdfEnabled;
  } else {
    delete process.env.PDF_EXPORT_ENABLED;
  }
}

// ============================================================
// 4. report-exporter.ts 报告导出器（F1/F2/F3/F5）
// ============================================================

async function checkReportExporter(): Promise<void> {
  section("report-exporter.ts 报告导出器（F1/F2/F3/F5）");

  // 确保_pdf 关闭（测试环境默认关闭）
  const originalPdfEnabled = process.env.PDF_EXPORT_ENABLED;
  process.env.PDF_EXPORT_ENABLED = "false";

  // F1: Markdown 导出 - format=markdown 返回 text/markdown + 文件内容
  const mdResult = await exportReport(TEST_MARKDOWN, "markdown");
  assert(mdResult.contentType.includes("text/markdown"), "F1: Markdown 导出 contentType 为 text/markdown");
  assert(mdResult.actualFormat === "markdown", "F1: actualFormat 为 markdown");
  assert(mdResult.content.length > 0, "F1: Markdown 内容非空");
  assert(mdResult.content.toString("utf-8") === TEST_MARKDOWN, "F1: Markdown 内容与输入一致");

  // F2: HTML 导出 - format=html 返回 text/html + 含 CSS
  const htmlResult = await exportReport(TEST_MARKDOWN, "html");
  assert(htmlResult.contentType.includes("text/html"), "F2: HTML 导出 contentType 为 text/html");
  assert(htmlResult.actualFormat === "html", "F2: actualFormat 为 html");
  const htmlContent = htmlResult.content.toString("utf-8");
  assert(htmlContent.includes("<style>"), "F2: HTML 含 <style> 标签");
  assert(htmlContent.includes("<table>"), "F2: HTML 含表格");

  // F3: PDF 降级 - format=pdf + 无 puppeteer → 降级为 HTML
  const pdfResult = await exportReport(TEST_MARKDOWN, "pdf");
  assert(pdfResult.actualFormat === "html", "F3: PDF 降级后 actualFormat 为 html");
  assert(pdfResult.contentType.includes("text/html"), "F3: 降级后 contentType 为 text/html");
  assert(pdfResult.filename.endsWith(".html"), "F3: 降级后文件名以 .html 结尾");

  // F5: 文件名 - 文件名含 chanceping-report + 时间戳
  assert(mdResult.filename.startsWith("chanceping-report-"), "F5: Markdown 文件名以 chanceping-report- 开头");
  assert(mdResult.filename.endsWith(".md"), "F5: Markdown 文件名以 .md 结尾");
  assert(htmlResult.filename.startsWith("chanceping-report-"), "F5: HTML 文件名以 chanceping-report- 开头");
  assert(htmlResult.filename.endsWith(".html"), "F5: HTML 文件名以 .html 结尾");
  // 文件名中应包含时间戳（YYYY-MM-DDTHH-MM-SS 格式）
  const timestampMatch = mdResult.filename.match(/chanceping-report-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  assert(timestampMatch !== null, "F5: 文件名含时间戳");

  // 恢复环境变量
  if (originalPdfEnabled !== undefined) {
    process.env.PDF_EXPORT_ENABLED = originalPdfEnabled;
  } else {
    delete process.env.PDF_EXPORT_ENABLED;
  }
}

// ============================================================
// 5. review-exporter.ts 复盘导出器（F10）
// ============================================================

async function checkReviewExporter(): Promise<void> {
  section("review-exporter.ts 复盘导出器（F10）");

  // reviewToMarkdown 测试
  const reviewMd = reviewToMarkdown(TEST_REVIEW);
  assert(reviewMd.includes(BRAND.product_name), "F10: 复盘 Markdown 含品牌名");
  assert(reviewMd.includes("## 总体统计"), "F10: 含总体统计章节");
  assert(reviewMd.includes("## 按等级分组"), "F10: 含按等级分组章节");
  assert(reviewMd.includes("| 等级 |"), "F10: 含等级表格头");
  assert(reviewMd.includes("| S |"), "F10: 含 S 级行");
  assert(reviewMd.includes("## 错过原因分析"), "F10: 含错过原因分析章节");
  assert(reviewMd.includes("## 改进建议"), "F10: 含改进建议章节");
  assert(reviewMd.includes("命中率：30.0%"), "F10: 含命中率");

  // F10: 复盘导出 - markdown 格式
  const reviewMdResult = await exportReview(TEST_REVIEW, "markdown");
  assert(reviewMdResult.contentType.includes("text/markdown"), "F10: 复盘 Markdown contentType");
  assert(reviewMdResult.filename.startsWith("chanceping-review-"), "F10: 复盘文件名以 chanceping-review- 开头");
  assert(reviewMdResult.filename.endsWith(".md"), "F10: 复盘 Markdown 文件名以 .md 结尾");
  assert(reviewMdResult.content.length > 0, "F10: 复盘 Markdown 内容非空");

  // F10: 复盘导出 - html 格式
  const reviewHtmlResult = await exportReview(TEST_REVIEW, "html");
  assert(reviewHtmlResult.contentType.includes("text/html"), "F10: 复盘 HTML contentType");
  assert(reviewHtmlResult.filename.endsWith(".html"), "F10: 复盘 HTML 文件名以 .html 结尾");
  const reviewHtml = reviewHtmlResult.content.toString("utf-8");
  assert(reviewHtml.includes("<table>"), "F10: 复盘 HTML 含表格");
  assert(reviewHtml.includes(BRAND.product_name), "F10: 复盘 HTML 含品牌名");

  // F10: 复盘导出 - pdf 格式（降级为 HTML）
  const reviewPdfResult = await exportReview(TEST_REVIEW, "pdf");
  assert(reviewPdfResult.actualFormat === "html", "F10: 复盘 PDF 降级为 HTML");
}

// ============================================================
// 6. API 路由测试（F6/F7/F8/F9）
// ============================================================

async function checkApiRoutes(): Promise<void> {
  section("API 路由测试（F6/F7/F8/F9）");

  // 清理测试目录
  const exportDir = path.resolve(process.cwd(), "reports", "export");
  if (fs.existsSync(exportDir)) {
    const files = fs.readdirSync(exportDir);
    for (const f of files) {
      fs.unlinkSync(path.join(exportDir, f));
    }
  }

  const ctx = createMockCtx();
  const app = reportRoutes(ctx);

  // F1/F6/F7: POST /export?format=markdown - 导出并保存
  const exportRes = await app.request("/export?format=markdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      radar_type: "ai_competition",
      opportunities: [],
    }),
  });
  assert(exportRes.status === 200, "F1: POST /export 返回 200");
  const contentDisposition = exportRes.headers.get("Content-Disposition") ?? "";
  // F6: Content-Disposition - 响应头含 attachment; filename
  assert(contentDisposition.includes("attachment;"), "F6: 响应头含 attachment");
  assert(contentDisposition.includes("filename="), "F6: 响应头含 filename");

  const contentType = exportRes.headers.get("Content-Type") ?? "";
  assert(contentType.includes("text/markdown"), "F1: 响应 Content-Type 为 text/markdown");

  const exportBody = await exportRes.text();
  assert(exportBody.length > 0, "F1: 响应体非空");

  // F7: 报告保存 - 导出后保存到 reports/export/ 目录
  assert(fs.existsSync(exportDir), "F7: reports/export 目录存在");
  const savedFiles = fs.readdirSync(exportDir);
  assert(savedFiles.length > 0, "F7: reports/export 目录有文件");
  const savedMdFile = savedFiles.find((f) => f.endsWith(".md"));
  assert(savedMdFile !== undefined, "F7: 保存了 .md 文件");

  // F2/F6: POST /export?format=html
  const htmlRes = await app.request("/export?format=html", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      radar_type: "ai_competition",
      opportunities: [],
    }),
  });
  assert(htmlRes.status === 200, "F2: POST /export?format=html 返回 200");
  const htmlContentType = htmlRes.headers.get("Content-Type") ?? "";
  assert(htmlContentType.includes("text/html"), "F2: HTML Content-Type 为 text/html");

  // F8: 报告列表 - GET /export/list 返回已导出文件列表
  const listRes = await app.request("/export/list", { method: "GET" });
  assert(listRes.status === 200, "F8: GET /export/list 返回 200");
  const listBody = await listRes.json() as any;
  assert(listBody.success === true, "F8: 列表返回 success=true");
  assert(listBody.data.files.length >= 2, "F8: 列表含至少 2 个文件（md + html）");
  assert(listBody.data.total === listBody.data.files.length, "F8: total 与 files 长度一致");

  // F9: 报告下载 - GET /export/:filename 返回文件内容
  if (savedMdFile) {
    const downloadRes = await app.request(`/export/${savedMdFile}`, { method: "GET" });
    assert(downloadRes.status === 200, "F9: GET /export/:filename 返回 200");
    const downloadContentType = downloadRes.headers.get("Content-Type") ?? "";
    assert(downloadContentType.includes("text/markdown"), "F9: 下载 Content-Type 为 text/markdown");
    const downloadBody = await downloadRes.text();
    assert(downloadBody.length > 0, "F9: 下载内容非空");
  }

  // F9: 下载不存在的文件应返回 404
  const notFoundRes = await app.request("/export/nonexistent-file.md", { method: "GET" });
  assert(notFoundRes.status === 404, "F9: 下载不存在的文件返回 404");

  // F10: POST /review/export - 导出复盘报告
  const reviewExportRes = await app.request("/review/export?format=markdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  assert(reviewExportRes.status === 200, "F10: POST /review/export 返回 200");
  const reviewContentType = reviewExportRes.headers.get("Content-Type") ?? "";
  assert(reviewContentType.includes("text/markdown"), "F10: 复盘导出 Content-Type 为 text/markdown");
  const reviewBody = await reviewExportRes.text();
  assert(reviewBody.includes(BRAND.product_name), "F10: 复盘导出内容含品牌名");
  assert(reviewBody.includes("总体统计"), "F10: 复盘导出含总体统计章节");
}

// ============================================================
// 7. 工程约束（T2 puppeteer 在 optionalDependencies）
// ============================================================

function checkEngineeringConstraints(): void {
  section("工程约束（T2 puppeteer 在 optionalDependencies）");

  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkgContent = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(pkgContent);

  // T2: puppeteer 在 optionalDependencies（非 dependencies）
  assert(
    pkg.optionalDependencies && pkg.optionalDependencies.puppeteer,
    "T2: puppeteer 在 optionalDependencies",
  );
  assert(
    !pkg.dependencies || !pkg.dependencies.puppeteer,
    "T2: puppeteer 不在 dependencies",
  );

  // 验证不引入 marked
  assert(
    !pkg.dependencies || !pkg.dependencies.marked,
    "T2: 未引入 marked 依赖",
  );
  assert(
    !pkg.devDependencies || !pkg.devDependencies.marked,
    "T2: 未引入 marked devDependency",
  );

  // 检查 export 目录文件不引用 marked
  const exportDir = path.resolve(process.cwd(), "src/export");
  if (fs.existsSync(exportDir)) {
    const exportFiles = fs.readdirSync(exportDir).filter((f) => f.endsWith(".ts"));
    for (const file of exportFiles) {
      const content = fs.readFileSync(path.join(exportDir, file), "utf-8");
      assert(
        !content.includes('from "marked"') && !content.includes('import("marked")'),
        `T2: ${file} 未引入 marked`,
      );
    }
  }

  // 检查报告生成器未被修改（不含 export 相关代码）
  const generatorPath = path.resolve(process.cwd(), "src/agents/radar-report-generator.ts");
  if (fs.existsSync(generatorPath)) {
    const generatorContent = fs.readFileSync(generatorPath, "utf-8");
    assert(
      !generatorContent.includes("markdownToHtml") && !generatorContent.includes("exportReport"),
      "T2: radar-report-generator.ts 未被修改（不含 export 代码）",
    );
  }

  // 检查机会复盘未被修改（不含 export 相关代码）
  const reviewPath = path.resolve(process.cwd(), "src/agents/opportunity-review.ts");
  if (fs.existsSync(reviewPath)) {
    const reviewContent = fs.readFileSync(reviewPath, "utf-8");
    assert(
      !reviewContent.includes("markdownToHtml") && !reviewContent.includes("exportReport"),
      "T2: opportunity-review.ts 未被修改（不含 export 代码）",
    );
  }
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log("============================================================");
  console.log("Task 031 验收脚本：报告导出（PDF/Markdown/HTML）");
  console.log("============================================================");

  checkFileExists();
  checkTemplateEngine();
  await checkPdfRenderer();
  await checkReportExporter();
  await checkReviewExporter();
  await checkApiRoutes();
  checkEngineeringConstraints();

  console.log("\n============================================================");
  console.log(`验收结果：${passCount} PASS / ${failCount} FAIL`);
  if (failures.length > 0) {
    console.log("\n失败项：");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }
  console.log("============================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("验收脚本执行失败：", err);
  process.exit(1);
});
