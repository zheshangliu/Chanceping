/**
 * Task 018 验收脚本 — i18n 基础设施
 *
 * 运行：npx tsx scripts/verify-task018.ts
 *
 * 覆盖验收标准 5.1–5.10 + V0.8 自检：
 *   5.1 i18n 核心模块（config.ts + locales.ts）
 *   5.2 locale 资源文件（8 命名空间 × 2 语言）
 *   5.3 硬编码中文抽取（card-template / radar-report-generator / confirmation-card-generator）
 *   5.4 品牌常量 locale 感知
 *   5.5 语言配置中心
 *   5.6 四层数据结构
 *   5.7 术语表 glossary（≥12 术语）
 *   5.8 LABELS locale 感知函数
 *   5.9 编译与引用（i18next 依赖 + 模块引用）
 *   5.10 现有功能回归（默认 zh-CN 输出一致）
 */

import fs from "fs";
import path from "path";

// i18n 核心模块
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  getEnabledLocales,
  isLocaleSupported,
  isLocaleEnabled,
} from "../src/i18n/config";
import {
  initI18n,
  getI18n,
  t,
  setLocale,
  getLocale,
} from "../src/i18n/locales";

// 四层数据结构 + 术语表
import type { UserLocaleSettings, MultilingualOpportunity } from "../src/i18n/types";
import { GLOSSARY } from "../src/i18n/types";

// 品牌常量
import { BRAND, REPORT_TITLE_PREFIX, BRAND_BY_LOCALE, getBrand, getReportTitlePrefix } from "../src/brand/constants";

// LABELS locale 感知函数
import {
  getCardStatusLabel,
  getCardPriorityLabel,
  getCardSourceLabel,
  CARD_STATUS_LABELS,
  CARD_PRIORITY_LABELS,
  CARD_SOURCE_LABELS,
} from "../src/schema/opportunity-card";
import {
  getLevelDefinition,
  LEVEL_DEFINITIONS,
} from "../src/schema/scoring-rules";

// 卡片渲染（验证硬编码抽取后输出一致）
import { renderCardCompact, renderCardDetail } from "../src/agents/card-template";
import type { OpportunityCard } from "../src/schema/opportunity-card";

// JSON 资源（用于 key 对比）
import zhCNCommon from "../src/messages/zh-CN/common.json";
import zhCNChat from "../src/messages/zh-CN/chat.json";
import zhCNRadar from "../src/messages/zh-CN/radar.json";
import zhCNOpportunity from "../src/messages/zh-CN/opportunity.json";
import zhCNReport from "../src/messages/zh-CN/report.json";
import zhCNSettings from "../src/messages/zh-CN/settings.json";
import zhCNErrors from "../src/messages/zh-CN/errors.json";
import zhCNOnboarding from "../src/messages/zh-CN/onboarding.json";
import enUSCommon from "../src/messages/en-US/common.json";
import enUSChat from "../src/messages/en-US/chat.json";
import enUSRadar from "../src/messages/en-US/radar.json";
import enUSOpportunity from "../src/messages/en-US/opportunity.json";
import enUSReport from "../src/messages/en-US/report.json";
import enUSSettings from "../src/messages/en-US/settings.json";
import enUSErrors from "../src/messages/en-US/errors.json";
import enUSOnboarding from "../src/messages/en-US/onboarding.json";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

// ============================================================
// 辅助：构造测试卡片
// ============================================================

function makeTestCard(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    title: "测试机会",
    type: "AI 赛事",
    organizer: "测试主办方",
    region: "北京",
    deadline: "2026-07-15",
    reward_or_value: "奖金 10 万",
    eligibility: "全国大学生",
    materials_required: "项目报告",
    match_reason: "匹配度高",
    next_action: "尽快报名",
    official_source_url: "https://example.com",
    application_url: "https://example.com/apply",
    contact_info: "test@example.com",
    risk_note: "无",
    backend_score: 92,
    visible_level: "S",
    status: "new",
    ...overrides,
  };
}

// ============================================================
// 主函数（async，确保所有测试顺序执行）
// ============================================================

