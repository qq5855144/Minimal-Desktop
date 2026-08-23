import { describe, expect, it } from 'vitest';
import {
  getRenderableWallpaperSource,
  IDB_WALLPAPER_MARKER,
} from './wallpaperStorage';

describe('wallpaper source restoration', () => {
  it('does not render the IndexedDB persistence marker as an image URL', () => {
    expect(getRenderableWallpaperSource(IDB_WALLPAPER_MARKER)).toBeUndefined();
    expect(getRenderableWallpaperSource()).toBeUndefined();
    expect(getRenderableWallpaperSource('')).toBeUndefined();
  });

  it('keeps remote and restored Blob wallpaper URLs renderable', () => {
    const remote = 'https://haowallpaper.com/link/common/file/getCroppingImg/18776371842698624';
    const restored = 'blob:https://example.test/restored-wallpaper';

    expect(getRenderableWallpaperSource(remote)).toBe(remote);
    expect(getRenderableWallpaperSource(restored)).toBe(restored);
  });
});
