import type { WidgetType } from '@/types';
import { getIconLayoutMetrics } from './iconLayout';
import { getWidgetConfig, getWidgetGhostWidthPx, getWidgetGridRowGapPx, resolveWidgetType } from './widgetConfig';

export interface WidgetLayoutMetrics {
  type: WidgetType;
  rowSpan: number;
  cellMinHeightPx: number;
  ghostWidthPx: number;
  ghostRadiusPx: number;
}

export function getWidgetLayoutMetrics(
  widgetType?: WidgetType,
  iconPx?: number,
  wide = false,
): WidgetLayoutMetrics {
  const type = resolveWidgetType(widgetType);
  const rowSpan = getWidgetConfig(type).rowSpan;
  const iconMetrics = getIconLayoutMetrics('normal', iconPx);
  const cellMinHeightPx =
    iconMetrics.cellMinHeightPx * rowSpan + getWidgetGridRowGapPx() * (rowSpan - 1);

  return {
    type,
    rowSpan,
    cellMinHeightPx,
    ghostWidthPx: getWidgetGhostWidthPx(wide),
    ghostRadiusPx: 24,
  };
}

/**
 * 将指针 Y 坐标映射到等高桌面网格的逻辑行；行间隙按中线归属相邻行。
 * 网格渲染与这里共用 rowHeight/rowGap，避免通过 widget DOM 高度反推 rowSpan。
 */
export function resolveGridRowAtY(
  clientY: number,
  gridTop: number,
  rowHeightPx: number,
  rowGapPx: number,
  rowCount: number,
): number | null {
  if (
    !Number.isFinite(clientY)
    || !Number.isFinite(gridTop)
    || !Number.isFinite(rowHeightPx)
    || !Number.isFinite(rowGapPx)
    || rowHeightPx <= 0
    || rowGapPx < 0
    || !Number.isInteger(rowCount)
    || rowCount <= 0
  ) {
    return null;
  }

  const relativeY = clientY - gridTop;
  const totalHeight = rowCount * rowHeightPx + (rowCount - 1) * rowGapPx;
  if (relativeY < 0 || relativeY > totalHeight) return null;
  if (relativeY === totalHeight) return rowCount - 1;

  const stride = rowHeightPx + rowGapPx;
  const baseRow = Math.floor(relativeY / stride);
  const withinStride = relativeY - baseRow * stride;
  const row = withinStride > rowHeightPx + rowGapPx / 2
    ? baseRow + 1
    : baseRow;
  return Math.max(0, Math.min(rowCount - 1, row));
}
