/**
 * normalizeUserInput —— 长文本整理
 *
 * V1.3 新增。对用户输入的长文本做断句、去重、纠错、结构化。
 *
 * 设计依据：多模态输入方案决策报告——
 *   用户通过输入法说话或粘贴大段文本后，文字通常存在：
 *   没标点、口语化、重复、信息散、错别字、不完整等问题。
 *   ChancePing 的差异化能力是把这段乱文本整理成结构化需求草稿。
 *
 * 整理策略（纯规则，不调用 LLM）：
 *   1. 断句：补充缺失标点（按语义分割）
 *   2. 去重：合并重复信息
 *   3. 纠错：修正常见错别字（QWAN→Qwen 等）
 *   4. 结构化：提取身份/目标/限制/排除项/优先级
 */

// ============================================================
// 常量
// ============================================================

/** 长文本阈值（超过此长度触发整理） */
const LONG_TEXT_THRESHOLD = 50;

/** 常见错别字修正表 */
const TYPO_MAP: Record<string, string> = {
  "QWAN": "Qwen",
  "QWAM": "Qwen",
  "qwam": "Qwen",
  "qwan": "Qwen",
  "deepseek": "DeepSeek",
  "DEEPSEEK": "DeepSeek",
  "trae": "TRAE",
  "codex": "Codex",
  "gpt": "GPT",
  "AI产品": "AI 产品",
  "ai产品": "AI 产品",
};

/** 口语化→结构化映射表 */
const COLLOQUIAL_MAP: Array<{ pattern: RegExp; field: string; value: string }> = [
  { pattern: /大厂办的|大厂|含金量高/, field: "organizer", value: "主办方权威" },
  { pattern: /奖金高|奖金多|有钱/, field: "reward", value: "奖金规模高" },
  { pattern: /快速做|快速demo|快速Demo/, field: "goal", value: "适合快速做 Demo" },
  { pattern: /开源/, field: "condition", value: "需开源" },
  { pattern: /海外|国外/, field: "region", value: "接受海外" },
  { pattern: /国内|中国/, field: "region", value: "仅国内" },
];

// ============================================================
// 类型
// ============================================================

