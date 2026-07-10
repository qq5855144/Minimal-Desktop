import type { DesktopItem, IconColor, WidgetType } from '@/types';

const DEFAULT_WIDGET_TYPE: WidgetType = 'search';
const WIDGET_GRID_ROW_GAP_PX = 12;
const WIDGET_GHOST_WIDTH_PX = {
  compact: 320,
  wide: 480,
} as const;

export const CLOCK_VISUAL_MIN_HEIGHT_PX = 96;

interface WidgetConfig {
  type: WidgetType;
  rowSpan: number;
  defaultId: string;
  defaultName: string;
  defaultColor: IconColor;
}

export const WIDGET_CONFIG: Record<WidgetType, WidgetConfig> = {
  clock: {
    type: 'clock',
    rowSpan: 2,
    defaultId: 'widget-clock',
    defaultName: '时钟',
    defaultColor: 'blue',
  },
  search: {
    type: 'search',
    rowSpan: 1,
    defaultId: 'widget-search',
    defaultName: '搜索栏',
    defaultColor: 'blue',
  },
  combined: {
    type: 'combined',
    rowSpan: 3,
    defaultId: 'widget-combined',
    defaultName: '组合组件',
    defaultColor: 'blue',
  },
};

export function resolveWidgetType(widgetType?: WidgetType): WidgetType {
  if (widgetType && widgetType in WIDGET_CONFIG) return widgetType;
  return DEFAULT_WIDGET_TYPE;
}

export function getWidgetConfig(widgetType?: WidgetType): WidgetConfig {
  return WIDGET_CONFIG[resolveWidgetType(widgetType)];
}

export function createWidgetItem(widgetType: WidgetType, page: number, row: number): DesktopItem {
  const config = getWidgetConfig(widgetType);

  return {
    id: config.defaultId,
    type: 'widget',
    name: config.defaultName,
    color: config.defaultColor,
    widgetType: config.type,
    page,
    row,
    col: 0,
  };
}

export function getWidgetGhostWidthPx(wide = false): number {
  return wide ? WIDGET_GHOST_WIDTH_PX.wide : WIDGET_GHOST_WIDTH_PX.compact;
}

export function getWidgetGridRowGapPx(): number {
  return WIDGET_GRID_ROW_GAP_PX;
}
