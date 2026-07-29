/**
 * 图标背景色提取模块
 *
 * 算法：
 * 1. 将图标绘制到 6×6 的离屏 canvas（每格取中心像素）
 * 2. 采样外围边框（共 6×6 - 4×4 = 20 个单元格）
 * 3. 忽略透明像素（alpha < 30）
 * 4. 将 RGB 量化为 32 阶桶，统计每个桶的频次
 * 5. 返回频次最高桶的中心色值（RGB hex）
 * 6. 若所有像素均透明则返回 null（调用方降级为默认背景）
 *
 * 取色在 <img> onLoad 时直接从 HTMLImageElement 提取，
 * 无需额外 fetch，跨域图片若 canvas 被污染则静默返回 null。
 */

const GRID = 6;
const QUANT = 32;
const ALPHA_THRESHOLD = 30;
const SAMPLE_SIZE = 48;

// 内存缓存（iconUrl → hex | null）
const memCache = new Map<string, string | null>();
const BG_CACHE_NS = 'bg_c:';

function toCacheKey(url: string): string {
  try { return BG_CACHE_NS + btoa(encodeURIComponent(url)).slice(0, 60); }
  catch { return BG_CACHE_NS + url.slice(0, 60).replace(/[^a-zA-Z0-9]/g, '_'); }
}

export function getBgColorCache(url: string): string | null | undefined {
  if (!url) return undefined;
  if (memCache.has(url)) return memCache.get(url);
  try {
    const raw = localStorage.getItem(toCacheKey(url));
    if (raw !== null) {
      const val = raw === '__null__' ? null : raw;
      memCache.set(url, val);
      return val;
    }
  } catch { /* ignore */ }
  return undefined;
}

function setBgColorCache(url: string, color: string | null): void {
  memCache.set(url, color);
  try { localStorage.setItem(toCacheKey(url), color ?? '__null__'); } catch { /* ignore */ }
}

/**
 * 直接从已加载完成的 HTMLImageElement 同步提取背景色。
 * 调用方须确保 img.complete === true。
 * 跨域 canvas 污染时静默返回 null。
 */
export function extractBgColorFromImg(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const cellPx = SAMPLE_SIZE / GRID;
    const buckets: Record<string, number> = {};

    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        // 跳过中心 4×4
        if (row >= 1 && row < GRID - 1 && col >= 1 && col < GRID - 1) continue;
        const x = Math.round((col + 0.5) * cellPx);
        const y = Math.round((row + 0.5) * cellPx);
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        if (a < ALPHA_THRESHOLD) continue;
        const qr = Math.round(r / QUANT) * QUANT;
        const qg = Math.round(g / QUANT) * QUANT;
        const qb = Math.round(b / QUANT) * QUANT;
        const key = `${qr},${qg},${qb}`;
        buckets[key] = (buckets[key] ?? 0) + 1;
      }
    }

    const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;
    const [qr, qg, qb] = sorted[0][0].split(',').map(Number);
    return '#' + [qr, qg, qb].map((v) => Math.min(v, 255).toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * 异步提取背景色（用于 DataURL / blob: / 本地已缓存图标）。
 * 优先读缓存；未命中则新建 Image 加载后提取。
 */
export function fetchIconBgColor(iconSrc: string, cacheKey?: string): Promise<string | null> {
  const key = cacheKey ?? iconSrc;
  if (!iconSrc) return Promise.resolve(null);
  const cached = getBgColorCache(key);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise<string | null>((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.onload = null; img.onerror = null; resolve(null); }, 5000);
    img.onload = () => {
      clearTimeout(timer);
      img.onload = null; img.onerror = null;
      const color = extractBgColorFromImg(img);
      setBgColorCache(key, color);
      resolve(color);
    };
    img.onerror = () => {
      clearTimeout(timer);
      img.onload = null; img.onerror = null;
      setBgColorCache(key, null);
      resolve(null);
    };
    img.src = iconSrc;
  });
}

/** 将取色结果写入缓存（供 onLoad 回调直接调用） */
export { setBgColorCache };
