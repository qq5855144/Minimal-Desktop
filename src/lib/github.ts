import type { DesktopData, SyncConfig } from '@/types';

const API = 'https://api.github.com';

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
): Promise<{ ok: boolean; created: boolean; message: string }> {
  const checkRes = await ghFetch(token, `/repos/${owner}/${repo}`);
  if (checkRes.ok) return { ok: true, created: false, message: '仓库已存在' };

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
    const err = await createRes.json().catch(() => ({}));
    return { ok: false, created: false, message: (err as { message?: string }).message || '创建仓库失败' };
  }
  return { ok: true, created: true, message: '仓库已自动创建' };
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
//   5. 强制更新分支引用指向新 commit
// 整个流程不依赖文件 blob SHA，从根本上消除冲突。

// 全局上传锁，防止并发上传
let uploadLock = false;

export async function uploadToGithub(
  config: SyncConfig,
  data: DesktopData,
): Promise<{ ok: boolean; message: string }> {
  if (uploadLock) return { ok: false, message: '上传进行中，请稍后重试' };
  uploadLock = true;
  try {
    return await doUploadViaGitApi(config, data);
  } finally {
    uploadLock = false;
  }
}

async function doUploadViaGitApi(
  config: SyncConfig,
  data: DesktopData,
): Promise<{ ok: boolean; message: string }> {
  const { token, owner, repo, branch = 'main' } = config;
  const filePath = config.path || 'desktop_backup.json';
  const jsonContent = JSON.stringify(data, null, 2);

  // 步骤 1：获取分支最新 commit SHA 与 tree SHA
  const refRes = await ghFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (!refRes.ok) {
    const err = await refRes.json().catch(() => ({}));
    return { ok: false, message: (err as { message?: string }).message || '获取分支信息失败' };
  }
  const refData = await refRes.json() as { object: { sha: string } };
  const latestCommitSha = refData.object.sha;

  const commitRes = await ghFetch(token, `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`);
  if (!commitRes.ok) return { ok: false, message: '获取 commit 信息失败' };
  const commitData = await commitRes.json() as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 步骤 2：创建文件 blob
  const blobRes = await ghFetch(token, `/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({
      content: btoa(unescape(encodeURIComponent(jsonContent))),
      encoding: 'base64',
    }),
  });
  if (!blobRes.ok) return { ok: false, message: '创建文件内容失败' };
  const blobData = await blobRes.json() as { sha: string };

  // 步骤 3：创建新 tree（仅替换目标文件）
  const treeRes = await ghFetch(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [{
        path: filePath,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      }],
    }),
  });
  if (!treeRes.ok) return { ok: false, message: '创建文件树失败' };
  const treeData = await treeRes.json() as { sha: string };

  // 步骤 4：创建新 commit
  const newCommitRes = await ghFetch(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `chore: sync desktop data ${new Date().toISOString()}`,
      tree: treeData.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!newCommitRes.ok) return { ok: false, message: '创建 commit 失败' };
  const newCommitData = await newCommitRes.json() as { sha: string };

  // 步骤 5：更新分支引用
  const updateRes = await ghFetch(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommitData.sha }),
  });
  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    return { ok: false, message: (err as { message?: string }).message || '更新分支引用失败' };
  }

  return { ok: true, message: '同步成功' };
}

// 从 GitHub 下载数据（继续使用 Contents API，只读无竞态问题）
export async function downloadFromGithub(
  config: SyncConfig,
): Promise<{ ok: boolean; message: string; data?: DesktopData }> {
  const { token, owner, repo, branch = 'main' } = config;
  const filePath = config.path || 'desktop_backup.json';
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');

  const res = await ghFetch(token, `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`);
  if (!res.ok) return { ok: false, message: `下载失败 (${res.status})` };

  const file = await res.json() as { content?: string };
  if (!file.content) return { ok: false, message: '文件内容为空' };

  const decoded = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))));
  const parsed = JSON.parse(decoded) as DesktopData;
  if (!parsed.pages || !Array.isArray(parsed.pages)) {
    return { ok: false, message: '数据格式错误' };
  }
  return { ok: true, message: '同步成功', data: parsed };
}