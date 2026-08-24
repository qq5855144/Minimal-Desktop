import { describe, expect, it } from 'vitest';
import { CURRENT_DESKTOP_VERSION, parseDesktopBackup, parseDesktopData } from './desktopSchema';

const validData = {
  version: CURRENT_DESKTOP_VERSION,
  pages: [[{
    id: 'app-1', type: 'app', name: 'Example', color: 'blue',
    page: 0, row: 0, col: 0, url: 'https://example.com/',
  }]],
};

describe('desktop backup schema', () => {
  it('accepts a valid backup', () => {
    expect(parseDesktopData(validData).ok).toBe(true);
  });

  it('rejects executable URL schemes', () => {
    const malicious = structuredClone(validData);
    malicious.pages[0][0].url = 'javascript:alert(1)';
    expect(parseDesktopData(malicious).ok).toBe(false);
  });

  it('strips legacy or unknown fields while validating known data', () => {
    const result = parseDesktopData({ ...validData, dock: [], injected: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).not.toHaveProperty('injected');
  });

  it('accepts legacy v2 privacy vault metadata', () => {
    const result = parseDesktopData({
      ...validData,
      privacyVault: { salt: 'AA==', iv: 'AA==', ct: 'AA==', v: 2 },
    });
    expect(result.ok).toBe(true);
  });

  it('validates persisted folder layout values', () => {
    const folderBackup = {
      version: CURRENT_DESKTOP_VERSION,
      pages: [[{
        id: 'folder',
        type: 'folder',
        name: 'Folder',
        color: 'gray',
        page: 0,
        row: 0,
        col: 0,
        folderLayout: '2x2',
        children: [],
      }]],
    };
    expect(parseDesktopData(folderBackup).ok).toBe(true);
    expect(parseDesktopData({
      ...folderBackup,
      pages: [[{ ...folderBackup.pages[0][0], folderLayout: '3x3' }]],
    }).ok).toBe(false);
  });

  it('accepts a cloud backup containing settings and an indexed wallpaper', () => {
    const result = parseDesktopBackup({
      ...validData,
      settings: {
        style: 'glassmorphism',
        iconSize: 46,
        iconRadiusPct: 25,
        cols: 4,
        rows: 8,
        bgType: 'image',
        bgImage: '__idb_wallpaper__',
      },
      background: {
        kind: 'image',
        mimeType: 'image/webp',
        fileName: 'wallpaper.webp',
        size: 1024,
        sha256: 'a'.repeat(64),
      },
    });

    expect(result.ok).toBe(true);
  });

  it('accepts 10 desktop columns and rejects values above the supported maximum', () => {
    const settings = {
      style: 'glassmorphism',
      iconSize: 46,
      iconRadiusPct: 25,
      cols: 10,
      rows: 8,
    };

    expect(parseDesktopBackup({ ...validData, settings }).ok).toBe(true);
    expect(parseDesktopBackup({
      ...validData,
      settings: { ...settings, cols: 11 },
    }).ok).toBe(false);
  });

  it('accepts the extension build relative default wallpaper path', () => {
    expect(parseDesktopBackup({
      ...validData,
      settings: {
        style: 'glassmorphism',
        iconSize: 46,
        iconRadiusPct: 25,
        cols: 4,
        rows: 8,
        bgType: 'image',
        bgImage: './images/wallpaper-default.svg',
      },
    }).ok).toBe(true);
  });

  it('rejects an indexed wallpaper marker without its media asset metadata', () => {
    const result = parseDesktopBackup({
      ...validData,
      settings: {
        style: 'glassmorphism',
        iconSize: 46,
        iconRadiusPct: 25,
        cols: 4,
        rows: 8,
        bgType: 'image',
        bgImage: '__idb_wallpaper__',
      },
    });

    expect(result.ok).toBe(false);
  });
});
