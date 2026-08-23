export type IconSizeVariant = 'normal' | 'small';

const SMALL_ICON_PX = 44;
const DEFAULT_ICON_PX = 46;
const DEFAULT_ICON_RADIUS_PCT = 25;
const ICON_LABEL_GAP_PX = 4;
const ICON_LABEL_PADDING_X_PX = 8;
const FOLDER_PREVIEW_SCALE = 0.78;
const FOLDER_PREVIEW_GAP_PX = 3;
const LARGE_FOLDER_BORDER_PX = 1;

/** 桌面行、列统一间隔；组件、普通图标和大文件夹共用同一几何基准。 */
export const DESKTOP_GRID_GAP_PX = 12;
export const DESKTOP_GRID_MAX_WIDTH_PX = 672;
export const DESKTOP_GRID_BREAKPOINT_PX = 768;
export const DESKTOP_GRID_COMPACT_PADDING_X_PX = 32;
export const DESKTOP_GRID_WIDE_PADDING_X_PX = 64;

const TEXT_CLASS_MAP: Record<IconSizeVariant, string> = {
  normal: 'text-[11px] leading-[18px]',
  small: 'text-[10px] leading-[14px]',
};

const LABEL_HEIGHT_MAP: Record<IconSizeVariant, number> = {
  normal: 18,
  small: 14,
};

export interface IconLayoutMetrics {
  iconPx: number;
  iconRadius: string;
  textClass: string;
  labelGapPx: number;
  labelHeightPx: number;
  labelMaxWidthPx: number;
  labelPlaceholderWidthPx: number;
  labelSkeletonHeightPx: number;
  cellMinHeightPx: number;
  folderPreviewGapPx: number;
  folderPreviewCellPx: number;
  glyphPx: number;
  initialFontPx: number;
}

export interface DesktopGridLayoutMetrics {
  contentWidthPx: number;
  columnWidthPx: number;
  iconPx: number;
}

export interface LargeFolderLayoutMetrics {
  /** 文件夹可视外框边长，不包含下方名称。 */
  sidePx: number;
  /** 外框内边距与缩略图行、列间距共用此值。 */
  spacingPx: number;
  /** 3×3 缩略图单格边长。 */
  previewCellPx: number;
  previewFontPx: number;
  totalHeightPx: number;
}

export function resolveIconPx(size: IconSizeVariant = 'normal', iconPx?: number): number {
  if (size === 'small') return SMALL_ICON_PX;
  return iconPx ?? DEFAULT_ICON_PX;
}

/**
 * 根据真实视口和“应用视图”列数计算有效图标尺寸。
 * 设置值是期望尺寸；窄屏下自动等比收缩，确保图标与名称都不会越过列边界。
 */
export function getDesktopGridLayoutMetrics(
  viewportWidthPx: number,
  cols: number,
  preferredIconPx: number,
): DesktopGridLayoutMetrics {
  const safeViewportWidth = Number.isFinite(viewportWidthPx)
    ? Math.max(0, viewportWidthPx)
    : DESKTOP_GRID_MAX_WIDTH_PX;
  const safeCols = Number.isInteger(cols) && cols > 0 ? cols : 4;
  const horizontalPadding = safeViewportWidth >= DESKTOP_GRID_BREAKPOINT_PX
    ? DESKTOP_GRID_WIDE_PADDING_X_PX
    : DESKTOP_GRID_COMPACT_PADDING_X_PX;
  const contentWidthPx = Math.min(
    DESKTOP_GRID_MAX_WIDTH_PX,
    Math.max(0, safeViewportWidth - horizontalPadding),
  );
  const columnWidthPx = Math.max(
    0,
    (contentWidthPx - DESKTOP_GRID_GAP_PX * (safeCols - 1)) / safeCols,
  );
  const requestedIconPx = Number.isFinite(preferredIconPx)
    ? Math.max(1, preferredIconPx)
    : DEFAULT_ICON_PX;
  const iconPx = Math.max(
    1,
    Math.min(requestedIconPx, columnWidthPx - ICON_LABEL_PADDING_X_PX),
  );

  return { contentWidthPx, columnWidthPx, iconPx };
}

export function getIconLayoutMetrics(size: IconSizeVariant = 'normal', iconPx?: number, iconRadiusPct?: number): IconLayoutMetrics {
  const resolvedIconPx = resolveIconPx(size, iconPx);
  const resolvedRadiusPct = size === 'small' ? DEFAULT_ICON_RADIUS_PCT : (iconRadiusPct ?? DEFAULT_ICON_RADIUS_PCT);
  const labelHeightPx = LABEL_HEIGHT_MAP[size];
  const labelMaxWidthPx = resolvedIconPx + ICON_LABEL_PADDING_X_PX;
  const labelPlaceholderWidthPx = Math.min(
    labelMaxWidthPx,
    Math.max(28, Math.round(resolvedIconPx * 0.84)),
  );
  const folderPreviewInnerPx = Math.round(resolvedIconPx * FOLDER_PREVIEW_SCALE);
  const folderPreviewCellPx = Math.max(0, (folderPreviewInnerPx - FOLDER_PREVIEW_GAP_PX) / 2);

  return {
    iconPx: resolvedIconPx,
    iconRadius: `${resolvedRadiusPct}%`,
    textClass: TEXT_CLASS_MAP[size],
    labelGapPx: ICON_LABEL_GAP_PX,
    labelHeightPx,
    labelMaxWidthPx,
    labelPlaceholderWidthPx,
    labelSkeletonHeightPx: 8,
    cellMinHeightPx: resolvedIconPx + ICON_LABEL_GAP_PX + labelHeightPx,
    folderPreviewGapPx: FOLDER_PREVIEW_GAP_PX,
    folderPreviewCellPx,
    glyphPx: resolvedIconPx * 0.5,
    initialFontPx: resolvedIconPx * 0.35,
  };
}

/**
 * 2×2 文件夹的统一尺寸公式：
 * - 外框始终为正方形，并同时受两列宽度与两行高度约束；
 * - 名称间距沿用普通应用的 labelGap；
 * - 内部 3×3 使用 3 个 1/4 单元 + 4 个 1/16 间距，四周与行列间距完全相等。
 */
export function getLargeFolderLayoutMetrics(
  iconMetrics: IconLayoutMetrics,
  columnWidthPx: number,
): LargeFolderLayoutMetrics {
  const twoRowHeightPx = iconMetrics.cellMinHeightPx * 2 + DESKTOP_GRID_GAP_PX;
  const verticalSidePx = twoRowHeightPx
    - iconMetrics.labelGapPx
    - iconMetrics.labelHeightPx;
  const horizontalSidePx = Math.max(0, columnWidthPx * 2 + DESKTOP_GRID_GAP_PX);
  const sidePx = Math.max(0, Math.min(verticalSidePx, horizontalSidePx));
  const innerSidePx = Math.max(0, sidePx - LARGE_FOLDER_BORDER_PX * 2);
  const spacingPx = innerSidePx / 16;
  const previewCellPx = innerSidePx / 4;

  return {
    sidePx,
    spacingPx,
    previewCellPx,
    previewFontPx: previewCellPx * 0.35,
    totalHeightPx: sidePx + iconMetrics.labelGapPx + iconMetrics.labelHeightPx,
  };
}
