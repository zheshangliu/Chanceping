import { Hono } from "hono";
import type { AppContext } from "../context";
import type { ApiResponse, ChatRequest } from "../types";
import { ConversationManager } from "../../agents/conversation-manager";
import type { TurnOutput } from "../../agents/conversation-turn-output";

export function chatRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // POST / - 对话
  app.post("/", async (c) => {
    const start = Date.now();
    let body: ChatRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        success: false, data: null,
        error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }
    if (!body.message || typeof body.message !== "string") {
      return c.json({
        success: false, data: null,
        error: { code: "BAD_REQUEST", message: "缺少 message 字段" },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }
    const radarType = body.radar_type ?? "ai_competition";
    try {
      let convEntry = body.conversation_id ? ctx.conversations.get(body.conversation_id) : undefined;
      let conversationId: string;
      if (convEntry) {
        conversationId = body.conversation_id!;
      } else {
        conversationId = body.conversation_id ?? `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // V1.3：默认启用 V2 一次一问模式
        const manager = new ConversationManager(ctx.llmAdapter, radarType, conversationId, true);
        convEntry = { manager, radar_type: radarType };
        ctx.conversations.set(conversationId, convEntry);
      }
      // V1.3 新增：合并上传文件解析文本
      const uploadedText = body.uploaded_text?.trim();
      const fullMessage = uploadedText
        ? `${body.message}\n\n[上传文件内容]\n${uploadedText}`
        : body.message;

      // V1.4 新增：处理 user_action
      const userAction = body.user_action ?? "answer";
      if (userAction === "generate_draft_now") {
        // 用户要求立即生成确认卡（跳过后续追问）
        const draftTurn = convEntry.manager.getConfirmationCard();
        if (draftTurn) {
          return c.json({
            success: true,
            data: { ...draftTurn, conversation_id: conversationId, canGenerateDraft: true },
            error: null,
            duration_ms: Date.now() - start,
          } satisfies ApiResponse);
        }
      }

      const turn = await convEntry.manager.processUserInput(fullMessage);
      return c.json({
        success: true,
        data: { ...turn, conversation_id: conversationId },
        error: null,
        duration_ms: Date.now() - start,
      } satisfies ApiResponse);
    } catch (err) {
      return c.json({
        success: false, data: null,
        error: { code: "CHAT_ERROR", message: err instanceof Error ? err.message : String(err) },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 500);
    }
  });

  // GET /:id/status - 查询会话状态
  app.get("/:id/status", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const entry = ctx.conversations.get(id);
    if (!entry) {
      return c.json({
        success: false, data: null,
        error: { code: "NOT_FOUND", message: `会话 ${id} 不存在` },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 404);
    }
    return c.json({
      success: true,
      data: { conversation_id: id, radar_type: entry.radar_type, exists: true },
      error: null,
      duration_ms: Date.now() - start,
    } satisfies ApiResponse);
  });

  // DELETE /:id - 结束会话
  app.delete("/:id", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const deleted = ctx.conversations.delete(id);
    if (!deleted) {
      return c.json({
        success: false, data: null,
        error: { code: "NOT_FOUND", message: `会话 ${id} 不存在` },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 404);
    }
    return c.json({
      success: true, data: { conversation_id: id, deleted: true },
      error: null, duration_ms: Date.now() - start,
    } satisfies ApiResponse);
  });

  // ============================================================
  // V1.3 新增端点
  // ============================================================

  // POST /:id/confirmation-card - 生成需求确认卡
  app.post("/:id/confirmation-card", (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const entry = ctx.conversations.get(id);
    if (!entry) {
      return c.json({
        success: false, data: null,
        error: { code: "NOT_FOUND", message: `会话 ${id} 不存在` },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 404);
    }
    const manager = entry.manager;
    const card = manager.getConfirmationCard();
    if (!card) {
      return c.json({
        success: false, data: null,
        error: { code: "CARD_NOT_READY", message: "确认卡尚未生成，请继续对话" },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }
    return c.json({
      success: true, data: card, error: null,
      duration_ms: Date.now() - start,
    } satisfies ApiResponse);
  });

  // POST /:id/confirm - 确认或拒绝需求确认卡
  app.post("/:id/confirm", async (c) => {
    const start = Date.now();
    const id = c.req.param("id");
    const entry = ctx.conversations.get(id);
    if (!entry) {
      return c.json({
        success: false, data: null,
        error: { code: "NOT_FOUND", message: `会话 ${id} 不存在` },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 404);
    }
    let body: { action: "confirm" | "reject" };
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        success: false, data: null,
        error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" },
        duration_ms: Date.now() - start,
      } satisfies ApiResponse, 400);
    }
    const manager = entry.manager;
    let turn: TurnOutput;
    if (body.action === "confirm") {
      turn = manager.userConfirm();
    } else {
      turn = manager.userRequestRevision();
    }
    return c.json({
      success: true, data: { ...turn, conversation_id: id }, error: null,
      duration_ms: Date.now() - start,
    } satisfies ApiResponse);
  });

  return app;
}
