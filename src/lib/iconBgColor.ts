/**
 * 图标背景色提取模块
 *
 * 目的：有些图标边缘有透明区域，视觉上比正常图标小。
 * 提取图标内容最外圈不透明像素的颜色作为背景色，
 * 让透明区域与图标内容边缘颜色一致，视觉无缝衔接。
 *
 * 算法：
 * 1. 将图标绘入 64×64 canvas，一次性 getImageData 读取全部像素数据
 * 2. 从四条边各取 EDGE_SAMPLES 个扫描线，每条从外向内找第一个不透明像素
 * 3. RGB 量化聚类，取频次最高的色作为背景色
 * 4. 若所有边缘均透明则返回 null（降级白色）
 *
 * 性能优化：
 * - willReadFrequently: true 告知浏览器将频繁读取像素，启用 CPU 读回优化
 * - 一次 getImageData 读完整张图，后续按坐标直接访问 ArrayBuffer（零额外 IO）
 *
 * 扩展环境兼容：
 * - extractBgColorFromImg 直接接收 HTMLImageElement（onLoad 时调用）
 * - fetchIconBgColor 通过 fetch + createImageBitmap 绕过跨域 canvas 污染
 */

const EDGE_SAMPLES = 8;
const QUANT = 32;
const ALPHA_THRESHOLD = 30;
const SAMPLE_SIZE = 64;

const memCache = new Map<string, string | null>();
const BG_CACHE_NS = 'bg_c3:'; // 版本号，避免旧缓存污染

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

/** 从 ImageData 的 pixels 数组按坐标取像素，返回 [r,g,b,a] */
function getPixel(pixels: Uint8ClampedArray, x: number, y: number, S: number): [number, number, number, number] {
  const idx = (y * S + x) * 4;
  return [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]];
}

/**
 * 核心取色逻辑，接收 CanvasImageSource（HTMLImageElement / ImageBitmap 均可）。
 * 一次 getImageData 读完所有像素，后续在内存中按坐标访问。
 */
function extractFromSource(source: CanvasImageSource): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    // willReadFrequently: true — 告知浏览器将多次读取像素，启用 CPU 读回路径优化
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const S = SAMPLE_SIZE;
    // 一次性读取全部像素，后续零 IO
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
      // 顶边：从上往下找第一个不透明像素
      for (let d = 0; d < S; d++) { if (getPixel(pixels, pi, d, S)[3] >= ALPHA_THRESHOLD) { addPixel(pos, d); break; } }
      // 底边：从下往上
      for (let d = S - 1; d >= 0; d--) { if (getPixel(pixels, pi, d, S)[3] >= ALPHA_THRESHOLD) { addPixel(pos, d); break; } }
      // 左边：从左往右
      for (let d = 0; d < S; d++) { if (getPixel(pixels, d, pi, S)[3] >= ALPHA_THRESHOLD) { addPixel(d, pos); break; } }
      // 右边：从右往左
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
 * 直接从已加载的 HTMLImageElement 同步提取背景色。
 * 在 <img> onLoad 回调中调用，无需额外 fetch。
 * 跨域 canvas 污染时返回 null（调用方可 fallback 到 fetchIconBgColor）。
 */
export function extractBgColorFromImg(img: HTMLImageElement): string | null {
  return extractFromSource(img);
}

/**
 * 异步提取背景色，兼容扩展环境（CSP / 跨域）。
 *
 * 策略：
 * 1. 命中缓存 → 直接返回
 * 2. DataURL / blob: → 用 Image + extractFromSource（不受 CORS 限制）
 * 3. 远程 URL → fetch ArrayBuffer + createImageBitmap → extractFromSource
 *    若 fetch 失败（CSP / 网络）→ 静默返回 null
 */
export function fetchIconBgColor(iconSrc: string, cacheKey?: string): Promise<string | null> {
  const key = cacheKey ?? iconSrc;
  if (!iconSrc) return Promise.resolve(null);
  const cached = getBgColorCache(key);
  if (cached !== undefined) return Promise.resolve(cached);

  // DataURL / blob: 直接用 Image 加载
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

  // 远程 URL：fetch + createImageBitmap，绕过 canvas CORS 污染
  return fetch(iconSrc, { mode: 'cors', credentials: 'omit' })
    .then((res) => {
      if (!res.ok) throw new Error('fetch failed');
      return res.blob();
    })
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      const color = extractFromSource(bitmap);
      bitmap.close();
      setBgColorCache(key, color);
      return color;
    })
    .catch(() => {
      // fetch 失败（CORS 拒绝 / CSP / 网络）→ 降级静默返回 null，不写缓存（允许后续重试）
      return null;
    });
}
