import {
  base64ToBytes, bytesToBase64, ensureRepo, errorMessage, getBranchHead, ghFetch,
  readRepoFileAtRef, verifyToken,
} from './github';
import {
  CLOUD_DRIVE_CHUNK_BYTES, type CloudDriveFile, type CloudDriveFolder, type CloudDriveIndex,
  driveEntryName, driveFileParts, driveFileSchema, driveFolderSubtree, parseCloudDriveIndex,
} from './cloudDriveModel';

export type { CloudDriveFile, CloudDriveFolder } from './cloudDriveModel';

export const CLOUD_DRIVE_REPO = 'minimal-desktop-drive';
const INDEX_PATH = 'drive/index.bin';
const KEY_TAG = 'minimal-desktop-drive-key-v1';
const KEY_PREFIX = 'minimal-desktop-drive-key-v1:';
const NONCE_BYTES = 12;
const SEALED_OVERHEAD = NONCE_BYTES + 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface CloudDriveSession {
  owner: string;
  branch: string;
  token: string;
  key: CryptoKey;
}

export interface CloudDriveListing extends CloudDriveIndex {
  revision: string;
}

export interface CloudDriveTransfer {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

interface FileChange {
  path: string;
  sha: string | null;
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

export async function openSharedCloudDrive(token: string, owner: string): Promise<CloudDriveSession> {
  if (!/^[\da-z](?:[\da-z-]{0,38})$/i.test(owner)) throw new Error('云盘分享链接无效');
  const attributes = await checkedJson<{ default_branch: string; private: boolean }>(
    await ghFetch(token, repoPath(owner), { cache: 'no-store', redirect: 'error' }), '无法访问分享文件',
  );
  if (attributes.private !== true) throw new Error('分享链接需要访问原私有云盘的权限');
  const key = await readKey(owner, token);
  if (!key) throw new Error('无法读取分享文件');
  return { owner, branch: attributes.default_branch || 'main', token, key };
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
  if (!index) return { revision, tree, files: [] as CloudDriveFile[], folders: [] as CloudDriveFolder[] };

  const blob = await checkedJson<{ content: string; encoding: string }>(
    await ghFetch(token, `${repo}/git/blobs/${index.sha}`), '读取云盘索引失败',
  );
  if (blob.encoding !== 'base64') throw new Error('云盘索引格式无效');
  const contents = await unseal(key, new Uint8Array(base64ToBytes(blob.content)), INDEX_PATH);
  const parsed = parseCloudDriveIndex(JSON.parse(decoder.decode(contents)));
  return { revision, tree, ...parsed };
}

export async function listCloudDrive(session: CloudDriveSession): Promise<CloudDriveListing> {
  const { revision, files, folders } = await getSnapshot(session);
  return { revision, files, folders };
}

async function createBlob(session: CloudDriveSession, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  const { sha } = await checkedJson<{ sha: string }>(
    await ghFetch(session.token, `${repoPath(session.owner)}/git/blobs`, {
      ...postJson({ encoding: 'base64', content: bytesToBase64(bytes) }), signal,
    }), '上传文件内容失败',
  );
  return sha;
}

async function updateIndex(
  session: CloudDriveSession,
  message: string,
  edit: (index: CloudDriveIndex) => { index: CloudDriveIndex; entries?: FileChange[] } | null,
  signal?: AbortSignal,
): Promise<CloudDriveListing> {
  const { owner, branch, token, key } = session;
  const repo = repoPath(owner);
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const current = await getSnapshot(session);
    const change = edit(current);
    if (!change) return current;
    const { index, entries = [] } = change;
    const sealed = await seal(key, encoder.encode(JSON.stringify(index)).buffer, INDEX_PATH);
    const indexSha = await createBlob(session, sealed, signal);
    const tree = await checkedJson<{ sha: string }>(
      await ghFetch(token, repo + '/git/trees', {
        ...postJson({
          base_tree: current.tree,
          tree: [{ path: INDEX_PATH, sha: indexSha }, ...entries].map((entry) => (
            { ...entry, mode: '100644', type: 'blob' }
          )),
        }),
        signal,
      }), '更新云盘目录失败',
    );
    const commit = await checkedJson<{ sha: string }>(
      await ghFetch(token, repo + '/git/commits', {
        ...postJson({ message, tree: tree.sha, parents: [current.revision] }), signal,
      }), '创建云盘版本失败',
    );
    signal?.throwIfAborted();
    const response = await ghFetch(token, repo + '/git/refs/heads/' + encodeURIComponent(branch), {
      method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }), redirect: 'error',
    });
    if (response.ok) return { revision: commit.sha, ...index };
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

function checkFolder(index: CloudDriveIndex, folderId: string | null): void {
  if (folderId && !index.folders.some((folder) => folder.id === folderId)) {
    throw new Error('目标文件夹不存在，请刷新云盘');
  }
}

function checkFolderName(index: CloudDriveIndex, name: string, folderId: string | null, skipId?: string): void {
  if (index.folders.some((folder) => (
    folder.id !== skipId && (folder.folderId ?? null) === folderId && folder.name === name
  ))) throw new Error('该目录已有同名文件夹');
}

export async function uploadCloudDriveFile(
  session: CloudDriveSession, file: File, folderId: string | null = null, transfer: CloudDriveTransfer = {},
): Promise<CloudDriveListing> {
  const { signal, onProgress } = transfer;
  signal?.throwIfAborted();
  await checkRepositoryPrivacy(session);
  if (folderId) checkFolder(await getSnapshot(session), folderId);
  const entry = driveFileSchema.parse({
    id: crypto.randomUUID(), name: driveEntryName(file.name), size: file.size, uploadedAt: new Date().toISOString(),
    folderId, mime: file.type || undefined,
    chunkSize: file.size > CLOUD_DRIVE_CHUNK_BYTES ? CLOUD_DRIVE_CHUNK_BYTES : undefined,
  });
  const entries: FileChange[] = [];
  for (const { path, offset, size } of driveFileParts(entry)) {
    signal?.throwIfAborted();
    const bytes = await file.slice(offset, offset + size).arrayBuffer();
    const sha = await createBlob(session, await seal(session.key, bytes, path), signal);
    entries.push({ path, sha });
    onProgress?.(offset + size, file.size);
  }
  return updateIndex(session, 'Add cloud drive file', (index) => {
    checkFolder(index, folderId);
    return { index: { files: [entry, ...index.files], folders: index.folders }, entries };
  }, signal);
}

export async function createCloudDriveFolder(
  session: CloudDriveSession, input: string, folderId: string | null,
): Promise<CloudDriveListing> {
  const name = driveEntryName(input);
  const folder = { id: crypto.randomUUID(), name, folderId };
  await checkRepositoryPrivacy(session);
  return updateIndex(session, 'Create cloud drive folder', (index) => {
    checkFolder(index, folderId);
    checkFolderName(index, name, folderId);
    return { index: { files: index.files, folders: [...index.folders, folder] } };
  });
}

export async function editCloudDriveEntry(
  session: CloudDriveSession, entryId: string, input: string, folderId: string | null,
): Promise<CloudDriveListing> {
  const name = driveEntryName(input);
  await checkRepositoryPrivacy(session);
  return updateIndex(session, 'Edit cloud drive entry', (index) => {
    checkFolder(index, folderId);
    const folder = index.folders.find((entry) => entry.id === entryId);
    const file = index.files.find((entry) => entry.id === entryId);
    const entry = folder ?? file;
    if (!entry) throw new Error('该项目已不存在');
    if (entry.name === name && (entry.folderId ?? null) === folderId) return null;
    if (folder) {
      if (folderId && driveFolderSubtree(index.folders, folder.id).has(folderId)) {
        throw new Error('不能移动到自身或子文件夹');
      }
      checkFolderName(index, name, folderId, folder.id);
      return { index: {
        files: index.files, folders: index.folders.map((item) => item.id === entryId ? { ...item, name, folderId } : item),
      } };
    }
    return { index: {
      folders: index.folders, files: index.files.map((item) => item.id === entryId ? { ...item, name, folderId } : item),
    } };
  });
}

export async function removeCloudDriveFile(session: CloudDriveSession, file: CloudDriveFile): Promise<CloudDriveListing> {
  await checkRepositoryPrivacy(session);
  return updateIndex(session, 'Remove cloud drive file', (index) => {
    const current = index.files.find((entry) => entry.id === file.id);
    if (!current) return null;
    return {
      index: { folders: index.folders, files: index.files.filter((entry) => entry.id !== file.id) },
      entries: [...driveFileParts(current)].map((part) => ({ path: part.path, sha: null })),
    };
  });
}

export async function removeCloudDriveFolder(session: CloudDriveSession, folderId: string): Promise<CloudDriveListing> {
  await checkRepositoryPrivacy(session);
  return updateIndex(session, 'Remove cloud drive folder', (index) => {
    if (!index.folders.some((folder) => folder.id === folderId)) return null;
    const ids = driveFolderSubtree(index.folders, folderId);
    const included = (file: CloudDriveFile) => file.folderId ? ids.has(file.folderId) : false;
    return {
      index: {
        folders: index.folders.filter((folder) => !ids.has(folder.id)),
        files: index.files.filter((file) => !included(file)),
      },
      entries: index.files.filter(included).flatMap((file) => (
        [...driveFileParts(file)].map((part) => ({ path: part.path, sha: null }))
      )),
    };
  });
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
  route: { origin: string }, size: number, probe: boolean, signal?: AbortSignal,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; bytesPerSecond: number }> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
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
    signal?.removeEventListener('abort', abort);
  }
}

