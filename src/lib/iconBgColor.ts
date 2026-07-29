/**
 * 图标背景色提取模块
 *
 * 算法：从图标四条边各均匀采样 6 个像素（共约 24 个样本），
 * 跳过透明像素，将 RGB 量化为 32 阶桶，取频次最高的色作为背景色。
 * 这样背景色与图标最外圈边缘颜色一致，padding 内缩后视觉无缝衔接。
 */

const EDGE_SAMPLES = 6;   // 每条边采样数量
const QUANT = 32;
const ALPHA_THRESHOLD = 30;
const SAMPLE_SIZE = 64;   // 渲染尺寸（适中精度）

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

export function setBgColorCache(url: string, color: string | null): void {
  memCache.set(url, color);
  try { localStorage.setItem(toCacheKey(url), color ?? '__null__'); } catch { /* ignore */ }
}

/**
 * 从 HTMLImageElement 的四条边缘各采样 EDGE_SAMPLES 个像素，
 * 量化后取频次最高色作为背景色。
 * 需在 img.complete === true 时调用。
 */
export function extractBgColorFromImg(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const buckets: Record<string, number> = {};
    const S = SAMPLE_SIZE;
    const step = Math.floor(S / EDGE_SAMPLES);

    // 四条边：top row=0, bottom row=S-1, left col=0, right col=S-1
    const samples: [number, number][] = [];
    for (let i = 0; i < EDGE_SAMPLES; i++) {
      const pos = Math.round(step * (i + 0.5));
      samples.push([pos, 0]);          // 顶边
      samples.push([pos, S - 1]);      // 底边
      samples.push([0, pos]);          // 左边
      samples.push([S - 1, pos]);      // 右边
    }

    for (const [x, y] of samples) {
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
      if (a < ALPHA_THRESHOLD) continue;
      const qr = Math.round(r / QUANT) * QUANT;
      const qg = Math.round(g / QUANT) * QUANT;
      const qb = Math.round(b / QUANT) * QUANT;
      const key = `${qr},${qg},${qb}`;
      buckets[key] = (buckets[key] ?? 0) + 1;
    }

    const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;
    const [qr, qg, qb] = sorted[0][0].split(',').map(Number);
    return '#' + [qr, qg, qb].map((v) => Math.min(v, 255).toString(16).padStart(2, '0')).join('');
  } catch {
    return null; // canvas CORS 污染时静默忽略
  }
}

/**
 * 异步提取背景色（用于 DataURL / 已缓存图标）。
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
