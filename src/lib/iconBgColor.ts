/**
 * 图标背景色提取模块
 *
 * 目的：有些图标边缘有透明区域，视觉上比正常图标小。
 * 通过提取图标内容最外圈不透明像素的颜色作为背景色，
 * 让透明区域填充与图标内容边缘一致的颜色，视觉上无缝衔接。
 *
 * 算法：
 * 1. 将图标绘入 64×64 canvas
 * 2. 从四条边各取 6 个位置，每个位置从外向内扫描，
 *    找到第一个不透明像素（alpha ≥ 30）
 * 3. 对采集到的不透明像素做 RGB 量化聚类，取频次最高的色
 * 4. 若所有边缘均透明则返回 null（降级白色背景）
 */

const EDGE_SAMPLES = 8;
const QUANT = 32;
const ALPHA_THRESHOLD = 30;
const SAMPLE_SIZE = 64;

const memCache = new Map<string, string | null>();
const BG_CACHE_NS = 'bg_c2:'; // 版本号避免旧缓存污染

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

export function setBgColorCache(url: string, color: string | null): void {
  memCache.set(url, color);
  try { localStorage.setItem(toCacheKey(url), color ?? '__null__'); } catch { /* ignore */ }
}

/**
 * 从 HTMLImageElement 提取背景色。
 * 从四条边各取 EDGE_SAMPLES 个位置，每个位置从外向内扫描
 * 找到第一个不透明像素，聚类后取主色。
 */
export function extractBgColorFromImg(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const S = SAMPLE_SIZE;
    const step = S / EDGE_SAMPLES;
    const buckets: Record<string, number> = {};

    const addPixel = (x: number, y: number) => {
      const [r, g, b, a] = ctx.getImageData(
        Math.max(0, Math.min(S - 1, Math.round(x))),
        Math.max(0, Math.min(S - 1, Math.round(y))),
        1, 1
      ).data;
      if (a < ALPHA_THRESHOLD) return;
      const qr = Math.round(r / QUANT) * QUANT;
      const qg = Math.round(g / QUANT) * QUANT;
      const qb = Math.round(b / QUANT) * QUANT;
      const key = `${qr},${qg},${qb}`;
      buckets[key] = (buckets[key] ?? 0) + 1;
    };

    for (let i = 0; i < EDGE_SAMPLES; i++) {
      const pos = step * (i + 0.5);
      // 顶边：从上往下扫
      for (let d = 0; d < S; d++) { const [,,,a] = ctx.getImageData(Math.round(pos), d, 1, 1).data; if (a >= ALPHA_THRESHOLD) { addPixel(pos, d); break; } }
      // 底边：从下往上扫
      for (let d = S - 1; d >= 0; d--) { const [,,,a] = ctx.getImageData(Math.round(pos), d, 1, 1).data; if (a >= ALPHA_THRESHOLD) { addPixel(pos, d); break; } }
      // 左边：从左往右扫
      for (let d = 0; d < S; d++) { const [,,,a] = ctx.getImageData(d, Math.round(pos), 1, 1).data; if (a >= ALPHA_THRESHOLD) { addPixel(d, pos); break; } }
      // 右边：从右往左扫
      for (let d = S - 1; d >= 0; d--) { const [,,,a] = ctx.getImageData(d, Math.round(pos), 1, 1).data; if (a >= ALPHA_THRESHOLD) { addPixel(d, pos); break; } }
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
 * 异步提取背景色（用于已缓存 DataURL / blob:）。
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
      clearTimeout(timer); img.onload = null; img.onerror = null;
      const color = extractBgColorFromImg(img);
      setBgColorCache(key, color);
      resolve(color);
    };
    img.onerror = () => {
      clearTimeout(timer); img.onload = null; img.onerror = null;
      setBgColorCache(key, null);
      resolve(null);
    };
    img.src = iconSrc;
  });
}
