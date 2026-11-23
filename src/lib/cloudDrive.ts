import { z } from 'zod';
import {
  base64ToBytes, bytesToBase64, ensureRepo, errorMessage, getBranchHead, ghFetch,
  readRepoFileAtRef, verifyToken,
} from './github';

export const CLOUD_DRIVE_REPO = 'minimal-desktop-drive';
export const CLOUD_DRIVE_MAX_BYTES = 25 * 1024 * 1024;
const INDEX_PATH = 'drive/index.bin';
const KEY_TAG = 'minimal-desktop-drive-key-v1';
const KEY_PREFIX = 'minimal-desktop-drive-key-v1:';
const NONCE_BYTES = 12;
const SEALED_OVERHEAD = NONCE_BYTES + 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const driveFileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  size: z.number().int().min(0).max(CLOUD_DRIVE_MAX_BYTES),
  uploadedAt: z.string().datetime(),
});
const driveIndexSchema = z.array(driveFileSchema);
export type CloudDriveFile = z.infer<typeof driveFileSchema>;

export interface CloudDriveSession {
  owner: string;
  branch: string;
  token: string;
  key: CryptoKey;
}

export interface CloudDriveListing {
  revision: string;
  files: CloudDriveFile[];
}

function filePath(id: string): string {
  return `drive/files/${id}.bin`;
}

function repoPath(owner: string): string {
  return `/repos/${encodeURIComponent(owner)}/${CLOUD_DRIVE_REPO}`;
}

async function checkedJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response, fallback));
  return response.json() as Promise<T>;
}

function postJson(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body), redirect: 'error' };
}

async function importKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (bytes.length !== 32) throw new Error('云盘密钥无效');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function readKey(owner: string, token: string): Promise<CryptoKey | null> {
  const repo = repoPath(owner);
  const ref = await ghFetch(token, `${repo}/git/ref/tags/${KEY_TAG}`);
  if (ref.status === 404) return null;
  const { object } = await checkedJson<{ object: { type: string; sha: string } }>(ref, '读取云盘密钥失败');
  if (object.type !== 'tag' || !/^[a-f0-9]{40}$/i.test(object.sha)) throw new Error('云盘密钥标签无效');
  const { message } = await checkedJson<{ message: string }>(
    await ghFetch(token, `${repo}/git/tags/${object.sha}`), '读取云盘密钥失败',
  );
  if (!message.startsWith(KEY_PREFIX)) throw new Error('云盘密钥标签无效');
  return importKey(new Uint8Array(base64ToBytes(message.slice(KEY_PREFIX.length).trim())));
}

async function ensureKey(owner: string, branch: string, token: string): Promise<CryptoKey> {
  const existing = await readKey(owner, token);
  if (existing) return existing;

  const repo = repoPath(owner);
  const head = await getBranchHead(token, owner, CLOUD_DRIVE_REPO, branch);
  if (!head) throw new Error('无法读取云盘分支');
  const index = await ghFetch(token, `${repo}/contents/${INDEX_PATH}?ref=${head}`);
  if (index.ok) throw new Error('云盘已有数据但密钥标签缺失，请在 GitHub 恢复该标签');
  if (index.status !== 404) throw new Error(await errorMessage(index, '检查云盘数据失败'));

  // Git 标签对象通过验证后的 API 读取。下载链接只指向加密后的 Git 文件。
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const tag = await checkedJson<{ sha: string }>(
    await ghFetch(token, `${repo}/git/tags`, postJson({
      tag: KEY_TAG, message: KEY_PREFIX + bytesToBase64(bytes), object: head, type: 'commit',
    })), '创建云盘密钥失败',
  );
  const ref = await ghFetch(token, `${repo}/git/refs`, postJson({ ref: `refs/tags/${KEY_TAG}`, sha: tag.sha }));
  if (ref.ok) return importKey(bytes);
  if (ref.status === 409 || ref.status === 422) {
    const concurrent = await readKey(owner, token);
    if (concurrent) return concurrent;
  }
  throw new Error(await errorMessage(ref, '保存云盘密钥失败'));
}

export async function connectCloudDrive(token: string): Promise<CloudDriveSession> {
  const user = await verifyToken(token);
  if (!user?.login) throw new Error('GitHub Token 无效');
  const result = await ensureRepo(token, user.login, CLOUD_DRIVE_REPO, {
    description: 'Minimal Desktop 云盘',
    requirePrivate: true,
  });
  if (!result.ok) throw new Error(result.message);
  const branch = result.branch || 'main';
  return { owner: user.login, branch, token, key: await ensureKey(user.login, branch, token) };
}

async function seal(key: CryptoKey, plain: ArrayBuffer, path: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(path) }, key, plain,
  );
  const result = new Uint8Array(iv.length + cipher.byteLength);
  result.set(iv);
  result.set(new Uint8Array(cipher), iv.length);
  return result;
}

