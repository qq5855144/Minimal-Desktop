import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_DRIVE_MAX_BYTES, connectCloudDrive, downloadCloudDriveFile, listCloudDrive, removeCloudDriveFile,
  uploadCloudDriveFile,
} from './cloudDrive';
import { base64ToBytes } from './github';

const TOKEN = 'test-only-github-token';
const REPO = '/repos/alice/minimal-desktop-drive';
const KEY_REF = '/git/ref/tags/minimal-desktop-drive-key-v1';
const INDEX_PATH = 'drive/index.bin';
const HEAD_REF = '/git/ref/heads/main';

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function gitFixture(initialPrivate: boolean | undefined = undefined) {
  let repoPrivate = initialPrivate;
  let serial = 1;
  let head = '1'.repeat(40);
  let tagRef: string | undefined;
  let failRefOnce = false;
  let linkContainsAccountToken = false;
  const blobs = new Map<string, string>();
  const tags = new Map<string, string>();
  const trees = new Map<string, Map<string, string>>([['initial-tree', new Map()]]);
  const commits = new Map<string, string>([[head, 'initial-tree']]);
  const sha = () => (serial++).toString(16).padStart(40, '0');
  const decodeBlob = (content: string) => new Uint8Array(base64ToBytes(content));
  const requests: { url: string; method: string; body: unknown; headers: Headers; credentials?: RequestCredentials }[] = [];
  const delays: Record<string, number> = {
    'gh-proxy.org': 4, 'ghfast.top': 22, 'raw.githubusercontent.com': 38,
  };
  const brokenRoutes = new Set<string>();

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init?.headers);
    requests.push({ url: url.href, method, body, headers, credentials: init?.credentials });
    if (url.hostname !== 'api.github.com') {
      expect(headers.has('authorization')).toBe(false);
      expect(url.href).not.toContain(TOKEN);
      expect(init?.credentials).toBe('omit');
      await new Promise((resolve) => setTimeout(resolve, delays[url.hostname]));
      if (brokenRoutes.has(url.hostname)) return new Response('<html>blocked</html>', {
        headers: { 'content-type': 'text/html' },
      });
      const path = url.pathname.slice(url.pathname.indexOf('/drive/files/') + 1);
      const stored = blobs.get(trees.get(commits.get(head)!)!.get(path)!)!;
      const bytes = decodeBlob(stored);
      const range = headers.get('range');
      if (range) return new Response(bytes.subarray(0, Number(range.split('-')[1]) + 1), { status: 206 });
      return new Response(bytes);
    }

    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    if (url.pathname === '/user') return json({ login: 'alice' });
    if (url.pathname === '/user/repos') {
      repoPrivate = body.private;
      return json({ private: repoPrivate, default_branch: 'main' }, 201);
    }
    expect(url.pathname.startsWith(REPO)).toBe(true);
    const path = url.pathname.slice(REPO.length);
    if (!path) return repoPrivate === undefined ? json({}, 404) : json({ private: repoPrivate, default_branch: 'main' });
    if (path === KEY_REF) return tagRef ? json({ object: { sha: tagRef, type: 'tag' } }) : json({}, 404);
    if (path === '/git/tags' && method === 'POST') {
      const id = sha();
      tags.set(id, body.message);
      return json({ sha: id }, 201);
    }
    if (path.startsWith('/git/tags/')) return json({ message: tags.get(path.split('/').at(-1)!) });
    if (path === '/git/refs' && method === 'POST') {
      tagRef = body.sha;
      return json({}, 201);
    }
    if (path === HEAD_REF) return json({ object: { sha: head } });
    if (path.startsWith('/contents/')) {
      const revision = url.searchParams.get('ref')!;
      const filePath = path.slice('/contents/'.length);
      const storage = trees.get(commits.get(revision)!)!;
      const blobSha = storage.get(filePath);
      if (!blobSha) return json({}, 404);
      if (headers.get('accept') === 'application/vnd.github.object+json') {
        const temporary = linkContainsAccountToken ? TOKEN : 'short-lived-file-link';
        return json({ download_url: `https://raw.githubusercontent.com/alice/minimal-desktop-drive/${revision}/${filePath}?token=${temporary}` });
      }
      return json({ sha: blobSha, encoding: 'base64', content: blobs.get(blobSha) });
    }
    if (path === '/git/blobs' && method === 'POST') {
      const id = sha();
      blobs.set(id, body.content);
      return json({ sha: id }, 201);
    }
    if (path.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: blobs.get(path.split('/').at(-1)!) });
    if (path === '/git/trees' && method === 'POST') {
      const id = sha();
      const tree = new Map(trees.get(body.base_tree));
      for (const change of body.tree) {
        if (change.sha) tree.set(change.path, change.sha);
        else tree.delete(change.path);
      }
      trees.set(id, tree);
      return json({ sha: id }, 201);
    }
    if (path.startsWith('/git/trees/')) {
      const id = path.split('/').at(-1)!;
      if (id.endsWith('-drive')) {
        const index = trees.get(id.slice(0, -6))!.get(INDEX_PATH);
        return json({ tree: [{ type: 'blob', path: 'index.bin', sha: index }] });
      }
      return json({ tree: trees.get(id)!.has(INDEX_PATH) ? [{ type: 'tree', path: 'drive', sha: id + '-drive' }] : [] });
    }
    if (path === '/git/commits' && method === 'POST') {
      const id = sha();
      expect(body.parents).toEqual([head]);
      commits.set(id, body.tree);
      return json({ sha: id }, 201);
    }
    if (path.startsWith('/git/commits/')) return json({ tree: { sha: commits.get(path.split('/').at(-1)!) } });
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      expect(body.force).toBe(false);
      if (failRefOnce) {
        failRefOnce = false;
        const currentTree = commits.get(head)!;
        head = sha();
        commits.set(head, currentTree);
        return json({}, 409);
      }
      head = body.sha;
      return json({});
    }
    throw new Error(`Unexpected GitHub endpoint: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    requests, blobs, brokenRoutes,
    conflictOnce: () => { failRefOnce = true; },
    useAccountTokenInLink: () => { linkContainsAccountToken = true; },
  };
}

describe('GitHub cloud drive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a private repository and encrypts uploads across reloads and branch retries', async () => {
    const fixture = gitFixture();
    const session = await connectCloudDrive(TOKEN);
    expect(fixture.requests.find((request) => new URL(request.url).pathname === '/user/repos')?.body)
      .toMatchObject({ name: 'minimal-desktop-drive', private: true, auto_init: true });
    fixture.conflictOnce();
    const file = new File(['secret bytes'], '计划.txt');
    const uploaded = await uploadCloudDriveFile(session, file);
    expect(uploaded.files).toHaveLength(1);
    expect([...fixture.blobs.values()].some((content) => atob(content).includes('secret bytes'))).toBe(false);
    expect(fixture.requests.some((request) => request.url.includes(encodeURIComponent(file.name)))).toBe(false);
    const reconnected = await connectCloudDrive(TOKEN);
    const list = await listCloudDrive(reconnected);
    expect(list.files[0]).toMatchObject({ name: '计划.txt', size: file.size });
    const downloaded = await downloadCloudDriveFile(reconnected, list.files[0], list.revision, false);
    expect(await downloaded.contents.text()).toBe('secret bytes');
    expect(fixture.requests.every((request) => new URL(request.url).hostname === 'api.github.com')).toBe(true);
    expect((await removeCloudDriveFile(reconnected, list.files[0])).files).toEqual([]);
    expect((await listCloudDrive(reconnected)).files).toEqual([]);
  });

  it('refuses a public repository and does not post any data', async () => {
    const fixture = gitFixture(false);
    await expect(connectCloudDrive(TOKEN)).rejects.toThrow('同名仓库不是私有仓库');
    expect(fixture.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('downloads over the fastest measured route using an opaque temporary URL', async () => {
    const fixture = gitFixture(true);
    const session = await connectCloudDrive(TOKEN);
    const expected = '测试'.repeat(40_000);
    const { files, revision } = await uploadCloudDriveFile(session, new File([expected], '原始文件.txt'));
    const result = await downloadCloudDriveFile(session, files[0], revision, true);
    expect(await result.contents.text()).toBe(expected);
    expect(result.route).toBe('GH-Proxy');
    const publicRequests = fixture.requests.filter((request) => !request.url.startsWith('https://api.github.com/'));
    expect(publicRequests.filter((request) => request.headers.has('range'))).toHaveLength(3);
    expect(publicRequests.find((request) => !request.headers.has('range'))?.url).toContain('https://gh-proxy.org/');
    expect(publicRequests.every((request) => !request.url.includes(encodeURIComponent('原始文件')))).toBe(true);
  });

  it('uses GitHub directly when acceleration routes are unavailable or a URL contains the login token', async () => {
    const fixture = gitFixture(true);
    const session = await connectCloudDrive(TOKEN);
    const { files, revision } = await uploadCloudDriveFile(session, new File(['backup'], 'test.txt'));
    fixture.brokenRoutes.add('gh-proxy.org');
    fixture.brokenRoutes.add('ghfast.top');
    fixture.brokenRoutes.add('raw.githubusercontent.com');
    let result = await downloadCloudDriveFile(session, files[0], revision, true);
    expect(await result.contents.text()).toBe('backup');
    expect(result.route).toBe('GitHub 直连');
    const count = fixture.requests.length;
    fixture.useAccountTokenInLink();
    result = await downloadCloudDriveFile(session, files[0], revision, true);
    expect(await result.contents.text()).toBe('backup');
    expect(fixture.requests.slice(count).every((request) => request.url.startsWith('https://api.github.com/'))).toBe(true);
  });

  it('rejects oversized files before reading or sending their contents', async () => {
    const fixture = gitFixture(true);
    const session = await connectCloudDrive(TOKEN);
    const count = fixture.requests.length;
    const file = { size: CLOUD_DRIVE_MAX_BYTES + 1, arrayBuffer: vi.fn() } as unknown as File;
    await expect(uploadCloudDriveFile(session, file)).rejects.toThrow('单文件最多 25 MiB');
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(fixture.requests).toHaveLength(count);
  });
});
