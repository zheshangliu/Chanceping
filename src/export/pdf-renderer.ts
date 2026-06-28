/**
 * PDF 渲染器（Puppeteer 封装）
 *
 * 来源：Task 031 第 5.3 节。
 *
 * 设计要点：
 *   - 用 Puppeteer 渲染 HTML → PDF
 *   - Puppeteer 作为**可选依赖**（optionalDependencies），未安装时抛错
 *   - 参赛版默认关闭 PDF（PDF_EXPORT_ENABLED=false），用 HTML 降级
 *   - 用 `dynamic import()` 延迟加载 puppeteer，避免未安装时启动报错
 */

/** PDF 渲染选项 */
export interface PdfRenderOptions {
  /** 页面格式（默认 A4） */
  format?: "A4" | "Letter";
  /** 边距（默认 1cm） */
  margin?: { top: string; bottom: string; left: string; right: string };
  /** 是否打印背景（默认 true） */
  printBackground?: boolean;
}

/** 默认边距 */
const DEFAULT_MARGIN = {
  top: "1cm",
  bottom: "1cm",
  left: "1cm",
  right: "1cm",
};

/**
 * 用 Puppeteer 将 HTML 渲染为 PDF。
 *
 * Puppeteer 作为可选依赖，未安装时抛错。
 * 调用方应捕获错误并降级为 HTML。
 *
 * @param html HTML 文档
 * @param options 渲染选项
 * @returns PDF Buffer
 */
export async function renderPdf(
  html: string,
  options?: PdfRenderOptions,
): Promise<Buffer> {
  // 检查 PDF 导出开关
  const enabled = process.env?.PDF_EXPORT_ENABLED ?? "false";
  if (enabled !== "true") {
    throw new Error("PDF 导出未启用（设置 PDF_EXPORT_ENABLED=true 启用）");
  }

  // 延迟加载 puppeteer（可选依赖）
  let puppeteer: any;
  try {
    puppeteer = await import("puppeteer");
  } catch {
    throw new Error("Puppeteer 未安装，无法导出 PDF（npm install puppeteer）");
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env?.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: options?.format ?? "A4",
      margin: options?.margin ?? DEFAULT_MARGIN,
      printBackground: options?.printBackground ?? true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * 检查 PDF 渲染是否可用。
 *
 * 同时满足：
 *   - PDF_EXPORT_ENABLED=true
 *   - puppeteer 已安装（require.resolve 不抛错）
 *
 * @returns 可用返回 true，否则 false
 */
export function isPdfAvailable(): boolean {
  const enabled = process.env?.PDF_EXPORT_ENABLED ?? "false";
  if (enabled !== "true") return false;
  try {
    require.resolve("puppeteer");
    return true;
  } catch {
    return false;
  }
}
