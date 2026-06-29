/**
 * QwenVlAdapter —— 图片/扫描件解析适配器
 *
 * 使用 Qwen-VL-Max（DashScope）识别图片中的文字。
 * 参赛版合规：仅使用 Qwen-VL-Max（DashScope 自家）。
 *
 * 环境变量：
 *   DASHSCOPE_API_KEY：DashScope API Key
 *   DASHSCOPE_BASE_URL：DashScope Base URL（可选，默认 https://dashscope.aliyuncs.com）
 */

import type { FileParser, FileParseResult } from "../schema/user-input-source";

export class QwenVlAdapter implements FileParser {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.DASHSCOPE_API_KEY ?? "";
    this.baseUrl = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com";
  }

  async parse(file: Buffer, mimeType: string, fileName: string): Promise<FileParseResult> {
    if (!this.apiKey) {
      throw new Error("DASHSCOPE_API_KEY not configured");
    }

    const base64Image = file.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    // 调用 Qwen-VL-Max（OpenAI 兼容接口）
    const response = await fetch(`${this.baseUrl}/compatible-mode/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen-vl-max",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "请提取这张图片中的所有文字信息，保持原有结构。" },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Qwen-VL API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      source: "uploaded_image",
      fileName,
      mimeType,
    };
  }
}
