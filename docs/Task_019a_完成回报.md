# Task 019a｜基础设施三件套（T1 域名校验 + T3 URL 标准化 + T4 JSON 修复）完成回报

任务编号：Task 019a（Task 019 拆分第 1 份）
所属版本：V0.8（搜索层 + LLM）
日期：2026-06-28
执行方：TRAE IDE
验收方：TRAE Work（总控台）

---

## 1. 任务概述

完成搜索层最底层的 3 个纯函数工具模块，作为 Task 019 后续所有子任务的地基：

- **T1 域名安全校验**：防 SSRF 和链接劫持
- **T3 URL 标准化**：去重前归一化 URL
- **T4 JSON 三重修复兜底**：LLM 输出 JSON 兜底解析

---

## 2. 修改了哪些文件

**无。** 本任务严格遵守"不修改任何现有文件"的约束，仅新增 4 个文件。

---

## 3. 新增了哪些文件

共 **4 个文件**：

| 文件 | 用途 |
|---|---|
| `src/utils/link-validator.ts` | T1 域名安全校验（validateLink / validateLinks） |
| `src/utils/url-normalizer.ts` | T3 URL 标准化（normalizeUrl / normalizeUrls） |
| `src/utils/json-repair.ts` | T4 JSON 三重修复兜底（parseJsonWithRepair / parseJsonStrict） |
| `scripts/verify-task019a.ts` | 验收脚本（覆盖 5.1-5.3，47 项测试） |

---

## 4. 如何本地运行

```bash
# TypeScript 类型检查
npx tsc --noEmit

# Task 019a 验收脚本
npx tsx scripts/verify-task019a.ts

# 集成测试（回归）
npx tsx scripts/integration-test.ts

# 现有验收脚本回归
npx tsx scripts/verify-task014.ts
npx tsx scripts/verify-task015.ts
npx tsx scripts/verify-task016.ts
npx tsx scripts/verify-task018.ts
```

---

## 5. 如何测试

### 5.1 T1 域名安全校验

```typescript
import { validateLink, validateLinks } from "./src/utils/link-validator";

validateLink("https://example.com/path");
// → { valid: true, safeUrl: "https://example.com/path" }

validateLink("http://example.com");
// → { valid: true, reason: "建议使用 HTTPS", safeUrl: "https://example.com" }

validateLink("https://evil.com@legit.com/");
// → { valid: false, reason: "URL 含 userinfo，疑似绕过攻击" }

validateLink("https://192.168.1.1/path");
// → { valid: false, reason: "私有 IP 或 localhost（192.168.1.1），疑似 SSRF 攻击" }

validateLink("https://example.com", "example.com");
// → { valid: true, safeUrl: "https://example.com" }

validateLink("https://evil.com", "example.com");
// → { valid: false, reason: "域名不匹配: 实际=evil.com, 期望=example.com" }
```

校验顺序：
1. 空值 / 格式错误
2. userinfo 绕过（url.username / url.password 非空）
3. 私有 IP / localhost（SSRF 防护）
4. 协议校验（仅允许 http/https）
5. 域名匹配（防链接劫持）
6. HTTP 警告（不拒绝，仅在 reason 中提示）

私有 IP 检测范围：
- 10.0.0.0/8
- 172.16.0.0/12（172.16.x.x ~ 172.31.x.x）
- 192.168.0.0/16
- 127.0.0.0/8（loopback）
- 169.254.0.0/16（link-local）
- 0.0.0.0
- localhost / ::1

### 5.2 T3 URL 标准化

```typescript
import { normalizeUrl } from "./src/utils/url-normalizer";

normalizeUrl("https://example.com/path?utm_source=google&id=123");
// → "https://example.com/path?id=123"

normalizeUrl("https://EXAMPLE.com/path/?b=2&a=1#section");
// → "https://example.com/path?a=1&b=2"

normalizeUrl("https://weibo.com/1234567890/LaBcDeFg?band_rank=1&Refer=SWeibo");
// → "https://weibo.com/1234567890/LaBcDeFg"

normalizeUrl("https://example.com/");
// → "https://example.com"（根路径移除尾部斜杠）

normalizeUrl("http://example.com/path");
// → "https://example.com/path"（升级 https）
```

标准化规则：
1. 统一协议为 https
2. 小写域名
3. 移除 fragment（#anchor）
4. 过滤黑名单参数（追踪参数 + 平台参数）
5. 参数按字母序排序
6. 移除 pathname 尾部斜杠（根路径除外）
7. 根路径移除尾部斜杠

追踪参数黑名单（12 个）：
utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, gclid, ref, source, from, is_from_otherapi, share_source

