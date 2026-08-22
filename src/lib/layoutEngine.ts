import { deepClone } from '@/lib/utils/deepClone';
import { getWidgetConfig, isRowCoveredByWidget, wouldWidgetOverlap } from '@/lib/widgetConfig';
import type { DesktopData, DesktopItem, DesktopSettings } from '@/types';

/**
 * 桌面布局的唯一规则源。
 *
 * UI 只负责把指针位置转换成 row/col，所有数据写入前都必须经过这里。
 * 这样拖拽、组件开关、跨隐私桌面移动、行列数变化不会各自维护一套规则。
 */
export const LAYOUT_LIMITS = Object.freeze({
  minRows: 1,
  maxRows: 16,
  minCols: 4,
  maxCols: 5,
  maxPages: 20,
  maxFolderApps: 9,
});

export type LayoutFailure =
  | 'invalid-page'
  | 'invalid-position'
  | 'occupied'
  | 'widget-overlap'
  | 'protected-item'
  | 'item-not-found';

export interface LayoutMutationResult {
  ok: boolean;
  data: DesktopData;
  reason?: LayoutFailure;
}

export interface PrivacyTransferResult extends LayoutMutationResult {
  privacyItems: DesktopItem[];
}

export interface LayoutIssue {
  code: string;
  message: string;
  itemId?: string;
  page?: number;
}

/**
 * 文件夹保持紧凑数组；拖到尚未填充的槽位等价于移到末尾。
 * 返回 null 表示索引无效或顺序未变化，调用方无需产生历史记录。
 */
export function reorderFolderChildren(
  children: DesktopItem[],
  fromIdx: number,
  toSlotIdx: number,
  maxItems = LAYOUT_LIMITS.maxFolderApps,
): DesktopItem[] | null {
  if (
    !Number.isInteger(fromIdx)
    || !Number.isInteger(toSlotIdx)
    || fromIdx < 0
    || fromIdx >= children.length
    || toSlotIdx < 0
    || toSlotIdx >= maxItems
    || fromIdx === toSlotIdx
  ) {
    return null;
  }
  const effectiveTargetIdx = Math.min(toSlotIdx, children.length - 1);
  if (fromIdx === effectiveTargetIdx) return null;
  const next = children.map((child) => ({ ...child }));
  const [moved] = next.splice(fromIdx, 1);
  next.splice(effectiveTargetIdx, 0, moved);
  return next;
}

function isIntegerInRange(value: number, min: number, maxExclusive: number): boolean {
  return Number.isInteger(value) && value >= min && value < maxExclusive;
}

export function getItemRowSpan(item: DesktopItem): number {
  return item.type === 'widget' ? getWidgetConfig(item.widgetType).rowSpan : 1;
}

export function isItemWithinBounds(
  item: DesktopItem,
  row: number,
  col: number,
  cols: number,
  rows: number,
): boolean {
  if (!isIntegerInRange(row, 0, rows)) return false;
  if (item.type === 'widget') {
    return col === 0 && row + getItemRowSpan(item) <= rows;
  }
  return isIntegerInRange(col, 0, cols);
}

export function canPlaceItem(
  pageItems: DesktopItem[],
  item: DesktopItem,
  row: number,
  col: number,
  cols: number,
  rows: number,
  excludeIds: string[] = [],
): boolean {
  if (!isItemWithinBounds(item, row, col, cols, rows)) return false;
  const excluded = new Set([...excludeIds, item.id]);
  const others = pageItems.filter((candidate) => !excluded.has(candidate.id));

  if (item.type === 'widget') {
    const span = getItemRowSpan(item);
    if (wouldWidgetOverlap(others, row, span)) return false;
    return !others.some((candidate) => (
      candidate.type !== 'widget' && candidate.row >= row && candidate.row < row + span
    ));
  }

  if (isRowCoveredByWidget(others, row)) return false;
  return !others.some((candidate) => candidate.row === row && candidate.col === col);
}

export function findFirstAvailableSlot(
  pageItems: DesktopItem[],
  item: DesktopItem,
  cols: number,
  rows: number,
): { row: number; col: number } | null {
  if (item.type === 'widget') {
    const span = getItemRowSpan(item);
    for (let row = 0; row + span <= rows; row++) {
      if (canPlaceItem(pageItems, item, row, 0, cols, rows)) return { row, col: 0 };
    }
    return null;
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (canPlaceItem(pageItems, item, row, col, cols, rows)) return { row, col };
    }
  }
  return null;
}

export function findFirstAvailableSlotAcrossPages(
  pages: DesktopItem[][],
  item: DesktopItem,
  cols: number,
  rows: number,
  preferPage?: number,
): { page: number; row: number; col: number } | null {
  const pageOrder = Array.from({ length: pages.length }, (_, index) => index);
  if (preferPage !== undefined && preferPage >= 0 && preferPage < pages.length) {
    pageOrder.splice(pageOrder.indexOf(preferPage), 1);
    pageOrder.unshift(preferPage);
  }

  for (const page of pageOrder) {
    const slot = findFirstAvailableSlot(pages[page], item, cols, rows);
    if (slot) return { page, ...slot };
  }
  return null;
}

