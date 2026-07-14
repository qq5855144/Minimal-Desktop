import type { DesktopData, SyncConfig } from '@/types';

const API = 'https://api.github.com';

// 验证 Token 并获取用户信息
export async function verifyToken(token: string): Promise<{ login: string } | null> {
  const res = await fetch(`${API}/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
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
  // 检查是否存在
  const checkRes = await fetch(`${API}/repos/${owner}/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (checkRes.ok) return { ok: true, created: false, message: '仓库已存在' };

  // 不存在，自动创建
  const createRes = await fetch(`${API}/user/repos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
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
  const res = await fetch(`${API}/user/repos?per_page=100&sort=updated`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data as { name: string; full_name: string }[]).map((r) => ({
    name: r.name,
    full_name: r.full_name,
  }));
}

// 获取文件 SHA（用于更新已存在文件）
async function getFileSha(config: SyncConfig, path: string): Promise<string | null> {
  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data as { sha?: string }).sha ?? null;
}

// 上传数据到 GitHub
export async function uploadToGithub(
  config: SyncConfig,
  data: DesktopData,
): Promise<{ ok: boolean; message: string }> {
  const path = config.path || 'ios-desktop.json';
  const sha = await getFileSha(config, path);
  // 确保 pinHash 和 privacyItems 都带入备份
  const payload: DesktopData = { ...data };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
  const res = await fetch(`${API}/repos/${config.owner}/${config.repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `chore: sync ios-desktop data ${new Date().toISOString()}`,
      content,
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, message: (err as { message?: string }).message || `上传失败 (${res.status})` };
  }
  return { ok: true, message: '同步成功' };
}

// 从 GitHub 下载数据
export async function downloadFromGithub(
  config: SyncConfig,
): Promise<{ ok: boolean; message: string; data?: DesktopData }> {
  const path = config.path || 'ios-desktop.json';
  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return { ok: false, message: `下载失败 (${res.status})` };
  const data = await res.json();
  const content = (data as { content?: string }).content;
  if (!content) return { ok: false, message: '文件内容为空' };
  const decoded = decodeURIComponent(escape(atob(content.replace(/\n/g, ''))));
  const parsed = JSON.parse(decoded) as DesktopData;
  if (!parsed.pages || !Array.isArray(parsed.pages)) {
    return { ok: false, message: '数据格式错误' };
  }
  return { ok: true, message: '同步成功', data: parsed };
}