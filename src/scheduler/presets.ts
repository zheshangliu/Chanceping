/**
 * 5 种预设模板（PresetTemplate）
 *
 * 来源：Task 028 第 5.3 节。
 *
 * 模板清单：
 *   1. daily_morning    - 每日早报（08:00 搜索）
 *   2. weekly_report    - 每周周报（周一 09:00 报告）
 *   3. deadline_alert   - 截止提醒（每日 18:00 提醒）
 *   4. realtime         - 实时监控（每小时搜索）
 *   5. competition_mode - 参赛模式（每 4 小时搜索 3 种雷达）
 */

import type { PresetTemplate } from "./types";

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: "daily_morning",
    name: "每日早报",
    description: "每日 08:00 搜索新机会 + 生成机会列表",
    periods: [
      {
        id: "daily_morning_search",
        time: "08:00",
        day_of_week: null,
        job_type: "search",
        job_params: { radar_type: "ai_competition", max_results: 20 },
        enabled: true,
      },
    ],
  },
  {
    id: "weekly_report",
    name: "每周周报",
    description: "每周一 09:00 生成周报",
    periods: [
      {
        id: "weekly_report_gen",
        time: "09:00",
        day_of_week: 1, // 周一
        job_type: "report",
        job_params: { report_type: "weekly", max_items: 10 },
        enabled: true,
      },
    ],
  },
  {
    id: "deadline_alert",
    name: "截止提醒",
    description: "每日 18:00 检查截止提醒",
    periods: [
      {
        id: "deadline_alert_check",
        time: "18:00",
        day_of_week: null,
        job_type: "reminder",
        job_params: { levels: ["urgent", "soon"] },
        enabled: true,
      },
    ],
  },
  {
    id: "realtime",
    name: "实时监控",
    description: "每小时整点搜索一次（高频）",
    periods: [
      {
        id: "realtime_search",
        time: "*:00", // 每小时整点
        day_of_week: null,
        job_type: "search",
        job_params: { radar_type: "ai_competition", max_results: 10 },
        enabled: true,
      },
    ],
  },
  {
    id: "competition_mode",
    name: "参赛模式",
    description: "每 4 小时搜索（08/12/16/20）覆盖 3 种雷达类型",
    periods: [
      {
        id: "competition_search_1",
        time: "08:00",
        day_of_week: null,
        job_type: "search",
        job_params: { radar_type: "ai_competition", max_results: 15 },
        enabled: true,
      },
      {
        id: "competition_search_2",
        time: "12:00",
        day_of_week: null,
        job_type: "search",
        job_params: { radar_type: "opc_policy", max_results: 15 },
        enabled: true,
      },
      {
        id: "competition_search_3",
        time: "16:00",
        day_of_week: null,
        job_type: "search",
        job_params: { radar_type: "cultural_heritage", max_results: 15 },
        enabled: true,
      },
      {
        id: "competition_search_4",
        time: "20:00",
        day_of_week: null,
        job_type: "search",
        job_params: { radar_type: "ai_competition", max_results: 15 },
        enabled: true,
      },
    ],
  },
];

/** 按 ID 获取预设模板 */
export function getPresetById(id: string): PresetTemplate | undefined {
  return PRESET_TEMPLATES.find((p) => p.id === id);
}

/** 获取全部预设模板 */
export function listPresets(): PresetTemplate[] {
  return [...PRESET_TEMPLATES];
}
