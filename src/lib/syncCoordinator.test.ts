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
      syncStatus: 'synced',
    });
    expect(loadSyncConfig()).toMatchObject({
      lastRemoteHead: 'own-head-2',
      lastBackupBlobSha: 'own-blob-2',
    });
  });

  it('refreshes the baseline after acquiring the cross-tab upload lock', async () => {
    const lockRequest = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      saveSyncConfig({
        ...config,
        lastRemoteHead: 'other-tab-head',
        lastBackupBlobSha: 'other-tab-blob',
      });
      return callback();
    });
    vi.stubGlobal('navigator', { locks: { request: lockRequest } });
    uploadMock.mockResolvedValueOnce({
      ok: true,
      unchanged: true,
      message: '云端已是最新数据',
      remoteHead: 'other-tab-head',
      backupBlobSha: 'other-tab-blob',
    });

    await uploadSyncSnapshot(config, snapshot, { source: 'auto' });

    expect(lockRequest).toHaveBeenCalledOnce();
    expect(lockRequest.mock.calls[0][0]).toContain('minimal-desktop-sync:');
    expect(lockRequest.mock.calls[0][0]).not.toContain(config.token);
    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRemoteHead: 'other-tab-head',
        lastBackupBlobSha: 'other-tab-blob',
      }),
      snapshot,
    );
  });

  it('marks a temporary automatic failure for retry without locking later uploads', async () => {
    uploadMock
      .mockResolvedValueOnce({ ok: false, message: '云端繁忙，将自动重试' })
      .mockResolvedValueOnce({
        ok: true,
        message: '同步成功',
        remoteHead: 'recovered-head',
        backupBlobSha: 'recovered-blob',
      });

    const failed = await uploadSyncSnapshot(config, snapshot, { source: 'auto' });
    const recovered = await uploadSyncSnapshot(config, snapshot, { source: 'auto' });

    expect(failed.config).toMatchObject({
      syncStatus: 'retrying',
      lastSyncError: '云端繁忙，将自动重试',
    });
    expect(recovered.config).toMatchObject({
      syncStatus: 'synced',
      lastRemoteHead: 'recovered-head',
      lastBackupBlobSha: 'recovered-blob',
    });
    expect(recovered.config.lastSyncError).toBeUndefined();
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it('clears an earlier retry error after a manual sync succeeds', async () => {
    saveSyncConfig({
      ...config,
      syncStatus: 'retrying',
      lastSyncError: 'temporary failure',
    });
    uploadMock.mockResolvedValueOnce({
      ok: true,
      message: '同步成功',
      remoteHead: 'overwritten-head',
      backupBlobSha: 'overwritten-blob',
    });

    const result = await uploadSyncSnapshot(config, snapshot, {
      source: 'manual',
    });

    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ syncStatus: 'syncing' }),
      snapshot,
    );
    expect(result.config.syncStatus).toBe('synced');
    expect(result.config.lastSyncError).toBeUndefined();
    expect(loadSyncConfig()).toMatchObject({
      lastRemoteHead: 'overwritten-head',
      lastBackupBlobSha: 'overwritten-blob',
      syncStatus: 'synced',
    });
  });
});
