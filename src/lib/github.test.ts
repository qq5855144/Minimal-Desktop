import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopData, SyncConfig } from '@/types';
import { uploadToGithub } from './github';
import { CURRENT_DESKTOP_VERSION } from './desktopSchema';

const config: SyncConfig = {
  token: 'token', owner: 'alice', repo: 'backup', branch: 'main', path: 'desktop_backup.json',
  fileName: 'desktop_backup.json', syncInterval: 'manual', autoSync: true, lastRemoteHead: 'old-head',
};
const data: DesktopData = { version: CURRENT_DESKTOP_VERSION, pages: [[]] };

describe('GitHub sync concurrency protection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stops before writing when the remote branch changed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ object: { sha: 'new-head' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToGithub(config, data);

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.remoteHead).toBe('new-head');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
