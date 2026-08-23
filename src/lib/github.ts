import type { DesktopBackup, SyncConfig, SyncSnapshot } from '@/types';
import { parseDesktopBackup } from '@/lib/desktopSchema';

const API = 'https://api.github.com';

export interface UploadResult {
  ok: boolean;
  message: string;
  remoteHead?: string;
  conflict?: boolean;
  unchanged?: boolean;
  backupBlobSha?: string;
  backgroundSha256?: string;
  backgroundBlobSha?: string;
}

export interface DownloadResult {
  ok: boolean;
  message: string;
  data?: DesktopBackup;
  remoteHead?: string;
  backupBlobSha?: string;
  backgroundFile?: File;
  backgroundBlobSha?: string;
}

export interface UploadOptions {
  /** 用户明确选择“本次覆盖”后跳过备份基线检查；分支更新仍保持 fast-forward。 */
  force?: boolean;
}

function encodedRepoPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** 背景媒体与 JSON 分离，桌面小改动不会重复提交大文件。 */
export function getBackgroundBackupPath(filePath: string): string {
  return `${filePath}.assets/background`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(content: string): Uint8Array {
  const binary = atob(content.replace(/\s/g, ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function bytesSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function gitBlobSha(content: string): Promise<string | null> {
  try {
    const contentBytes = new TextEncoder().encode(content);
    const headerBytes = new TextEncoder().encode(`blob ${contentBytes.byteLength}\0`);
    const objectBytes = new Uint8Array(headerBytes.byteLength + contentBytes.byteLength);
    objectBytes.set(headerBytes);
    objectBytes.set(contentBytes, headerBytes.byteLength);
    const digest = await crypto.subtle.digest('SHA-1', bytesToArrayBuffer(objectBytes));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    // SHA-1 摘要只用于省略重复上传；不可用时回退常规 Git API 流程。
    return null;
  }
}
// GitHub API 通用请求辅助
async function ghFetch(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}
// 识别认证/权限类错误，返回面向用户的提示
function authErrorMessage(res: Response): string | null {
  if (res.status === 401) return 'Token 已失效或已撤销，请重新连接';
  if (res.status === 403) return 'Token 权限不足，请确认已授予 Contents 读写权限';
  return null;
}
// 统一的失败消息构造：优先认证错误，其次 GitHub 返回的 message
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const auth = authErrorMessage(res);
  if (auth) return auth;
  const err = await res.json().catch(() => ({}));
  return (err as { message?: string }).message || fallback;
}

// 验证 Token 并获取用户信息
export async function verifyToken(token: string): Promise<{ login: string } | null> {
  const res = await ghFetch(token, '/user');
  if (!res.ok) return null;
  const data = await res.json();
  return { login: data.login as string };
}

// 检查仓库是否存在，不存在则自动创建（私有仓库）
export async function ensureRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<{ ok: boolean; created: boolean; message: string; branch?: string }> {
  const checkRes = await ghFetch(token, `/repos/${owner}/${repo}`);
  if (checkRes.ok) {
    const existing = await checkRes.json() as { default_branch?: string };
    return { ok: true, created: false, message: '仓库已存在', branch: existing.default_branch };
  }
  if (checkRes.status !== 404) {
    return {
      ok: false,
      created: false,
      message: await errorMessage(checkRes, '检查仓库失败'),
    };
  }
  const createRes = await ghFetch(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: repo,
      description: 'Minimal Desktop 桌面数据备份',
      private: true,
      auto_init: true,
    }),
  });
  if (!createRes.ok) {
    return { ok: false, created: false, message: await errorMessage(createRes, '创建仓库失败') };
  }
  const created = await createRes.json() as { default_branch?: string };
  return { ok: true, created: true, message: '仓库已自动创建', branch: created.default_branch };
}

// 获取用户仓库列表
export async function listRepos(token: string): Promise<{ name: string; full_name: string }[]> {
  const res = await ghFetch(token, '/user/repos?per_page=100&sort=updated');
  if (!res.ok) return [];
  const data = await res.json();
  return (data as { name: string; full_name: string }[]).map((r) => ({
    name: r.name,
    full_name: r.full_name,
  }));
}

/** 获取分支当前 HEAD；连接同步时记录它，后续上传据此做乐观并发检查。 */
export async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  branch = 'main',
): Promise<string | null> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!res.ok) return null;
  const data = await res.json() as { object?: { sha?: string } };
  return data.object?.sha ?? null;
}

type RemoteFileMetadata =
  | { state: 'found'; sha: string }
  | { state: 'missing' }
  | { state: 'error'; message: string };

