import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncConfig } from '@/types';
import { CURRENT_DESKTOP_VERSION } from './desktopSchema';
import {
  DEFAULT_BG_IMAGE,
  loadDesktopData,
  loadSettings,
  loadSyncConfig,
  saveSyncConfig,
  updateSyncConfig,
  WIDGET_ITEMS,
} from './storage';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

const config: SyncConfig = {
  token: 'github_pat_secret', owner: 'alice', repo: 'backup', branch: 'main',
  path: 'desktop_backup.json', fileName: 'desktop_backup.json',
  syncInterval: 'manual', autoSync: true,
};

describe('sync credential storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  it('keeps GitHub token out of persistent localStorage', () => {
    saveSyncConfig(config);
    expect(localStorage.getItem('ios_sync_config')).not.toContain(config.token);
    expect(loadSyncConfig()?.token).toBe(config.token);
  });

  it('migrates a legacy persisted token into sessionStorage', () => {
    localStorage.setItem('ios_sync_config', JSON.stringify(config));
    expect(loadSyncConfig()?.token).toBe(config.token);
    expect(localStorage.getItem('ios_sync_config')).not.toContain(config.token);
  });

  it('atomically patches sync preferences without losing the latest remote baseline', () => {
    saveSyncConfig({
      ...config,
      lastRemoteHead: 'latest-head',
      lastBackupBlobSha: 'latest-blob',
    });

    const updated = updateSyncConfig({ autoSync: false });

    expect(updated).toMatchObject({
      autoSync: false,
      lastRemoteHead: 'latest-head',
      lastBackupBlobSha: 'latest-blob',
    });
    expect(loadSyncConfig()).toMatchObject({
      autoSync: false,
      lastRemoteHead: 'latest-head',
      lastBackupBlobSha: 'latest-blob',
    });
  });

  it('removes the obsolete configurable automatic sync interval', () => {
    localStorage.setItem('ios_sync_config', JSON.stringify({
      ...config,
      autoSyncDelaySeconds: 15,
    }));

    expect(loadSyncConfig()).not.toHaveProperty('autoSyncDelaySeconds');
    expect(localStorage.getItem('ios_sync_config')).not.toContain('autoSyncDelaySeconds');
  });

  it('migrates the legacy built-in wallpaper to the current local WebP asset', () => {
    localStorage.setItem('ios_desktop_settings', JSON.stringify({
      style: 'glassmorphism',
      bgType: 'image',
      bgImage: './images/wallpaper-default.svg',
    }));

    expect(loadSettings().bgImage).toBe(DEFAULT_BG_IMAGE);
    expect(DEFAULT_BG_IMAGE).toContain('images/wallpaper-default.webp');
  });

  it('defaults legacy settings to the soft search bar style', () => {
    localStorage.setItem('ios_desktop_settings', JSON.stringify({
      style: 'glassmorphism', iconSize: 46, iconRadiusPct: 25, cols: 4, rows: 8,
    }));
    expect(loadSettings().searchBarStyle).toBe('soft');
  });

  it('loads and normalizes the remembered portrait column count', () => {
    localStorage.setItem('ios_desktop_settings', JSON.stringify({
      style: 'glassmorphism', iconSize: 46, iconRadiusPct: 25,
      cols: 6, portraitCols: 3, rows: 8,
    }));
    expect(loadSettings()).toMatchObject({ cols: 6, portraitCols: 4 });
  });

  it('recognizes system entries inside a folder instead of recreating duplicates', () => {
    localStorage.setItem('ios_desktop_data', JSON.stringify({
      version: CURRENT_DESKTOP_VERSION,
      pages: [[
        ...WIDGET_ITEMS,
        {
          id: 'tools',
          type: 'folder',
          name: '工具',
          color: 'gray',
          page: 0,
          row: 3,
          col: 0,
          folderLayout: '2x2',
          children: [
            { id: 'sys-add', type: 'system', name: '添加应用', color: 'blue', page: 0, row: 3, col: 0 },
            { id: 'sys-settings', type: 'system', name: '设置', color: 'gray', page: 0, row: 3, col: 0 },
            { id: 'sys-sync', type: 'system', name: '同步', color: 'indigo', page: 0, row: 3, col: 0 },
          ],
        },
      ]],
    }));

    const restored = loadDesktopData();
    const ids: string[] = [];
    const visit = (items: typeof restored.pages[number]) => {
      for (const item of items) {
        ids.push(item.id);
        if (item.children) visit(item.children);
      }
    };
    restored.pages.forEach(visit);

    expect(ids.filter((id) => id === 'sys-add')).toHaveLength(1);
    expect(ids.filter((id) => id === 'sys-settings')).toHaveLength(1);
    expect(ids.filter((id) => id === 'sys-sync')).toHaveLength(1);
    expect(restored.pages.flat().find((item) => item.id === 'tools')?.folderLayout).toBe('2x2');
  });

  it('preserves widgets explicitly removed by the user across reloads', () => {
    localStorage.setItem('ios_desktop_data', JSON.stringify({
      version: CURRENT_DESKTOP_VERSION,
      pages: [[
        { id: 'sys-add', type: 'system', name: '添加应用', color: 'blue', page: 0, row: 0, col: 0 },
        { id: 'sys-settings', type: 'system', name: '设置', color: 'gray', page: 0, row: 0, col: 1 },
        { id: 'sys-sync', type: 'system', name: '同步', color: 'indigo', page: 0, row: 0, col: 2 },
      ]],
    }));

    const restored = loadDesktopData();

    expect(restored.pages.flat().some((item) => item.type === 'widget')).toBe(false);
  });

  it('still splits a legacy combined widget into the independent defaults', () => {
    localStorage.setItem('ios_desktop_data', JSON.stringify({
      version: CURRENT_DESKTOP_VERSION,
      pages: [[{
        id: 'widget-combined',
        type: 'widget',
        widgetType: 'combined',
        name: '时钟与搜索',
        color: 'gray',
        page: 0,
        row: 0,
        col: 0,
      }]],
    }));

    const restored = loadDesktopData();
    const ids = restored.pages.flat().map((item) => item.id);

    expect(ids).not.toContain('widget-combined');
    expect(ids).toContain('widget-clock');
    expect(ids).toContain('widget-search');
  });
});
