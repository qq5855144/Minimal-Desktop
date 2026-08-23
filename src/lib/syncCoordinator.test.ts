import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncConfig, SyncSnapshot } from '@/types';
import { CURRENT_DESKTOP_VERSION } from './desktopSchema';

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock('@/lib/github', () => ({ uploadToGithub: uploadMock }));

import { loadSyncConfig, saveSyncConfig } from './storage';
import { uploadSyncSnapshot } from './syncCoordinator';

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
  token: 'token',
  owner: 'alice',
  repo: 'backup',
  branch: 'main',
  path: 'desktop_backup.json',
  fileName: 'desktop_backup.json',
  syncInterval: 'manual',
  autoSync: true,
  lastRemoteHead: 'old-head',
  lastBackupBlobSha: 'old-blob',
};

const snapshot: SyncSnapshot = {
  data: { version: CURRENT_DESKTOP_VERSION, pages: [[]] },
};

describe('sync upload coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    saveSyncConfig(config);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('serializes uploads and refreshes the baseline after the previous upload', async () => {
    uploadMock
      .mockResolvedValueOnce({
        ok: true,
        message: '同步成功',
        remoteHead: 'own-head-1',
        backupBlobSha: 'own-blob-1',
      })
      .mockResolvedValueOnce({
        ok: true,
        message: '同步成功',
        remoteHead: 'own-head-2',
        backupBlobSha: 'own-blob-2',
      });

    const first = uploadSyncSnapshot(config, snapshot, { source: 'auto' });
    const second = uploadSyncSnapshot(config, snapshot, { source: 'auto' });
    const [, secondResult] = await Promise.all([first, second]);

    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(uploadMock.mock.calls[1][0]).toMatchObject({
      lastRemoteHead: 'own-head-1',
      lastBackupBlobSha: 'own-blob-1',
    });
    expect(secondResult.config).toMatchObject({
      lastRemoteHead: 'own-head-2',
      lastBackupBlobSha: 'own-blob-2',
    });
    expect(loadSyncConfig()).toMatchObject({
      lastRemoteHead: 'own-head-2',
      lastBackupBlobSha: 'own-blob-2',
    });
  });

  it('persists a conflict and suppresses repeated automatic uploads', async () => {
    uploadMock.mockResolvedValueOnce({
      ok: false,
      conflict: true,
      remoteHead: 'other-device-head',
      message: '远端数据已更新',
    });

    const conflict = await uploadSyncSnapshot(config, snapshot, { source: 'auto' });
    const suppressed = await uploadSyncSnapshot(config, snapshot, { source: 'auto' });

    expect(conflict.config.pendingConflictHead).toBe('other-device-head');
    expect(suppressed).toMatchObject({ conflict: true, suppressed: true });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(loadSyncConfig()?.pendingConflictHead).toBe('other-device-head');
  });

  it('clears the paused conflict after an explicit one-time overwrite succeeds', async () => {
    saveSyncConfig({
      ...config,
      pendingConflictHead: 'other-device-head',
      pendingConflictAt: '2026-08-24T00:00:00.000Z',
    });
    uploadMock.mockResolvedValueOnce({
      ok: true,
      message: '同步成功',
      remoteHead: 'overwritten-head',
      backupBlobSha: 'overwritten-blob',
    });

    const result = await uploadSyncSnapshot(config, snapshot, {
      source: 'manual',
      force: true,
    });

    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ pendingConflictHead: 'other-device-head' }),
      snapshot,
      { force: true },
    );
    expect(result.config.pendingConflictHead).toBeUndefined();
    expect(loadSyncConfig()).toMatchObject({
      lastRemoteHead: 'overwritten-head',
      lastBackupBlobSha: 'overwritten-blob',
    });
    expect(loadSyncConfig()?.pendingConflictHead).toBeUndefined();
  });
});
