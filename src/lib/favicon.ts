// 获取网站 favicon URL（无需外网，使用多源回退）
// 来源1: favicon.im（国内可访问的 favicon 聚合服务）
// 来源2: 直连网站 favicon.ico（组件层 onError 回退）
export function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://favicon.im/${u.hostname}`;
  } catch {
    return '';
  }
}

// 获取直连 favicon（图片加载失败时的备用地址）
export function getDirectFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/favicon.ico`;
  } catch {
    return '';
  }
}

// 规范化 URL（补全协议）
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// 多源探测：按优先级逐一尝试各 favicon 服务，返回第一个成功加载的 URL
// 每个来源最多等待 4 秒，全部失败则返回 undefined
export async function probeFavicon(rawUrl: string): Promise<string | undefined> {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname;
    const sources = [
      `https://favicon.im/${host}`,
      `https://www.google.com/s2/favicons?domain=${host}&sz=128`,
      `https://icons.duckduckgo.com/ip3/${host}.ico`,
      `${u.protocol}//${host}/favicon.ico`,
    ];
    for (const src of sources) {
      const ok = await new Promise<boolean>((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => {
          img.onload = img.onerror = null;
          resolve(false);
        }, 4000);
        img.onload = () => { clearTimeout(timer); resolve(true); };
        img.onerror = () => { clearTimeout(timer); resolve(false); };
        img.src = src;
      });
      if (ok) return src;
    }
  } catch { /* ignore */ }
  return undefined;
}

// 从 hostname 推断网站名称（简单启发式）
export function guessNameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');
    const part = host.split('.')[0];
    return part.charAt(0).toUpperCase() + part.slice(1);
  } catch {
    return '';
  }
}

// 获取网站标题（通过 CORS 代理）
export async function fetchSiteTitle(url: string): Promise<string> {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}