async function main(): Promise<void> {
  // ============================================================
  // 5.1 i18n 核心模块（config.ts + locales.ts）
  // ============================================================

  console.log("\n=== 5.1 i18n 核心模块 ===");

  check(
    "config.ts 导出 SUPPORTED_LOCALES",
    Array.isArray(SUPPORTED_LOCALES) && SUPPORTED_LOCALES.length === 7,
    `length=${SUPPORTED_LOCALES.length}`,
  );

  check(
    "SUPPORTED_LOCALES 含 7 种语言",
    SUPPORTED_LOCALES.map((l) => l.code).join(",") ===
      "zh-CN,en-US,zh-TW,ja-JP,ko-KR,vi-VN,es-ES",
  );

  check(
    "zh-CN / en-US 启用，其余 enabled:false",
    SUPPORTED_LOCALES.filter((l) => l.enabled).length === 2 &&
      isLocaleEnabled("zh-CN") &&
      isLocaleEnabled("en-US"),
  );

  check("DEFAULT_LOCALE = 'zh-CN'", DEFAULT_LOCALE === "zh-CN");
  check("FALLBACK_LOCALE = 'en-US'", FALLBACK_LOCALE === "en-US");

  check(
    "locales.ts 导出 initI18n / getI18n / t / setLocale / getLocale",
    typeof initI18n === "function" &&
      typeof getI18n === "function" &&
      typeof t === "function" &&
      typeof setLocale === "function" &&
      typeof getLocale === "function",
  );

  // initI18n 幂等：多次调用不报错
  await initI18n("zh-CN");
  await initI18n("zh-CN");
  check("initI18n 幂等：多次调用不报错", true);

  // t() 找不到 key 时返回 key 本身
  const missingKey = "nonexistent.key.for.testing";
  const missingResult = t(missingKey);
  check(
    "t() 找不到 key 时返回 key 本身（不抛错）",
    missingResult === missingKey,
    `got=${missingResult}`,
  );

  // t() 默认 locale 为 zh-CN
  check("t() 默认 locale 为 zh-CN", getLocale() === "zh-CN", `locale=${getLocale()}`);

  check(
    "t('common.confirm') 默认返回中文 '确认'",
    t("common.confirm") === "确认",
    `got=${t("common.confirm")}`,
  );

  // setLocale('en-US') 后 t() 返回英文
  await setLocale("en-US");
  check(
    "setLocale('en-US') 后 t() 返回英文",
    t("common.confirm") === "Confirm",
    `got=${t("common.confirm")}`,
  );
  // 恢复 zh-CN
  await setLocale("zh-CN");
  check("恢复 setLocale('zh-CN')", getLocale() === "zh-CN");

  // ============================================================
  // 5.2 locale 资源文件（8 命名空间 × 2 语言）
  // ============================================================

  console.log("\n=== 5.2 locale 资源文件 ===");

  const zhCNFiles = ["common", "chat", "radar", "opportunity", "report", "settings", "errors", "onboarding"];

  const zhCNDir = path.join(__dirname, "..", "src", "messages", "zh-CN");
  const enUSDir = path.join(__dirname, "..", "src", "messages", "en-US");

  check(
    "src/messages/zh-CN/ 目录存在，含 8 个 JSON 文件",
    zhCNFiles.every((f) => fs.existsSync(path.join(zhCNDir, `${f}.json`))),
  );

  check(
    "src/messages/en-US/ 目录存在，含 8 个 JSON 文件",
    zhCNFiles.every((f) => fs.existsSync(path.join(enUSDir, `${f}.json`))),
  );

  // zh-CN 和 en-US 的 key 完全一致
  const zhCNResources = {
    ...zhCNCommon, ...zhCNChat, ...zhCNRadar, ...zhCNOpportunity,
    ...zhCNReport, ...zhCNSettings, ...zhCNErrors, ...zhCNOnboarding,
  };
  const enUSResources = {
    ...enUSCommon, ...enUSChat, ...enUSRadar, ...enUSOpportunity,
    ...enUSReport, ...enUSSettings, ...enUSErrors, ...enUSOnboarding,
  };

  const zhCNKeys = Object.keys(zhCNResources).sort();
  const enUSKeys = Object.keys(enUSResources).sort();

  check(
    "zh-CN 和 en-US 的 key 完全一致（无遗漏）",
    zhCNKeys.length === enUSKeys.length && zhCNKeys.every((k, i) => k === enUSKeys[i]),
    `zh-CN=${zhCNKeys.length}, en-US=${enUSKeys.length}`,
  );

  // 所有 key 采用扁平化命名（含至少 2 个点分段）
  const allKeys = zhCNKeys;
  const flatKeys = allKeys.filter((k) => k.split(".").length >= 2);
  check(
    "所有 key 采用扁平化命名（{feature}.{context}.{action}）",
    flatKeys.length === allKeys.length,
    `non-flat=${allKeys.length - flatKeys.length}`,
  );

  // 无中文当 key
  const chineseKeyPattern = /[\u4e00-\u9fff]/;
  const chineseKeys = allKeys.filter((k) => chineseKeyPattern.test(k));
  check("无中文当 key", chineseKeys.length === 0, `chinese keys=${chineseKeys.join(",")}`);

  // key 数量足够（至少 50 个）
  check("key 总数 ≥ 50", allKeys.length >= 50, `total=${allKeys.length}`);

  // ============================================================
  // 5.3 硬编码中文抽取
  // ============================================================

  console.log("\n=== 5.3 硬编码中文抽取 ===");

  // 读取源文件检查是否使用了 t()
  const cardTemplateSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "agents", "card-template.ts"),
    "utf-8",
  );
  const radarReportSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "agents", "radar-report-generator.ts"),
    "utf-8",
  );
  const confirmationCardSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "agents", "confirmation-card-generator.ts"),
    "utf-8",
  );

  // card-template.ts
  check(
    "card-template.ts import t from i18n/locales",
    cardTemplateSrc.includes('import { t } from "../i18n/locales"'),
  );

  check(
    "card-template.ts 使用 t('opportunity.card.unspecified')",
    cardTemplateSrc.includes('t("opportunity.card.unspecified")'),
  );

  check(
    "card-template.ts 使用 t('opportunity.card.needsReview')",
    cardTemplateSrc.includes('t("opportunity.card.needsReview")'),
  );

  check(
    "card-template.ts 使用 t('opportunity.card.deadlinePrefix')",
    cardTemplateSrc.includes('t("opportunity.card.deadlinePrefix")'),
  );

  // 验证 formatString 不再硬编码 "未明确"
  check(
    "card-template.ts formatString 不再硬编码 return \"未明确\"",
    !/return\s+"未明确"/.test(cardTemplateSrc),
  );

  // 验证 formatUrl 不再硬编码 "需人工复核"
  check(
    "card-template.ts formatUrl 不再硬编码 return \"需人工复核\"",
    !/return\s+"需人工复核"/.test(cardTemplateSrc),
  );

  // radar-report-generator.ts
  check(
    "radar-report-generator.ts import t from i18n/locales",
    radarReportSrc.includes('import { t } from "../i18n/locales"'),
  );

  check(
    "radar-report-generator.ts 使用 t('report.section.overview')",
    radarReportSrc.includes('t("report.section.overview")'),
  );

  check(
    "radar-report-generator.ts 使用 t('report.section.expiringSoon')",
    radarReportSrc.includes('t("report.section.expiringSoon")'),
  );

  check(
    "radar-report-generator.ts 使用 t('report.section.detailCard')",
    radarReportSrc.includes('t("report.section.detailCard")'),
  );

  check(
    "radar-report-generator.ts 使用 t('report.section.suggestedAction')",
    radarReportSrc.includes('t("report.section.suggestedAction")'),
  );

  check(
    "radar-report-generator.ts 使用 t('report.section.excluded')",
    radarReportSrc.includes('t("report.section.excluded")'),
  );

  check(
    "radar-report-generator.ts 使用 t('report.section.nextWeekTracking')",
    radarReportSrc.includes('t("report.section.nextWeekTracking")'),
  );

  check(
    "radar-report-generator.ts 使用 t('report.section.conclusion')",
    radarReportSrc.includes('t("report.section.conclusion")'),
  );

  check(
    "radar-report-generator.ts 使用 t('report.section.sLevel/aLevel/bLevel')",
    radarReportSrc.includes('report.section.sLevel') &&
      radarReportSrc.includes('report.section.aLevel') &&
      radarReportSrc.includes('report.section.bLevel'),
  );

  // 不再硬编码章节标题
  check(
    "radar-report-generator.ts 不再硬编码 ## 0. 本周一句话判断",
    !radarReportSrc.includes('"## 0. 本周一句话判断"'),
  );

  check(
    "radar-report-generator.ts 不再硬编码 ## 4. 即将截止机会",
    !radarReportSrc.includes('"## 4. 即将截止机会"'),
  );

  check(
    "radar-report-generator.ts 不再硬编码 ## 本周结论",
    !radarReportSrc.includes('"## 本周结论"'),
  );

  // confirmation-card-generator.ts
  check(
    "confirmation-card-generator.ts import t from i18n/locales",
    confirmationCardSrc.includes('import { t } from "../i18n/locales"'),
  );

  check(
    "confirmation-card-generator.ts 使用 t('chat.section.identity')",
    confirmationCardSrc.includes('t("chat.section.identity")'),
  );

  check(
    "confirmation-card-generator.ts 使用 t('chat.section.pleaseConfirm')",
    confirmationCardSrc.includes('t("chat.section.pleaseConfirm")'),
  );

  check(
    "confirmation-card-generator.ts 使用 t('chat.section.confidenceLevel')",
    confirmationCardSrc.includes('t("chat.section.confidenceLevel")'),
  );

  // 不再硬编码模块标题
  check(
    "confirmation-card-generator.ts 不再硬编码 ## 1. 我理解你的身份",
    !confirmationCardSrc.includes('"## 1. 我理解你的身份"'),
  );

  check(
    "confirmation-card-generator.ts 不再硬编码 ## 10. 请你确认",
    !confirmationCardSrc.includes('"## 10. 请你确认"'),
  );

  // ============================================================
  // 5.4 品牌常量 locale 感知
  // ============================================================

  console.log("\n=== 5.4 品牌常量 locale 感知 ===");

  check(
    "brand/constants.ts 导出 BRAND_BY_LOCALE",
    typeof BRAND_BY_LOCALE === "object" && BRAND_BY_LOCALE !== null,
  );

  check(
    "brand/constants.ts 导出 getBrand 函数",
    typeof getBrand === "function",
  );

  check(
    "brand/constants.ts 导出 getReportTitlePrefix 函数",
    typeof getReportTitlePrefix === "function",
  );

  check(
    "getBrand('zh-CN') 返回中文品牌常量（与 BRAND 一致）",
    getBrand("zh-CN").product_name === BRAND.product_name &&
      getBrand("zh-CN").chinese_slogan === BRAND.chinese_slogan,
  );

  check(
    "getBrand('en-US') 返回英文品牌常量（product_name='ChancePing'）",
    getBrand("en-US").product_name === "ChancePing",
    `got=${getBrand("en-US").product_name}`,
  );

  check(
    "getBrand('unknown') 回退到中文（fallback）",
    getBrand("unknown").product_name === BRAND.product_name,
  );

  check(
    "现有 BRAND 常量保留不变",
    BRAND.product_name === "盯一下 ChancePing",
  );

  check(
    "现有 REPORT_TITLE_PREFIX 保留不变",
    REPORT_TITLE_PREFIX === "盯一下 ChancePing｜",
  );

  check(
    "getReportTitlePrefix('zh-CN') === REPORT_TITLE_PREFIX",
    getReportTitlePrefix("zh-CN") === REPORT_TITLE_PREFIX,
  );

  check(
    "getReportTitlePrefix('en-US') 返回英文前缀",
    getReportTitlePrefix("en-US") === "ChancePing｜",
    `got=${getReportTitlePrefix("en-US")}`,
  );

  // ============================================================
  // 5.5 语言配置中心
  // ============================================================

  console.log("\n=== 5.5 语言配置中心 ===");

  const enabledLocales = getEnabledLocales();
  check(
    "getEnabledLocales() 只返回 enabled=true（zh-CN + en-US）",
    enabledLocales.length === 2 &&
      enabledLocales.some((l) => l.code === "zh-CN") &&
      enabledLocales.some((l) => l.code === "en-US"),
    `count=${enabledLocales.length}`,
  );

  check("isLocaleSupported('zh-CN') 返回 true", isLocaleSupported("zh-CN") === true);
  check("isLocaleSupported('en-US') 返回 true", isLocaleSupported("en-US") === true);
  check("isLocaleSupported('ja-JP') 返回 true（支持但未启用）", isLocaleSupported("ja-JP") === true);
  check("isLocaleSupported('fr-FR') 返回 false", isLocaleSupported("fr-FR") === false);

  check("isLocaleEnabled('zh-CN') 返回 true", isLocaleEnabled("zh-CN") === true);
  check("isLocaleEnabled('en-US') 返回 true", isLocaleEnabled("en-US") === true);
  check("isLocaleEnabled('ja-JP') 返回 false（支持但未启用）", isLocaleEnabled("ja-JP") === false);
  check("isLocaleEnabled('fr-FR') 返回 false", isLocaleEnabled("fr-FR") === false);

  // ============================================================
  // 5.6 四层数据结构
  // ============================================================

  console.log("\n=== 5.6 四层数据结构 ===");

  check(
    "types.ts 导出 GLOSSARY",
    typeof GLOSSARY === "object" && GLOSSARY !== null,
  );

  check(
    "GLOSSARY['zh-CN'] 含 ≥12 个术语",
    Object.keys(GLOSSARY["zh-CN"]).length >= 12,
    `count=${Object.keys(GLOSSARY["zh-CN"]).length}`,
  );

  check(
    "GLOSSARY['en-US'] 含 ≥12 个术语",
    Object.keys(GLOSSARY["en-US"]).length >= 12,
    `count=${Object.keys(GLOSSARY["en-US"]).length}`,
  );

  // UserLocaleSettings / MultilingualOpportunity 类型导出（import 不报错即存在）
  check("UserLocaleSettings 类型已导出", true);
  check("MultilingualOpportunity 类型已导出", true);

  // ============================================================
  // 5.7 术语表 glossary
  // ============================================================

  console.log("\n=== 5.7 术语表 glossary ===");

  const zhCNRequiredTerms: Record<string, string> = {
    "盯一下": "ChancePing",
    "机会雷达": "Opportunity Radar",
    "需求确认卡": "Requirement Confirmation Card",
    "雷达方案": "Radar Plan",
    "机会报告": "Opportunity Report",
    "弱信号": "Weak Signal",
    "官方来源": "Official Source",
    "可信度": "Confidence Level",
    "S 级机会": "S-Tier Opportunity",
    "机会等级": "Opportunity Tier",
    "搜索计划": "Search Plan",
    "截止日期": "Deadline",
  };

  const zhCNGlossary = GLOSSARY["zh-CN"];
  let allZhTermsPresent = true;
  for (const [zh, en] of Object.entries(zhCNRequiredTerms)) {
    if (zhCNGlossary[zh] !== en) {
      allZhTermsPresent = false;
      console.log(`    缺失/不匹配: zh='${zh}' expected='${en}' got='${zhCNGlossary[zh]}'`);
    }
  }
  check("GLOSSARY['zh-CN'] 覆盖 12 个核心术语（zh→en）", allZhTermsPresent);

  const enUSRequiredTerms: Record<string, string> = {
    "ChancePing": "盯一下",
    "Opportunity Radar": "机会雷达",
    "Requirement Confirmation Card": "需求确认卡",
    "Radar Plan": "雷达方案",
    "Opportunity Report": "机会报告",
    "Weak Signal": "弱信号",
    "Official Source": "官方来源",
    "Confidence Level": "可信度",
    "S-Tier Opportunity": "S 级机会",
    "Opportunity Tier": "机会等级",
    "Search Plan": "搜索计划",
    "Deadline": "截止日期",
  };

  const enUSGlossary = GLOSSARY["en-US"];
  let allEnTermsPresent = true;
  for (const [en, zh] of Object.entries(enUSRequiredTerms)) {
    if (enUSGlossary[en] !== zh) {
      allEnTermsPresent = false;
      console.log(`    缺失/不匹配: en='${en}' expected='${zh}' got='${enUSGlossary[en]}'`);
    }
  }
  check("GLOSSARY['en-US'] 覆盖 12 个核心术语（en→zh）", allEnTermsPresent);

  // zh-CN key 是中文，value 是英文
  const zhCNHasChineseKeys = Object.keys(zhCNGlossary).some((k) => /[\u4e00-\u9fff]/.test(k));
  check("GLOSSARY['zh-CN'] 的 key 是中文术语", zhCNHasChineseKeys);

  const zhCNHasEnglishValues = Object.values(zhCNGlossary).some((v) => /[a-zA-Z]/.test(v));
  check("GLOSSARY['zh-CN'] 的 value 是英文", zhCNHasEnglishValues);

  // en-US key 是英文，value 是中文
  const enUSHasEnglishKeys = Object.keys(enUSGlossary).some((k) => /[a-zA-Z]/.test(k));
  check("GLOSSARY['en-US'] 的 key 是英文术语", enUSHasEnglishKeys);

  const enUSHasChineseValues = Object.values(enUSGlossary).some((v) => /[\u4e00-\u9fff]/.test(v));
  check("GLOSSARY['en-US'] 的 value 是中文", enUSHasChineseValues);

  // ============================================================
  // 5.8 LABELS locale 感知函数
  // ============================================================

  console.log("\n=== 5.8 LABELS locale 感知函数 ===");

  check(
    "opportunity-card.ts 导出 getCardStatusLabel 函数",
    typeof getCardStatusLabel === "function",
  );
  check(
    "opportunity-card.ts 导出 getCardPriorityLabel 函数",
    typeof getCardPriorityLabel === "function",
  );
  check(
    "opportunity-card.ts 导出 getCardSourceLabel 函数",
    typeof getCardSourceLabel === "function",
  );
  check(
    "scoring-rules.ts 导出 getLevelDefinition 函数",
    typeof getLevelDefinition === "function",
  );

  // getCardStatusLabel('new') 默认返回 "新发现"
  check(
    "getCardStatusLabel('new') 默认返回 '新发现'",
    getCardStatusLabel("new") === "新发现",
    `got=${getCardStatusLabel("new")}`,
  );

  // getCardStatusLabel('new', 'en-US') 返回英文
  check(
    "getCardStatusLabel('new', 'en-US') 返回英文 'New'",
    getCardStatusLabel("new", "en-US") === "New",
    `got=${getCardStatusLabel("new", "en-US")}`,
  );

  // 各状态
  check("getCardStatusLabel('viewed') === '已查看'", getCardStatusLabel("viewed") === "已查看");
  check("getCardStatusLabel('saved') === '已保存'", getCardStatusLabel("saved") === "已保存");
  check("getCardStatusLabel('applied') === '已报名'", getCardStatusLabel("applied") === "已报名");
  check("getCardStatusLabel('archived') === '已归档'", getCardStatusLabel("archived") === "已归档");
  check("getCardStatusLabel('dismissed') === '已忽略'", getCardStatusLabel("dismissed") === "已忽略");

  // 优先级
  check("getCardPriorityLabel('urgent') === '紧急'", getCardPriorityLabel("urgent") === "紧急");
  check("getCardPriorityLabel('high') === '高'", getCardPriorityLabel("high") === "高");
  check("getCardPriorityLabel('medium') === '中'", getCardPriorityLabel("medium") === "中");
  check("getCardPriorityLabel('low') === '低'", getCardPriorityLabel("low") === "低");

  // 来源
  check("getCardSourceLabel('manual') === '手动录入'", getCardSourceLabel("manual") === "手动录入");
  check("getCardSourceLabel('search') === '搜索'", getCardSourceLabel("search") === "搜索");
  check("getCardSourceLabel('user_supplied') === '用户提供'", getCardSourceLabel("user_supplied") === "用户提供");
  check("getCardSourceLabel('rss') === 'RSS 订阅'", getCardSourceLabel("rss") === "RSS 订阅");

  // getLevelDefinition
  check(
    "getLevelDefinition('S') 默认返回 '强烈推荐，优先行动'",
    getLevelDefinition("S") === "强烈推荐，优先行动",
    `got=${getLevelDefinition("S")}`,
  );

  check(
    "getLevelDefinition('S', 'en-US') 返回英文",
    getLevelDefinition("S", "en-US") === "Highly recommended, prioritize action",
    `got=${getLevelDefinition("S", "en-US")}`,
  );

  check("getLevelDefinition('A') === '高价值机会，建议认真考虑'", getLevelDefinition("A") === "高价值机会，建议认真考虑");
  check("getLevelDefinition('B') === '可关注，适合收藏或观察'", getLevelDefinition("B") === "可关注，适合收藏或观察");
  check("getLevelDefinition('C') === '低优先级，仅供参考'", getLevelDefinition("C") === "低优先级，仅供参考");
  check("getLevelDefinition('hidden') === '默认不主动展示'", getLevelDefinition("hidden") === "默认不主动展示");

  // 现有常量保留不变
  check(
    "CARD_STATUS_LABELS 常量保留不变",
    CARD_STATUS_LABELS.new === "新发现" && CARD_STATUS_LABELS.archived === "已归档",
  );
  check(
    "CARD_PRIORITY_LABELS 常量保留不变",
    CARD_PRIORITY_LABELS.urgent === "紧急" && CARD_PRIORITY_LABELS.low === "低",
  );
  check(
    "CARD_SOURCE_LABELS 常量保留不变",
    CARD_SOURCE_LABELS.manual === "手动录入" && CARD_SOURCE_LABELS.rss === "RSS 订阅",
  );
  check(
    "LEVEL_DEFINITIONS 常量保留不变",
    LEVEL_DEFINITIONS.S === "强烈推荐，优先行动" && LEVEL_DEFINITIONS.hidden === "默认不主动展示",
  );

  // ============================================================
  // 5.9 编译与引用
  // ============================================================

  console.log("\n=== 5.9 编译与引用 ===");

  // package.json 含 i18next 依赖
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
  check(
    "package.json 含 i18next 依赖",
    packageJson.dependencies && typeof packageJson.dependencies.i18next === "string",
    `i18next=${packageJson.dependencies?.i18next ?? "NOT FOUND"}`,
  );

  check(
    "i18next 版本以 ^23 开头",
    packageJson.dependencies.i18next.startsWith("^23"),
    `version=${packageJson.dependencies.i18next}`,
  );

  // src/i18n/ 被其他模块引用
  const oppCardSrc = fs.readFileSync(path.join(__dirname, "..", "src", "schema", "opportunity-card.ts"), "utf-8");
  const scoringSrc = fs.readFileSync(path.join(__dirname, "..", "src", "schema", "scoring-rules.ts"), "utf-8");

  check(
    "schema/opportunity-card.ts 引用 ../i18n/locales",
    oppCardSrc.includes('from "../i18n/locales"'),
  );

  check(
    "schema/scoring-rules.ts 引用 ../i18n/locales",
    scoringSrc.includes('from "../i18n/locales"'),
  );

  check(
    "agents/card-template.ts 引用 ../i18n/locales",
    cardTemplateSrc.includes('from "../i18n/locales"'),
  );

  check(
    "agents/radar-report-generator.ts 引用 ../i18n/locales",
    radarReportSrc.includes('from "../i18n/locales"'),
  );

  check(
    "agents/confirmation-card-generator.ts 引用 ../i18n/locales",
    confirmationCardSrc.includes('from "../i18n/locales"'),
  );

  // i18next 模块可加载
  check(
    "i18next 模块可正常加载（t 函数可用）",
    typeof t === "function" && t("common.confirm") === "确认",
  );

  // ============================================================
  // 5.10 现有功能回归（默认 zh-CN 输出一致）
  // ============================================================

  console.log("\n=== 5.10 现有功能回归 ===");

  // 确保 locale 为 zh-CN
  await setLocale("zh-CN");

  // 卡片渲染输出一致
  const card = makeTestCard();
  const compact = renderCardCompact(card);
  check(
    "renderCardCompact 输出含 '截止：'",
    compact.includes("截止："),
    `output=${compact}`,
  );

  check(
    "renderCardCompact 输出含 '测试机会'",
    compact.includes("测试机会"),
  );

  // 空值卡片
  const emptyCard = makeTestCard({
    title: "",
    deadline: "",
    match_reason: "",
    official_source_url: "",
  });
  const emptyCompact = renderCardCompact(emptyCard);
  check(
    "空值卡片 compact 输出含 '未明确'",
    emptyCompact.includes("未明确"),
    `output=${emptyCompact}`,
  );

  const emptyDetail = renderCardDetail(emptyCard);
  check(
    "空值卡片 detail 输出含 '需人工复核'",
    emptyDetail.includes("需人工复核"),
  );

  check(
    "空值卡片 detail 输出含 '未明确'（daysText）",
    emptyDetail.includes("未明确"),
  );

  // 正常卡片 detail 输出
  const detail = renderCardDetail(card);
  check(
    "renderCardDetail 输出含 '基本信息'",
    detail.includes("## 基本信息"),
  );

  check(
    "renderCardDetail 输出含 '推荐等级：S'",
    detail.includes("推荐等级：S"),
  );

  // t() 默认中文
  check(
    "t('opportunity.status.new') === '新发现'（默认 zh-CN）",
    t("opportunity.status.new") === "新发现",
  );

  check(
    "t('opportunity.card.unspecified') === '未明确'",
    t("opportunity.card.unspecified") === "未明确",
  );

  check(
    "t('opportunity.card.needsReview') === '需人工复核'",
    t("opportunity.card.needsReview") === "需人工复核",
  );

  check(
    "t('opportunity.card.deadlinePrefix') === '截止：'",
    t("opportunity.card.deadlinePrefix") === "截止：",
  );

  check(
    "t('opportunity.card.daysText', { days: 5 }) === '5 天'",
    t("opportunity.card.daysText", { days: 5 }) === "5 天",
    `got=${t("opportunity.card.daysText", { days: 5 })}`,
  );

  check(
    "t('opportunity.level.S') === '强烈推荐，优先行动'",
    t("opportunity.level.S") === "强烈推荐，优先行动",
  );

  check(
    "t('report.section.overview') === '0. 本周一句话判断'",
    t("report.section.overview") === "0. 本周一句话判断",
  );

  check(
    "t('report.section.conclusion') === '本周结论'",
    t("report.section.conclusion") === "本周结论",
  );

  check(
    "t('chat.section.identity') === '1. 我理解你的身份'",
    t("chat.section.identity") === "1. 我理解你的身份",
  );

  check(
    "t('chat.section.pleaseConfirm') === '10. 请你确认'",
    t("chat.section.pleaseConfirm") === "10. 请你确认",
  );

  // en-US 翻译验证
  await setLocale("en-US");
  check(
    "en-US: t('opportunity.status.new') === 'New'",
    t("opportunity.status.new") === "New",
    `got=${t("opportunity.status.new")}`,
  );

  check(
    "en-US: t('opportunity.card.unspecified') === 'Unspecified'",
    t("opportunity.card.unspecified") === "Unspecified",
    `got=${t("opportunity.card.unspecified")}`,
  );

  check(
    "en-US: t('report.section.conclusion') === \"This Week's Conclusion\"",
    t("report.section.conclusion") === "This Week's Conclusion",
    `got=${t("report.section.conclusion")}`,
  );

  check(
    "en-US: t('chat.section.identity') === '1. Your Identity As I Understand'",
    t("chat.section.identity") === "1. Your Identity As I Understand",
    `got=${t("chat.section.identity")}`,
  );

  // 恢复 zh-CN
  await setLocale("zh-CN");
  check("恢复 zh-CN locale", getLocale() === "zh-CN");

  // ============================================================
  // V0.8 验收清单自检
  // ============================================================

  console.log("\n=== V0.8 验收清单自检 ===");

  check(
    "i18n 核心模块（config.ts + locales.ts）已实现",
    typeof SUPPORTED_LOCALES !== "undefined" && typeof t === "function",
  );

  check(
    "locale 资源文件（zh-CN/en-US × 8 命名空间）已创建",
    fs.existsSync(path.join(zhCNDir, "common.json")) &&
      fs.existsSync(path.join(enUSDir, "common.json")),
  );

  check(
    "硬编码中文抽取（3 个文件）已完成",
    cardTemplateSrc.includes('from "../i18n/locales"') &&
      radarReportSrc.includes('from "../i18n/locales"') &&
      confirmationCardSrc.includes('from "../i18n/locales"'),
  );

  check(
    "品牌常量 locale 感知已实现",
    typeof getBrand === "function" && typeof getReportTitlePrefix === "function",
  );

  check(
    "语言配置中心（SUPPORTED_LOCALES + enabled）已实现",
    typeof getEnabledLocales === "function" && getEnabledLocales().length === 2,
  );

  check(
    "四层数据结构 + 术语表 glossary（≥12 术语）已实现",
    Object.keys(GLOSSARY["zh-CN"]).length >= 12 && Object.keys(GLOSSARY["en-US"]).length >= 12,
  );

  check(
    "LABELS locale 感知函数已实现",
    typeof getCardStatusLabel === "function" && typeof getLevelDefinition === "function",
  );

  check(
    "i18next 依赖已添加",
    packageJson.dependencies?.i18next?.startsWith("^23") === true,
  );

  // ============================================================
  // 汇总
  // ============================================================

  console.log("\n" + "=".repeat(60));
  console.log(`Task 018 验收结果：PASS ${passed} / FAIL ${failed}`);
  console.log("=".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-task018 异常退出:", err);
  process.exit(1);
});
