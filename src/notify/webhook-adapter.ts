/**
 * Webhook 渠道适配器
 *
 * 来源：Task 029 第 5.5 节。
 *
 * 设计要点：
 *   - JSON 格式发送
 *   - 支持自定义 Webhook URL
 *   - Mock 模式跳过
 *   - 不拆分（Webhook 通常无字数限制）
 */

import { isGlobalMockMode } from "./channel-adapter";
import type { ChannelAdapter, SendResult, SendOptions } from "./channel-adapter";

export class WebhookAdapter implements ChannelAdapter {
  readonly channel = "webhook" as const;
  readonly mockMode: boolean;
  private readonly webhookUrl: string;

  constructor() {
    this.webhookUrl = process.env?.WEBHOOK_URL ?? "";
    this.mockMode = this.webhookUrl === "" || isGlobalMockMode();
  }

  async send(messages: string[], options?: SendOptions): Promise<SendResult> {
    const sentAt = new Date().toISOString();

    // JSON 格式 payload
    const payload = {
      messages,
      sent_at: sentAt,
      count: messages.length,
    };

    if (!this.mockMode) {
      const webhookUrl = options?.webhookUrl ?? this.webhookUrl;
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    }

    return {
      success: true,
      channel: this.channel,
      messages_sent: messages.length,
      sent_at: sentAt,
      mock_mode: this.mockMode,
    };
  }

  async healthCheck(): Promise<boolean> {
    if (this.mockMode) return true;
    return this.webhookUrl !== "";
  }
}
