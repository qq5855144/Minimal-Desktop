import type { DesktopData, DesktopSettings, SyncSnapshot } from '@/types';
import { loadPrivacyVault } from '@/lib/storage';
import { IDB_VIDEO_MARKER, loadVideoDB } from '@/lib/videoStorage';
import { IDB_WALLPAPER_MARKER, loadWallpaperDB } from '@/lib/wallpaperStorage';

const digestCache = new Map<string, string>();
export const SYNC_DEFAULT_WALLPAPER_MARKER = '__default_wallpaper__';

function normalizedFileName(file: File, kind: 'image' | 'video'): string {
  const cleaned = file.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 255);
  return cleaned || (kind === 'image' ? 'wallpaper.img' : 'wallpaper.video');
}

function fileCacheKey(file: File): string {
  return [file.name, file.type, file.size, file.lastModified].join('\u0000');
}

async function fileSha256(file: File): Promise<string> {
  const cacheKey = fileCacheKey(file);
  const cached = digestCache.get(cacheKey);
  if (cached) return cached;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  digestCache.set(cacheKey, sha256);
  if (digestCache.size > 4) digestCache.delete(digestCache.keys().next().value as string);
  return sha256;
}

function normalizeSettings(settings: DesktopSettings): DesktopSettings {
  const isDefaultWallpaper = settings.bgImage?.endsWith('/images/wallpaper-default.svg')
    || settings.bgImage === 'images/wallpaper-default.svg';
  return {
    ...settings,
    bgImage: isDefaultWallpaper
      ? SYNC_DEFAULT_WALLPAPER_MARKER
      : settings.bgImage?.startsWith('blob:') ? IDB_WALLPAPER_MARKER : settings.bgImage,
    bgVideo: settings.bgVideo?.startsWith('blob:') ? IDB_VIDEO_MARKER : settings.bgVideo,
    customEngines: settings.customEngines?.map((engine) => ({ ...engine })),
    deletedSearchEngineIds: settings.deletedSearchEngineIds
      ? [...settings.deletedSearchEngineIds]
      : undefined,
  };
}

/**
 * 构造唯一的云同步快照。手动同步和自动同步都必须走这里，避免漏传隐私 vault、
 * 外观设置或 IndexedDB 中的本地背景媒体。
 */
export async function buildSyncSnapshot(
  data: DesktopData,
  settings: DesktopSettings,
): Promise<SyncSnapshot> {
  const vault = loadPrivacyVault();
  const {
    privacyVault: _staleVault,
    privacyItems: _legacyPlaintext,
    pinHash: _legacyPinHash,
    ...desktop
  } = data;
  const backupSettings = normalizeSettings(settings);
  let backgroundFile: File | null = null;
  let kind: 'image' | 'video' | null = null;

  const localImage = settings.bgType === 'image'
    && (settings.bgImage === IDB_WALLPAPER_MARKER || settings.bgImage?.startsWith('blob:'));
  const localVideo = settings.bgType === 'video'
    && (settings.bgVideo === IDB_VIDEO_MARKER || settings.bgVideo?.startsWith('blob:'));

  if (localImage) {
    backgroundFile = await loadWallpaperDB();
    kind = 'image';
    if (!backgroundFile) throw new Error('本地壁纸文件读取失败，请重新选择壁纸后再同步');
    backupSettings.bgImage = IDB_WALLPAPER_MARKER;
    backupSettings.bgVideo = undefined;
  } else if (localVideo) {
    backgroundFile = await loadVideoDB();
    kind = 'video';
    if (!backgroundFile) throw new Error('本地视频壁纸读取失败，请重新选择视频后再同步');
    backupSettings.bgVideo = IDB_VIDEO_MARKER;
    backupSettings.bgImage = undefined;
  }

  if (!backgroundFile || !kind) {
    return {
      data: {
        ...desktop,
        privacyVault: vault ?? undefined,
        settings: backupSettings,
      },
    };
  }

  const mimeType = backgroundFile.type || (kind === 'image' ? 'image/png' : 'video/mp4');
  return {
    data: {
      ...desktop,
      privacyVault: vault ?? undefined,
      settings: backupSettings,
      background: {
        kind,
        mimeType,
        fileName: normalizedFileName(backgroundFile, kind),
        size: backgroundFile.size,
        sha256: await fileSha256(backgroundFile),
        lastModified: backgroundFile.lastModified,
      },
    },
    backgroundFile,
  };
}
