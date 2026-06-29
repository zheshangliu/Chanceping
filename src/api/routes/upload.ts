/**
 * POST /api/upload —— 文件上传解析端点
 *
 * 接收 multipart/form-data 文件，解析后返回结构化文本。
 * 解析结果由前端注入 /api/chat 的 message 字段。
 */

import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse } from "../types";
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE } from "../../schema/user-input-source";
import { FileParserRouter } from "../../search/file-parser-router";

export function uploadRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const parser = ctx.fileParser ?? new FileParserRouter();

  app.post("/", async (c) => {
    const start = Date.now();
    let body: { file: File; conversation_id?: string };

    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({
        success: false, data: null,
        error: { code: "BAD_REQUEST", message: "请求体不是合法 multipart/form-data" },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }

    const file = body.file;
    if (!file || !(file instanceof File)) {
      return c.json({
        success: false, data: null,
        error: { code: "NO_FILE", message: "未找到文件，请选择文件后上传" },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }

    // MIME 类型检查
    const mimeType = file.type;
    if (!SUPPORTED_MIME_TYPES[mimeType]) {
      return c.json({
        success: false, data: null,
        error: { code: "UNSUPPORTED_FILE_TYPE", message: `不支持的文件类型: ${mimeType}` },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }

    // 大小检查
    if (file.size > MAX_FILE_SIZE) {
      return c.json({
        success: false, data: null,
        error: { code: "FILE_TOO_LARGE", message: `文件超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制` },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }

    // 解析
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await parser.parse(buffer, mimeType, file.name);

      return c.json({
        success: true,
        data: {
          ...result,
          conversation_id: body.conversation_id,
        },
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return c.json({
        success: false, data: null,
        error: { code: "PARSE_ERROR", message: `文件解析失败: ${errMsg}` },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  return app;
}
