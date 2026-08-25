import type { DesktopItem, FolderLayout } from '@/types';

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

export function getFolderPreviewGrid(layout: FolderLayout | undefined): {
  rows: number;
  cols: number;
} {
  switch (layout ?? '1x1') {
    case '1x2': return { rows: 1, cols: 3 };
    case '2x1': return { rows: 3, cols: 1 };
    case '2x2': return { rows: 3, cols: 3 };
    default: return { rows: 2, cols: 2 };
  }
}

/** 1×1 保持传统整面点击；扩展布局中的网站应用允许缩略图直达。 */
export function canOpenFolderChildDirectly(
  layout: FolderLayout | undefined,
  child: DesktopItem,
): boolean {
  return (layout ?? '1x1') !== '1x1'
    && child.type === 'app'
    && Boolean(child.url);
}