function moveToPosition(item: DesktopItem, page: number, row: number, col: number): DesktopItem {
  const moved = { ...item, page, row, col };
  if (moved.children) {
    moved.children = moved.children.map((child) => ({ ...child, page, row, col }));
  }
  return moved;
}

/** 移动普通桌面项目。普通项目命中普通项目时交换；widget 只能进入完整空闲区域。 */
export function moveDesktopItem(
  data: DesktopData,
  itemId: string,
  fromPage: number,
  toPage: number,
  row: number,
  col: number,
  cols: number,
  rows: number,
): LayoutMutationResult {
  if (!data.pages[fromPage] || !data.pages[toPage]) {
    return { ok: false, data, reason: 'invalid-page' };
  }
  const source = data.pages[fromPage].find((item) => item.id === itemId);
  if (!source) return { ok: false, data, reason: 'item-not-found' };
  if (!isItemWithinBounds(source, row, source.type === 'widget' ? 0 : col, cols, rows)) {
    return { ok: false, data, reason: 'invalid-position' };
  }

  const targetCol = source.type === 'widget' ? 0 : col;
  if (source.page === toPage && source.row === row && source.col === targetCol) {
    return { ok: true, data };
  }

  const destination = data.pages[toPage];
  if (source.type === 'widget') {
    if (!canPlaceItem(destination, source, row, 0, cols, rows, [source.id])) {
      return { ok: false, data, reason: 'widget-overlap' };
    }
  } else {
    if (isRowCoveredByWidget(destination.filter((item) => item.id !== source.id), row)) {
      return { ok: false, data, reason: 'widget-overlap' };
    }
    const exactTarget = destination.find((item) => (
      item.id !== source.id && item.row === row && item.col === targetCol
    ));
    if (exactTarget?.type === 'widget') {
      return { ok: false, data, reason: 'widget-overlap' };
    }
  }

  const next = deepClone(data);
  const sourceIndex = next.pages[fromPage].findIndex((item) => item.id === itemId);
  const [moved] = next.pages[fromPage].splice(sourceIndex, 1);
  const targetIndex = next.pages[toPage].findIndex((item) => (
    item.row === row && item.col === targetCol
  ));

  if (targetIndex >= 0) {
    const [target] = next.pages[toPage].splice(targetIndex, 1);
    if (moved.type === 'widget' || target.type === 'widget') {
      return { ok: false, data, reason: 'widget-overlap' };
    }
    next.pages[fromPage].push(moveToPosition(target, fromPage, moved.row, moved.col));
  }

  next.pages[toPage].push(moveToPosition(moved, toPage, row, targetCol));
  return { ok: true, data: next };
}

/**
 * 普通桌面 → 隐私桌面。
 * 隐私边界不做隐式交换：目标必须为空，且仅 app 可跨越隐私边界。
 */
export function transferDesktopToPrivacy(
  data: DesktopData,
  privacyItems: DesktopItem[],
  itemId: string,
  row: number,
  col: number,
  cols: number,
  rows: number,
): PrivacyTransferResult {
  if (!isIntegerInRange(row, 0, rows) || !isIntegerInRange(col, 0, cols)) {
    return { ok: false, data, privacyItems, reason: 'invalid-position' };
  }
  let sourcePage = -1;
  let source: DesktopItem | undefined;
  for (let page = 0; page < data.pages.length; page++) {
    source = data.pages[page].find((item) => item.id === itemId);
    if (source) { sourcePage = page; break; }
  }
  if (!source) return { ok: false, data, privacyItems, reason: 'item-not-found' };
  if (source.type !== 'app') return { ok: false, data, privacyItems, reason: 'protected-item' };
  if (privacyItems.some((item) => item.row === row && item.col === col && item.id !== itemId)) {
    return { ok: false, data, privacyItems, reason: 'occupied' };
  }

  const nextData = deepClone(data);
  nextData.pages[sourcePage] = nextData.pages[sourcePage].filter((item) => item.id !== itemId);
  const nextPrivacy = privacyItems.filter((item) => item.id !== itemId).map((item) => ({ ...item }));
  nextPrivacy.push(moveToPosition(source, -1, row, col));
  return { ok: true, data: nextData, privacyItems: nextPrivacy };
}

