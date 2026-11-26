import { uploadToGithub, type UploadResult } from '@/lib/github';
import { loadSyncConfig, saveSyncConfig } from '@/lib/storage';
import { isSameSyncTarget, syncTargetKey } from '@/lib/syncTarget';
import type { SyncConfig, SyncSnapshot } from '@/types';

export type SyncUploadSource = 'auto' | 'manual';

export interface CoordinatedUploadOptions {
  source?: SyncUploadSource;
  confirmedRemoteBackupSha?: string;
}

export interface CoordinatedUploadResult extends UploadResult {
  config: SyncConfig;
}

let uploadQueue: Promise<void> = Promise.resolve();

function baselineStorageKey(config: SyncConfig): string {
  return `minimal-desktop:sync-base:${syncTargetKey(config)}`;
}

export function rememberWorkspaceSyncBase(config: SyncConfig): void {
  try { sessionStorage.setItem(baselineStorageKey(config), config.lastBackupBlobSha ?? ''); } catch { /* optional storage */ }
}

export function initializeWorkspaceSyncBase(config: SyncConfig): void {
  try {
    if (sessionStorage.getItem(baselineStorageKey(config)) === null) rememberWorkspaceSyncBase(config);
  } catch { /* optional storage */ }
}

function workspaceSyncBase(config: SyncConfig): string | undefined {
  try {
    const stored = sessionStorage.getItem(baselineStorageKey(config));
    return stored === null ? config.lastBackupBlobSha : stored || undefined;
  } catch {
    return config.lastBackupBlobSha;
  }
}

/**
 * 只从最新配置中吸收同步运行态，保留调用方当前的 Token 与交互设置。
 * 这一步在任务真正出队时执行，避免定时器闭包持有过期远端基线。
 */
export function mergeLatestSyncRuntime(
  config: SyncConfig,
  latest: SyncConfig | null,
): SyncConfig {
  if (!latest || !isSameSyncTarget(config, latest)) return config;
  return {
    ...config,
    lastSyncAt: latest.lastSyncAt,
    lastRemoteHead: latest.lastRemoteHead,
    lastBackupBlobSha: latest.lastBackupBlobSha,
    lastBackgroundSha256: latest.lastBackgroundSha256,
    lastBackgroundBlobSha: latest.lastBackgroundBlobSha,
    syncStatus: latest.syncStatus,
    lastSyncError: latest.lastSyncError,
  };
}

function persistRuntimePatch(
  base: SyncConfig,
  patch: Partial<SyncConfig>,
): SyncConfig {
  const latest = loadSyncConfig();
  if (!latest || !isSameSyncTarget(base, latest)) return { ...base, ...patch };
  const next = {
    ...latest,
    token: latest.token || base.token,
    ...patch,
  };
  saveSyncConfig(next);
  return next;
}

async function performCoordinatedUpload(
  config: SyncConfig,
  snapshot: SyncSnapshot,
  options: CoordinatedUploadOptions,
): Promise<CoordinatedUploadResult> {
  const latest = loadSyncConfig();
  if (!latest?.token || !isSameSyncTarget(config, latest) || config.token !== latest.token
    || (options.source === 'auto' && !latest.autoSync)) {
    return { ok: false, message: '同步目标或登录已变更，请重试', config: latest ?? config };
  }
  const current = mergeLatestSyncRuntime(config, latest);
  const active = persistRuntimePatch(current, {
    syncStatus: 'syncing',
    lastSyncError: undefined,
  });
  const backupBase = workspaceSyncBase(config);
  const verified = {
    ...active,
    lastBackupBlobSha: backupBase,
    lastRemoteHead: backupBase === active.lastBackupBlobSha ? active.lastRemoteHead : undefined,
  };
  const result = options.source === 'manual' && options.confirmedRemoteBackupSha
    ? await uploadToGithub(verified, snapshot, options.confirmedRemoteBackupSha)
    : await uploadToGithub(verified, snapshot);
  if (result.ok) {
    const next = persistRuntimePatch(active, {
      lastSyncAt: new Date().toISOString(),
      lastRemoteHead: result.remoteHead ?? active.lastRemoteHead,
      lastBackupBlobSha: result.backupBlobSha,
      lastBackgroundSha256: result.backgroundSha256,
      lastBackgroundBlobSha: result.backgroundBlobSha,
      syncStatus: 'synced',
      lastSyncError: undefined,
    });
    rememberWorkspaceSyncBase({ ...active, lastBackupBlobSha: result.backupBlobSha });
    return { ...result, config: next };
  }

  const next = persistRuntimePatch(active, {
    syncStatus: options.source === 'auto' && !result.conflictingBackupSha ? 'retrying' : 'error',
    lastSyncError: result.message,
  });
  return { ...result, config: next };
}

/** Web Locks 将不同标签页/扩展页面对同一备份文件的上传也串行化。 */
async function withCrossContextLock<T>(
  config: SyncConfig,
  task: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return task();
  return navigator.locks.request(`minimal-desktop-sync:${syncTargetKey(config)}`, task);
}

/**
 * 手动和自动上传共享同一串行队列。后发任务会在前一任务持久化新基线后再读取配置，
 * 因此连续拖拽、隐私 vault 落盘和手动上传会继承上一任务的新远端状态。
 */
export function uploadSyncSnapshot(
  config: SyncConfig,
  snapshot: SyncSnapshot,
  options: CoordinatedUploadOptions = {},
): Promise<CoordinatedUploadResult> {
  initializeWorkspaceSyncBase(config);
  const run = () => withCrossContextLock(
    config,
    () => performCoordinatedUpload(config, snapshot, options),
  );
  const task = uploadQueue.then(
    run,
    run,
  );
  uploadQueue = task.then(() => undefined, () => undefined);
  return task;
}
