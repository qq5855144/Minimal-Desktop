/**
 * 隐私屏密码加密工具
 * 使用 Web Crypto API（SHA-256）在前端对密码进行哈希
 * 不可逆，安全存储到数据库
 */

// 固定盐值（防止彩虹表攻击）
const SALT = 'minimal-desktop-privacy-v1';

/** 计算带盐的 SHA-256 哈希，返回 hex 字符串 */
export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(SALT + pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 验证用户输入是否与存储的哈希匹配 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const hash = await hashPin(pin);
  return hash === storedHash;
}