type DownloadRoute = { name: string; origin: string };

async function downloadPart(
  session: CloudDriveSession, path: string, size: number, revision: string,
  preferred: DownloadRoute | null | undefined, signal?: AbortSignal,
): Promise<{ bytes: ArrayBuffer; route: DownloadRoute | null }> {
  const sealedSize = size + SEALED_OVERHEAD;
  const decrypt = async (bytes: Uint8Array<ArrayBuffer>, route: DownloadRoute | null) => {
    if (bytes.length !== sealedSize) throw new Error('云端文件大小不匹配');
    return { bytes: await unseal(session.key, bytes, path), route };
  };

  if (preferred) {
    try {
      const { bytes } = await requestRoute(session, path, revision, preferred, sealedSize, false, signal);
      return await decrypt(bytes, preferred);
    } catch {
      signal?.throwIfAborted();
    }
  }
  if (preferred !== null) {
    const sampleSize = Math.min(SAMPLE_BYTES, sealedSize);
    const routes = [DIRECT_ROUTE, ...PROXIES];
    const probes = await Promise.allSettled(routes.map(async (route) => {
      const probe = await requestRoute(session, path, revision, route, sampleSize, true, signal);
      return { route, speed: probe.bytesPerSecond, sample: probe.bytes };
    }));
    signal?.throwIfAborted();
    const ranked = probes.flatMap((probe) => probe.status === 'fulfilled' ? [probe.value] : [])
      .sort((left, right) => right.speed - left.speed);
    for (const { route, sample } of ranked) {
      try {
        if (sampleSize === sealedSize) return await decrypt(sample, route);
        const { bytes } = await requestRoute(session, path, revision, route, sealedSize, false, signal);
        return await decrypt(bytes, route);
      } catch {
        signal?.throwIfAborted();
      }
    }
  }

  const result = await readRepoFileAtRef(session.token, session.owner, CLOUD_DRIVE_REPO, path, revision, signal);
  if (!result.ok || !result.bytes) throw new Error(result.message);
  return decrypt(new Uint8Array(result.bytes), null);
}