async function unseal(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>, path: string): Promise<ArrayBuffer> {
  if (sealed.length < SEALED_OVERHEAD) throw new Error('云端文件不完整');
  try {
    return await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: sealed.subarray(0, NONCE_BYTES), additionalData: encoder.encode(path),
    }, key, sealed.subarray(NONCE_BYTES));
  } catch {
    throw new Error('云端文件完整性校验失败');
  }
}

async function getSnapshot(session: CloudDriveSession) {
  const { token, owner, branch, key } = session;
  const repo = repoPath(owner);
  const revision = await getBranchHead(token, owner, CLOUD_DRIVE_REPO, branch);
  if (!revision) throw new Error('无法读取云盘分支');
  const commit = await checkedJson<{ tree: { sha: string } }>(
    await ghFetch(token, `${repo}/git/commits/${revision}`), '读取云盘版本失败',
  );
  // 根目录树和 drive 子树都固定在同一次提交，索引和文件始终一起更新。
  const readTree = async (sha: string) => checkedJson<{ tree: { path: string; type: string; sha: string }[] }>(
    await ghFetch(token, `${repo}/git/trees/${sha}`), '读取云盘目录失败',
  );
  const tree = commit.tree.sha;
  const folder = (await readTree(tree)).tree.find((entry) => entry.path === 'drive' && entry.type === 'tree');
  const index = folder && (await readTree(folder.sha)).tree.find(
    (entry) => entry.path === 'index.bin' && entry.type === 'blob',
  );
  if (!index) return { revision, tree, files: [] as CloudDriveFile[] };

  const blob = await checkedJson<{ content: string; encoding: string }>(
    await ghFetch(token, `${repo}/git/blobs/${index.sha}`), '读取云盘索引失败',
  );
  if (blob.encoding !== 'base64') throw new Error('云盘索引格式无效');
  const contents = await unseal(key, new Uint8Array(base64ToBytes(blob.content)), INDEX_PATH);
  const parsed = driveIndexSchema.safeParse(JSON.parse(decoder.decode(contents)));
  if (!parsed.success || new Set(parsed.data.map((file) => file.id)).size !== parsed.data.length) {
    throw new Error('云盘索引格式无效');
  }
  return { revision, tree, files: parsed.data };
}

export async function listCloudDrive(session: CloudDriveSession): Promise<CloudDriveListing> {
  const { revision, files } = await getSnapshot(session);
  return { revision, files };
}

async function createBlob(session: CloudDriveSession, bytes: Uint8Array): Promise<string> {
  const { sha } = await checkedJson<{ sha: string }>(
    await ghFetch(session.token, `${repoPath(session.owner)}/git/blobs`, postJson({
      encoding: 'base64', content: bytesToBase64(bytes),
    })), '上传文件内容失败',
  );
  return sha;
}

