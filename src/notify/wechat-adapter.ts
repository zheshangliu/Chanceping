/**
 * 微信渠道适配器
 *
 * 来源：Task 029 第 5.3 节。
 *
 * 设计要点：
 *   - 先用 byteSplitter.splitByBytes 拆分（maxBytes=2048）
 *   - 逐条发送到微信 webhook（Mock 模式跳过）
 *   - Mock 模式返回拆分后的消息数
 */

import { splitByBytes } from "./byte-splitter";
import { isGlobalMockMode } from "./channel-adapter";
import type { ChannelAdapter, SendResult, SendOptions } from "./channel-adapter";

/** 微信渠道最大字节数（与 WECHAT_MAX_LENGTH 一致） */
const WECHAT_MAX_BYTES = 2048;

export class WeChatAdapter implements ChannelAdapter {
  readonly channel = "wechat" as const;
  readonly mockMode: boolean;
  private readonly webhookUrl: string;

  constructor() {
    this.webhookUrl = process.env?.WECHAT_WEBHOOK_URL ?? "";
    this.mockMode = this.webhookUrl === "" || isGlobalMockMode();
  }

  async send(messages: string[], options?: SendOptions): Promise<SendResult> {
    const sentAt = new Date().toISOString();

    // 1. 每条消息按字节拆分
    const allParts: string[] = [];
    for (const msg of messages) {
      const result = splitByBytes(msg, { maxBytes: WECHAT_MAX_BYTES });
      allParts.push(...result.messages);
    }

    // 2. 发送（Mock 模式跳过）
    if (!this.mockMode) {
      const webhookUrl = options?.wechatWebhookUrl ?? this.webhookUrl;
      if (webhookUrl) {
        for (const part of allParts) {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ msgtype: "text", text: { content: part } }),
          });
        }
      }
    }

    return {
      success: true,
      channel: this.channel,
      messages_sent: allParts.length,
      sent_at: sentAt,
      mock_mode: this.mockMode,
    };
  }

  async healthCheck(): Promise<boolean> {
    // Mock 模式始终 true；真实模式检查 webhookUrl 是否配置
    if (this.mockMode) return true;
    return this.webhookUrl !== "";
  }
}
