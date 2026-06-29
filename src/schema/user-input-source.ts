/**
 * UserInputSource —— 用户输入来源类型 + 多模态接口定义
 *
 * V1.3 新增。定义用户输入的来源类型和文件解析接口。
 *
 * 设计依据：多模态输入方案决策报告——
 *   - 语音不做应用内 ASR，依赖输入法代劳，仅预留 SpeechToTextProvider 接口
 *   - 文件做自建解析（pdf-parse/mammoth/exceljs + Qwen-VL-Max/Qwen-Long）
 *   - FileParser 接口与 LLMAdapter 平级，不修改 LLMAdapter
 */

// ============================================================
// 用户输入来源类型
// ============================================================

/**
 * 用户输入来源类型。
 *
 * - typed_text：键盘打字
 * - ime_voice_to_text：输入法语音转文字（系统/第三方输入法）
 * - pasted_text：粘贴文本
 * - uploaded_image：上传图片（PNG/JPG）
 * - uploaded_pdf：上传 PDF
 * - uploaded_docx：上传 Word
 * - uploaded_xlsx：上传 Excel
 *
 * 注：ime_voice_to_text 进入系统的本质是文字，与 typed_text 处理逻辑一致，
 *     区分仅为来源统计埋点。
 */
export type UserInputSource =
  | "typed_text"
  | "ime_voice_to_text"
  | "pasted_text"
  | "uploaded_image"
  | "uploaded_pdf"
  | "uploaded_docx"
  | "uploaded_xlsx";

// ============================================================
// SpeechToTextProvider 接口（V1.3 仅定义，不实现）
// ============================================================

/**
 * 语音转文字 Provider 接口。
 *
 * V1.3 不实现具体服务，仅预留接口。
 * 未来可接：阿里 Paraformer、火山豆包 ASR、腾讯云、讯飞、本地 Whisper/Vosk。
 *
 * 触发条件（满足 2 项以上再启动，V1.5 按数据决策）：
 *   1. 移动端用户占比超过 50%
 *   2. 用户反馈频繁要求"按住说话"
 *   3. 用户不会用输入法语音转文字
 *   4. 文件上传和长文本整理已稳定
 *   5. 已有稳定 ASR Provider 和成本预算
 */
export interface SpeechToTextProvider {
  /**
   * 将音频文件转写为文字。
   *
   * @param file 音频文件 Buffer
   * @param options 转写选项
   * @returns 转写结果（文字 + 置信度）
   */
  transcribe(
    file: Buffer,
    options: { language?: string },
  ): Promise<{
    /** 转写文字 */
    text: string;
    /** 转写置信度（0-1） */
    confidence: number;
  }>;
}

// ============================================================
// FileParser 接口（V1.3 定义，Task E 实现）
// ============================================================

/**
 * 文件解析结果。
 */
export interface FileParseResult {
  /** 解析出的纯文本 */
  text: string;
  /** 结构化数据（如 Excel 的表格数据，可选） */
  structuredData?: Record<string, unknown>;
  /** 输入来源类型 */
  source: UserInputSource;
  /** 解析的文件名 */
  fileName: string;
  /** 解析的 MIME 类型 */
  mimeType: string;
}

/**
 * 文件解析器接口。
 *
 * 与 LLMAdapter 接口平级，不修改 LLMAdapter 接口定义。
 * 实现类（FileParserRouter）在 Task E 中实现。
 *
 * 支持的文件类型：
 *   - PDF（application/pdf）→ pdf-parse 本地解析
 *   - Word（.docx）→ mammoth 本地解析
 *   - Excel（.xlsx）→ exceljs 本地解析
 *   - 图片（PNG/JPG）→ Qwen-VL-Max 云端解析
 *   - 长文档/兜底 → Qwen-Long 文件接口
 *
 * 安全约束：
 *   - 单文件上限 20MB，超限走 Qwen-Long 云端解析
 *   - 不引入 Python 后端
 *   - 不引入 JVM
 *   - 参赛版图片识别仅用 Qwen-VL-Max（合规）
 */
export interface FileParser {
  /**
   * 解析文件为结构化文本。
   *
   * @param file 文件 Buffer
   * @param mimeType 文件 MIME 类型
   * @param fileName 文件名
   * @returns 解析结果
   * @throws {Error} FILE_TOO_LARGE - 文件超过 20MB
   * @throws {Error} UNSUPPORTED_FILE_TYPE - 不支持的文件类型
   * @throws {Error} PARSE_ERROR - 解析失败
   */
  parse(file: Buffer, mimeType: string, fileName: string): Promise<FileParseResult>;
}

// ============================================================
// 文件类型常量
// ============================================================

/** 支持的文件 MIME 类型 */
export const SUPPORTED_MIME_TYPES: Record<string, UserInputSource> = {
  "application/pdf": "uploaded_pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "uploaded_docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "uploaded_xlsx",
  "image/png": "uploaded_image",
  "image/jpeg": "uploaded_image",
  "image/jpg": "uploaded_image",
  "image/webp": "uploaded_image",
};

/** 单文件大小上限（20MB） */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 前端文件选择器 accept 属性 */
export const FILE_INPUT_ACCEPT = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp";
