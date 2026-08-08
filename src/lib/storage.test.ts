import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncConfig } from '@/types';
import { loadSyncConfig, saveSyncConfig } from './storage';

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
});