export interface CloudDriveDownload {
  contents: Blob;
  route: string;
  release?: () => Promise<void>;
}

async function openTemporaryFile() {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  const name = crypto.randomUUID();
  let folder: FileSystemDirectoryHandle | undefined;
  try {
    const root = await navigator.storage.getDirectory();
    folder = await root.getDirectoryHandle('minimal-desktop-drive-downloads', { create: true });
    const file = await folder.getFileHandle(name, { create: true });
    const writer = await file.createWritable();
    const directory = folder;
    return { file, writer, release: () => directory.removeEntry(name).catch(() => undefined) };
  } catch {
    await folder?.removeEntry(name).catch(() => undefined);
    return null;
  }
}

export async function downloadCloudDriveFile(
  session: CloudDriveSession, file: CloudDriveFile, revision: string,
  accelerate: boolean, transfer: CloudDriveTransfer = {},
): Promise<CloudDriveDownload> {
  const { signal, onProgress } = transfer;
  signal?.throwIfAborted();
  const temporary = file.chunkSize ? await openTemporaryFile() : null;
  const fragments: ArrayBuffer[] = [];
  const mime = file.mime || 'application/octet-stream';
  let preferred: DownloadRoute | null | undefined = accelerate ? undefined : null;
  try {
    for (const { path, size, offset } of driveFileParts(file)) {
      signal?.throwIfAborted();
      const part = await downloadPart(session, path, size, revision, preferred, signal);
      signal?.throwIfAborted();
      if (temporary) await temporary.writer.write(part.bytes);
      else fragments.push(part.bytes);
      preferred = part.route;
      onProgress?.(offset + size, file.size);
    }
    const route = preferred?.name ?? DIRECT_ROUTE.name;
    if (!temporary) return { contents: new Blob(fragments, { type: mime }), route };
    await temporary.writer.close();
    const contents = (await temporary.file.getFile()).slice(0, file.size, mime);
    return { contents, route, release: temporary.release };
  } catch (error) {
    await temporary?.writer.abort().catch(() => undefined);
    await temporary?.release();
    throw error;
  }
}
