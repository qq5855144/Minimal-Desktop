/**
 * 图标背景色提取模块
 *
 * 算法：
 * 1. 将图标绘制到 6×6 的离屏 canvas
 * 2. 采样外围边框（共 6×6 - 4×4 = 20 个单元格）
 * 3. 忽略透明像素（alpha < 30）
 * 4. 将 RGB 量化为 32 阶桶，统计每个桶的频次
 * 5. 返回频次最高桶的中心色值（RGB hex）
 * 6. 若所有像素均透明则返回 null（调用方降级为默认背景）
 */

const GRID = 6;           // 网格边长
const INNER = 4;          // 中心内核边长（跳过）
const QUANT = 32;         // RGB 量化步长（256/8 = 32 阶）
const ALPHA_THRESHOLD = 30;
const SAMPLE_SIZE = 48;   // canvas 渲染尺寸（足够精度，省内存）

// 背景色内存缓存（url → hex | null）
const memCache = new Map<string, string | null>();

// localStorage 持久化
const BG_CACHE_NS = 'bg_c:';

function toCacheKey(url: string): string {
  try {
    return BG_CACHE_NS + btoa(encodeURIComponent(url)).slice(0, 60);
  } catch {
    return BG_CACHE_NS + url.slice(0, 60).replace(/[^a-zA-Z0-9]/g, '_');
  }
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
  return undefined; // 未命中
}

function setBgColorCache(url: string, color: string | null): void {
  memCache.set(url, color);
  try {
    localStorage.setItem(toCacheKey(url), color ?? '__null__');
  } catch { /* ignore */ }
}

/**
 * 从已加载的图片元素中提取背景色
 * 只能在 img.onload 完成后调用；若 canvas 被 CORS 污染则返回 null
 */
function extractFromImage(img: HTMLImageElement): string | null {
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
        // 只取外围边框格
        const isInner =
          row >= 1 && row < GRID - 1 &&
          col >= 1 && col < GRID - 1 &&
          row <= GRID - INNER + 1 && col <= GRID - INNER + 1;
        if (isInner) continue;

        // 取单元格中心像素
        const x = Math.round((col + 0.5) * cellPx);
        const y = Math.round((row + 0.5) * cellPx);
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        if (a < ALPHA_THRESHOLD) continue;

        // RGB 量化
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
    // 转为 hex
    const hex = '#' + [qr, qg, qb].map((v) => Math.min(v, 255).toString(16).padStart(2, '0')).join('');
    return hex;
  } catch {
    return null; // canvas 被污染时静默忽略
  }
}

/**
 * 异步提取图标背景色，带缓存。
 * - 命中缓存则同步返回（通过 Promise 包装）
 * - 未命中则新建 Image 加载后提取
 * @param iconSrc 图标 DataURL 或远程 URL
 * @param originalUrl 原始 URL（用作缓存 key），可选
 */
export function fetchIconBgColor(
  iconSrc: string,
  originalUrl?: string,
): Promise<string | null> {
  const cacheKey = originalUrl ?? iconSrc;
  if (!iconSrc) return Promise.resolve(null);

  const cached = getBgColorCache(cacheKey);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise<string | null>((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      resolve(null);
    }, 5000);

    img.onload = () => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      const color = extractFromImage(img);
      setBgColorCache(cacheKey, color);
      resolve(color);
    };

    img.onerror = () => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      setBgColorCache(cacheKey, null);
      resolve(null);
    };

    img.src = iconSrc;
  });
}
