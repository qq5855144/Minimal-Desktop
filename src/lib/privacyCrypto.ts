/**
 * 隐私屏密码加密工具（v2）
 * - AES-256-GCM 加密隐私桌面数据
 * - PBKDF2 密钥派生（100_000 次迭代）
 * - 一个密码只能解密自己加密的数据（重置/更改密码后旧数据不可访问）
 */

import type { DesktopItem } from '@/types';

/** Vault 存储格式（JSON 序列化后存 localStorage） */
export interface PrivacyVault {
  salt: string;   // base64 随机盐（16 bytes）
  iv: string;     // base64 随机 IV（12 bytes）
  ct: string;     // base64 密文
  v: number;      // 版本号，当前 2
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

const toBase64 = (buf: ArrayBuffer | Uint8Array): string => {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...arr));
};
const fromBase64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 生成随机字节 */
export function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

// ─── 密钥派生 ─────────────────────────────────────────────────────────────────

/**
 * PBKDF2 派生 AES-256-GCM CryptoKey
 * @param pin  用户 PIN
 * @param salt 16 字节随机盐
 */
export async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ─── 加密 / 解密 ──────────────────────────────────────────────────────────────

/**
 * 用 CryptoKey 加密隐私桌面数据，返回可序列化的 PrivacyVault
 */
export async function encryptItems(
  items: DesktopItem[],
  key: CryptoKey,
  salt: Uint8Array,
): Promise<PrivacyVault> {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(items));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    plaintext,
  );
  return { salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(ciphertext), v: 2 };
}

/**
 * 用 CryptoKey 解密 PrivacyVault，返回图标列表；密码错误则返回 null
 */
export async function decryptItems(
  vault: PrivacyVault,
  key: CryptoKey,
): Promise<DesktopItem[] | null> {
  try {
    const iv = fromBase64(vault.iv);
    const ct = fromBase64(vault.ct);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ct.buffer as ArrayBuffer,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as DesktopItem[];
  } catch {
    return null;
  }
}

/**
 * 便捷：从 PIN + vault 完整验证并解密
 * 返回 { key, items } 或 null（密码错误）
 */
export async function unlockVault(
  pin: string,
  vault: PrivacyVault,
): Promise<{ key: CryptoKey; items: DesktopItem[] } | null> {
  const salt = fromBase64(vault.salt);
  const key = await deriveKey(pin, salt);
  const items = await decryptItems(vault, key);
  if (items === null) return null;
  return { key, items };
}

