import type { PrivacyVault } from '@/lib/privacyCrypto';
import type { DesktopData, SyncConfig, WidgetType } from '@/types';
import { createWidgetItem, getWidgetConfig } from './widgetConfig';
import { CURRENT_DESKTOP_VERSION, parseDesktopData, privacyVaultSchema } from './desktopSchema';
import { LAYOUT_LIMITS } from './layoutEngine';
const DESKTOP_KEY = 'ios_desktop_data';
const SYNC_KEY = 'ios_sync_config';
const SYNC_TOKEN_SESSION_KEY = 'ios_sync_token_session';
const SYNC_TOKEN_KEY = 'ios_sync_token';
const PRIVACY_VAULT_KEY = 'ios_privacy_vault';
const PIN_LOCKOUT_KEY = 'ios_privacy_lockout';

/** 读取加密 vault */
export function loadPrivacyVault(): PrivacyVault | null {
  try {
    const raw = localStorage.getItem(PRIVACY_VAULT_KEY);
    if (!raw) return null;
    const parsed = privacyVaultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** 保存加密 vault */
export function savePrivacyVault(vault: PrivacyVault): void {
  try { localStorage.setItem(PRIVACY_VAULT_KEY, JSON.stringify(vault)); } catch { /* ignore */ }
}

/** 清除 vault（重置密码时调用，旧数据永久丢失） */
export function clearPrivacyVault(): void {
  try { localStorage.removeItem(PRIVACY_VAULT_KEY); } catch { /* ignore */ }
}

interface LockoutState { failCount: number; lockedUntil: number; }

/** 读取锁定状态 */
export function loadLockout(): LockoutState {
  try {
    const raw = localStorage.getItem(PIN_LOCKOUT_KEY);
    if (raw) return JSON.parse(raw) as LockoutState;
  } catch { /* ignore */ }
  return { failCount: 0, lockedUntil: 0 };
}

/** 保存锁定状态 */
export function saveLockout(state: LockoutState): void {
  try { localStorage.setItem(PIN_LOCKOUT_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/** 清除锁定状态 */
export function clearLockout(): void {
  try { localStorage.removeItem(PIN_LOCKOUT_KEY); } catch { /* ignore */ }
}

// 默认组件通过配置声明占位与基础信息，新增桌面组件时只需补配置并声明默认顺序
const DEFAULT_WIDGET_TYPES: WidgetType[] = ['clock', 'search'];

// 按 rowSpan 累加：clock(row=0, span=2) → search(row=2, span=1) → 系统应用(row=3)
export const WIDGET_ITEMS: import('@/types').DesktopItem[] = (() => {
  let nextRow = 0;
  return DEFAULT_WIDGET_TYPES.map((widgetType) => {
    const item = createWidgetItem(widgetType, 0, nextRow);
    nextRow += getWidgetConfig(widgetType).rowSpan;
    return item;
  });
})();

export const SYSTEM_APPS: import('@/types').DesktopItem[] = (() => {
  // 系统应用起始行 = 所有默认 widget 累计占用的行数
  const widgetRows = DEFAULT_WIDGET_TYPES.reduce(
    (sum, t) => sum + getWidgetConfig(t).rowSpan, 0,
  );
  return [
    { id: 'sys-add',      type: 'system', name: '添加应用', color: 'blue',   page: 0, row: widgetRows,     col: 0 },
    { id: 'sys-settings', type: 'system', name: '设置',     color: 'gray',   page: 0, row: widgetRows,     col: 1 },
    { id: 'sys-sync',     type: 'system', name: '同步',     color: 'indigo', page: 0, row: widgetRows,     col: 2 },
  ] as import('@/types').DesktopItem[];
})();

export const defaultDesktopData: DesktopData = {
  pages: [JSON.parse(JSON.stringify([...WIDGET_ITEMS, ...SYSTEM_APPS]))],
  version: CURRENT_DESKTOP_VERSION,
};

/** 判断某行是否完全空闲（页面中没有任何 item 占据该行的任意列） */
function isRowEmpty(page: import('@/types').DesktopItem[], row: number): boolean {
  return !page.some((it) => it.row === row);
}

/** 找第一个完全空闲的行 */
function findEmptyRow(page: import('@/types').DesktopItem[], maxRows = LAYOUT_LIMITS.maxRows): number {
  for (let r = 0; r < maxRows; r++) {
    if (isRowEmpty(page, r)) return r;
  }
  return -1;
}

export function loadDesktopData(): DesktopData {
  try {
    const raw = localStorage.getItem(DESKTOP_KEY);
    if (raw) {
      const validated = parseDesktopData(JSON.parse(raw));
      if (validated.ok) {
        const ensured = JSON.parse(JSON.stringify(validated.data)) as DesktopData;
        const allItems = ensured.pages.flat();

        // ── 迁移 1：确保三个系统应用始终存在 ──
        for (const sysApp of SYSTEM_APPS) {
          const exists = allItems.some((it) => it.id === sysApp.id);
          if (!exists) {
            let placed = false;
            outer: for (let p = 0; p < ensured.pages.length; p++) {
              for (let r = 0; r < LAYOUT_LIMITS.maxRows; r++) {
                for (let c = 0; c < LAYOUT_LIMITS.maxCols; c++) {
                  if (!ensured.pages[p].some((it) => it.row === r && it.col === c)) {
                    ensured.pages[p].push({ ...sysApp, page: p, row: r, col: c });
                    placed = true;
                    break outer;
                  }
                }
              }
            }
            if (!placed) {
              ensured.pages.push([{ ...sysApp, page: ensured.pages.length, row: 0, col: 0 }]);
            }
          }
        }

        // ── 迁移 2：拆分旧的 combined widget / 确保两个独立 widget 存在 ──
        // 移除旧的合并 widget
        for (let p = 0; p < ensured.pages.length; p++) {
          ensured.pages[p] = ensured.pages[p].filter((it) => it.id !== 'widget-combined');
        }
        // 确保两个独立 widget 存在
        for (const w of WIDGET_ITEMS) {
          const exists = ensured.pages.flat().some((it) => it.id === w.id);
          if (!exists) {
            const emptyRow = findEmptyRow(ensured.pages[0]);
            if (emptyRow >= 0) {
              ensured.pages[0].push({ ...w, page: 0, row: emptyRow, col: 0 });
            } else {
              const newPage = ensured.pages.length;
              ensured.pages.push([{ ...w, page: newPage, row: 0, col: 0 }]);
            }
          }
        }

        ensured.version = CURRENT_DESKTOP_VERSION;
        return ensured;
      }
    }
  } catch {
    // ignore
  }
  return JSON.parse(JSON.stringify(defaultDesktopData));
}

export function saveDesktopData(data: DesktopData): boolean {
  // 隐私字段不进入普通桌面 localStorage：vault 单独存储，旧明文/哈希字段不再持久化。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { privacyVault: _v, privacyItems: _legacyItems, pinHash: _legacyPin, ...rest } = data;
  try {
    localStorage.setItem(DESKTOP_KEY, JSON.stringify(rest));
    return true;
  } catch {
    return false;
  }
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SyncConfig;
      // 迁移旧字段
      if (!parsed.fileName) parsed.fileName = 'desktop_backup.json';
      if (!parsed.syncInterval) parsed.syncInterval = 'manual';
      if (parsed.autoSync === undefined) parsed.autoSync = false;
      if (parsed.rememberToken === undefined) parsed.rememberToken = false;
      // 旧版本曾把 PAT 明文写入 localStorage。迁移时立即移除，仅保留本会话副本。
      const legacyToken = parsed.token;
      if (legacyToken) {
        try { sessionStorage.setItem(SYNC_TOKEN_SESSION_KEY, legacyToken); } catch { /* ignore */ }
        parsed.token = '';
        try { localStorage.setItem(SYNC_KEY, JSON.stringify(parsed)); } catch { /* ignore */ }
      }
      // 恢复 Token：勾选"保持登录"时持久化于 localStorage，否则仅当前会话副本。
      try {
        parsed.token = localStorage.getItem(SYNC_TOKEN_KEY) ?? '';
        if (!parsed.token) parsed.token = sessionStorage.getItem(SYNC_TOKEN_SESSION_KEY) ?? '';
      } catch { parsed.token = ''; }
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveSyncConfig(config: SyncConfig): void {
  const { token, ...persisted } = config;
  try { localStorage.setItem(SYNC_KEY, JSON.stringify({ ...persisted, token: '' })); } catch { /* ignore */ }
  try {
    if (config.rememberToken) {
      // 持久化模式：Token 写入 localStorage，并清除会话副本
      if (token) localStorage.setItem(SYNC_TOKEN_KEY, token);
      else localStorage.removeItem(SYNC_TOKEN_KEY);
      sessionStorage.removeItem(SYNC_TOKEN_SESSION_KEY);
    } else {
      // 会话模式：Token 仅保留在当前浏览会话，并清除持久化副本
      if (token) sessionStorage.setItem(SYNC_TOKEN_SESSION_KEY, token);
      else sessionStorage.removeItem(SYNC_TOKEN_SESSION_KEY);
      localStorage.removeItem(SYNC_TOKEN_KEY);
    }
  } catch { /* ignore */ }
}

export function clearSyncConfig(): void {
  try { localStorage.removeItem(SYNC_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(SYNC_TOKEN_SESSION_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(SYNC_TOKEN_KEY); } catch { /* ignore */ }
}

const SETTINGS_KEY = 'ios_desktop_settings';

// 内置默认壁纸（本地资源，导出供其他模块引用）
export const DEFAULT_BG_IMAGE = `${import.meta.env.BASE_URL}images/wallpaper-default.svg`;

const DEFAULT_SETTINGS: import('@/types').DesktopSettings = {
  style: 'glassmorphism',
  iconSize: 46,
  iconRadiusPct: 25,
  cols: 4,
  rows: 8,
  bgType: 'image',
  bgImage: DEFAULT_BG_IMAGE,
  bgOverlayEnabled: false,
  bgOverlayScheme: 'aurora',
  applyOverlayToWallpaper: false,
  searchEngine: 'bing',
  customEngines: [],
};

export function loadSettings(): import('@/types').DesktopSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      delete parsed.pixabayKey; // 已移除共享/客户端壁纸 API Key 方案
      return { ...DEFAULT_SETTINGS, ...parsed } as import('@/types').DesktopSettings;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: import('@/types').DesktopSettings): boolean {
  // blob: URL 刷新后失效；本地媒体本体已写入 IndexedDB，这里只保存恢复标记。
  const bgVideo =
    s.bgVideo?.startsWith('blob:') ? '__idb__' : s.bgVideo;
  const bgImage =
    s.bgImage?.startsWith('blob:') ? '__idb_wallpaper__' : s.bgImage;
  const toSave = { ...s, bgVideo, bgImage };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
    return true;
  } catch {
    return false;
  }
}
