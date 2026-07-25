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

/**
 * 判断数据层行号 r 是否被某个 widget 的视觉区域覆盖。
 *
 * 数据层每个 widget 占 1 个 row slot（row = widgetRow），
 * 但渲染时视觉高度为 rowSpan 行。
 * 因此行 r 被覆盖的条件：widgetRow <= r < widgetRow + rowSpan。
 *
 * 用于所有需要跳过"视觉被 widget 占据的行"的场景：
 *   findEmptySlot、dissolveFolder、addItem 隐私桌面、拖拽落点校验。
 */
export function isRowCoveredByWidget(
  pageItems: import('@/types').DesktopItem[],
  r: number,
): boolean {
  for (const it of pageItems) {
    if (it.type !== 'widget') continue;
    const span = getWidgetConfig(it.widgetType).rowSpan;
    if (r >= it.row && r < it.row + span) return true;
  }
  return false;
}

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