平台参数黑名单（5 个）：
band_rank, Refer, SWeibo（微博）；xsec_token, xsec_source（小红书）

### 5.3 T4 JSON 三重修复兜底

```typescript
import { parseJsonWithRepair, parseJsonStrict } from "./src/utils/json-repair";

// 第 1 层：标准 JSON
parseJsonWithRepair('{"a":1}');           // → { a: 1 }

// 第 2 层：等效修复
parseJsonWithRepair('{"a":1,}');          // → { a: 1 }（尾逗号）
parseJsonWithRepair("{'a':1}");           // → { a: 1 }（单引号）
parseJsonWithRepair("{a:1}");             // → { a: 1 }（未引号 key）
parseJsonWithRepair('```json\n{"a":1}\n```'); // → { a: 1 }（Markdown）
parseJsonWithRepair('{"a":1');            // → { a: 1 }（截断补全）
parseJsonWithRepair("[1,2,");             // → [1, 2]（数组截断补全）

// 第 3 层：正则提取
parseJsonWithRepair('前文 {"a":1} 后文');  // → { a: 1 }
parseJsonWithRepair("LLM: [{\"x\":1}] 结束"); // → [{x:1}]

// 第 4 层：文本兜底
parseJsonWithRepair("完全不是JSON");       // → { raw: "完全不是JSON" }

// 严格模式
parseJsonStrict('{"a":1}');               // → { a: 1 }
parseJsonStrict('{"a":1,}');              // 抛错
```

修复规则（第 2 层，按顺序应用）：
1. 移除 Markdown 代码块标记（```json ... ```）
2. 截断补全（补全缺失的 `}` 和 `]`）
3. 移除尾逗号（对象和数组末尾的逗号）
4. 单引号转双引号（匹配单引号字符串并转换）
5. 未引号 key 加引号（`{a:1}` → `{"a":1}`）

---

## 6. 哪些功能还没做

| 不做 | 何时做 |
|---|---|
| 调用 T1/T3 的搜索层模块（rule-filter） | Task 019c/019d |
| 调用 T4 的 LLM 模块（ai-filter） | Task 019b/019d |
| HTTP 客户端封装 | Task 019c |
| LLM Adapter | Task 019b |

---

## 7. 下一步建议

继续执行 **Task 019b（LLM QwenAdapter T2T5）**，它将调用本任务的 T4 JSON 修复模块来解析 LLM 输出。

---

## 8. 验证结果

### 8.1 TypeScript 类型检查

```
$ npx tsc --noEmit
（无输出，exit 0）
```

### 8.2 Task 019a 验收脚本

```
$ npx tsx scripts/verify-task019a.ts

=== Task 019a 验收检查 ===

[验收 5.1] T1 域名安全校验
  PASS  https://example.com/path → valid=true
  PASS  https://example.com/path → safeUrl 存在
  PASS  https://example.com/path → reason 为空
  PASS  http://example.com → valid=true
  PASS  http://example.com → reason 含 HTTPS 提示
  PASS  https://evil.com@legit.com/ → valid=false（userinfo 绕过）
  PASS  https://192.168.1.1/path → valid=false（私有 IP）
  PASS  https://localhost/path → valid=false（localhost）
  PASS  https://10.0.0.1/path → valid=false（私有 IP）
  PASS  https://172.16.0.1/path → valid=false（私有 IP）
  PASS  https://example.com + expectedDomain=example.com → valid=true
  PASS  https://evil.com + expectedDomain=example.com → valid=false（域名不匹配）
  PASS  not-a-url → valid=false（格式错误）
  PASS  validateLinks 返回数组长度 2
  PASS  空字符串 → valid=false
  PASS  https://127.0.0.1/path → valid=false（loopback）
  PASS  子域名 sub.example.com + expectedDomain=example.com → valid=true
  PASS  http://example.com → safeUrl 升级为 https
  PASS  LinkValidationResult 接口可用

[验收 5.2] T3 URL 标准化
  PASS  移除 utm_source → https://example.com/path?id=123
  PASS  EXAMPLE.com/path/?b=2&a=1#section → https://example.com/path?a=1&b=2
  PASS  weibo 参数移除 → https://weibo.com/1234567890/LaBcDeFg
  PASS  https://example.com → https://example.com（根路径保留）
  PASS  https://example.com/ → https://example.com（移除尾部斜杠）
  PASS  http://example.com/path → https://example.com/path（升级 https）
  PASS  utm_medium + utm_source 全部移除 → https://example.com/path
  PASS  normalizeUrls 返回数组长度 2
  PASS  无追踪参数 → 标准化后值不变
  PASS  空字符串 → 返回空字符串
  PASS  小红书 xsec_token 移除
  PASS  参数按字母序排序

[验收 5.3] T4 JSON 三重修复兜底
  PASS  第 1 层：{"a":1} → {a:1}
  PASS  第 2 层：{"a":1,} → {a:1}（尾逗号）
  PASS  第 2 层：{'a':1} → {a:1}（单引号）
  PASS  第 2 层：{a:1} → {a:1}（未引号 key）
  PASS  第 2 层：```json\n{...}\n``` → {a:1}（Markdown 代码块）
  PASS  第 2 层：{"a":1 → {a:1}（截断补全）
  PASS  第 2 层：[1,2, → [1,2]（数组截断补全）
  PASS  第 3 层：前文 {"a":1} 后文 → {a:1}（正则提取）
  PASS  第 3 层：LLM 输出: [{...},{...}] 结束 → 数组提取
  PASS  第 4 层：完全不是JSON → {raw: '完全不是JSON'}（文本兜底，不抛错）
  PASS  parseJsonStrict('{"a":1}') → {a:1}
  PASS  parseJsonStrict('{"a":1,}') 抛错（严格模式）
  PASS  空字符串 → {raw: ''}
  PASS  嵌套对象尾逗号：{"a":{"b":1},} → {a:{b:1}}
  PASS  复杂对象单引号：{'name':'test','value':123}
  PASS  未引号 key + 单引号值：{name:'test',age:20}

=== 汇总 ===
Task 019a 验收结果：PASS 47 / FAIL 0
```

