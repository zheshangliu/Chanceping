/**
 * T3 URL 标准化
 *
 * 来源：Task 019a 第 4.2 节。
 *
 * 去重前必须归一化 URL，否则同一页面不同参数顺序会误判为不同。
 * 标准化规则：
 *   - 移除追踪参数（utm_*, fbclid, gclid, ref, source 等）
 *   - 移除平台参数（微博 band_rank/Refer/SWeibo，小红书 xsec_token/xsec_source）
 *   - 参数按字母序排序
 *   - 移除 fragment（#anchor）
 *   - 统一协议为 https
 *   - 移除尾部斜杠（根路径除外）
 *   - 小写域名
 *
 * 纯 TS，使用 Node.js 内置 URL API，不引入第三方库。
 */

/** 追踪参数黑名单 */
const TRACKING_PARAMS = new Set<string>([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
  "source",
  "from",
  "is_from_otherapi",
  "share_source",
]);

/** 平台参数黑名单（微博 + 小红书） */
const PLATFORM_PARAMS = new Set<string>([
  "band_rank",
  "Refer",
  "SWeibo",
  "xsec_token",
  "xsec_source",
]);

/** 判断参数是否在黑名单中 */
function isBlacklistedParam(name: string): boolean {
  return TRACKING_PARAMS.has(name) || PLATFORM_PARAMS.has(name);
}

/**
 * T3 URL 标准化
 *
 * @param url 待标准化的 URL
 * @returns 标准化后的 URL；无法解析时返回原字符串
 */
export function normalizeUrl(url: string): string {
  // 边界情况
  if (typeof url !== "string" || url.trim() === "") {
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // 无法解析，返回原字符串
  }

  // 1. 统一协议为 https
  parsed.protocol = "https:";

  // 2. 小写域名
  parsed.hostname = parsed.hostname.toLowerCase();

  // 3. 移除 fragment
  parsed.hash = "";

  // 4. 过滤黑名单参数并收集保留的参数
  const keptParams: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    if (!isBlacklistedParam(key)) {
      keptParams.push([key, value]);
    }
  });

  // 5. 清空 searchParams，按字母序排序后重新添加
  parsed.search = "";
  keptParams.sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, v] of keptParams) {
    parsed.searchParams.append(k, v);
  }

  // 6. 移除 pathname 尾部斜杠（根路径 "/" 除外）
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // 7. 根路径移除尾部斜杠：https://example.com/ → https://example.com
  let result = parsed.href;
  if (parsed.pathname === "/" && result.endsWith("/")) {
    result = result.slice(0, -1);
  }

  return result;
}

/**
 * 批量标准化 URL
 * @param urls URL 数组
 */
export function normalizeUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map((u) => normalizeUrl(u));
}
