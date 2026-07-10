import type { DesktopData, SyncConfig, WidgetType } from '@/types';
import { createWidgetItem } from './widgetConfig';

const DESKTOP_KEY = 'ios_desktop_data';
const SYNC_KEY = 'ios_sync_config';

// 三个固定系统应用：添加应用、设置、同步（放在 row=2，为 widget 行留空间）
export const SYSTEM_APPS: import('@/types').DesktopItem[] = [
  { id: 'sys-add',      type: 'system', name: '添加应用', color: 'blue',   page: 0, row: 2, col: 0 },
  { id: 'sys-settings', type: 'system', name: '设置',     color: 'gray',   page: 0, row: 2, col: 1 },
  { id: 'sys-sync',     type: 'system', name: '同步',     color: 'indigo', page: 0, row: 2, col: 2 },
];

// 默认组件通过配置声明占位与基础信息，新增桌面组件时只需补配置并声明默认顺序
const DEFAULT_WIDGET_TYPES: WidgetType[] = ['clock', 'search'];

export const WIDGET_ITEMS: import('@/types').DesktopItem[] = DEFAULT_WIDGET_TYPES.map((widgetType, index) =>
  createWidgetItem(widgetType, 0, index),
);

export const defaultDesktopData: DesktopData = {
  pages: [structuredClone([...WIDGET_ITEMS, ...SYSTEM_APPS])],
  dock: [],
  version: 3,
};

/** 判断某行是否完全空闲（页面中没有任何 item 占据该行的任意列） */
function isRowEmpty(page: import('@/types').DesktopItem[], row: number): boolean {
  return !page.some((it) => it.row === row);
}

/** 找第一个完全空闲的行 */
function findEmptyRow(page: import('@/types').DesktopItem[], maxRows = 6): number {
  for (let r = 0; r < maxRows; r++) {
    if (isRowEmpty(page, r)) return r;
  }
  return -1;
}

export function loadDesktopData(): DesktopData {
  try {
    const raw = localStorage.getItem(DESKTOP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DesktopData;
      if (parsed.pages && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
        const ensured = structuredClone(parsed);
        const allItems = ensured.pages.flat();

        // ── 迁移 1：确保三个系统应用始终存在 ──
        for (const sysApp of SYSTEM_APPS) {
          const exists = allItems.some((it) => it.id === sysApp.id);
          if (!exists) {
            let placed = false;
            outer: for (let p = 0; p < ensured.pages.length; p++) {
              for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 6; c++) {
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

        return ensured;
      }
    }
  } catch {
    // ignore
  }
  return structuredClone(defaultDesktopData);
}

export function saveDesktopData(data: DesktopData): void {
  localStorage.setItem(DESKTOP_KEY, JSON.stringify(data));
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SyncConfig;
      // 迁移旧字段
      if (!parsed.fileName) parsed.fileName = 'desktop_backup.json';
      if (!parsed.syncInterval) parsed.syncInterval = 'manual';
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveSyncConfig(config: SyncConfig): void {
  localStorage.setItem(SYNC_KEY, JSON.stringify(config));
}

export function clearSyncConfig(): void {
  localStorage.removeItem(SYNC_KEY);
}

const SETTINGS_KEY = 'ios_desktop_settings';

// 毛玻璃风格默认壁纸（山脉+星空 Unsplash 照片）
const DEFAULT_BG_IMAGE = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80';

const DEFAULT_SETTINGS: import('@/types').DesktopSettings = {
  style: 'glassmorphism',
  iconSize: 46,
  cols: 4,
  rows: 7,
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
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: import('@/types').DesktopSettings): void {
  // blob: URL 不持久化（刷新后失效）；'__idb__' 标记和真实 URL 均可持久化
  const bgVideo =
    s.bgVideo?.startsWith('blob:') ? undefined : s.bgVideo;
  const toSave = { ...s, bgVideo };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
}
