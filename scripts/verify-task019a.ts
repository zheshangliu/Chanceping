/**
 * Task 019a 验收脚本
 *
 * 运行：npx tsx scripts/verify-task019a.ts
 *
 * 覆盖验收标准 5.1-5.3：
 *   5.1 T1 域名安全校验
 *   5.2 T3 URL 标准化
 *   5.3 T4 JSON 三重修复兜底
 */

import {
  validateLink,
  validateLinks,
  type LinkValidationResult,
} from "../src/utils/link-validator";
import {
  normalizeUrl,
  normalizeUrls,
} from "../src/utils/url-normalizer";
import {
  parseJsonWithRepair,
  parseJsonStrict,
} from "../src/utils/json-repair";

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

/** 深度比较两个值（用于 JSON 解析结果对比） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}

// ============================================================
// 验收 5.1：T1 域名安全校验
// ============================================================

console.log("\n=== Task 019a 验收检查 ===\n");
console.log("[验收 5.1] T1 域名安全校验\n");

{
  // 1. 标准 HTTPS URL
  const r1 = validateLink("https://example.com/path");
  check("https://example.com/path → valid=true", r1.valid === true, `valid=${r1.valid}`);
  check("https://example.com/path → safeUrl 存在", r1.safeUrl !== undefined);
  check("https://example.com/path → reason 为空", r1.reason === undefined);

  // 2. HTTP URL（警告但不拒绝）
  const r2 = validateLink("http://example.com");
  check("http://example.com → valid=true", r2.valid === true, `valid=${r2.valid}`);
  check("http://example.com → reason 含 HTTPS 提示",
    r2.reason !== undefined && r2.reason.includes("HTTPS"),
    `reason=${r2.reason}`);

  // 3. userinfo 绕过
  const r3 = validateLink("https://evil.com@legit.com/");
  check("https://evil.com@legit.com/ → valid=false（userinfo 绕过）",
    r3.valid === false, `valid=${r3.valid}`);

  // 4. 私有 IP 192.168.x.x
  const r4 = validateLink("https://192.168.1.1/path");
  check("https://192.168.1.1/path → valid=false（私有 IP）",
    r4.valid === false, `valid=${r4.valid}`);

  // 5. localhost
  const r5 = validateLink("https://localhost/path");
  check("https://localhost/path → valid=false（localhost）",
    r5.valid === false, `valid=${r5.valid}`);

  // 6. 私有 IP 10.x.x.x
  const r6 = validateLink("https://10.0.0.1/path");
  check("https://10.0.0.1/path → valid=false（私有 IP）",
    r6.valid === false, `valid=${r6.valid}`);

  // 7. 私有 IP 172.16.x.x
  const r7 = validateLink("https://172.16.0.1/path");
  check("https://172.16.0.1/path → valid=false（私有 IP）",
    r7.valid === false, `valid=${r7.valid}`);

  // 8. 域名匹配 - 正确
  const r8 = validateLink("https://example.com", "example.com");
  check("https://example.com + expectedDomain=example.com → valid=true",
    r8.valid === true, `valid=${r8.valid}`);

  // 9. 域名匹配 - 不匹配
  const r9 = validateLink("https://evil.com", "example.com");
  check("https://evil.com + expectedDomain=example.com → valid=false（域名不匹配）",
    r9.valid === false, `valid=${r9.valid}`);

  // 10. 格式错误
  const r10 = validateLink("not-a-url");
  check("not-a-url → valid=false（格式错误）",
    r10.valid === false, `valid=${r10.valid}`);

  // 11. 批量校验
  const r11 = validateLinks(["https://a.com", "https://b.com"]);
  check("validateLinks 返回数组长度 2", r11.length === 2, `len=${r11.length}`);

  // 附加边界情况
  const r12 = validateLink("");
  check("空字符串 → valid=false", r12.valid === false);

  const r13 = validateLink("https://127.0.0.1/path");
  check("https://127.0.0.1/path → valid=false（loopback）",
    r13.valid === false);

  const r14 = validateLink("https://sub.example.com/path", "example.com");
  check("子域名 sub.example.com + expectedDomain=example.com → valid=true",
    r14.valid === true, `valid=${r14.valid}`);

  // http → safeUrl 升级为 https
  check("http://example.com → safeUrl 升级为 https",
    r2.safeUrl !== undefined && r2.safeUrl.startsWith("https://"),
    `safeUrl=${r2.safeUrl}`);

  // 导出类型存在性检查
  const result: LinkValidationResult = { valid: true };
  check("LinkValidationResult 接口可用", result.valid === true);
}

// ============================================================
// 验收 5.2：T3 URL 标准化
// ============================================================

console.log("\n[验收 5.2] T3 URL 标准化\n");

{
  // 1. 移除追踪参数
  check(
    '移除 utm_source → https://example.com/path?id=123',
    normalizeUrl("https://example.com/path?utm_source=google&id=123") === "https://example.com/path?id=123",
    `result=${normalizeUrl("https://example.com/path?utm_source=google&id=123")}`,
  );

  // 2. 大小写归一化 + 参数排序 + 移除 fragment + 移除尾部斜杠
  check(
    'EXAMPLE.com/path/?b=2&a=1#section → https://example.com/path?a=1&b=2',
    normalizeUrl("https://EXAMPLE.com/path/?b=2&a=1#section") === "https://example.com/path?a=1&b=2",
    `result=${normalizeUrl("https://EXAMPLE.com/path/?b=2&a=1#section")}`,
  );

  // 3. 微博平台参数移除
  check(
    'weibo 参数移除 → https://weibo.com/1234567890/LaBcDeFg',
    normalizeUrl("https://weibo.com/1234567890/LaBcDeFg?band_rank=1&Refer=SWeibo") === "https://weibo.com/1234567890/LaBcDeFg",
    `result=${normalizeUrl("https://weibo.com/1234567890/LaBcDeFg?band_rank=1&Refer=SWeibo")}`,
  );

  // 4. 根路径保留
  check(
    'https://example.com → https://example.com（根路径保留）',
    normalizeUrl("https://example.com") === "https://example.com",
    `result=${normalizeUrl("https://example.com")}`,
  );

  // 5. 根路径移除尾部斜杠
  check(
    'https://example.com/ → https://example.com（移除尾部斜杠）',
    normalizeUrl("https://example.com/") === "https://example.com",
    `result=${normalizeUrl("https://example.com/")}`,
  );

  // 6. http 升级为 https
  check(
    'http://example.com/path → https://example.com/path（升级 https）',
    normalizeUrl("http://example.com/path") === "https://example.com/path",
    `result=${normalizeUrl("http://example.com/path")}`,
  );

  // 7. 全部追踪参数移除
  check(
    'utm_medium + utm_source 全部移除 → https://example.com/path',
    normalizeUrl("https://example.com/path?utm_medium=email&utm_source=newsletter") === "https://example.com/path",
    `result=${normalizeUrl("https://example.com/path?utm_medium=email&utm_source=newsletter")}`,
  );

  // 8. 批量标准化
  const r8 = normalizeUrls(["https://a.com", "https://b.com"]);
  check("normalizeUrls 返回数组长度 2", r8.length === 2, `len=${r8.length}`);

  // 9. 无追踪参数的 URL 标准化后值不变
  const original = "https://example.com/path?id=123";
  check(
    '无追踪参数 → 标准化后值不变',
    normalizeUrl(original) === original,
    `result=${normalizeUrl(original)}`,
  );

  // 附加边界情况
  check("空字符串 → 返回空字符串", normalizeUrl("") === "");

  // 小红书参数移除
  check(
    '小红书 xsec_token 移除',
    normalizeUrl("https://www.xiaohongshu.com/explore/abc123?xsec_token=xyz&xsec_source=pc_feed") === "https://www.xiaohongshu.com/explore/abc123",
    `result=${normalizeUrl("https://www.xiaohongshu.com/explore/abc123?xsec_token=xyz&xsec_source=pc_feed")}`,
  );

  // 参数排序验证
  check(
    '参数按字母序排序',
    normalizeUrl("https://example.com/path?z=1&a=1&m=1") === "https://example.com/path?a=1&m=1&z=1",
    `result=${normalizeUrl("https://example.com/path?z=1&a=1&m=1")}`,
  );
}

// ============================================================
// 验收 5.3：T4 JSON 三重修复兜底
// ============================================================

console.log("\n[验收 5.3] T4 JSON 三重修复兜底\n");

{
  // 第 1 层：标准 JSON
  const r1 = parseJsonWithRepair('{"a":1}');
  check(
    '第 1 层：{"a":1} → {a:1}',
    deepEqual(r1, { a: 1 }),
    `result=${JSON.stringify(r1)}`,
  );

  // 第 2 层：尾逗号
  const r2 = parseJsonWithRepair('{"a":1,}');
  check(
    '第 2 层：{"a":1,} → {a:1}（尾逗号）',
    deepEqual(r2, { a: 1 }),
    `result=${JSON.stringify(r2)}`,
  );

  // 第 2 层：单引号
  const r3 = parseJsonWithRepair("{'a':1}");
  check(
    "第 2 层：{'a':1} → {a:1}（单引号）",
    deepEqual(r3, { a: 1 }),
    `result=${JSON.stringify(r3)}`,
  );

  // 第 2 层：未引号 key
  const r4 = parseJsonWithRepair("{a:1}");
  check(
    "第 2 层：{a:1} → {a:1}（未引号 key）",
    deepEqual(r4, { a: 1 }),
    `result=${JSON.stringify(r4)}`,
  );

  // 第 2 层：Markdown 代码块
  const r5 = parseJsonWithRepair('```json\n{"a":1}\n```');
  check(
    "第 2 层：```json\\n{...}\\n``` → {a:1}（Markdown 代码块）",
    deepEqual(r5, { a: 1 }),
    `result=${JSON.stringify(r5)}`,
  );

  // 第 2 层：截断补全（对象）
  const r6 = parseJsonWithRepair('{"a":1');
  check(
    '第 2 层：{"a":1 → {a:1}（截断补全）',
    deepEqual(r6, { a: 1 }),
    `result=${JSON.stringify(r6)}`,
  );

  // 第 2 层：截断补全（数组）
  const r7 = parseJsonWithRepair("[1,2,");
  check(
    "第 2 层：[1,2, → [1,2]（数组截断补全）",
    deepEqual(r7, [1, 2]),
    `result=${JSON.stringify(r7)}`,
  );

  // 第 3 层：正则提取对象
  const r8 = parseJsonWithRepair('前文 {"a":1} 后文');
  check(
    '第 3 层：前文 {"a":1} 后文 → {a:1}（正则提取）',
    deepEqual(r8, { a: 1 }),
    `result=${JSON.stringify(r8)}`,
  );

  // 第 3 层：正则提取数组
  const r9 = parseJsonWithRepair("LLM 输出: [{\"x\":1},{\"y\":2}] 结束");
  check(
    "第 3 层：LLM 输出: [{...},{...}] 结束 → 数组提取",
    deepEqual(r9, [{ x: 1 }, { y: 2 }]),
    `result=${JSON.stringify(r9)}`,
  );

  // 第 4 层：文本兜底
  const r10 = parseJsonWithRepair("完全不是JSON");
  check(
    "第 4 层：完全不是JSON → {raw: '完全不是JSON'}（文本兜底，不抛错）",
    deepEqual(r10, { raw: "完全不是JSON" }),
    `result=${JSON.stringify(r10)}`,
  );

  // parseJsonStrict 正常解析
  const r11 = parseJsonStrict('{"a":1}');
  check(
    "parseJsonStrict('{\"a\":1}') → {a:1}",
    deepEqual(r11, { a: 1 }),
    `result=${JSON.stringify(r11)}`,
  );

  // parseJsonStrict 严格模式抛错
  let strictThrew = false;
  try {
    parseJsonStrict('{"a":1,}');
  } catch {
    strictThrew = true;
  }
  check("parseJsonStrict('{\"a\":1,}') 抛错（严格模式）", strictThrew);

  // 附加边界情况
  const r12 = parseJsonWithRepair("");
  check("空字符串 → {raw: ''}", deepEqual(r12, { raw: "" }), `result=${JSON.stringify(r12)}`);

  // 嵌套对象修复
  const r13 = parseJsonWithRepair('{"a":{"b":1},}');
  check(
    '嵌套对象尾逗号：{"a":{"b":1},} → {a:{b:1}}',
    deepEqual(r13, { a: { b: 1 } }),
    `result=${JSON.stringify(r13)}`,
  );

  // 复杂对象单引号修复
  const r14 = parseJsonWithRepair("{'name':'test','value':123}");
  check(
    "复杂对象单引号：{'name':'test','value':123}",
    deepEqual(r14, { name: "test", value: 123 }),
    `result=${JSON.stringify(r14)}`,
  );

  // 未引号 key + 多字段
  const r15 = parseJsonWithRepair("{name:'test',age:20}");
  check(
    "未引号 key + 单引号值：{name:'test',age:20}",
    deepEqual(r15, { name: "test", age: 20 }),
    `result=${JSON.stringify(r15)}`,
  );
}

// ============================================================
// 汇总
// ============================================================

console.log("\n=== 汇总 ===");
console.log(`Task 019a 验收结果：PASS ${passed} / FAIL ${failed}`);

if (failed > 0) {
  process.exit(1);
}
