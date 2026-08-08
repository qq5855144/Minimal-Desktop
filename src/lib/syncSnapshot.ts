import type { DesktopData } from '@/types';
import { loadPrivacyVault } from '@/lib/storage';

/**
 * 构造唯一的云同步快照。手动同步和自动同步都必须走这里，避免漏传或覆盖隐私 vault。
 */
export function buildSyncSnapshot(data: DesktopData): DesktopData {
  const vault = loadPrivacyVault();
  const {
    privacyVault: _staleVault,
    privacyItems: _legacyPlaintext,
    pinHash: _legacyPinHash,
    ...desktop
  } = data;
  return { ...desktop, privacyVault: vault ?? undefined };
}
