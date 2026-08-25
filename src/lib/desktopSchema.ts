import { z } from 'zod';
import type { DesktopBackup, DesktopData, DesktopSettings } from '@/types';

export const CURRENT_DESKTOP_VERSION = 5;

const httpUrl = z.string().max(4096).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'URL 必须使用 http/https');

const iconUrl = z.string().max(1_000_000).refine((value) => (
  value.startsWith('data:image/') || (() => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  })()
), '图标地址必须是 http/https 或 data:image');

const iconColor = z.enum([
  'blue', 'green', 'orange', 'red', 'purple', 'yellow', 'pink', 'teal', 'indigo', 'gray',
]);

const itemType = z.enum(['app', 'folder', 'system', 'widget']);
const widgetType = z.enum(['clock', 'search', 'combined']);
const folderLayout = z.enum(['1x1', '1x2', '2x1', '2x2']);
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, '必须是有效 Base64');
const wallpaperMarker = '__idb_wallpaper__';
const videoMarker = '__idb__';
const defaultWallpaperMarker = '__default_wallpaper__';
const wallpaperMaxBytes = 20 * 1024 * 1024;
const videoMaxBytes = 50 * 1024 * 1024;

const backgroundSource = z.string().max(1_000_000).refine((value) => {
  if (value === wallpaperMarker || value === videoMarker || value === defaultWallpaperMarker) return true;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (value.startsWith('./') && !value.includes('..') && !value.includes('\\')) return true;
  if (value.startsWith('data:image/')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, '背景地址必须是安全的本地资源或 http/https URL');

const searchUrlTemplate = z.string().min(1).max(4096).refine((value) => {
  try {
    const url = new URL(value.replace(/\{q\}|%s/g, 'query'));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, '搜索地址必须使用 http/https');

const customSearchEngineSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  urlTemplate: searchUrlTemplate,
  iconUrl: iconUrl.optional(),
  color: z.string().min(1).max(64),
});

export const desktopSettingsSchema: z.ZodType<DesktopSettings> = z.object({
  bgImage: backgroundSource.optional(),
  bgVideo: backgroundSource.optional(),
  bgType: z.enum(['image', 'video', 'default']).optional(),
  style: z.enum(['glassmorphism', 'neumorphism']),
  iconSize: z.number().finite().min(24).max(128),
  iconRadiusPct: z.number().finite().min(0).max(50),
  cols: z.union([
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
    z.literal(10),
  ]),
  rows: z.number().int().min(1).max(16),
  bgOverlayEnabled: z.boolean().optional(),
  bgOverlayScheme: z.enum(['aurora', 'sunset', 'forest', 'midnight', 'warm']).optional(),
  applyOverlayToWallpaper: z.boolean().optional(),
  searchBarStyle: z.enum(['soft', 'outline']).optional(),
  searchEngine: z.string().min(1).max(256).optional(),
  customEngines: z.array(customSearchEngineSchema).max(100).optional(),
  deletedSearchEngineIds: z.array(z.string().min(1).max(256)).max(100).optional(),
});

const backupBackgroundSchema = z.object({
  kind: z.enum(['image', 'video']),
  mimeType: z.string().min(1).max(128),
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive().max(videoMaxBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, '必须是有效 SHA-256'),
  lastModified: z.number().int().nonnegative().optional(),
}).superRefine((background, ctx) => {
  if (background.kind === 'image') {
    if (!background.mimeType.startsWith('image/')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mimeType'], message: '图片壁纸 MIME 类型无效' });
    }
    if (background.size > wallpaperMaxBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['size'], message: '图片壁纸超过 20 MB' });
    }
  } else if (!background.mimeType.startsWith('video/')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mimeType'], message: '视频壁纸 MIME 类型无效' });
  }
});

export const desktopItemSchema: z.ZodType<import('@/types').DesktopItem> = z.lazy(() => z.object({
  id: z.string().min(1).max(256),
  type: itemType,
  name: z.string().max(256),
  url: httpUrl.optional(),
  iconUrl: iconUrl.optional(),
  iconCrop: z.object({
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    size: z.number().finite().min(1).max(100),
  }).optional(),
  color: iconColor,
  page: z.number().int().min(-1).max(1000),
  row: z.number().int().min(0).max(1000),
  col: z.number().int().min(0).max(1000),
  children: z.array(desktopItemSchema).max(9).optional(),
  folderLayout: folderLayout.optional(),
  widgetType: widgetType.optional(),
}));

export const privacyVaultSchema = z.object({
  salt: base64.min(1).max(1024),
  iv: base64.min(1).max(1024),
  ct: base64.min(1).max(20_000_000),
  v: z.number().int().min(2).max(3),
  iterations: z.number().int().min(100_000).max(2_000_000).optional(),
}).strict();

const desktopDataObjectSchema = z.object({
  pages: z.array(z.array(desktopItemSchema).max(1000)).min(1).max(20),
  version: z.number().int().min(1).max(CURRENT_DESKTOP_VERSION),
  privacyVault: privacyVaultSchema.optional(),
  pinHash: z.string().max(1024).optional(),
  privacyItems: z.array(desktopItemSchema).max(1000).optional(),
});

export const desktopDataSchema: z.ZodType<DesktopData> = desktopDataObjectSchema;

export const desktopBackupSchema: z.ZodType<DesktopBackup> = desktopDataObjectSchema.extend({
  settings: desktopSettingsSchema.optional(),
  background: backupBackgroundSchema.optional(),
}).superRefine((backup, ctx) => {
  const { background, settings } = backup;
  if (!background) {
    if (settings?.bgImage === wallpaperMarker || settings?.bgVideo === videoMarker) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['background'],
        message: '本地背景文件索引缺失',
      });
    }
    return;
  }
  const sourceMatches = background.kind === 'image'
    ? settings?.bgType === 'image' && settings.bgImage === wallpaperMarker
    : settings?.bgType === 'video' && settings.bgVideo === videoMarker;
  if (!sourceMatches) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settings'],
      message: '背景设置与媒体索引不一致',
    });
  }
});

export type DesktopDataParseResult =
  | { ok: true; data: DesktopData }
  | { ok: false; message: string };

export function parseDesktopData(input: unknown): DesktopDataParseResult {
  const result = desktopDataSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const path = first?.path.length ? first.path.join('.') : 'root';
  return { ok: false, message: `备份数据校验失败（${path}）：${first?.message ?? '未知错误'}` };
}

export type DesktopBackupParseResult =
  | { ok: true; data: DesktopBackup }
  | { ok: false; message: string };

export function parseDesktopBackup(input: unknown): DesktopBackupParseResult {
  const result = desktopBackupSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const path = first?.path.length ? first.path.join('.') : 'root';
  return { ok: false, message: `备份数据校验失败（${path}）：${first?.message ?? '未知错误'}` };
}
