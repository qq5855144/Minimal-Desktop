export type IconSizeVariant = 'normal' | 'small';

const SMALL_ICON_PX = 48;
const DEFAULT_ICON_PX = 46;
const ICON_RADIUS = '22%';
const ICON_LABEL_GAP_PX = 4;
const ICON_LABEL_PADDING_X_PX = 8;
const FOLDER_PREVIEW_SCALE = 0.68;
const FOLDER_PREVIEW_GAP_PX = 4;

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

export function resolveIconPx(size: IconSizeVariant = 'normal', iconPx?: number): number {
  if (size === 'small') return SMALL_ICON_PX;
  return iconPx ?? DEFAULT_ICON_PX;
}

export function getIconLayoutMetrics(size: IconSizeVariant = 'normal', iconPx?: number): IconLayoutMetrics {
  const resolvedIconPx = resolveIconPx(size, iconPx);
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
    iconRadius: ICON_RADIUS,
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