async function updateIndex(
  session: CloudDriveSession,
  file: CloudDriveFile,
  fileSha: string | null,
): Promise<CloudDriveListing> {
  const { owner, branch, token, key } = session;
  const repo = repoPath(owner);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getSnapshot(session);
    const exists = current.files.some((entry) => entry.id === file.id);
    if (exists === Boolean(fileSha)) return current;
    const files = fileSha ? [file, ...current.files] : current.files.filter((entry) => entry.id !== file.id);
    const indexSha = await createBlob(session, await seal(key, encoder.encode(JSON.stringify(files)).buffer, INDEX_PATH));
    const tree = await checkedJson<{ sha: string }>(
      await ghFetch(token, `${repo}/git/trees`, postJson({
        base_tree: current.tree,
        tree: [
          { path: INDEX_PATH, mode: '100644', type: 'blob', sha: indexSha },
          { path: filePath(file.id), mode: '100644', type: 'blob', sha: fileSha },
        ],
      })), '更新云盘目录失败',
    );
    const commit = await checkedJson<{ sha: string }>(
      await ghFetch(token, `${repo}/git/commits`, postJson({
        message: fileSha ? 'Add cloud drive file' : 'Remove cloud drive file',
        tree: tree.sha, parents: [current.revision],
      })), '创建云盘版本失败',
    );
    const response = await ghFetch(token, `${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }), redirect: 'error',
    });
    if (response.ok) return { revision: commit.sha, files };
    if (response.status === 409 || response.status === 422) {
      const head = await getBranchHead(token, owner, CLOUD_DRIVE_REPO, branch);
      if (head && head !== current.revision) continue;
    }
    throw new Error(await errorMessage(response, '保存云盘版本失败'));
  }
  throw new Error('云盘正在被其他设备更新，请重试');
}

async function checkRepositoryPrivacy(session: CloudDriveSession): Promise<void> {
  const attributes = await checkedJson<{ private: boolean }>(
    await ghFetch(session.token, repoPath(session.owner), { cache: 'no-store', redirect: 'error' }),
    '检查云盘仓库失败',
  );
  if (attributes.private !== true) throw new Error('云盘需要私有仓库，请在 GitHub 检查仓库可见性');
}

export async function uploadCloudDriveFile(session: CloudDriveSession, file: File): Promise<CloudDriveListing> {
  if (file.size > CLOUD_DRIVE_MAX_BYTES) throw new Error('单文件最多 25 MiB');
  await checkRepositoryPrivacy(session);
  const entry = driveFileSchema.parse({
    id: crypto.randomUUID(), name: file.name, size: file.size, uploadedAt: new Date().toISOString(),
  });
  const sha = await createBlob(session, await seal(session.key, await file.arrayBuffer(), filePath(entry.id)));
  return updateIndex(session, entry, sha);
}

export async function removeCloudDriveFile(session: CloudDriveSession, file: CloudDriveFile): Promise<CloudDriveListing> {
  await checkRepositoryPrivacy(session);
  return updateIndex(session, file, null);
}

const PROXIES = [
  { name: 'GH-Proxy', origin: 'https://gh-proxy.org' },
  { name: 'GHFast', origin: 'https://ghfast.top' },
] as const;
const DIRECT_ROUTE = { name: 'GitHub 直连', origin: '' };
const SAMPLE_BYTES = 64 * 1024;

async function getRawLink(session: CloudDriveSession, path: string, revision: string, signal: AbortSignal): Promise<URL> {
  const response = await ghFetch(session.token, `${repoPath(session.owner)}/contents/${path}?ref=${encodeURIComponent(revision)}`, {
    headers: { Accept: 'application/vnd.github.object+json' }, signal, cache: 'no-store', redirect: 'error',
  });
  const { download_url } = await checkedJson<{ download_url: string }>(response, '获取临时下载链接失败');
  const url = new URL(download_url);
  const parts = url.pathname.split('/');
  if (url.origin !== 'https://raw.githubusercontent.com' || url.username || url.password || url.hash
    || parts[1]?.toLowerCase() !== session.owner.toLowerCase() || parts[2] !== CLOUD_DRIVE_REPO
    || parts.slice(3).join('/') !== `${revision}/${path}`
    || [...url.searchParams.values()].some((value) => value.includes(session.token))) {
    throw new Error('GitHub 返回了无法用于加速的链接');
  }
  return url;
}

async function readTransfer(response: Response, size: number, prefix: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || /^(text\/html|application\/json)/i.test(contentType) || !response.body) {
    throw new Error('下载线路不可用');
  }
  const bytes = new Uint8Array(size);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (!prefix || offset < size) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!prefix && value.length > size - offset) throw new Error('云端文件大小不匹配');
      const chunk = value.subarray(0, size - offset);
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (offset !== size) throw new Error('云端文件不完整');
  return bytes;
}

async function requestRoute(
  session: CloudDriveSession, path: string, revision: string,
  route: { origin: string }, size: number, probe: boolean,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; bytesPerSecond: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probe ? 2500 : 120_000);
  try {
    const raw = await getRawLink(session, path, revision, controller.signal);
    const url = route.origin ? `${route.origin}/${raw.href}` : raw.href;
    const started = performance.now();
    const response = await fetch(url, {
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
      headers: probe ? { Range: `bytes=0-${size - 1}` } : undefined,
      signal: controller.signal,
    });
    const bytes = await readTransfer(response, size, probe);
    return { bytes, bytesPerSecond: size * 1000 / Math.max(1, performance.now() - started) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadCloudDriveFile(
  session: CloudDriveSession,
  file: CloudDriveFile,
  revision: string,
  accelerate: boolean,
): Promise<{ contents: Blob; route: string }> {
  const path = filePath(file.id);
  const sealedSize = file.size + SEALED_OVERHEAD;
  const decrypt = async (bytes: Uint8Array<ArrayBuffer>, route: string) => {
    if (bytes.length !== sealedSize) throw new Error('云端文件大小不匹配');
    return { contents: new Blob([await unseal(session.key, bytes, path)]), route };
  };

  if (accelerate) {
    const sampleSize = Math.min(SAMPLE_BYTES, sealedSize);
    const routes = [DIRECT_ROUTE, ...PROXIES];
    const probes = await Promise.allSettled(routes.map(async (route) => {
      const probe = await requestRoute(session, path, revision, route, sampleSize, true);
      return { route, speed: probe.bytesPerSecond, sample: probe.bytes };
    }));
    const ranked = probes.flatMap((probe) => probe.status === 'fulfilled' ? [probe.value] : [])
      .sort((left, right) => right.speed - left.speed);
    for (const { route, sample } of ranked) {
      try {
        if (sampleSize === sealedSize) return await decrypt(sample, route.name);
        const { bytes } = await requestRoute(session, path, revision, route, sealedSize, false);
        return await decrypt(bytes, route.name);
      } catch { /* Continue with the next measured route. */ }
    }
  }

  const fileResult = await readRepoFileAtRef(session.token, session.owner, CLOUD_DRIVE_REPO, path, revision);
  if (!fileResult.ok || !fileResult.bytes) throw new Error(fileResult.message);
  return decrypt(new Uint8Array(fileResult.bytes), DIRECT_ROUTE.name);
}
