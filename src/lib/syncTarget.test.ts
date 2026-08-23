import { describe, expect, it } from 'vitest';
import type { SyncConfig } from '@/types';
import { isSameSyncTarget, preserveSyncStateForReconnect } from './syncTarget';

const previous: SyncConfig = {
  token: '',
  owner: 'Alice',
  repo: 'Backup',
  branch: 'main',
  path: 'desktop_backup.json',
  fileName: 'desktop_backup.json',
  syncInterval: '1d',
  autoSync: true,
  lastSyncAt: '2026-08-24T00:00:00.000Z',
  lastRemoteHead: 'known-head',
  lastBackupBlobSha: 'known-blob',
  lastBackgroundSha256: 'known-background-digest',
  lastBackgroundBlobSha: 'known-background-blob',
  pendingConflictHead: 'pending-head',
  pendingConflictAt: '2026-08-24T00:01:00.000Z',
};

function reconnected(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    token: 'new-session-token',
    owner: 'alice',
    repo: 'backup',
    branch: 'main',
    path: 'desktop_backup.json',
    fileName: 'desktop_backup.json',
    syncInterval: 'manual',
    autoSync: false,
    ...overrides,
  };
}

describe('sync target reconnect state', () => {
  it('preserves the verified baseline and preferences when reconnecting the same target', () => {
    const next = preserveSyncStateForReconnect(reconnected(), previous);

    expect(isSameSyncTarget(next, previous)).toBe(true);
    expect(next).toMatchObject({
      token: 'new-session-token',
      autoSync: true,
      syncInterval: '1d',
      lastRemoteHead: 'known-head',
      lastBackupBlobSha: 'known-blob',
      lastBackgroundSha256: 'known-background-digest',
      lastBackgroundBlobSha: 'known-background-blob',
      pendingConflictHead: 'pending-head',
    });
  });

  it('does not carry a baseline to a different remote target', () => {
    const next = preserveSyncStateForReconnect(reconnected({ repo: 'another-backup' }), previous);

    expect(next).toMatchObject({ autoSync: false, syncInterval: 'manual' });
    expect(next.lastRemoteHead).toBeUndefined();
    expect(next.lastBackupBlobSha).toBeUndefined();
    expect(next.pendingConflictHead).toBeUndefined();
  });
});
