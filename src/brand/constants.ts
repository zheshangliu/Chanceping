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
} as const;

export type Brand = typeof BRAND;

/**
 * 报告标题前缀，由产品名派生，避免硬编码产品名。
 * 取自 03 号文档第 11 节：report_title_prefix = "盯一下 ChancePing｜"
 */
export const REPORT_TITLE_PREFIX = `${BRAND.product_name}｜`;