/** 隐私桌面 → 普通桌面。目标必须为空，永不通过删除目标项目来“让位”。 */
export function transferPrivacyToDesktop(
  data: DesktopData,
  privacyItems: DesktopItem[],
  itemId: string,
  toPage: number,
  row: number,
  col: number,
  cols: number,
  rows: number,
): PrivacyTransferResult {
  if (!data.pages[toPage]) return { ok: false, data, privacyItems, reason: 'invalid-page' };
  const source = privacyItems.find((item) => item.id === itemId);
  if (!source) return { ok: false, data, privacyItems, reason: 'item-not-found' };
  if (source.type !== 'app') return { ok: false, data, privacyItems, reason: 'protected-item' };
  if (!isItemWithinBounds(source, row, col, cols, rows)) {
    return { ok: false, data, privacyItems, reason: 'invalid-position' };
  }
  if (!canPlaceItem(data.pages[toPage], source, row, col, cols, rows)) {
    const widgetBlocked = isRowCoveredByWidget(data.pages[toPage], row);
    return { ok: false, data, privacyItems, reason: widgetBlocked ? 'widget-overlap' : 'occupied' };
  }

  const nextData = deepClone(data);
  nextData.pages[toPage].push(moveToPosition(source, toPage, row, col));
  const nextPrivacy = privacyItems.filter((item) => item.id !== itemId).map((item) => ({ ...item }));
  return { ok: true, data: nextData, privacyItems: nextPrivacy };
}

/** 根据新的网格尺寸稳定重排，保证任何项目都不会被放到不可见区域。 */
export function reflowDesktopData(data: DesktopData, cols: number, rows: number): DesktopData {
  const source = deepClone(data);
  const output: DesktopItem[][] = [];

  const ensurePage = (preferNew = false): number => {
    if (preferNew || output.length === 0) {
      if (output.length >= LAYOUT_LIMITS.maxPages) throw new Error('桌面页数已达到上限');
      output.push([]);
    }
    return output.length - 1;
  };

  for (const originalPage of source.pages) {
    let outputPage = ensurePage(true);
    const sorted = [...originalPage].sort((a, b) => (a.row - b.row) || (a.col - b.col));
    for (const item of sorted) {
      let slot = findFirstAvailableSlot(output[outputPage], item, cols, rows);
      if (!slot) {
        outputPage = ensurePage(true);
        slot = findFirstAvailableSlot(output[outputPage], item, cols, rows);
      }
      // settings UI 会保证 rows >= 最大 widget span；这里保留最终防线。
      if (!slot) {
        throw new Error(`无法在 ${rows} 行布局中放置 ${item.id}`);
      }
      output[outputPage].push(moveToPosition(item, outputPage, slot.row, slot.col));
    }
  }

  while (output.length > 1 && output[output.length - 1].length === 0) output.pop();
  return { ...source, pages: output.length ? output : [[]] };
}

export function minimumRowsForEnabledWidgets(data: DesktopData): number {
  let minimum: number = LAYOUT_LIMITS.minRows;
  for (const item of data.pages.flat()) {
    if (item.type === 'widget') minimum = Math.max(minimum, getItemRowSpan(item));
  }
  return minimum;
}

export function validateDesktopLayout(
  data: DesktopData,
  settings: Pick<DesktopSettings, 'cols' | 'rows'>,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const ids = new Set<string>();
  const { cols, rows } = settings;

  const registerId = (item: DesktopItem, page: number) => {
    if (ids.has(item.id)) {
      issues.push({ code: 'duplicate-id', message: `重复 ID: ${item.id}`, itemId: item.id, page });
    }
    ids.add(item.id);
    item.children?.forEach((child) => registerId(child, page));
  };

  data.pages.forEach((pageItems, page) => {
    pageItems.forEach((item) => registerId(item, page));
    for (const item of pageItems) {
      if (item.page !== page) {
        issues.push({ code: 'page-mismatch', message: `${item.id} 的 page 字段与所在页不一致`, itemId: item.id, page });
      }
      if (!isItemWithinBounds(item, item.row, item.col, cols, rows)) {
        issues.push({ code: 'out-of-bounds', message: `${item.id} 超出网格范围`, itemId: item.id, page });
      }
      if (item.type === 'folder' && (item.children?.length ?? 0) > LAYOUT_LIMITS.maxFolderApps) {
        issues.push({ code: 'folder-overflow', message: `${item.id} 超出文件夹容量`, itemId: item.id, page });
      }
      if (item.type === 'widget') {
        const span = getItemRowSpan(item);
        if (wouldWidgetOverlap(pageItems, item.row, span, [item.id])) {
          issues.push({ code: 'widget-overlap', message: `${item.id} 与其他 widget 重叠`, itemId: item.id, page });
        }
        if (pageItems.some((candidate) => (
          candidate.id !== item.id && candidate.type !== 'widget'
          && candidate.row >= item.row && candidate.row < item.row + span
        ))) {
          issues.push({ code: 'widget-covers-item', message: `${item.id} 覆盖普通项目`, itemId: item.id, page });
        }
      } else {
        const collision = pageItems.find((candidate) => (
          candidate.id !== item.id && candidate.type !== 'widget'
          && candidate.row === item.row && candidate.col === item.col
        ));
        if (collision) {
          issues.push({ code: 'cell-collision', message: `${item.id} 与 ${collision.id} 占用同一格`, itemId: item.id, page });
        }
        if (isRowCoveredByWidget(pageItems.filter((candidate) => candidate.id !== item.id), item.row)) {
          issues.push({ code: 'widget-covers-item', message: `${item.id} 位于 widget 覆盖行`, itemId: item.id, page });
        }
      }
    }
  });
  return issues;
}
