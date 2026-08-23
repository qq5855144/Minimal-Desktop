import { uploadToGithub, type UploadOptions, type UploadResult } from '@/lib/github';
import { loadSyncConfig, saveSyncConfig } from '@/lib/storage';
import { isSameSyncTarget, syncTargetKey } from '@/lib/syncTarget';
import type { SyncConfig, SyncSnapshot } from '@/types';

export type SyncUploadSource = 'auto' | 'manual';

export interface CoordinatedUploadOptions extends UploadOptions {
  source?: SyncUploadSource;
}

export interface CoordinatedUploadResult extends UploadResult {
  config: SyncConfig;
  /** 冲突已处于待处理状态，自动同步无需重复请求或提示。 */
  suppressed?: boolean;
}

let uploadQueue: Promise<void> = Promise.resolve();

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
    pendingConflictHead: latest.pendingConflictHead,
    pendingConflictAt: latest.pendingConflictAt,
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
  const current = mergeLatestSyncRuntime(config, loadSyncConfig());
  if (options.source === 'auto' && current.pendingConflictHead && !options.force) {
    return {
      ok: false,
      conflict: true,
      suppressed: true,
      remoteHead: current.pendingConflictHead,
      message: '自动同步已暂停，等待处理云端版本冲突',
      config: current,
    };
  }

  const result = await uploadToGithub(current, snapshot, { force: options.force });
  if (result.ok) {
    const next = persistRuntimePatch(current, {
      lastSyncAt: new Date().toISOString(),
      lastRemoteHead: result.remoteHead ?? current.lastRemoteHead,
      lastBackupBlobSha: result.backupBlobSha,
      lastBackgroundSha256: result.backgroundSha256,
      lastBackgroundBlobSha: result.backgroundBlobSha,
      pendingConflictHead: undefined,
      pendingConflictAt: undefined,
    });
    return { ...result, config: next };
  }

  if (result.conflict) {
    const next = persistRuntimePatch(current, {
      pendingConflictHead: result.remoteHead ?? current.pendingConflictHead,
      pendingConflictAt: new Date().toISOString(),
    });
    return { ...result, config: next };
  }

  return { ...result, config: current };
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
 * 因此连续拖拽、隐私 vault 落盘和手动上传不会互相制造伪冲突。
 */
export function uploadSyncSnapshot(
  config: SyncConfig,
  snapshot: SyncSnapshot,
  options: CoordinatedUploadOptions = {},
): Promise<CoordinatedUploadResult> {
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
