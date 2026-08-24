import type { DesktopItem } from '@/types';

export const SYSTEM_GLYPH_SCALE = 0.5;
export const SYSTEM_GLYPH_STROKE_WIDTH = 2;

export type FolderChildVisualKind = 'system' | 'image' | 'initial';

/** 系统入口始终沿用桌面系统图标，不允许缓存图片覆盖其图案。 */
export function resolveFolderChildVisualKind(
  child: DesktopItem,
  hasImageSource: boolean,
): FolderChildVisualKind {
  if (child.type === 'system') return 'system';
  return hasImageSource ? 'image' : 'initial';
}
