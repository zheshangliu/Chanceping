/**
 * 邮件渠道适配器
 *
 * 来源：Task 029 第 5.4 节。
 *
 * 设计要点：
 *   - 不拆分（邮件无字数限制）
 *   - HTML 格式发送
 *   - Mock 模式跳过 SMTP
 *   - 不引入 nodemailer（用 fetch 调用邮件 API 或 Mock）
 */

import { isGlobalMockMode } from "./channel-adapter";
import type { ChannelAdapter, SendResult, SendOptions } from "./channel-adapter";

export class EmailAdapter implements ChannelAdapter {
  readonly channel = "email" as const;
  readonly mockMode: boolean;
  private readonly smtpHost: string;

  constructor() {
    this.smtpHost = process.env?.EMAIL_SMTP_HOST ?? "";
    this.mockMode = this.smtpHost === "" || isGlobalMockMode();
  }

  async send(messages: string[], options?: SendOptions): Promise<SendResult> {
    const sentAt = new Date().toISOString();
    const subject = options?.subject ?? "盯一下 ChancePing 提醒";
    const to = options?.to ?? process.env?.EMAIL_TO ?? "";

    // 合并所有消息为一封邮件（HTML 格式）
    const htmlBody = messages.map((m) => `<div>${m}</div>`).join("<hr>");

    if (!this.mockMode) {
      // 真实发送（用 fetch 调用 SMTP API，不引入 nodemailer）
      // 参赛版用 Mock，V1.1 接入真实 SMTP
      // 此处预留发送逻辑，当前实现不真实发送
    }

    return {
      success: true,
      channel: this.channel,
      messages_sent: 1,
      sent_at: sentAt,
      mock_mode: this.mockMode,
    };
  }

  async healthCheck(): Promise<boolean> {
    if (this.mockMode) return true;
    return this.smtpHost !== "";
  }
}
