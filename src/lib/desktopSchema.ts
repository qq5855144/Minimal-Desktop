import { z } from 'zod';
import type { DesktopData } from '@/types';

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
const folderLayout = z.enum(['1x1', '2x2']);
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, '必须是有效 Base64');

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

export const desktopDataSchema: z.ZodType<DesktopData> = z.object({
  pages: z.array(z.array(desktopItemSchema).max(1000)).min(1).max(20),
  version: z.number().int().min(1).max(CURRENT_DESKTOP_VERSION),
  privacyVault: privacyVaultSchema.optional(),
  pinHash: z.string().max(1024).optional(),
  privacyItems: z.array(desktopItemSchema).max(1000).optional(),
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
