import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncConfig, SyncSnapshot } from '@/types';
import { downloadFromGithub, getBackgroundBackupPath, uploadToGithub } from './github';
import { CURRENT_DESKTOP_VERSION, parseDesktopBackup } from './desktopSchema';

const config: SyncConfig = {
  token: 'token', owner: 'alice', repo: 'backup', branch: 'main', path: 'desktop_backup.json',
  fileName: 'desktop_backup.json', syncInterval: 'manual', autoSync: true, lastRemoteHead: 'old-head',
};
const snapshot: SyncSnapshot = {
  data: { version: CURRENT_DESKTOP_VERSION, pages: [[]] },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function expectedGitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const object = new Uint8Array(header.byteLength + body.byteLength);
  object.set(header);
  object.set(body, header.byteLength);
  const digest = await crypto.subtle.digest('SHA-1', object.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function successfulUploadResponses(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'base-tree' } }))
    .mockResolvedValueOnce(jsonResponse({ sha: 'backup-blob' }))
    .mockResolvedValueOnce(jsonResponse({ sha: 'new-tree' }))
    .mockResolvedValueOnce(jsonResponse({ sha: 'new-commit' }))
    .mockResolvedValueOnce(jsonResponse({}));
}

describe('GitHub sync concurrency protection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stops before writing when the remote branch changed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-head' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'new-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'old-backup-blob' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, snapshot);

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.remoteHead).toBe('new-head');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requires a download before overwriting an existing backup without a local baseline', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'remote-head' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'remote-backup-blob' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({ ...config, lastRemoteHead: undefined }, snapshot);

    expect(result).toMatchObject({ ok: false, conflict: true, remoteHead: 'remote-head' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recreates a backup deleted remotely instead of reporting a conflict', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-head' } }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404));
    successfulUploadResponses(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, snapshot);

    expect(result).toMatchObject({ ok: true, remoteHead: 'new-commit' });
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('allows unrelated remote commits when the backup blob is unchanged', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-head' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'same-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'same-backup-blob' }));
    successfulUploadResponses(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, snapshot);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('uses the backup blob baseline to avoid a false conflict from a stale branch HEAD', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-head' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'known-backup-blob' }));
    successfulUploadResponses(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({
      ...config,
      lastRemoteHead: 'stale-head',
      lastBackupBlobSha: 'known-backup-blob',
    }, snapshot);

    expect(result).toMatchObject({
      ok: true,
      remoteHead: 'new-commit',
      backupBlobSha: 'backup-blob',
    });
    // 不再读取旧 HEAD 下的文件元数据；当前 blob 基线已经足够判断。
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('supports an explicit one-time overwrite while retaining fast-forward updates', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'remote-head' } }));
    successfulUploadResponses(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(
      { ...config, lastRemoteHead: undefined, lastBackupBlobSha: undefined },
      snapshot,
      { force: true },
    );

    expect(result).toMatchObject({ ok: true, remoteHead: 'new-commit' });
    const commitRequest = JSON.parse(fetchMock.mock.calls[4][1]?.body as string);
    expect(commitRequest.parents).toEqual(['remote-head']);
    const updateRequest = JSON.parse(fetchMock.mock.calls[5][1]?.body as string);
    expect(updateRequest).toEqual({ sha: 'new-commit', force: false });
  });

  it('safely retries a normal upload when only the branch ref advanced', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'old-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'old-base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-commit' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Update is not a fast forward' }, 422))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'latest-head' } }))
      // 重试时先确认最新 HEAD 中的备份仍等于本地已知基线。
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'latest-head' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'baseline-blob' }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'latest-base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-commit' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({
      ...config,
      lastRemoteHead: 'old-head',
      lastBackupBlobSha: 'baseline-blob',
    }, snapshot);

    expect(result).toMatchObject({ ok: true, remoteHead: 'second-commit' });
    expect(fetchMock.mock.calls[8][0]).toContain('/contents/desktop_backup.json?ref=latest-head');
    const secondCommitRequest = JSON.parse(fetchMock.mock.calls[12][1]?.body as string);
    expect(secondCommitRequest.parents).toEqual(['latest-head']);
    expect(fetchMock.mock.calls.filter(([, request]) => request?.method === 'PATCH')).toHaveLength(2);
  });

  it('does not retry over a backup that really changed during a ref race', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'old-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'old-base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-commit' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Update is not a fast forward' }, 422))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'latest-head' } }))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'latest-head' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'other-device-blob' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({
      ...config,
      lastRemoteHead: 'old-head',
      lastBackupBlobSha: 'baseline-blob',
    }, snapshot);

    expect(result).toMatchObject({ ok: false, conflict: true, remoteHead: 'latest-head' });
    expect(result.message).toContain('其他设备更新');
    expect(fetchMock.mock.calls.filter(([, request]) => request?.method === 'PATCH')).toHaveLength(1);
  });

  it('rebuilds an explicit overwrite on the latest HEAD after a fast-forward race', async () => {
    const fetchMock = vi.fn()
      // 第一次尝试以旧 HEAD 创建提交，但更新引用前远端又产生了新提交。
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'old-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'old-base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-commit' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Update is not a fast forward' }, 422))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'latest-head' } }))
      // 第二次尝试必须重新读取 HEAD 并基于它创建新的 fast-forward commit。
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'latest-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'latest-base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-commit' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, snapshot, { force: true });

    expect(result).toMatchObject({ ok: true, remoteHead: 'second-commit' });
    const firstCommitRequest = JSON.parse(fetchMock.mock.calls[4][1]?.body as string);
    expect(firstCommitRequest.parents).toEqual(['old-head']);
    const secondCommitRequest = JSON.parse(fetchMock.mock.calls[11][1]?.body as string);
    expect(secondCommitRequest.parents).toEqual(['latest-head']);
    const updateRequests = fetchMock.mock.calls
      .filter(([, request]) => request?.method === 'PATCH')
      .map(([, request]) => JSON.parse(request?.body as string));
    expect(updateRequests).toEqual([
      { sha: 'first-commit', force: false },
      { sha: 'second-commit', force: false },
    ]);
  });

  it('shows an actionable message when all overwrite retries encounter remote updates', async () => {
    const fetchMock = vi.fn();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ object: { sha: `head-${attempt}` } }))
        .mockResolvedValueOnce(jsonResponse({ tree: { sha: `base-tree-${attempt}` } }))
        .mockResolvedValueOnce(jsonResponse({ sha: `backup-blob-${attempt}` }))
        .mockResolvedValueOnce(jsonResponse({ sha: `tree-${attempt}` }))
        .mockResolvedValueOnce(jsonResponse({ sha: `commit-${attempt}` }))
        .mockResolvedValueOnce(jsonResponse({ message: 'Update is not a fast forward' }, 422))
        .mockResolvedValueOnce(jsonResponse({ object: { sha: `advanced-head-${attempt}` } }));
    }
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, snapshot, { force: true });

    expect(result).toMatchObject({
      ok: false,
      conflict: true,
      remoteHead: 'advanced-head-3',
      message: '覆盖期间远端仍在持续更新，请稍后再次点击“本次覆盖”。',
    });
    expect(fetchMock.mock.calls.filter(([, request]) => request?.method === 'PATCH')).toHaveLength(3);
  });

  it('skips an empty commit when the generated tree is unchanged', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'current-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'base-tree' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({
      ...config,
      lastRemoteHead: 'current-head',
      lastBackupBlobSha: 'backup-blob',
    }, snapshot);

    expect(result).toMatchObject({
      ok: true,
      unchanged: true,
      remoteHead: 'current-head',
      backupBlobSha: 'backup-blob',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('uses the saved file fingerprint to skip every write request for identical data', async () => {
    const parsed = parseDesktopBackup(snapshot.data);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const backupBlobSha = await expectedGitBlobSha(JSON.stringify(parsed.data, null, 2));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'current-head' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({
      ...config,
      lastRemoteHead: 'current-head',
      lastBackupBlobSha: backupBlobSha,
    }, snapshot);

    expect(result).toMatchObject({
      ok: true,
      unchanged: true,
      remoteHead: 'current-head',
      backupBlobSha,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uploads a wallpaper as a separate blob in the same commit', async () => {
    const wallpaper = new File([new Uint8Array([1, 2, 3, 4])], 'wallpaper.webp', {
      type: 'image/webp',
      lastModified: 123,
    });
    const mediaSnapshot: SyncSnapshot = {
      data: {
        ...snapshot.data,
        settings: {
          style: 'glassmorphism', iconSize: 46, iconRadiusPct: 25, cols: 4, rows: 8,
          bgType: 'image', bgImage: '__idb_wallpaper__',
        },
        background: {
          kind: 'image', mimeType: 'image/webp', fileName: 'wallpaper.webp', size: 4,
          sha256: '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
          lastModified: 123,
        },
      },
      backgroundFile: wallpaper,
    };
    const currentConfig = { ...config, lastRemoteHead: 'current-head' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'current-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'media-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'new-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'new-commit' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(currentConfig, mediaSnapshot);

    expect(result).toMatchObject({
      ok: true,
      backgroundBlobSha: 'media-blob',
      backgroundSha256: mediaSnapshot.data.background?.sha256,
    });
    const mediaRequest = JSON.parse(fetchMock.mock.calls[2][1]?.body as string);
    expect(mediaRequest).toEqual({ content: 'AQIDBA==', encoding: 'base64' });
    const treeRequest = JSON.parse(fetchMock.mock.calls[4][1]?.body as string);
    expect(treeRequest.tree).toContainEqual(expect.objectContaining({
      path: getBackgroundBackupPath(config.path),
      sha: 'media-blob',
    }));
  });

  it('downloads and verifies the wallpaper from the same remote snapshot', async () => {
    const sha256 = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a';
    const backup = {
      ...snapshot.data,
      settings: {
        style: 'glassmorphism', iconSize: 46, iconRadiusPct: 25, cols: 4, rows: 8,
        bgType: 'image', bgImage: '__idb_wallpaper__',
      },
      background: {
        kind: 'image', mimeType: 'image/webp', fileName: 'wallpaper.webp', size: 4,
        sha256, lastModified: 123,
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'remote-head' } }))
      .mockResolvedValueOnce(jsonResponse({
        content: btoa(JSON.stringify(backup)), encoding: 'base64', sha: 'backup-blob',
      }))
      .mockResolvedValueOnce(jsonResponse({
        content: 'AQIDBA==', encoding: 'base64', sha: 'media-blob',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadFromGithub(config);

    expect(result).toMatchObject({
      ok: true,
      remoteHead: 'remote-head',
      backupBlobSha: 'backup-blob',
      backgroundBlobSha: 'media-blob',
    });
    expect(result.data?.background?.sha256).toBe(sha256);
    expect(result.backgroundFile).toMatchObject({ name: 'wallpaper.webp', type: 'image/webp', size: 4 });
    expect(Array.from(new Uint8Array(await result.backgroundFile?.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });
});
