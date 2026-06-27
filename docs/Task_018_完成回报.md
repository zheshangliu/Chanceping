# Task 018｜i18n 基础设施 完成回报

任务编号：Task 018
所属版本：V0.8（i18n 基础设施）
日期：2026-06-27
执行方：TRAE IDE
验收方：TRAE Work（总控台）

---

## 1. 任务概述

搭建 ChancePing 的 i18n 基础设施，完成 6 项设计点：
1. i18n 核心模块（i18next，框架无关纯 TS）
2. locale 资源文件（zh-CN / en-US，8 命名空间）
3. 硬编码中文抽取（5 个文件）
4. 品牌常量 locale 感知
5. 语言配置中心（SUPPORTED_LOCALES + enabled 开关）
6. 四层数据结构 + 术语表 glossary

---

## 2. 修改的文件

| 文件 | 修改内容 |
|---|---|
| `src/brand/constants.ts` | 将 `as const` 改为 `Brand` interface（string 类型），新增 `BRAND_BY_LOCALE`、`getBrand(locale)`、`getReportTitlePrefix(locale)` |
| `src/schema/opportunity-card.ts` | 新增 `import { t }`，新增 `getCardStatusLabel`、`getCardPriorityLabel`、`getCardSourceLabel` 3 个 locale 感知函数 |
| `src/schema/scoring-rules.ts` | 新增 `import { t }`，新增 `getLevelDefinition(level, locale?)` locale 感知函数 |
| `src/agents/card-template.ts` | 新增 `import { t }`，5 处硬编码改为 `t()` 调用（"未明确"、"需人工复核"、"截止："、daysText） |
| `src/agents/radar-report-generator.ts` | 新增 `import { t }`，10 个章节标题改为 `t()` 调用（section 0-8 + conclusion） |
| `src/agents/confirmation-card-generator.ts` | 新增 `import { t }`，10 个模块标题改为 `t()` 调用（chat.section.identity ~ pleaseConfirm）；修复 forEach 参数 `t` 与 import `t` 的变量遮蔽冲突 |

---

## 3. 新增的文件

### 3.1 i18n 核心模块（3 个文件）

| 文件 | 用途 |
|---|---|
| `src/i18n/config.ts` | 语言配置中心：`SUPPORTED_LOCALES`（7 种语言）、`DEFAULT_LOCALE`、`FALLBACK_LOCALE`、`getEnabledLocales()`、`isLocaleSupported()`、`isLocaleEnabled()` |
| `src/i18n/locales.ts` | i18next 初始化与 `t()` 函数：`initI18n(locale)`（幂等）、`getI18n()`、`t(key, options)`、`setLocale(locale)`、`getLocale()`。模块加载时同步初始化（ensureInitialized 模式） |
| `src/i18n/types.ts` | 四层数据结构 + 术语表：`UserLocaleSettings`（6 字段）、`MultilingualOpportunity`（7 字段）、`GLOSSARY`（zh-CN 12 术语 + en-US 12 术语） |

### 3.2 locale 资源文件（16 个 JSON 文件）

**zh-CN（8 个）：**
- `src/messages/zh-CN/common.json` — 12 个通用 key
- `src/messages/zh-CN/chat.json` — 22 个 key（11 个 chat.confirmation.* + 11 个 chat.section.*）
- `src/messages/zh-CN/radar.json` — 3 个 key
- `src/messages/zh-CN/opportunity.json` — 22 个 key（status×6 + priority×4 + source×4 + card×5 + level×5）
- `src/messages/zh-CN/report.json` — 13 个 key（9 章节标题 + 4 额外）
- `src/messages/zh-CN/settings.json` — 3 个 key
- `src/messages/zh-CN/errors.json` — 3 个 key
- `src/messages/zh-CN/onboarding.json` — 2 个 key

**en-US（8 个）：** 与 zh-CN 完全同结构，值为英文翻译。

### 3.3 验证脚本

| 文件 | 用途 |
|---|---|
| `scripts/verify-task018.ts` | 验收脚本，覆盖 5.1-5.10 + V0.8 自检，共 139 项测试 |

---

## 4. 本地运行

```bash
# TypeScript 编译检查
npx tsc --noEmit

# Task 018 验收
npx tsx scripts/verify-task018.ts

# 集成测试（确保不受影响）
npx tsx scripts/integration-test.ts

# 回归测试
npx tsx scripts/verify-task014.ts
npx tsx scripts/verify-task015.ts
npx tsx scripts/verify-task016.ts
```

---

## 5. 验证结果

### 5.1 npx tsc --noEmit

```
exit code: 0（无错误）
```

### 5.2 npx tsx scripts/verify-task018.ts

