import type { FolderLayout } from '@/types';

export type IconSizeVariant = 'normal' | 'small';

const SMALL_ICON_PX = 44;
const DEFAULT_ICON_PX = 46;
const DEFAULT_ICON_RADIUS_PCT = 25;
const ICON_LABEL_GAP_PX = 4;
const ICON_LABEL_PADDING_X_PX = 8;
const FOLDER_PREVIEW_SCALE = 0.78;
const FOLDER_PREVIEW_GAP_PX = 3;
const LARGE_FOLDER_RADIUS = '12%';
const WIDE_GRID_VERTICAL_RESERVED_PX = 48;
const WIDE_COLUMN_BREATHING_MIN_PX = 32;
const WIDE_COLUMN_BREATHING_MAX_PX = 44;
const WIDE_COLUMN_BREATHING_RATIO = 0.78;

/** 桌面行、列统一间隔；组件、普通图标和大文件夹共用同一几何基准。 */
export const DESKTOP_GRID_GAP_PX = 16;
export const DESKTOP_GRID_MAX_WIDTH_PX = 672;
export const DESKTOP_GRID_WIDE_MAX_WIDTH_PX = 1080;
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
  contentHeightPx: number;
  columnWidthPx: number;
  rowHeightPx: number;
  columnGapPx: number;
  rowGapPx: number;
  iconPx: number;
  isWide: boolean;
}

export interface LargeFolderLayoutMetrics {
  /** 文件夹可视外框边长，不包含下方名称。 */
  sidePx: number;
  /** 2×2 外框使用固定圆角，不受应用图标圆角设置影响。 */
  radius: string;
  /** 外框内边距与缩略图行、列间距共用此值。 */
  spacingPx: number;
  /** 3×3 缩略图单格边长。 */
  previewCellPx: number;
  previewFontPx: number;
  totalHeightPx: number;
}

export interface ExpandedFolderLayoutMetrics {
  widthPx: number;
  heightPx: number;
  radius: string;
  previewRows: number;
  previewCols: number;
  previewCellPx: number;
  previewFontPx: number;
  columnGapPx: number;
  rowGapPx: number;
  paddingXPx: number;
  paddingYPx: number;
  totalHeightPx: number;
}

export function resolveIconPx(size: IconSizeVariant = 'normal', iconPx?: number): number {
  if (size === 'small') return SMALL_ICON_PX;
  return iconPx ?? DEFAULT_ICON_PX;
}

/**
 * 根据真实视口和“应用视图”的行列数计算统一网格几何。
 *
 * 紧凑视口保持原有满宽布局；电脑端则以 2×2 文件夹为几何锚点：
 * - 两列宽度 + 列间隔 = 文件夹正方形边长；
 * - 两行高度 + 行间隔 = 文件夹边长 + 名称区域；
 * - 行数越多，优先收紧留白和间隔，不缩小用户指定的图标尺寸；空间仍不足时滚动。
 */
