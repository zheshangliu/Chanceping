/**
 * i18n locale 资源加载与 t() 初始化
 *
 * 来源：Task 018 第 4.1 节。
 *
 * 使用 i18next 核心库（纯 TS，不依赖 react-i18next / i18next-http-backend）。
 * 手动 import JSON 资源文件，模块加载时同步初始化（确保现有代码无需显式 initI18n）。
 *
 * 设计要点：
 *   - 模块加载时同步初始化 i18next（zh-CN 默认）
 *   - initI18n 幂等：多次调用不重复初始化
 *   - t() 找不到 key 时返回 key 本身（不抛错）并输出 console.warn
 *   - 8 命名空间 JSON 合并为单 translation namespace（key 格式：feature.context.action）
 */

import i18next from "i18next";
import { DEFAULT_LOCALE, FALLBACK_LOCALE } from "./config";

// ============================================================
// 资源文件 import（手动加载，不依赖 HTTP backend）
// ============================================================

import zhCNCommon from "../messages/zh-CN/common.json";
import zhCNChat from "../messages/zh-CN/chat.json";
import zhCNRadar from "../messages/zh-CN/radar.json";
import zhCNOpportunity from "../messages/zh-CN/opportunity.json";
import zhCNReport from "../messages/zh-CN/report.json";
import zhCNSettings from "../messages/zh-CN/settings.json";
import zhCNErrors from "../messages/zh-CN/errors.json";
import zhCNOnboarding from "../messages/zh-CN/onboarding.json";

import enUSCommon from "../messages/en-US/common.json";
import enUSChat from "../messages/en-US/chat.json";
import enUSRadar from "../messages/en-US/radar.json";
import enUSOpportunity from "../messages/en-US/opportunity.json";
import enUSReport from "../messages/en-US/report.json";
import enUSSettings from "../messages/en-US/settings.json";
import enUSErrors from "../messages/en-US/errors.json";
import enUSOnboarding from "../messages/en-US/onboarding.json";

// ============================================================
// 类型定义
// ============================================================

export type Locale = string; // 'zh-CN' | 'en-US' | ...

export interface I18nInstance {
  t(key: string, options?: Record<string, unknown>): string;
  changeLanguage(locale: Locale): Promise<void>;
  getLocale(): Locale;
}

// ============================================================
// 资源合并：8 命名空间 JSON → 单 translation namespace
// ============================================================

const zhCNResources = {
  ...zhCNCommon,
  ...zhCNChat,
  ...zhCNRadar,
  ...zhCNOpportunity,
  ...zhCNReport,
  ...zhCNSettings,
  ...zhCNErrors,
  ...zhCNOnboarding,
};

const enUSResources = {
  ...enUSCommon,
  ...enUSChat,
  ...enUSRadar,
  ...enUSOpportunity,
  ...enUSReport,
  ...enUSSettings,
  ...enUSErrors,
  ...enUSOnboarding,
};

// ============================================================
// i18next 初始化（模块加载时同步完成）
// ============================================================

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  i18next.init({
    resources: {
      "zh-CN": { translation: zhCNResources },
      "en-US": { translation: enUSResources },
    },
    lng: DEFAULT_LOCALE,
    fallbackLng: FALLBACK_LOCALE,
    // 找不到 key 时返回 key 本身（不抛错）
    returnNull: false,
    returnEmptyString: false,
    parseMissingKeyHandler: (key: string): string => {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] missing key: ${key}`);
      return key;
    },
  });
  initialized = true;
}

// 模块加载时立即初始化
ensureInitialized();

// ============================================================
// I18nInstance 实现
// ============================================================

const i18nInstance: I18nInstance = {
  t(key: string, options?: Record<string, unknown>): string {
    return i18next.t(key, options as any) as string;
  },
  async changeLanguage(locale: Locale): Promise<void> {
    await i18next.changeLanguage(locale);
  },
  getLocale(): Locale {
    return i18next.language;
  },
};

// ============================================================
// 核心导出函数
// ============================================================

/**
 * 初始化 i18n（幂等：多次调用不重复初始化，只切换语言）。
 *
 * @param locale 目标 locale（默认 zh-CN）
 * @returns i18n 实例
 */
export async function initI18n(locale: Locale = DEFAULT_LOCALE): Promise<I18nInstance> {
  ensureInitialized();
  await i18next.changeLanguage(locale);
  return i18nInstance;
}

/** 获取当前 i18n 实例 */
export function getI18n(): I18nInstance {
  ensureInitialized();
  return i18nInstance;
}

/**
 * 翻译函数。
 * 找不到 key 时返回 key 本身（不抛错），并输出 console.warn。
 *
 * @param key 扁平化 key，如 'opportunity.status.new'
 * @param options 插值参数 / lng 指定 locale
 * @returns 翻译后的字符串
 */
export function t(key: string, options?: Record<string, unknown>): string {
  ensureInitialized();
  return i18next.t(key, options as any) as string;
}

/** 切换当前 locale */
export async function setLocale(locale: Locale): Promise<void> {
  ensureInitialized();
  await i18next.changeLanguage(locale);
}

/** 获取当前 locale */
export function getLocale(): Locale {
  ensureInitialized();
  return i18next.language;
}
