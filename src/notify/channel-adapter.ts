/**
 * 多渠道适配器接口 + 工厂（T12）
 *
 * 来源：Task 029 第 5.2 节。
 *
 * 统一渠道适配器接口，支持 wechat / email / webhook 三种渠道。
 * 新增渠道只需实现 ChannelAdapter 接口 + 在工厂注册，符合开闭原则。
 */

/** 渠道类型（wechat / email / webhook；web 渠道由 reminder-renderer 处理，不在此适配） */
export type NotifyChannel = "wechat" | "email" | "webhook";

/** 发送结果 */
export interface SendResult {
  /** 是否成功 */
  success: boolean;
  /** 渠道 */
  channel: NotifyChannel;
  /** 发送的消息数 */
  messages_sent: number;
  /** 错误信息 */
  error?: string;
  /** 发送时间（ISO 字符串） */
  sent_at: string;
  /** Mock 模式标志（true 表示未真实发送） */
  mock_mode: boolean;
}

/** 发送选项 */
export interface SendOptions {
  /** 邮件主题（email 渠道） */
  subject?: string;
  /** 收件人（email 渠道） */
  to?: string;
  /** Webhook URL（webhook 渠道） */
  webhookUrl?: string;
  /** 微信 webhook URL（wechat 渠道） */
  wechatWebhookUrl?: string;
}

/** 适配器接口 */
export interface ChannelAdapter {
  /** 渠道标识 */
  readonly channel: NotifyChannel;
  /** 是否 Mock 模式 */
  readonly mockMode: boolean;
  /** 发送消息 */
  send(messages: string[], options?: SendOptions): Promise<SendResult>;
  /** 健康检查 */
  healthCheck(): Promise<boolean>;
}

/**
 * 适配器工厂：根据渠道创建适配器实例。
 *
 * @param channel 渠道标识
 * @returns 适配器实例
 * @throws 未知渠道时抛出错误
 */
export function createChannelAdapter(channel: NotifyChannel): ChannelAdapter {
  switch (channel) {
    case "wechat": {
      const { WeChatAdapter } = require("./wechat-adapter");
      return new WeChatAdapter() as ChannelAdapter;
    }
    case "email": {
      const { EmailAdapter } = require("./email-adapter");
      return new EmailAdapter() as ChannelAdapter;
    }
    case "webhook": {
      const { WebhookAdapter } = require("./webhook-adapter");
      return new WebhookAdapter() as ChannelAdapter;
    }
    default:
      throw new Error(`未知渠道: ${channel}`);
  }
}

/** 全局 Mock 模式检查 */
export function isGlobalMockMode(): boolean {
  const flag = process.env?.NOTIFY_MOCK_MODE ?? "true";
  return flag === "true" || flag === "1";
}
