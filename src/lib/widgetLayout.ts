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
