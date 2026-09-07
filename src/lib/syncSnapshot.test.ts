import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopData, DesktopSettings } from '@/types';
import { CURRENT_DESKTOP_VERSION } from './desktopSchema';

vi.mock('@/lib/storage', () => ({
  loadPrivacyVault: vi.fn(() => null),
  isBuiltInDefaultWallpaper: (source?: string) => Boolean(
    source?.includes('images/wallpaper-default.webp')
    || source?.includes('images/wallpaper-default.svg'),
  ),
}));
vi.mock('@/lib/wallpaperStorage', () => ({
  IDB_WALLPAPER_MARKER: '__idb_wallpaper__',
  loadWallpaperDB: vi.fn(async () => null),
}));
vi.mock('@/lib/videoStorage', () => ({
  IDB_VIDEO_MARKER: '__idb__',
  loadVideoDB: vi.fn(async () => null),
}));

import { loadWallpaperDB } from '@/lib/wallpaperStorage';
import { buildSyncSnapshot } from './syncSnapshot';

const data: DesktopData = { version: CURRENT_DESKTOP_VERSION, pages: [[]] };
const settings: DesktopSettings = {
  style: 'glassmorphism',
  iconSize: 46,
  iconRadiusPct: 25,
  cols: 4,
  rows: 8,
  bgType: 'image',
  bgImage: 'https://example.com/wallpaper.webp',
};

describe('cloud sync snapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes appearance settings for a remote wallpaper', async () => {
    const snapshot = await buildSyncSnapshot(data, settings);

    expect(snapshot.data.settings?.bgImage).toBe(settings.bgImage);
    expect(snapshot.data.background).toBeUndefined();
    expect(snapshot.backgroundFile).toBeUndefined();
  });

  it.each([
    './images/wallpaper-default.webp',
    './images/wallpaper-default.svg',
  ])('normalizes the built-in wallpaper %s to a cross-build marker', async (bgImage) => {
    const snapshot = await buildSyncSnapshot(data, {
      ...settings,
      bgImage,
    });

    expect(snapshot.data.settings?.bgImage).toBe('__default_wallpaper__');
  });

  it('indexes a local wallpaper as a separately uploaded media file', async () => {
    const wallpaper = new File([new Uint8Array([1, 2, 3, 4])], 'mountain.webp', {
      type: 'image/webp',
      lastModified: 123,
    });
    vi.mocked(loadWallpaperDB).mockResolvedValue(wallpaper);

    const snapshot = await buildSyncSnapshot(data, {
      ...settings,
      bgImage: 'blob:https://example.test/wallpaper',
    });

    expect(snapshot.backgroundFile).toBe(wallpaper);
    expect(snapshot.data.settings?.bgImage).toBe('__idb_wallpaper__');
    expect(snapshot.data.background).toMatchObject({
      kind: 'image',
      mimeType: 'image/webp',
      fileName: 'mountain.webp',
      size: 4,
      lastModified: 123,
    });
    expect(snapshot.data.background?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

it('includes bookmark groups and order in the cloud snapshot', async () => {
  const bookmarks = { groups: [{ id: 'default', name: '默认分组' }], items: [{ id: 'link', name: '示例', url: 'https://example.com/', groupId: 'default' }] };
  const snapshot = await buildSyncSnapshot({ ...data, bookmarks }, { ...settings, bgType: 'color' });
  expect(snapshot.data.bookmarks).toEqual(bookmarks);
});
