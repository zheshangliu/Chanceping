/**
 * 盯一下 ChancePing 品牌常量（单一来源）
 *
 * 全项目产品名、Slogan、CTA 必须从此文件引用，不得在其它代码中硬编码。
 * 取值来源：《盯一下 ChancePing V0.12 品牌统一规范》（05 号文档）。
 */
export const BRAND = {
  /** 产品正式名称 */
  product_name: "盯一下 ChancePing",
  /** 产品类型 */
  product_category: "AI 机会雷达系统",
  /** 中文 Slogan */
  chinese_slogan: "盯一下，好机会不错过。",
  /** 备用中文 Slogan */
  alternate_chinese_slogan: "盯一下，机会就来了。",
  /** 英文 Slogan */
  english_slogan: "Good opportunities, right on time.",
  /** 首页一句话 */
  homepage_one_liner:
    "Tell AI what to watch. ChancePing finds the right opportunities and pings you at the right time.",
  /** 主按钮文案（中文 CTA） */
  primary_cta: "帮我盯一下",
  /** 英文按钮文案（英文 CTA） */
  secondary_cta: "Ping me when it matters",
};

/** 品牌常量类型（使用 string 而非字面量，便于 locale 感知函数返回不同值） */
export interface Brand {
  product_name: string;
  product_category: string;
  chinese_slogan: string;
  alternate_chinese_slogan: string;
  english_slogan: string;
  homepage_one_liner: string;
  primary_cta: string;
  secondary_cta: string;
}

/**
 * 报告标题前缀，由产品名派生，避免硬编码产品名。
 * 取自 03 号文档第 11 节：report_title_prefix = "盯一下 ChancePing｜"
 */
export const REPORT_TITLE_PREFIX = `${BRAND.product_name}｜`;

// ============================================================
// locale 感知品牌常量（Task 018 新增，向后兼容）
// ============================================================

/** 按 locale 划分的品牌常量（zh-CN 与现有 BRAND 一致，en-US 为英文版本） */
export const BRAND_BY_LOCALE: Record<string, Brand> = {
  "zh-CN": {
    ...BRAND, // 现有中文值不变
  },
  "en-US": {
    product_name: "ChancePing",
    product_category: "AI Opportunity Radar",
    chinese_slogan: "盯一下，好机会不错过。",
    alternate_chinese_slogan: "盯一下，机会就来了。",
    english_slogan: "Good opportunities, right on time.",
    homepage_one_liner:
      "Tell AI what to watch. ChancePing finds the right opportunities and pings you at the right time.",
    primary_cta: "Ping me when it matters",
    secondary_cta: "帮我盯一下",
  },
};

/** 获取指定 locale 的品牌常量（不支持的 locale 回退到中文 BRAND） */
export function getBrand(locale: string = "zh-CN"): Brand {
  return BRAND_BY_LOCALE[locale] ?? BRAND;
}

/** 获取指定 locale 的报告标题前缀（如 "盯一下 ChancePing｜" 或 "ChancePing｜"） */
export function getReportTitlePrefix(locale: string = "zh-CN"): string {
  const brand = getBrand(locale);
  return `${brand.product_name}｜`;
}