export function getDesktopGridLayoutMetrics(
  viewportWidthPx: number,
  cols: number,
  preferredIconPx: number,
  viewportHeightPx = Number.POSITIVE_INFINITY,
  rows = 8,
): DesktopGridLayoutMetrics {
  const safeViewportWidth = Number.isFinite(viewportWidthPx)
    ? Math.max(0, viewportWidthPx)
    : DESKTOP_GRID_MAX_WIDTH_PX;
  const safeCols = Number.isInteger(cols) && cols > 0 ? cols : 4;
  const safeRows = Number.isInteger(rows) && rows > 0 ? rows : 8;
  const isWide = safeViewportWidth >= DESKTOP_GRID_BREAKPOINT_PX;
  const horizontalPadding = isWide
    ? DESKTOP_GRID_WIDE_PADDING_X_PX
    : DESKTOP_GRID_COMPACT_PADDING_X_PX;
  const availableContentWidthPx = Math.min(
    isWide ? DESKTOP_GRID_WIDE_MAX_WIDTH_PX : DESKTOP_GRID_MAX_WIDTH_PX,
    Math.max(0, safeViewportWidth - horizontalPadding),
  );
  const requestedIconPx = Number.isFinite(preferredIconPx)
    ? Math.max(1, preferredIconPx)
    : DEFAULT_ICON_PX;
  const labelAreaPx = ICON_LABEL_GAP_PX + LABEL_HEIGHT_MAP.normal;

  if (!isWide) {
    const columnGapPx = DESKTOP_GRID_GAP_PX;
    const rowGapPx = DESKTOP_GRID_GAP_PX;
    const columnWidthPx = Math.max(
      0,
      (availableContentWidthPx - columnGapPx * (safeCols - 1)) / safeCols,
    );
    const iconPx = Math.max(
      1,
      Math.min(requestedIconPx, columnWidthPx - ICON_LABEL_PADDING_X_PX),
    );
    // 行高与列宽相等、行列 gap 相等，保证相邻图标的横纵中心距一致。
    // 图标与名称允许使用紧随轨道的 gap；最大图标下仍保留至少 2px 分隔。
    const rowHeightPx = columnWidthPx;
    return {
      contentWidthPx: availableContentWidthPx,
      contentHeightPx: rowHeightPx * safeRows + rowGapPx * (safeRows - 1),
      columnWidthPx,
      rowHeightPx,
      columnGapPx,
      rowGapPx,
      iconPx,
      isWide,
    };
  }

  // 8 行以内保持舒展；增加每页行数时逐级收紧，最低仍保留 12px 触控分隔。
  const gridGapPx = safeRows <= 8 ? 16 : safeRows <= 10 ? 14 : 12;
  const maxColumnWidthByViewportPx = Math.max(
    0,
    (availableContentWidthPx - gridGapPx * (safeCols - 1)) / safeCols,
  );
  const breathingPx = Math.min(
    WIDE_COLUMN_BREATHING_MAX_PX,
    Math.max(WIDE_COLUMN_BREATHING_MIN_PX, requestedIconPx * WIDE_COLUMN_BREATHING_RATIO),
  );
  const targetColumnWidthPx = requestedIconPx + breathingPx;

  // rowHeight = columnWidth 且行列 gap 相等时，相邻应用图标的横纵中心距严格相等，
  // 正方形 2×2 文件夹才能同时对齐两列的左右边和两行的上下边。
  // 高度约束只压缩额外留白；达到图标可读下限后允许页面纵向滚动。
  const minColumnWidthForRequestedIconPx = requestedIconPx + labelAreaPx / 2;
  const safeViewportHeightPx = Number.isFinite(viewportHeightPx)
    ? Math.max(0, viewportHeightPx)
    : Number.POSITIVE_INFINITY;
  const availableContentHeightPx = Math.max(
    0,
    safeViewportHeightPx - WIDE_GRID_VERTICAL_RESERVED_PX,
  );
  const maxRowHeightByViewportPx = Number.isFinite(availableContentHeightPx)
    ? (availableContentHeightPx - gridGapPx * (safeRows - 1)) / safeRows
    : Number.POSITIVE_INFINITY;
  const maxColumnWidthByHeightPx = Math.max(
    minColumnWidthForRequestedIconPx,
    maxRowHeightByViewportPx,
  );
  const columnWidthPx = Math.max(
    0,
    Math.min(
      targetColumnWidthPx,
      maxColumnWidthByViewportPx,
      maxColumnWidthByHeightPx,
    ),
  );
  // 极端窄的伪桌面视口仍以列宽为最终边界，避免名称或图标越过格子。
  const iconPx = Math.max(
    1,
    Math.min(requestedIconPx, columnWidthPx - labelAreaPx / 2),
  );
  const rowHeightPx = columnWidthPx;
  const contentWidthPx = columnWidthPx * safeCols + gridGapPx * (safeCols - 1);
  const contentHeightPx = rowHeightPx * safeRows + gridGapPx * (safeRows - 1);

  return {
    contentWidthPx,
    contentHeightPx,
    columnWidthPx,
    rowHeightPx,
    columnGapPx: gridGapPx,
    rowGapPx: gridGapPx,
    iconPx,
    isWide,
  };
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
 * - 外框始终为正方形，并保持 2×2 数据占位；
 * - 外框左右边缘与相邻两列普通应用图标的外边缘严格对齐；
 * - 网格横纵中心距相等，因此上下边也与相邻两行普通应用图标严格对齐；
 * - 外框在四格数据占位内居中，不把列轨为名称预留的呼吸空间算进宽度；
 * - 名称间距沿用普通应用的 labelGap；
 * - 内部 3×3 使用 3 个 1/4 单元 + 4 个 1/16 间距，四周与行列间距完全相等。
 */
export function getLargeFolderLayoutMetrics(
  iconMetrics: IconLayoutMetrics,
  gridMetrics: Pick<
    DesktopGridLayoutMetrics,
    'columnWidthPx' | 'columnGapPx'
  >,
): LargeFolderLayoutMetrics {
  // 相邻两列图标的中心距为 columnWidth + columnGap；在其两端各延伸半个
  // iconPx，得到的正方形才能在任意图标尺寸下都与普通应用的左右边缘对齐。
  // 不能直接使用完整两列轨道宽度，否则图标越大，文件夹越会侵入轨道留白。
  const sidePx = Math.max(
    0,
    gridMetrics.columnWidthPx + gridMetrics.columnGapPx + iconMetrics.iconPx,
  );
  // 无边线：整个正方形直接按 16 份分配，3 个缩略图各 4 份、四段间距各 1 份。
  const spacingPx = sidePx / 16;
  const previewCellPx = sidePx / 4;

  return {
    sidePx,
    radius: LARGE_FOLDER_RADIUS,
    spacingPx,
    previewCellPx,
    previewFontPx: previewCellPx * 0.35,
    totalHeightPx: sidePx + iconMetrics.labelGapPx + iconMetrics.labelHeightPx,
  };
}

/** 由同一 2×2 几何锚点派生三种扩展文件夹外框，确保行列边缘一致。 */
export function getExpandedFolderLayoutMetrics(
  layout: Exclude<FolderLayout, '1x1'>,
  iconMetrics: IconLayoutMetrics,
  largeMetrics: LargeFolderLayoutMetrics,
): ExpandedFolderLayoutMetrics {
  if (layout === '2x2') {
    return {
      widthPx: largeMetrics.sidePx,
      heightPx: largeMetrics.sidePx,
      radius: largeMetrics.radius,
      previewRows: 3,
      previewCols: 3,
      previewCellPx: largeMetrics.previewCellPx,
      previewFontPx: largeMetrics.previewFontPx,
      columnGapPx: largeMetrics.spacingPx,
      rowGapPx: largeMetrics.spacingPx,
      paddingXPx: largeMetrics.spacingPx,
      paddingYPx: largeMetrics.spacingPx,
      totalHeightPx: largeMetrics.totalHeightPx,
    };
  }

  const horizontal = layout === '1x2';
  const widthPx = horizontal ? largeMetrics.sidePx : iconMetrics.iconPx;
  const heightPx = horizontal ? iconMetrics.iconPx : largeMetrics.sidePx;
  const previewRows = horizontal ? 1 : 3;
  const previewCols = horizontal ? 3 : 1;
  const shortSidePx = Math.min(widthPx, heightPx);
  const longSidePx = Math.max(widthPx, heightPx);
  const minimumGapPx = Math.max(2, shortSidePx * 0.06);
  const previewCellPx = Math.max(
    1,
    Math.min(shortSidePx * 0.72, (longSidePx - minimumGapPx * 4) / 3),
  );
  const columnGapPx = (widthPx - previewCellPx * previewCols) / (previewCols + 1);
  const rowGapPx = (heightPx - previewCellPx * previewRows) / (previewRows + 1);

  return {
    widthPx,
    heightPx,
    radius: largeMetrics.radius,
    previewRows,
    previewCols,
    previewCellPx,
    previewFontPx: previewCellPx * 0.35,
    columnGapPx,
    rowGapPx,
    paddingXPx: columnGapPx,
    paddingYPx: rowGapPx,
    totalHeightPx: heightPx + iconMetrics.labelGapPx + iconMetrics.labelHeightPx,
  };
}
