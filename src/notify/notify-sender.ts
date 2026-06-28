/**
 * 统一发送入口（NotifySender）
 *
 * 来源：Task 029 第 5.6 节。
 *
 * 调度器调用的入口，接收 ReminderResult + 渠道列表。
 * 渲染 + 拆分 + 发送。
 *
 * 渠道处理：
 *   - wechat / email：调用 renderRemindersForChannel 渲染为对应格式字符串
 *   - webhook：直接 JSON.stringify(result) 作为消息（reminder-renderer 不支持 webhook 渠道）
 */

import { renderRemindersForChannel } from "../agents/reminder-renderer";
import type { ReminderChannel } from "../agents/reminder-renderer";
import type { ReminderResult } from "../agents/reminder-engine";
import { createChannelAdapter } from "./channel-adapter";
import type { NotifyChannel, SendResult, SendOptions } from "./channel-adapter";

/**
 * 发送提醒到多渠道。
 *
 * @param result 提醒结果（ReminderResult）
 * @param channels 渠道列表（默认 ["wechat"]）
 * @param options 发送选项（可选）
 * @returns 各渠道发送结果
 */
export async function notifyReminders(
  result: ReminderResult,
  channels: NotifyChannel[] = ["wechat"],
  options?: SendOptions,
): Promise<Record<string, SendResult>> {
  const results: Record<string, SendResult> = {};

  for (const channel of channels) {
    // 渲染消息
    const messages = renderForChannel(result, channel);

    // 创建适配器并发送
    const adapter = createChannelAdapter(channel);
    const sendResult = await adapter.send(messages, options);
    results[channel] = sendResult;
  }

  return results;
}

/**
 * 按渠道渲染提醒消息。
 *
 * wechat/email 渠道：调用 reminder-renderer 的 renderRemindersForChannel
 * webhook 渠道：JSON 序列化（reminder-renderer 不支持 webhook）
 *
 * @param result 提醒结果
 * @param channel 渠道
 * @returns 渲染后的消息数组
 */
function renderForChannel(result: ReminderResult, channel: NotifyChannel): string[] {
  switch (channel) {
    case "wechat":
    case "email": {
      // wechat/email 渠道用 reminder-renderer 渲染
      const rendered = renderRemindersForChannel(result, channel as ReminderChannel);
      return [rendered];
    }
    case "webhook": {
      // webhook 渠道用 JSON 格式
      return [JSON.stringify(result, null, 2)];
    }
    default:
      throw new Error(`未知渠道: ${channel}`);
  }
}
