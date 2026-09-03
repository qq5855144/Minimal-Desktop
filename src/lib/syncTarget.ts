import type { SyncConfig } from '@/types';

function targetParts(config: SyncConfig): string[] {
  return [
    config.owner.toLowerCase(),
    config.repo.toLowerCase(),
    config.branch || 'main',
    config.path || 'desktop_backup.json',
  ];
}

/** Token 不参与目标身份；同一仓库文件在重新认证后仍应沿用已确认的同步基线。 */
export function syncTargetKey(config: SyncConfig): string {
  return JSON.stringify(targetParts(config));
}

export function isSameSyncTarget(left: SyncConfig, right: SyncConfig): boolean {
  return syncTargetKey(left) === syncTargetKey(right);
}

/**
 * 会话 Token 失效后重新连接同一仓库时，保留自动同步偏好与最近同步状态。
 * 切换账号、仓库、分支或文件路径时不会继承，避免信任另一个远端目标。
 */
export function preserveSyncStateForReconnect(
  next: SyncConfig,
  previous: SyncConfig | null,
): SyncConfig {
  if (!previous || !isSameSyncTarget(next, previous)) return next;
  return {
    ...next,
    syncInterval: previous.syncInterval,
    autoSync: previous.autoSync,
    lastSyncAt: previous.lastSyncAt,
    lastRemoteHead: previous.lastRemoteHead,
    lastBackupBlobSha: previous.lastBackupBlobSha,
    lastBackgroundSha256: previous.lastBackgroundSha256,
    lastBackgroundBlobSha: previous.lastBackgroundBlobSha,
    syncStatus: previous.syncStatus,
    lastSyncError: previous.lastSyncError,
  };
}