/** 整理后的用户输入 */
export interface NormalizedUserInput {
  /** 整理后的文本（断句+去重+纠错后） */
  normalizedText: string;
  /** 是否触发了整理（原文 > 50 字或口语化） */
  wasNormalized: boolean;
  /** 提取的结构化片段 */
  structured: {
    identity?: string;
    goals: string[];
    constraints: string[];
    exclusions: string[];
    priorities: string[];
  };
  /** 修正的错别字列表 */
  correctedTypos: string[];
  /** 检测到的口语化表达 */
  detectedColloquialisms: string[];
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 整理用户输入的长文本。
 *
 * @param rawInput 用户原始输入
 * @returns 整理后的结构化结果
 */
export function normalizeUserInput(rawInput: string): NormalizedUserInput {
  const input = rawInput.trim();

  // 短文本直接返回（除非含口语化或重复模式）
  if (input.length <= LONG_TEXT_THRESHOLD && !hasColloquialisms(input) && !hasRepetition(input)) {
    return {
      normalizedText: input,
      wasNormalized: false,
      structured: { goals: [], constraints: [], exclusions: [], priorities: [] },
      correctedTypos: [],
      detectedColloquialisms: [],
    };
  }

  // 步骤 1：纠错
  let text = input;
  const correctedTypos: string[] = [];
  for (const [typo, correct] of Object.entries(TYPO_MAP)) {
    if (text.includes(typo)) {
      text = text.replaceAll(typo, correct);
      correctedTypos.push(`${typo} → ${correct}`);
    }
  }

  // 步骤 2：压缩连续重复片段（如"我想找比赛我想找比赛" → "我想找比赛"）
  text = compressRepetition(text);

  // 步骤 3：断句（补充缺失标点）
  text = addPunctuation(text);

  // 步骤 4：去重（合并重复信息）
  const sentences = text.split(/[。！？\n]/).filter((s) => s.trim());
  const uniqueSentences = deduplicateSentences(sentences);
  text = uniqueSentences.join("。");

  // 步骤 5：结构化提取
  const structured = extractStructured(input, uniqueSentences);

  // 步骤 6：检测口语化
  const detectedColloquialisms = detectColloquialisms(input);

  return {
    normalizedText: text,
    wasNormalized: true,
    structured,
    correctedTypos,
    detectedColloquialisms,
  };
}

// ============================================================
// 私有函数
// ============================================================

/** 检测是否包含口语化表达 */
function hasColloquialisms(text: string): boolean {
  return COLLOQUIAL_MAP.some((item) => item.pattern.test(text));
}

/** 检测是否含连续重复模式（3+ 字片段重复 3+ 次） */
function hasRepetition(text: string): boolean {
  return /(.{3,})\1{2,}/.test(text);
}

/** 压缩连续重复片段（保留一份） */
function compressRepetition(text: string): string {
  // 循环压缩直到稳定（处理嵌套重复）
  let prev = "";
  let curr = text;
  while (prev !== curr) {
    prev = curr;
    curr = curr.replace(/(.{3,})\1{1,}/g, "$1");
  }
  return curr;
}

/** 补充缺失标点 */
function addPunctuation(text: string): string {
  // 在"我是"后面加逗号
  let result = text.replace(/(我是[^，。！？\s]{2,10})(帮我|想|要|希望)/g, "$1，$2");
  // 在"就是"后面加逗号
  result = result.replace(/(就是[^，。！？\s]{2,8})(最好|相关|那种)/g, "$1，$2");
  // 句末补句号
  if (!/[。！？]$/.test(result)) result += "。";
  return result;
}

/** 去重句子 */
function deduplicateSentences(sentences: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    // 简单去重：完全相同的句子跳过
    if (seen.has(trimmed)) continue;
    // 语义去重：如果新句子是已有句子的子串，跳过
    const isSubstring = Array.from(seen).some((existing) => existing.includes(trimmed) || trimmed.includes(existing));
    if (isSubstring && trimmed.length < 20) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** 提取结构化信息 */
function extractStructured(
  rawInput: string,
  sentences: string[],
): NormalizedUserInput["structured"] {
  const structured: NormalizedUserInput["structured"] = {
    goals: [],
    constraints: [],
    exclusions: [],
    priorities: [],
  };

  // 提取身份
  const identityMatch = rawInput.match(/我是(.+?)(?:帮我|想|要|希望|，|$)/);
  if (identityMatch) {
    structured.identity = identityMatch[1].trim();
  }

  // 提取目标
  for (const s of sentences) {
    if (s.includes("帮我") || s.includes("我想") || s.includes("我要") || s.includes("希望")) {
      structured.goals.push(s.trim());
    }
  }

  // 从口语化映射提取约束
  for (const item of COLLOQUIAL_MAP) {
    if (item.pattern.test(rawInput)) {
      if (item.field === "region" || item.field === "condition") {
        structured.constraints.push(item.value);
      } else if (item.field === "organizer") {
        structured.priorities.push(item.value);
      } else if (item.field === "reward") {
        structured.priorities.push(item.value);
      } else if (item.field === "goal") {
        structured.goals.push(item.value);
      }
    }
  }

  // 提取排除项
  for (const s of sentences) {
    if (s.includes("不要") || s.includes("排除") || s.includes("不用")) {
      structured.exclusions.push(s.replace(/不要|排除|不用/g, "").trim());
    }
  }

  return structured;
}

/** 检测口语化表达 */
function detectColloquialisms(rawInput: string): string[] {
  const detected: string[] = [];
  for (const item of COLLOQUIAL_MAP) {
    if (item.pattern.test(rawInput)) {
      detected.push(item.value);
    }
  }
  return detected;
}

// ============================================================
// 调试辅助：导出常量与映射表（供 verify 脚本和单元测试使用）
// ============================================================

export { LONG_TEXT_THRESHOLD, TYPO_MAP, COLLOQUIAL_MAP };
