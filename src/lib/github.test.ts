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

function successfulUploadResponses(
  fetchMock: ReturnType<typeof vi.fn>,
  currentTree: { path: string; type: string; sha: string }[] = [],
): void {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'base-tree' } }))
    .mockResolvedValueOnce(jsonResponse({ tree: currentTree }))
    .mockResolvedValueOnce(jsonResponse({ sha: 'backup-blob' }))
    .mockResolvedValueOnce(jsonResponse({ sha: 'new-tree' }))
    .mockResolvedValueOnce(jsonResponse({ sha: 'new-commit' }))
    .mockResolvedValueOnce(jsonResponse({}));
}

describe('GitHub automatic sync', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves local changes on top of the latest remote version without a conflict prompt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-head' } }));
    successfulUploadResponses(fetchMock, [{
      path: config.path, type: 'blob', sha: 'other-device-blob',
    }]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({
      ...config,
      lastRemoteHead: 'stale-head',
      lastBackupBlobSha: 'stale-blob',
    }, snapshot);

    expect(result).toMatchObject({
      ok: true,
      remoteHead: 'new-commit',
      backupBlobSha: 'backup-blob',
    });
    expect(result).not.toHaveProperty('conflict');
    const commitRequest = JSON.parse(fetchMock.mock.calls[5][1]?.body as string);
    expect(commitRequest.parents).toEqual(['new-head']);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/contents/'))).toBe(false);
  });

  it('creates or replaces the cloud snapshot even when this installation has no baseline yet', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'remote-head' } }));
    successfulUploadResponses(fetchMock, [{
      path: config.path, type: 'blob', sha: 'existing-backup',
    }]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({
      ...config,
      lastRemoteHead: undefined,
      lastBackupBlobSha: undefined,
    }, snapshot);

    expect(result).toMatchObject({ ok: true, remoteHead: 'new-commit' });
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('adopts an identical remote snapshot despite a stale local baseline', async () => {
    const parsed = parseDesktopBackup(snapshot.data);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const backupBlobSha = await expectedGitBlobSha(JSON.stringify(parsed.data, null, 2));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: [{
        path: config.path, type: 'blob', sha: backupBlobSha,
      }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub({
      ...config,
      lastRemoteHead: 'stale-head',
      lastBackupBlobSha: 'stale-blob',
    }, snapshot);

    expect(result).toMatchObject({
      ok: true,
      unchanged: true,
      remoteHead: 'new-head',
      backupBlobSha,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('recreates a remotely deleted backup automatically', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-head' } }));
    successfulUploadResponses(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, snapshot);

    expect(result).toMatchObject({ ok: true, remoteHead: 'new-commit' });
  });

  it('rebases and retries automatically when the branch advances during upload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'old-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'old-base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: [] }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'first-commit' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Update is not a fast forward' }, 422))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'latest-head' } }))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'latest-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'latest-base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: [{
        path: config.path, type: 'blob', sha: 'other-device-blob',
      }] }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'second-commit' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, snapshot);

    expect(result).toMatchObject({ ok: true, remoteHead: 'second-commit' });
    const secondCommitRequest = JSON.parse(fetchMock.mock.calls[13][1]?.body as string);
    expect(secondCommitRequest.parents).toEqual(['latest-head']);
    expect(fetchMock.mock.calls.filter(([, request]) => request?.method === 'PATCH')).toHaveLength(2);
  });

  it('returns a retry message instead of a conflict lock after repeated ref races', async () => {
    const fetchMock = vi.fn();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ object: { sha: `head-${attempt}` } }))
        .mockResolvedValueOnce(jsonResponse({ tree: { sha: `base-tree-${attempt}` } }))
        .mockResolvedValueOnce(jsonResponse({ tree: [] }))
        .mockResolvedValueOnce(jsonResponse({ sha: `backup-blob-${attempt}` }))
        .mockResolvedValueOnce(jsonResponse({ sha: `tree-${attempt}` }))
        .mockResolvedValueOnce(jsonResponse({ sha: `commit-${attempt}` }))
        .mockResolvedValueOnce(jsonResponse({ message: 'Update is not a fast forward' }, 422))
        .mockResolvedValueOnce(jsonResponse({ object: { sha: `advanced-head-${attempt}` } }));
    }
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, snapshot);

    expect(result).toMatchObject({
      ok: false,
      remoteHead: 'advanced-head-3',
      message: '云端正在频繁更新，已保留本地更改，将自动重试。',
    });
    expect(result).not.toHaveProperty('conflict');
    expect(fetchMock.mock.calls.filter(([, request]) => request?.method === 'PATCH')).toHaveLength(3);
  });

  it('uses the saved fingerprint to skip every write request for identical data', async () => {
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'current-head' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'base-tree' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: [] }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'media-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'backup-blob' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'new-tree' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'new-commit' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, mediaSnapshot);

    expect(result).toMatchObject({
      ok: true,
      backgroundBlobSha: 'media-blob',
      backgroundSha256: mediaSnapshot.data.background?.sha256,
    });
    const mediaRequest = JSON.parse(fetchMock.mock.calls[3][1]?.body as string);
    expect(mediaRequest).toEqual({ content: 'AQIDBA==', encoding: 'base64' });
    const treeRequest = JSON.parse(fetchMock.mock.calls[5][1]?.body as string);
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
