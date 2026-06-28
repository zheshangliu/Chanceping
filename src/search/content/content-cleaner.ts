/**
 * 内容清洗（content cleaner）
 *
 * 来源：Task 019c 第 4.5 节。
 *
 * 搜索层第四层：将原始网页文本转为 AI 可读结构。
 *   - 移除 HTML 标签（script/style/nav/footer/header 及内容）
 *   - 连续空行压缩为单个空行
 *   - 过短行移除（< 10 字符且非标题）
 *   - 截断超长文本（默认 maxChars=8000，约 2000 token）
 *   - 提取标题 / 发布日期 / 作者
 *
 * 纯函数，无副作用，不引入依赖。
 */

import type { CleanedContent } from "../types";

/** 默认最大字符数（约 2000 token） */
const DEFAULT_MAX_CHARS = 8000;

/** 截断后缀 */
const TRUNCATE_SUFFIX = "...[截断]";

/** 标题提取正则：<title>xxx</title> */
const TITLE_TAG_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/** H1 标签提取正则：<h1>xxx</h1> */
const H1_TAG_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;

/** 发布日期正则：20XX-XX-XX 或 20XX年XX月XX日 */
const PUBLISH_DATE_RE = /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?)/;

/** 作者正则：作者：xxx 或 <meta name="author" content="xxx"> */
const AUTHOR_TEXT_RE = /作者[：:]\s*([^\n<，。]+)/;
const AUTHOR_META_RE = /<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i;

/**
 * 移除 HTML 标签及内容（script/style/nav/footer/header）。
 * 其他标签只移除标签本身，保留内部文本。
 */
function removeHtmlTags(rawText: string): string {
  let text = rawText;
  // 移除 script/style/nav/footer/header 标签及内容
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");
  // 移除 HTML 注释
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // 移除其他标签（保留内容）
  text = text.replace(/<[^>]+>/g, "");
  // 解码常见 HTML 实体
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  return text;
}

/** 压缩连续空行为单个空行，并去除行首尾多余空白 */
function compressBlankLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line, idx, arr) => {
      // 连续空行只保留一个
      if (line === "" && idx > 0 && arr[idx - 1].trim() === "") {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
}

/** 移除过短行（< 10 字符且非标题） */
function removeShortLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      if (line === "") return true; // 保留空行（已压缩）
      // 标题行保留（以 # 开头或全大写短行）
      if (line.startsWith("#")) return true;
      // 短行移除
      if (line.length < 10) return false;
      return true;
    })
    .join("\n");
}

/**
 * 计算字数（中文按字数，英文按空格分词）。
 * 策略：中文字符各算 1 字，英文单词各算 1 字。
 */
function countWords(text: string): number {
  if (!text) return 0;
  // 中文字符数
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  // 英文单词数（去除中文后的英文单词）
  const nonChineseText = text.replace(/[\u4e00-\u9fff]/g, " ");
  const englishWords = nonChineseText
    .split(/\s+/)
    .filter((w) => w.length > 0 && /[a-zA-Z0-9]/.test(w)).length;
  return chineseChars + englishWords;
}

/** 提取标题：优先 <title>，其次 <h1>，再次第一行非空文本 */
function extractTitle(rawText: string, cleanedText: string): string {
  // 1. <title> 标签
  const titleMatch = rawText.match(TITLE_TAG_RE);
  if (titleMatch && titleMatch[1]) {
    const title = titleMatch[1].trim();
    if (title) return title;
  }
  // 2. <h1> 标签
  const h1Match = rawText.match(H1_TAG_RE);
  if (h1Match && h1Match[1]) {
    const title = h1Match[1].trim();
    if (title) return title;
  }
  // 3. 清洗后文本的第一行非空文本
  const firstLine = cleanedText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) {
    // 移除 Markdown 标题前缀
    return firstLine.replace(/^#+\s*/, "").trim();
  }
  return "";
}

/** 提取发布日期：正则匹配 20XX-XX-XX 或 20XX年XX月XX日 */
function extractPublishDate(rawText: string): string | undefined {
  const match = rawText.match(PUBLISH_DATE_RE);
  if (match && match[1]) {
    // 标准化为 YYYY-MM-DD 格式
    const dateStr = match[1]
      .replace(/年/g, "-")
      .replace(/月/g, "-")
      .replace(/日/g, "")
      .replace(/\//g, "-");
    // 验证日期格式
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const [year, month, day] = parts;
      if (year.length === 4 && month.length >= 1 && day.length >= 1) {
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }
    }
    return dateStr;
  }
  return undefined;
}

/** 提取作者：<meta name="author"> 或 作者：xxx */
function extractAuthor(rawText: string): string | undefined {
  // 1. meta 标签
  const metaMatch = rawText.match(AUTHOR_META_RE);
  if (metaMatch && metaMatch[1]) {
    return metaMatch[1].trim();
  }
  // 2. 文本格式
  const textMatch = rawText.match(AUTHOR_TEXT_RE);
  if (textMatch && textMatch[1]) {
    return textMatch[1].trim();
  }
  return undefined;
}

/**
 * 内容清洗：将原始网页文本转为 AI 可读结构。
 *
 * @param rawText 原始网页文本（可能含 HTML 标签）
 * @param url 来源 URL
 * @param options.maxChars 最大字符数（默认 8000）
 * @returns 清洗后的 CleanedContent（fetch_success=true）
 */
export function cleanContent(
  rawText: string,
  url: string,
  options?: { maxChars?: number },
): CleanedContent {
  // 空字符串入参：返回空的 CleanedContent
  if (!rawText || rawText.trim() === "") {
    return {
      url,
      title: "",
      main_text: "",
      word_count: 0,
      fetch_success: false,
      fetch_error: "empty input",
    };
  }

  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  // 提取元信息（在移除标签前）
  const title = extractTitle(rawText, "");
  const publishDate = extractPublishDate(rawText);
  const author = extractAuthor(rawText);

  // 移除 HTML 标签
  let cleaned = removeHtmlTags(rawText);

  // 压缩空行
  cleaned = compressBlankLines(cleaned);

  // 移除过短行
  cleaned = removeShortLines(cleaned);

  // 如果标题为空，用清洗后文本的第一行
  const finalTitle = title || extractTitle("", cleaned);

  // 截断超长文本
  if (cleaned.length > maxChars) {
    cleaned = cleaned.slice(0, maxChars) + TRUNCATE_SUFFIX;
  }

  return {
    url,
    title: finalTitle,
    main_text: cleaned,
    publish_date: publishDate,
    author,
    word_count: countWords(cleaned),
    fetch_success: true,
  };
}
