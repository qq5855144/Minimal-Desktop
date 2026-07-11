/**
 * 图标本地缓存模块
 * - 将远程图标 URL fetch 转为 base64 DataURL 存入 localStorage
 * - key: btoa(url) 截断，避免特殊字符
 * - 删除应用时调用 evictIconCache 清理孤儿缓存
 * - 存储上限 100 条，超出时 LRU 淘汰最旧条目
 */

const CACHE_NS = 'icon_c:';
const META_KEY = 'icon_c_meta'; // JSON: { [cacheKey]: timestamp }
const MAX_ENTRIES = 100;
const inflightFetches = new Map<string, Promise<string | null>>();

function toCacheKey(url: string): string {
  // btoa 不支持多字节字符，先 encodeURIComponent 再 btoa
  try {
    return CACHE_NS + btoa(encodeURIComponent(url)).slice(0, 60);
  } catch {
    return CACHE_NS + url.slice(0, 60).replace(/[^a-zA-Z0-9]/g, '_');
  }
}

function readMeta(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveMeta(meta: Record<string, number>): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch { /* ignore */ }
}

/** 从缓存读取图标 DataURL，未命中返回 null */
export function getIconCache(url: string): string | null {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
  try {
    return localStorage.getItem(toCacheKey(url));
  } catch {
    return null;
  }
}

/** 将 DataURL 写入缓存，超限时 LRU 淘汰 */
export function setIconCache(url: string, dataUrl: string): void {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
  const key = toCacheKey(url);
  const meta = readMeta();

  // 超限：移除最旧的条目
  const keys = Object.keys(meta);
  if (keys.length >= MAX_ENTRIES && !meta[key]) {
    const oldest = keys.sort((a, b) => meta[a] - meta[b]).slice(0, keys.length - MAX_ENTRIES + 1);
    for (const k of oldest) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
      delete meta[k];
    }
  }

  try {
    localStorage.setItem(key, dataUrl);
    meta[key] = Date.now();
    saveMeta(meta);
  } catch {
    // localStorage 空间不足时静默跳过
  }
}

/** 删除指定 URL 的缓存条目 */
export function deleteIconCache(url: string): void {
  if (!url) return;
  const key = toCacheKey(url);
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  const meta = readMeta();
  delete meta[key];
  saveMeta(meta);
}

/**
 * 清理孤儿缓存：遍历 meta，删除不在 validUrls 中的条目
 * 调用时机：整体数据重新加载后（importData / removeItem）
 */
export function pruneIconCaches(validUrls: Set<string>): void {
  const meta = readMeta();
  const validKeys = new Set([...validUrls].map(toCacheKey));
  for (const k of Object.keys(meta)) {
    if (!validKeys.has(k)) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
      delete meta[k];
    }
  }
  saveMeta(meta);
}

/**
 * 异步加载远程图标并缓存为 base64 DataURL。
 *
 * 使用无 crossOrigin 属性的 <img> + Canvas 方案：
 *  - 不设置 crossOrigin='anonymous'，浏览器以普通模式加载图片，不发送 Origin 头
 *  - 服务端无需返回 CORS 头，不会产生任何控制台 CORS 警告
 *  - 图片加载后尝试 canvas.toDataURL()；若跨域导致 canvas 被污染（SecurityError）则静默忽略
 *  - 缓存失败时返回 null，图标依旧可由组件层 <img src> 正常显示
 */
export function fetchAndCacheIcon(url: string): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  if (url.startsWith('data:') || url.startsWith('blob:')) return Promise.resolve(url);

  const cached = getIconCache(url);
  if (cached) return Promise.resolve(cached);

  const inflight = inflightFetches.get(url);
  if (inflight) return inflight;

  const request = new Promise<string | null>((resolve) => {
    const img = new Image();
    // 不设置 crossOrigin='anonymous'：浏览器以普通模式加载，
    // 服务端无 ACAO 头时也不会触发控制台 CORS 警告。
    // 代价是跨域图片会污染 canvas → toDataURL 抛 SecurityError → 静默忽略，不缓存。

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      inflightFetches.delete(url);
    };

    const timer = setTimeout(() => { cleanup(); resolve(null); }, 6000);

    img.onload = () => {
      clearTimeout(timer);
      cleanup();
      try {
        const size = Math.min(Math.max(img.naturalWidth, img.naturalHeight, 1), 256);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/png');
        setIconCache(url, dataUrl);
        resolve(dataUrl);
      } catch {
        // canvas 被污染（CORS 拒绝）— 静默忽略，不缓存，图标依旧可显示
        resolve(null);
      }
    };

    img.onerror = () => { clearTimeout(timer); cleanup(); resolve(null); };
    img.src = url;
  });

  inflightFetches.set(url, request);
  return request;
}
