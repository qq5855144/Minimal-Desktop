import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncConfig, SyncSnapshot } from '@/types';
import { downloadFromGithub, getBackgroundBackupPath, uploadToGithub } from './github';
import { CURRENT_DESKTOP_VERSION } from './desktopSchema';

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

    expect(result).toMatchObject({ ok: true, remoteHead: 'remote-head', backgroundBlobSha: 'media-blob' });
    expect(result.data?.background?.sha256).toBe(sha256);
    expect(result.backgroundFile).toMatchObject({ name: 'wallpaper.webp', type: 'image/webp', size: 4 });
    expect(Array.from(new Uint8Array(await result.backgroundFile?.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });
});
