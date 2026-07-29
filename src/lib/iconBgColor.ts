/**
 * 图标背景色提取模块
 *
 * 目的：有些图标边缘有透明区域，视觉上比正常图标小。
 * 提取图标内容最外圈不透明像素的颜色作为背景色，
 * 让透明区域与图标内容边缘颜色一致，视觉无缝衔接。
 *
 * 取色策略（三级降级链）：
 * 1. DataURL/blob: → 直接 img + canvas（无 CORS 问题）
 * 2. 远程 URL → fetch CORS 模式 + createImageBitmap
 * 3. fetch 失败（无 CORS 头）→ crossOrigin='anonymous' img 重载（复用浏览器缓存）
 * 4. 全部失败 → null，调用方降级白色背景
 *
 * 性能优化：
 * - willReadFrequently: true
 * - 一次 getImageData 读全部像素，ArrayBuffer 内按坐标访问，零额外 IO
 */

const EDGE_SAMPLES = 8;
const QUANT = 32;
const ALPHA_THRESHOLD = 30;
const SAMPLE_SIZE = 64;

const memCache = new Map<string, string | null>();
const BG_CACHE_NS = 'bg_c4:';

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

function getPixel(pixels: Uint8ClampedArray, x: number, y: number, S: number): [number, number, number, number] {
  const idx = (y * S + x) * 4;
  return [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]];
}

/** 核心取色：接收任何 CanvasImageSource，一次读像素后在内存中扫描 */
function extractFromSource(source: CanvasImageSource): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const S = SAMPLE_SIZE;
    const pixels = ctx.getImageData(0, 0, S, S).data;
    const step = S / EDGE_SAMPLES;
    const buckets: Record<string, number> = {};

    const addPixel = (x: number, y: number) => {
      const cx = Math.max(0, Math.min(S - 1, Math.round(x)));
      const cy = Math.max(0, Math.min(S - 1, Math.round(y)));
      const [r, g, b, a] = getPixel(pixels, cx, cy, S);
      if (a < ALPHA_THRESHOLD) return;
      const qr = Math.round(r / QUANT) * QUANT;
      const qg = Math.round(g / QUANT) * QUANT;
      const qb = Math.round(b / QUANT) * QUANT;
      const key = `${qr},${qg},${qb}`;
      buckets[key] = (buckets[key] ?? 0) + 1;
    };

    for (let i = 0; i < EDGE_SAMPLES; i++) {
      const pos = step * (i + 0.5);
      const pi = Math.round(pos);
      // 四边各从外向内找第一个不透明像素
      for (let d = 0; d < S; d++) { if (getPixel(pixels, pi, d, S)[3] >= ALPHA_THRESHOLD) { addPixel(pos, d); break; } }
      for (let d = S - 1; d >= 0; d--) { if (getPixel(pixels, pi, d, S)[3] >= ALPHA_THRESHOLD) { addPixel(pos, d); break; } }
      for (let d = 0; d < S; d++) { if (getPixel(pixels, d, pi, S)[3] >= ALPHA_THRESHOLD) { addPixel(d, pos); break; } }
      for (let d = S - 1; d >= 0; d--) { if (getPixel(pixels, d, pi, S)[3] >= ALPHA_THRESHOLD) { addPixel(d, pos); break; } }
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
 * 用 crossOrigin='anonymous' 重新加载图片用于取色。
 * 加 _c=1 参数让浏览器发送带 Origin 头的新请求，
 * 若服务器支持 CORS 则可复用已有图片缓存内容。
 */
function extractWithCrossOrigin(url: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { img.onload = null; img.onerror = null; resolve(null); }, 4000);
    img.onload = () => {
      clearTimeout(timer); img.onload = null; img.onerror = null;
      resolve(extractFromSource(img));
    };
    img.onerror = () => {
      clearTimeout(timer); img.onload = null; img.onerror = null;
      resolve(null);
    };
    img.src = url.includes('?') ? `${url}&_cors=1` : `${url}?_cors=1`;
  });
}

/**
 * 直接从已加载的 HTMLImageElement 同步提取背景色（onLoad 回调中调用）。
 * 若 canvas 被 CORS 污染返回 null，调用方应 fallback 到 fetchIconBgColor。
 */
export function extractBgColorFromImg(img: HTMLImageElement): string | null {
  return extractFromSource(img);
}

/**
 * 异步提取背景色，三级降级链：
 * DataURL/blob → fetch+createImageBitmap → crossOrigin img → null
 */
export function fetchIconBgColor(iconSrc: string, cacheKey?: string): Promise<string | null> {
  const key = cacheKey ?? iconSrc;
  if (!iconSrc) return Promise.resolve(null);
  const cached = getBgColorCache(key);
  if (cached !== undefined) return Promise.resolve(cached);

  // DataURL / blob: 直接加载，无 CORS 问题
  if (iconSrc.startsWith('data:') || iconSrc.startsWith('blob:')) {
    return new Promise<string | null>((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => { img.onload = null; img.onerror = null; resolve(null); }, 5000);
      img.onload = () => {
        clearTimeout(timer); img.onload = null; img.onerror = null;
        const color = extractFromSource(img);
        setBgColorCache(key, color);
        resolve(color);
      };
      img.onerror = () => {
        clearTimeout(timer); img.onload = null; img.onerror = null;
        setBgColorCache(key, null); resolve(null);
      };
      img.src = iconSrc;
    });
  }

  // 远程 URL：先 fetch CORS，再 crossOrigin img 兜底
  return fetch(iconSrc, { mode: 'cors', credentials: 'omit' })
    .then((res) => { if (!res.ok) throw new Error('http error'); return res.blob(); })
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      const color = extractFromSource(bitmap);
      bitmap.close();
      setBgColorCache(key, color);
      return color;
    })
    .catch(() =>
      // fetch CORS 失败 → crossOrigin img 重试
      extractWithCrossOrigin(iconSrc).then((color) => {
        if (color !== null) setBgColorCache(key, color);
        return color;
      })
    );
}