### 8.3 集成测试（回归）

```
$ npx tsx scripts/integration-test.ts
================================
Task 017 - V0.7.5 端到端集成测试
================================
...
================================
PASS: 91 / FAIL: 0
================================
```

### 8.4 现有验收脚本回归

```
$ npx tsx scripts/verify-task014.ts
=== 验收汇总 ===
PASS: 143
FAIL: 0

$ npx tsx scripts/verify-task015.ts
=== 验收汇总 ===
PASS: 177
FAIL: 0

$ npx tsx scripts/verify-task016.ts
=== 验收汇总 ===
PASS: 157
FAIL: 0

$ npx tsx scripts/verify-task018.ts
============================================================
Task 018 验收结果：PASS 139 / FAIL 0
============================================================
```

### 8.5 验证结果汇总

| 验证命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx tsx scripts/verify-task019a.ts` | PASS 47 / FAIL 0 |
| `npx tsx scripts/integration-test.ts` | PASS 91 / FAIL 0 |
| `npx tsx scripts/verify-task014.ts` | PASS 143 / FAIL 0 |
| `npx tsx scripts/verify-task015.ts` | PASS 177 / FAIL 0 |
| `npx tsx scripts/verify-task016.ts` | PASS 157 / FAIL 0 |
| `npx tsx scripts/verify-task018.ts` | PASS 139 / FAIL 0 |
| **合计** | **754 项断言全部通过** |

---

## 9. 约束遵守情况

| 约束 | 遵守情况 |
|---|---|
| 不修改任何现有文件 | ✅ 仅新增 4 个文件 |
| 不引入新 npm 依赖 | ✅ 使用 Node.js 内置 URL API 和 JSON.parse |
| 纯函数 | ✅ 3 个模块全部为纯函数，无副作用，无 IO |
| GPL-3.0 约束 | ✅ T4 JSON 修复纯手写，不引入 jsonrepair 库 |
| 边界情况处理 | ✅ 空字符串、null、undefined 入参返回合理结果 |

---

## 10. 验收清单自检

| 验收项 | 自检结果 |
|---|---|
| T1 link-validator.ts 存在且导出正确 | ✅ |
| T1 11 项校验场景全部通过 | ✅（实际 19 项含边界情况） |
| T3 url-normalizer.ts 存在且导出正确 | ✅ |
| T3 9 项标准化场景全部通过 | ✅（实际 12 项含边界情况） |
| T4 json-repair.ts 存在且导出正确 | ✅ |
| T4 12 项修复场景全部通过 | ✅（实际 16 项含边界情况） |
| tsc exit 0 | ✅ |
| verify-task019a 全 PASS | ✅（47 PASS / 0 FAIL） |
| 集成测试全 PASS | ✅（91 PASS / 0 FAIL） |
| 回归测试全 PASS（014/015/016/018） | ✅（143+177+157+139 = 616 PASS） |
| 不修改现有文件 | ✅ |
| 不引入新依赖 | ✅ |