async function getRemoteFileMetadata(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<RemoteFileMetadata> {
  const res = await ghFetch(
    token,
    `/repos/${owner}/${repo}/contents/${encodedRepoPath(filePath)}?ref=${encodeURIComponent(ref)}`,
  );
  if (res.status === 404) return { state: 'missing' };
  if (!res.ok) return { state: 'error', message: await errorMessage(res, '读取远端文件状态失败') };
  const file = await res.json() as { sha?: string };
  return file.sha
    ? { state: 'found', sha: file.sha }
    : { state: 'error', message: '远端备份文件状态无效' };
}

interface RepoFileResult {
  ok: boolean;
  message: string;
  bytes?: Uint8Array;
  blobSha?: string;
}

/** Contents API 对大文件不返回 content；此时自动回退 Git Blob API。 */
async function readRepoFileAtRef(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<RepoFileResult> {
  const res = await ghFetch(
    token,
    `/repos/${owner}/${repo}/contents/${encodedRepoPath(filePath)}?ref=${encodeURIComponent(ref)}`,
  );
  if (!res.ok) return { ok: false, message: await errorMessage(res, `下载失败 (${res.status})`) };
  const file = await res.json() as { content?: string; encoding?: string; sha?: string };
  if (file.content && file.encoding === 'base64') {
    return { ok: true, message: '读取成功', bytes: base64ToBytes(file.content), blobSha: file.sha };
  }
  if (!file.sha) return { ok: false, message: '远端文件内容为空' };

  const blobRes = await ghFetch(token, `/repos/${owner}/${repo}/git/blobs/${file.sha}`);
  if (!blobRes.ok) return { ok: false, message: await errorMessage(blobRes, '下载大文件失败') };
  const blob = await blobRes.json() as { content?: string; encoding?: string };
  if (!blob.content || blob.encoding !== 'base64') {
    return { ok: false, message: '远端大文件内容为空' };
  }
  return { ok: true, message: '读取成功', bytes: base64ToBytes(blob.content), blobSha: file.sha };
}

// ─── 上传核心：使用 Git Data API（Tree + Commit）彻底避免 SHA 竞态 ────────────
//
// Contents API（PUT /repos/.../contents/...）要求在请求体中提供文件的当前 blob SHA。
// 若两次上传之间文件被并发修改，本地缓存的 SHA 已过期，GitHub 会返回：
//   "does not match <旧 SHA>"
// 即使重试重新获取 SHA，网络延迟窗口内仍可能再次冲突。
//
// Git Data API 解决方案：
//   1. 获取 main 分支最新 commit SHA 及其 tree SHA
//   2. 创建新 blob（文件内容）
//   3. 基于原 tree 创建新 tree（只替换目标文件，其余不变）
//   4. 创建新 commit，指向新 tree，parent 为步骤 1 的 commit
//   5. 以 fast-forward 方式更新分支引用指向新 commit
// 整个流程不依赖文件 blob SHA，从根本上消除冲突。

export async function uploadToGithub(
  config: SyncConfig,
  snapshot: SyncSnapshot,
  options: UploadOptions = {},
): Promise<UploadResult> {
  return doUploadViaGitApi(config, snapshot, options);
}

async function doUploadViaGitApi(
  config: SyncConfig,
  snapshot: SyncSnapshot,
  options: UploadOptions,
): Promise<UploadResult> {
  const { token, owner, repo, branch = 'main' } = config;
  const filePath = config.path || 'desktop_backup.json';
  const backgroundPath = getBackgroundBackupPath(filePath);
  const validated = parseDesktopBackup(snapshot.data);
  if (!validated.ok) return { ok: false, message: validated.message };
  const jsonContent = JSON.stringify(validated.data, null, 2);
  const expectedBackupBlobSha = await gitBlobSha(jsonContent);
  const background = validated.data.background;

  // 步骤 1：获取分支最新 commit SHA 与 tree SHA
  const refRes = await ghFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!refRes.ok) {
    return { ok: false, message: await errorMessage(refRes, '获取分支信息失败') };
  }
  const refData = await refRes.json() as { object: { sha: string } };
  const latestCommitSha = refData.object.sha;

  const backgroundAlreadySynced = !background || (
    config.lastBackgroundSha256 === background.sha256
    && Boolean(config.lastBackgroundBlobSha)
  );
  if (
    !options.force
    && config.lastRemoteHead === latestCommitSha
    && config.lastBackupBlobSha === expectedBackupBlobSha
    && backgroundAlreadySynced
  ) {
    return {
      ok: true,
      unchanged: true,
      message: '云端已是最新数据',
      remoteHead: latestCommitSha,
      backupBlobSha: expectedBackupBlobSha,
      backgroundSha256: background?.sha256,
      backgroundBlobSha: background ? config.lastBackgroundBlobSha : undefined,
    };
  }

  const needsRemoteFileCheck = !options.force && (
    (!config.lastRemoteHead && !config.lastBackupBlobSha)
    || config.lastRemoteHead !== latestCommitSha
  );
  const latestFile = needsRemoteFileCheck
    ? await getRemoteFileMetadata(token, owner, repo, filePath, latestCommitSha)
    : null;
  if (latestFile?.state === 'error') return { ok: false, message: latestFile.message };

  if (!options.force && !config.lastRemoteHead && !config.lastBackupBlobSha) {
    if (latestFile?.state === 'found') {
      return {
        ok: false,
        conflict: true,
        remoteHead: latestCommitSha,
        message: '远端已有备份。请先下载云端数据，确认后再上传。',
      };
    }
  } else if (
    !options.force
    && latestFile?.state === 'found'
    && config.lastBackupBlobSha
    && config.lastBackupBlobSha !== latestFile.sha
  ) {
    return {
      ok: false,
      conflict: true,
      remoteHead: latestCommitSha,
      message: '远端数据已被其他设备更新。请先下载确认，或选择“本次覆盖”。',
    };
  } else if (
    !options.force
    && !config.lastBackupBlobSha
    && config.lastRemoteHead
    && config.lastRemoteHead !== latestCommitSha
  ) {
    // 分支 HEAD 可能只是 README 等无关文件变化。只在备份文件本身被修改时阻止覆盖；
    // 若目标备份已被删除，则允许本次上传重新创建。
    if (latestFile?.state === 'found') {
      const previousFile = await getRemoteFileMetadata(
        token,
        owner,
        repo,
        filePath,
        config.lastRemoteHead,
      );
      if (previousFile.state === 'error') return { ok: false, message: previousFile.message };
      if (previousFile.state !== 'found' || previousFile.sha !== latestFile.sha) {
        return {
          ok: false,
          conflict: true,
          remoteHead: latestCommitSha,
          message: '远端数据已被其他设备更新。请先下载确认，或选择“本次覆盖”。',
        };
      }
    }
  }

  const commitRes = await ghFetch(token, `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`);
  if (!commitRes.ok) return { ok: false, message: await errorMessage(commitRes, '获取 commit 信息失败') };
  const commitData = await commitRes.json() as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 步骤 2a：背景媒体单独作为 blob；相同媒体沿用当前 tree 中的 blob，避免重复上传。
  let backgroundBlobSha: string | undefined;
  if (
    background
    && config.lastBackgroundSha256 === background.sha256
    && config.lastBackgroundBlobSha
  ) {
    const currentTreeRes = await ghFetch(
      token,
      `/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`,
    );
    if (currentTreeRes.ok) {
      const currentTree = await currentTreeRes.json() as {
        tree?: { path?: string; type?: string; sha?: string }[];
      };
      const existing = currentTree.tree?.find((entry) => (
        entry.path === backgroundPath && entry.type === 'blob'
      ));
      if (existing?.sha === config.lastBackgroundBlobSha) backgroundBlobSha = existing.sha;
    }
  }

  if (background && !backgroundBlobSha) {
    const file = snapshot.backgroundFile;
    if (!file) return { ok: false, message: '背景媒体文件缺失，无法创建完整备份' };
    if (file.size !== background.size) return { ok: false, message: '背景媒体大小已变化，请重新上传' };
    const mediaBytes = new Uint8Array(await file.arrayBuffer());
    if (await bytesSha256(mediaBytes) !== background.sha256) {
      return { ok: false, message: '背景媒体校验失败，请重新选择后上传' };
    }
    const mediaBlobRes = await ghFetch(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: bytesToBase64(mediaBytes), encoding: 'base64' }),
    });
    if (!mediaBlobRes.ok) {
      return { ok: false, message: await errorMessage(mediaBlobRes, '上传背景媒体失败') };
    }
    const mediaBlob = await mediaBlobRes.json() as { sha: string };
    backgroundBlobSha = mediaBlob.sha;
  }

  // 步骤 2b：创建备份 JSON blob。使用 UTF-8 避免对 JSON 再做一层 Base64 膨胀。
  const blobRes = await ghFetch(token, `/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: jsonContent, encoding: 'utf-8' }),
  });
  if (!blobRes.ok) return { ok: false, message: await errorMessage(blobRes, '创建文件内容失败') };
  const blobData = await blobRes.json() as { sha: string };
  // 步骤 3：创建新 tree（替换 JSON；存在本地背景时同时更新媒体文件）
  const treeEntries = [{
    path: filePath,
    mode: '100644',
    type: 'blob',
    sha: blobData.sha,
  }];
  if (background && backgroundBlobSha) {
    treeEntries.push({
      path: backgroundPath,
      mode: '100644',
      type: 'blob',
      sha: backgroundBlobSha,
    });
  }
  const treeRes = await ghFetch(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });
  if (!treeRes.ok) return { ok: false, message: await errorMessage(treeRes, '创建文件树失败') };
  const treeData = await treeRes.json() as { sha: string };
  if (treeData.sha === baseTreeSha) {
    return {
      ok: true,
      unchanged: true,
      message: '云端已是最新数据',
      remoteHead: latestCommitSha,
      backupBlobSha: blobData.sha,
      backgroundSha256: background?.sha256,
      backgroundBlobSha,
    };
  }
  // 步骤 4：创建新 commit
  const newCommitRes = await ghFetch(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `chore: sync desktop data ${new Date().toISOString()}`,
      tree: treeData.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!newCommitRes.ok) return { ok: false, message: await errorMessage(newCommitRes, '创建 commit 失败') };
  const newCommitData = await newCommitRes.json() as { sha: string };
  // 步骤 5：更新分支引用
  const updateRes = await ghFetch(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommitData.sha }),
  });
  if (!updateRes.ok) {
    const currentRemoteHead = updateRes.status === 409 || updateRes.status === 422
      ? await getBranchHead(token, owner, repo, branch) ?? latestCommitSha
      : latestCommitSha;
    return {
      ok: false,
      conflict: updateRes.status === 409 || updateRes.status === 422,
      remoteHead: currentRemoteHead,
      message: await errorMessage(updateRes, '更新分支引用失败'),
    };
  }

  return {
    ok: true,
    message: background ? '同步成功（含背景媒体）' : '同步成功',
    remoteHead: newCommitData.sha,
    backupBlobSha: blobData.sha,
    backgroundSha256: background?.sha256,
    backgroundBlobSha,
  };
}

// 从 GitHub 下载数据；JSON 与背景媒体固定读取同一个 commit 快照。
export async function downloadFromGithub(
  config: SyncConfig,
): Promise<DownloadResult> {
  const { token, owner, repo, branch = 'main' } = config;
  const filePath = config.path || 'desktop_backup.json';

  const remoteHead = await getBranchHead(token, owner, repo, branch);
  if (!remoteHead) return { ok: false, message: '无法读取远端分支状态' };

  const backupFile = await readRepoFileAtRef(token, owner, repo, filePath, remoteHead);
  if (!backupFile.ok || !backupFile.bytes) return { ok: false, message: backupFile.message };
  let parsed: ReturnType<typeof parseDesktopBackup>;
  try {
    parsed = parseDesktopBackup(JSON.parse(new TextDecoder().decode(backupFile.bytes)));
  } catch {
    return { ok: false, message: '备份文件不是有效 JSON' };
  }
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (!parsed.data.background) {
    return {
      ok: true,
      message: '同步成功',
      data: parsed.data,
      remoteHead,
      backupBlobSha: backupFile.blobSha,
    };
  }

  const media = await readRepoFileAtRef(
    token,
    owner,
    repo,
    getBackgroundBackupPath(filePath),
    remoteHead,
  );
  if (!media.ok || !media.bytes) {
    return { ok: false, message: `备份中的背景媒体无法读取：${media.message}` };
  }
  const metadata = parsed.data.background;
  if (media.bytes.byteLength !== metadata.size) {
    return { ok: false, message: '备份中的背景媒体大小校验失败' };
  }
  if (await bytesSha256(media.bytes) !== metadata.sha256) {
    return { ok: false, message: '备份中的背景媒体完整性校验失败' };
  }
  const backgroundFile = new File([bytesToArrayBuffer(media.bytes)], metadata.fileName, {
    type: metadata.mimeType,
    lastModified: metadata.lastModified,
  });
  return {
    ok: true,
    message: '同步成功（含背景媒体）',
    data: parsed.data,
    remoteHead,
    backupBlobSha: backupFile.blobSha,
    backgroundFile,
    backgroundBlobSha: media.blobSha,
  };
}
