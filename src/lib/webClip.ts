import { normalizeHttpUrl } from './urlSafety';

export const WEB_CLIP_HASH_PREFIX = '#clip=';
export const MAX_WEB_CLIP_URL_LENGTH = 8192;
export const MAX_WEB_CLIP_ICON_LENGTH = 4096;
const MAX_RAW_TITLE_LENGTH = 512;
const MAX_TITLE_LENGTH = 64;
const MAX_ENCODED_PAYLOAD_LENGTH = 24000;

export interface WebClipPayload {
  url: string;
  title: string;
  favicon?: string;
  target: 'desktop' | 'bookmarks';
}

export function extractSiteName(raw: string): string {
  const trimmed = raw.trim();
  const firstSeparator = trimmed.match(/^(.+?)\s*[-|–—,·\/]\s*.+$/);
  let name = firstSeparator ? firstSeparator[1].trim() : trimmed;
  const decoratedSuffix = name.match(/^(.+?)\s+(?=[(\[{<（【《『「'"@#$%^&*~`！？。，、；：☆★♪♫♬♩©®™°•])/u);
  if (decoratedSuffix) name = decoratedSuffix[1].trim();
  return name.length > MAX_TITLE_LENGTH ? `${name.slice(0, MAX_TITLE_LENGTH - 1)}…` : name;
}

function normalizeFavicon(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_WEB_CLIP_ICON_LENGTH) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseWebClipHash(hash: string): WebClipPayload | null {
  if (!hash.startsWith(WEB_CLIP_HASH_PREFIX)) return null;
  const encoded = hash.slice(WEB_CLIP_HASH_PREFIX.length);
  if (!encoded || encoded.length > MAX_ENCODED_PAYLOAD_LENGTH) return null;

  try {
    const candidate = JSON.parse(decodeURIComponent(encoded)) as Record<string, unknown>;
    if (typeof candidate.url !== 'string' || candidate.url.length > MAX_WEB_CLIP_URL_LENGTH) return null;
    const url = normalizeHttpUrl(candidate.url);
    if (!url) return null;

    const hostname = new URL(url).hostname;
    const rawTitle = typeof candidate.title === 'string' && candidate.title.length <= MAX_RAW_TITLE_LENGTH
      ? candidate.title
      : hostname;
    const title = extractSiteName(rawTitle) || hostname;

    return {
      url,
      title,
      favicon: normalizeFavicon(candidate.favicon),
      target: candidate.target === 'bookmarks' ? 'bookmarks' : 'desktop',
    };
  } catch {
    return null;
  }
}
