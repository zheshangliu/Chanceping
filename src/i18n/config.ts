/**
 * i18n 语言配置中心
 *
 * 来源：Task 018 第 4.1 节。
 *
 * 维护支持的 locale 列表与启用状态。
 * zh-CN / en-US 启用，其余语言预留（enabled: false），待 V1.2+ 启用。
 */

export interface LocaleConfig {
  /** locale 代码，如 'zh-CN' */
  code: string;
  /** 展示名称，如 '简体中文' */
  label: string;
  /** 是否启用（未启用的 locale 不允许在 UI 中选择） */
  enabled: boolean;
}

/** 支持的 locale 列表（7 种语言，zh-CN/en-US 启用，其余 enabled:false） */
export const SUPPORTED_LOCALES: LocaleConfig[] = [
  { code: "zh-CN", label: "简体中文", enabled: true },
  { code: "en-US", label: "English", enabled: true },
  { code: "zh-TW", label: "繁體中文", enabled: false },
  { code: "ja-JP", label: "日本語", enabled: false },
  { code: "ko-KR", label: "한국어", enabled: false },
  { code: "vi-VN", label: "Tiếng Việt", enabled: false },
  { code: "es-ES", label: "Español", enabled: false },
];

/** 默认 locale（不显式调用 setLocale 时使用） */
export const DEFAULT_LOCALE = "zh-CN" as const;

/** 回退 locale（当 key 在当前 locale 缺失时使用） */
export const FALLBACK_LOCALE = "en-US" as const;

/** 返回所有启用的 locale（enabled=true） */
export function getEnabledLocales(): LocaleConfig[] {
  return SUPPORTED_LOCALES.filter((l) => l.enabled);
}

/** 判断 locale 是否被支持（在 SUPPORTED_LOCALES 列表中，无论是否 enabled） */
export function isLocaleSupported(locale: string): boolean {
  return SUPPORTED_LOCALES.some((l) => l.code === locale);
}

/** 判断 locale 是否已启用（在列表中且 enabled=true） */
export function isLocaleEnabled(locale: string): boolean {
  return SUPPORTED_LOCALES.some((l) => l.code === locale && l.enabled);
}
