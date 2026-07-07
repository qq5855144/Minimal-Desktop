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

// 获取网站标题（通过 CORS 代理）
export async function fetchSiteTitle(url: string): Promise<string> {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}