```
Task 018 验收结果：PASS 139 / FAIL 0
exit code: 0
```

覆盖验收标准：
- 5.1 i18n 核心模块（config.ts + locales.ts）— 12 项 PASS
- 5.2 locale 资源文件（8 命名空间 × 2 语言）— 6 项 PASS
- 5.3 硬编码中文抽取（3 个文件）— 26 项 PASS
- 5.4 品牌常量 locale 感知 — 10 项 PASS
- 5.5 语言配置中心 — 9 项 PASS
- 5.6 四层数据结构 — 5 项 PASS
- 5.7 术语表 glossary — 6 项 PASS
- 5.8 LABELS locale 感知函数 — 33 项 PASS
- 5.9 编译与引用 — 9 项 PASS
- 5.10 现有功能回归 — 19 项 PASS
- V0.8 验收清单自检 — 8 项 PASS

### 5.3 npx tsx scripts/integration-test.ts

```
PASS: 91 / FAIL: 0
exit code: 0
```

### 5.4 回归测试

| 脚本 | 结果 |
|---|---|
| verify-task014.ts | PASS: 143 / FAIL: 0 |
| verify-task015.ts | PASS: 177 / FAIL: 0 |
| verify-task016.ts | PASS: 157 / FAIL: 0 |

**合计：707 项断言全部通过，0 失败。**

---

## 6. 设计要点

### 6.1 i18next 核心库选型
- 使用 `i18next@^23.7.0` 核心（纯 TS，不依赖 react-i18next / i18next-http-backend）
- 手动 import JSON 资源文件（不依赖 HTTP backend）
- 模块加载时同步初始化（ensureInitialized 模式），确保现有 verify 脚本无需显式 initI18n

### 6.2 8 命名空间合并为单 translation namespace
- key 格式：`{feature}.{context}.{action}`（如 `opportunity.status.new`）
- 8 个 JSON 文件通过 spread operator 合并为单个 translation namespace
- zh-CN 和 en-US 的 key 完全一致（无遗漏）

### 6.3 向后兼容策略
- 现有 `BRAND`、`CARD_STATUS_LABELS`、`CARD_PRIORITY_LABELS`、`CARD_SOURCE_LABELS`、`LEVEL_DEFINITIONS` 常量保留不变
- 新增 locale 感知函数：`getBrand(locale)`、`getCardStatusLabel(status, locale?)`、`getLevelDefinition(level, locale?)` 等
- zh-CN JSON 值 = 现有硬编码值（确保 5.10 回归通过）

### 6.4 四层语言架构
- UI Locale / Report Locale / Search Locale / Source Locale
- `UserLocaleSettings` 接口含 6 字段
- `MultilingualOpportunity` 接口含 7 字段（V1.1 落地，V0.8 预留类型）

### 6.5 术语表 GLOSSARY
- zh-CN：12 个核心术语（zh→en）
- en-US：12 个核心术语（en→zh）
- 覆盖：盯一下/ChancePing、机会雷达/Opportunity Radar、需求确认卡/Requirement Confirmation Card 等

### 6.6 missing key 处理
- `t()` 找不到 key 时返回 key 本身（不抛错）
- 通过 `parseMissingKeyHandler` 配置 `console.warn` 提示

---

## 7. 验收清单自检

| 验收项 | 自检结果 |
|---|---|
| i18n 核心模块（config.ts + locales.ts） | ✅ |
| locale 资源文件（zh-CN/en-US × 8 命名空间） | ✅ |
| 硬编码中文抽取（3 个文件） | ✅ |
| 品牌常量 locale 感知 | ✅ |
| 语言配置中心（SUPPORTED_LOCALES + enabled） | ✅ |
| 四层数据结构 + 术语表 glossary（≥12 术语） | ✅ |
| LABELS locale 感知函数 | ✅ |
| 编译通过（tsc exit 0） | ✅ |
| i18next 依赖已添加 | ✅ |
| 现有功能回归（014/015/016 全 PASS） | ✅ |

---

## 8. 哪些功能还没做

按任务书第 7 节「不在范围内」：
- react-i18next 集成（V0.9）
- Web 语言检测（V0.9）
- 硬编码检查 lint 规则（V0.9）
- 语言切换 UI（V1.0）
- 报告生成 reportLocale 参数（V1.0）
- 机会数据多语字段落地（V1.1）
- 报告中英对照展示（V1.1）
- 多语 locale 翻译（zh-TW/ja-JP 等，V1.2）

---

## 9. 下一步建议

- Task 019：搜索层（可复用 i18n 的 locale 体系做多语搜索）
- 或 V0.9：Web UI + react-i18next 集成
