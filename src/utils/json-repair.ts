/**
 * T4 JSON 三重修复兜底
 *
 * 来源：Task 019a 第 4.3 节。
 *
 * LLM 输出的 JSON 经常有格式问题，按以下顺序尝试修复：
 *   1. JSON.parse —— 直接解析（正常情况）
 *   2. 等效修复 —— 修复常见问题后解析（Markdown 代码块、尾逗号、单引号→双引号、未引号 key、截断补全）
 *   3. 正则提取 —— 从混合文本中提取 {...} 或 [...] 块
 *   4. 文本兜底 —— 全部失败，返回 { raw: originalText }
 *
 * 纯 TS 手写，不引入 jsonrepair / json_repair 库（GPL-3.0 约束）。
 */

/**
 * 移除 Markdown 代码块标记
 * - ```json\n{...}\n``` → {...}
 * - ```\n[...]\n``` → [...]
 */
function stripMarkdownCodeBlock(text: string): string {
  // 优先匹配完整的代码块（含开闭标记）
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // 处理未闭合的代码块（仅开头标记）
  let result = text;
  result = result.replace(/^```(?:json)?\s*/i, "");
  result = result.replace(/\s*```\s*$/g, "");
  return result.trim();
}

/**
 * 移除尾逗号（对象和数组末尾的逗号）
 * - {"a":1,} → {"a":1}
 * - [1,2,] → [1,2]
 */
function removeTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * 单引号转双引号（将单引号字符串转为双引号字符串）
 * - {'a':1} → {"a":1}
 * - {'a':'b'} → {"a":"b"}
 */
function singleToDoubleQuotes(text: string): string {
  // 匹配单引号字符串（处理转义 \'）
  return text.replace(/'(?:[^'\\]|\\.)*'/g, (match) => {
    // 提取内容：去掉首尾单引号
    const content = match.slice(1, -1);
    // 反转义 \' → '，转义 " → \"
    const unescaped = content.replace(/\\'/g, "'").replace(/"/g, '\\"');
    return '"' + unescaped + '"';
  });
}

/**
 * 未引号的 key 加引号
 * - {a:1} → {"a":1}
 * - {a:1, b:2} → {"a":1, "b":2}
 */
function quoteUnquotedKeys(text: string): string {
  // 匹配 { 或 , 后面跟标识符再跟 : 的情况
  return text.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');
}

/**
 * 截断补全（补全缺失的 } 和 ]）
 * - {"a":1 → {"a":1}
 * - [1,2 → [1,2]
 */
function completeTruncation(text: string): string {
  let result = text;

  // 统计未闭合的大括号
  const openBraces = (result.match(/{/g) || []).length;
  const closeBraces = (result.match(/}/g) || []).length;
  if (openBraces > closeBraces) {
    result += "}".repeat(openBraces - closeBraces);
  }

  // 统计未闭合的方括号
  const openBrackets = (result.match(/\[/g) || []).length;
  const closeBrackets = (result.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    result += "]".repeat(openBrackets - closeBrackets);
  }

  return result;
}

/**
 * 第 2 层：等效修复
 * 按顺序应用所有修复规则，然后尝试解析
 */
function repairJson(text: string): string {
  let result = text;

  // 1. 移除 Markdown 代码块标记
  result = stripMarkdownCodeBlock(result);

  // 2. 截断补全（先补全，再移除尾逗号）
  result = completeTruncation(result);

  // 3. 移除尾逗号
  result = removeTrailingCommas(result);

  // 4. 单引号转双引号
  result = singleToDoubleQuotes(result);

  // 5. 未引号 key 加引号
  result = quoteUnquotedKeys(result);

  return result;
}

/**
 * 第 3 层：从混合文本中正则提取第一个 {...} 或 [...] 块（贪婪匹配）
 * - 前文 {"a":1} 后文 → {"a":1}
 * - LLM 输出: [{"x":1}] 结束 → [{"x":1}]
 */
function extractJsonBlock(text: string): string | null {
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");

  // 都不存在
  if (firstBrace === -1 && firstBracket === -1) {
    return null;
  }

  // 判断哪个先出现，提取对应的块
  let extracted: string | null = null;

  if (firstBrace === -1) {
    // 只有方括号
    const m = text.match(/\[[\s\S]*\]/);
    extracted = m ? m[0] : null;
  } else if (firstBracket === -1) {
    // 只有大括号
    const m = text.match(/\{[\s\S]*\}/);
    extracted = m ? m[0] : null;
  } else if (firstBrace < firstBracket) {
    // 大括号先出现，优先提取 {...}
    const m = text.match(/\{[\s\S]*\}/);
    extracted = m ? m[0] : null;
    // 如果 {...} 提取失败，尝试 [...]
    if (extracted === null) {
      const m2 = text.match(/\[[\s\S]*\]/);
      extracted = m2 ? m2[0] : null;
    }
  } else {
    // 方括号先出现，优先提取 [...]
    const m = text.match(/\[[\s\S]*\]/);
    extracted = m ? m[0] : null;
    // 如果 [...] 提取失败，尝试 {...}
    if (extracted === null) {
      const m2 = text.match(/\{[\s\S]*\}/);
      extracted = m2 ? m2[0] : null;
    }
  }

  return extracted;
}

/**
 * T4 JSON 三重修复兜底解析
 *
 * @param text 待解析的文本
 * @returns 解析结果；全部失败时返回 { raw: text }
 */
export function parseJsonWithRepair<T = unknown>(text: string): T {
  // 边界情况：非字符串 / 空字符串
  if (typeof text !== "string") {
    return { raw: String(text ?? "") } as unknown as T;
  }
  if (text.trim() === "") {
    return { raw: "" } as unknown as T;
  }

  // 第 1 层：直接解析
  try {
    return JSON.parse(text) as T;
  } catch {
    // 继续第 2 层
  }

  // 第 2 层：修复后解析
  try {
    const repaired = repairJson(text);
    return JSON.parse(repaired) as T;
  } catch {
    // 继续第 3 层
  }

  // 第 3 层：正则提取后解析
  const extracted = extractJsonBlock(text);
  if (extracted !== null) {
    // 先尝试直接解析提取的块
    try {
      return JSON.parse(extracted) as T;
    } catch {
      // 继续尝试修复后解析
    }
    try {
      const repaired = repairJson(extracted);
      return JSON.parse(repaired) as T;
    } catch {
      // 继续第 4 层
    }
  }

  // 第 4 层：文本兜底（不抛错）
  return { raw: text } as unknown as T;
}

/**
 * 仅第 1 层：标准 JSON.parse（用于对比测试）
 * 严格模式，解析失败时抛错
 */
export function parseJsonStrict(text: string): unknown {
  return JSON.parse(text);
}
