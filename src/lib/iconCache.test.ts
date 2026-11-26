import { expect, it, vi } from 'vitest';
import { getIconCache, setIconCache } from './iconCache';

it('uses distinct cache entries for URLs with a long common prefix', () => {
  const cache = new Map<string, string>([['icon_c:legacy', 'old image'], ['icon_c_meta', '{}']]);
  vi.stubGlobal('localStorage', {
    get length() { return cache.size; },
    key: (index: number) => Array.from(cache.keys())[index] ?? null,
    getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => { cache.set(key, value); },
    removeItem: (key: string) => { cache.delete(key); },
  });
  try {
    const first = 'https://cdn.example.com/themes/pack/desktop/zh-CN/icons/apple.png';
    const second = first.replace('apple.png', 'orange.png');
    setIconCache(first, 'apple');
    setIconCache(second, 'orange');
    expect(getIconCache(first)).toBe('apple');
    expect(getIconCache(second)).toBe('orange');
    expect(cache.has('icon_c:legacy')).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
