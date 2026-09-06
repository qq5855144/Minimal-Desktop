import type { DesktopItem, IconColor, WidgetType } from '@/types';
import { DESKTOP_GRID_GAP_PX } from './iconLayout';

const DEFAULT_WIDGET_TYPE: WidgetType = 'search';
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
  weather: { type: 'weather', rowSpan: 2, defaultId: 'widget-weather', defaultName: '天气', defaultColor: 'blue' },
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

/**
 * 检查将 widget 放到 newRow（视觉 span = newSpan）后，是否会与页面上的其他 widget 视觉重叠。
 * 排除 excludeIds 中指定的 widget（通常是参与拖拽/交换的 widget 自身）。
 *
 * 区间重叠判定：[newRow, newRow+newSpan) 与 [it.row, it.row+span) 有交集
 *   ⇔ newRow < it.row + span && it.row < newRow + newSpan
 *
 * 用于拖拽落点校验：避免 widget 落入其他 widget 的 rowSpan 视觉区域内，
 * 否则渲染循环（r += span - 1）会跳过被覆盖行的所有 cell，导致被覆盖的 widget
 * 不被渲染（视觉上表现为"被覆盖/消失"）。
 */
export function wouldWidgetOverlap(
  pageItems: import('@/types').DesktopItem[],
  newRow: number,
  newSpan: number,
  excludeIds: string[] = [],
): boolean {
  for (const it of pageItems) {
    if (it.type !== 'widget') continue;
    if (excludeIds.includes(it.id)) continue;
    const span = getWidgetConfig(it.widgetType).rowSpan;
    if (newRow < it.row + span && it.row < newRow + newSpan) return true;
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
  return DESKTOP_GRID_GAP_PX;
}

/** 天气是固定矩形组件，其余既有组件仍占满整行。 */
export function isFullWidthWidget(item: DesktopItem): boolean {
  return item.type === 'widget' && item.widgetType !== 'weather';
}
