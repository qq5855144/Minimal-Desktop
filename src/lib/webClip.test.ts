import { describe, expect, it } from 'vitest';
import { extractSiteName, parseWebClipHash, WEB_CLIP_HASH_PREFIX } from './webClip';

function makeHash(payload: unknown): string {
  return `${WEB_CLIP_HASH_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

describe('web clip protocol', () => {
  it('parses and normalizes a valid desktop clip', () => {
    expect(parseWebClipHash(makeHash({
      url: 'example.com/path?q=1',
      title: 'Example - Documentation',
      favicon: 'https://example.com/favicon.ico',
      target: 'desktop',
    }))).toEqual({
      url: 'https://example.com/path?q=1',
      title: 'Example',
      favicon: 'https://example.com/favicon.ico',
      target: 'desktop',
    });
  });

  it('supports bookmarks and falls back to the hostname for an invalid title', () => {
    expect(parseWebClipHash(makeHash({
      url: 'https://example.com/',
      title: 'x'.repeat(513),
      target: 'bookmarks',
    }))).toEqual({
      url: 'https://example.com/',
      title: 'example.com',
      favicon: undefined,
      target: 'bookmarks',
    });
  });

  it('rejects privileged protocols and malformed payloads', () => {
    expect(parseWebClipHash(makeHash({ url: 'javascript:alert(1)', title: 'bad' }))).toBeNull();
    expect(parseWebClipHash('#clip=%E0%A4%A')).toBeNull();
    expect(parseWebClipHash('#other=value')).toBeNull();
  });

  it('drops unsafe favicon protocols', () => {
    expect(parseWebClipHash(makeHash({
      url: 'https://example.com/',
      title: 'Example',
      favicon: 'data:image/svg+xml,<svg/>',
    }))?.favicon).toBeUndefined();
  });

  it('uses the same concise site-name rule as extension clipping', () => {
    expect(extractSiteName('哔哩哔哩 (゜-゜)つロ 干杯~')).toBe('哔哩哔哩');
    expect(extractSiteName('GitHub Actions')).toBe('GitHub Actions');
  });
});
