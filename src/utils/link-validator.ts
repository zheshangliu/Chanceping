/**
 * T1 域名安全校验
 *
 * 来源：Task 019a 第 4.1 节。
 *
 * 搜索层抓取前必须校验 URL 安全性：
 *   - 强制 HTTPS（http:// 仅警告，不拒绝）
 *   - 域名匹配校验（防链接劫持：显示域名 ≠ 实际跳转域名）
 *   - userinfo 防绕过（拒绝 https://evil.com@legit.com/ 形式）
 *   - 私有 IP / localhost 拒绝（防 SSRF）
 *
 * 纯 TS，使用 Node.js 内置 URL API，不引入第三方库。
 */

/** 链路校验结果 */
export interface LinkValidationResult {
  valid: boolean;
  reason?: string;
  /** 清理后的安全 URL（http 升级为 https） */
  safeUrl?: string;
}

/**
 * 判断 hostname 是否为私有 IP / localhost（防 SSRF）
 * - 10.0.0.0/8
 * - 172.16.0.0/12
 * - 192.168.0.0/16
 * - 127.0.0.0/8
 * - 169.254.0.0/16（link-local）
 * - 0.0.0.0
 * - localhost / ::1
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // localhost（IPv4 + IPv6）
  if (h === "localhost" || h === "::1" || h === "[::1]") {
    return true;
  }

  // IPv4 格式检测
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);

    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12（172.16.x.x ~ 172.31.x.x）
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 127.0.0.0/8（loopback）
    if (a === 127) return true;
    // 169.254.0.0/16（link-local）
    if (a === 169 && b === 254) return true;
    // 0.0.0.0
    if (a === 0) return true;
  }

  return false;
}

/**
 * T1 域名安全校验
 *
 * 校验顺序：
 *   1. 空值 / 格式错误
 *   2. userinfo 绕过（url.username / url.password 非空）
 *   3. 私有 IP / localhost（SSRF 防护）
 *   4. 协议校验（仅允许 http/https）
 *   5. 域名匹配（防链接劫持）
 *   6. HTTP 警告（不拒绝，仅在 reason 中提示）
 *
 * @param url 待校验的 URL
 * @param expectedDomain 期望域名（可选，用于防链接劫持；支持子域名匹配）
 */
export function validateLink(url: string, expectedDomain?: string): LinkValidationResult {
  // 边界情况：空字符串 / null / undefined
  if (typeof url !== "string" || url.trim() === "") {
    return { valid: false, reason: "URL 为空" };
  }

  // 格式校验
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "URL 格式错误" };
  }

  // userinfo 防绕过：拒绝 https://evil.com@legit.com/ 形式
  if (parsed.username !== "" || parsed.password !== "") {
    return { valid: false, reason: "URL 含 userinfo，疑似绕过攻击" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 私有 IP / localhost 拒绝（防 SSRF）
  if (isPrivateHost(hostname)) {
    return { valid: false, reason: `私有 IP 或 localhost（${hostname}），疑似 SSRF 攻击` };
  }

  // 协议校验（仅允许 http/https）
  const protocol = parsed.protocol;
  if (protocol !== "https:" && protocol !== "http:") {
    return { valid: false, reason: `不支持的协议: ${protocol}` };
  }

  // 域名匹配校验（防链接劫持）
  if (expectedDomain) {
    const expected = expectedDomain.toLowerCase();
    // hostname 应等于 expectedDomain 或为其子域名（以 .expectedDomain 结尾）
    if (hostname !== expected && !hostname.endsWith("." + expected)) {
      return {
        valid: false,
        reason: `域名不匹配: 实际=${hostname}, 期望=${expectedDomain}`,
      };
    }
  }

  // HTTP 警告（不拒绝，仅在 reason 中提示建议使用 HTTPS）
  const reasons: string[] = [];
  if (protocol === "http:") {
    reasons.push("建议使用 HTTPS");
  }

  // 构造 safeUrl（http 升级为 https）
  let safeUrl = parsed.href;
  if (protocol === "http:") {
    safeUrl = "https://" + safeUrl.slice("http://".length);
  }

  return {
    valid: true,
    reason: reasons.length > 0 ? reasons.join("；") : undefined,
    safeUrl,
  };
}

/**
 * 批量校验链接
 * @param urls URL 数组
 * @param expectedDomain 期望域名（可选）
 */
export function validateLinks(urls: string[], expectedDomain?: string): LinkValidationResult[] {
  if (!Array.isArray(urls)) return [];
  return urls.map((u) => validateLink(u, expectedDomain));
}
