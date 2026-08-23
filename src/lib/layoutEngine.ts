import { deepClone } from '@/lib/utils/deepClone';
import { createWidgetItem, getWidgetConfig } from '@/lib/widgetConfig';
import type { DesktopData, DesktopItem, DesktopSettings, FolderLayout, WidgetType } from '@/types';

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

export interface WidgetVisibilityResult extends LayoutMutationResult {
  widgetPage?: number;
}

export interface PrivacyTransferResult extends LayoutMutationResult {
  privacyItems: DesktopItem[];
}

export interface PrivacyPageCompaction {
  items: DesktopItem[];
  /** 旧负页码到新负页码；空页不会出现在映射中。 */
  pageMap: Map<number, number>;
}

export interface PrivacyLayoutMutationResult {
  ok: boolean;
  privacyItems: DesktopItem[];
  reason?: LayoutFailure;
  pageMap?: Map<number, number>;
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
  if (item.type === 'widget') return getWidgetConfig(item.widgetType).rowSpan;
  return item.type === 'folder' && item.folderLayout === '2x2' ? 2 : 1;
}

export function getItemColumnSpan(item: DesktopItem, cols: number): number {
  if (item.type === 'widget') return cols;
  return item.type === 'folder' && item.folderLayout === '2x2' ? 2 : 1;
}

export function getItemGridSpan(item: DesktopItem, cols: number): {
  rowSpan: number;
  colSpan: number;
} {
  return {
    rowSpan: getItemRowSpan(item),
    colSpan: getItemColumnSpan(item, cols),
  };
}

interface GridRect {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

function getItemGridRect(
  item: DesktopItem,
  row: number,
  col: number,
  cols: number,
): GridRect {
  const { rowSpan, colSpan } = getItemGridSpan(item, cols);
  const colStart = item.type === 'widget' ? 0 : col;
  return {
    rowStart: row,
    rowEnd: row + rowSpan,
    colStart,
    colEnd: colStart + colSpan,
  };
}

function gridRectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.rowStart < b.rowEnd
    && b.rowStart < a.rowEnd
    && a.colStart < b.colEnd
    && b.colStart < a.colEnd;
}

export function itemsOverlapAt(
  itemA: DesktopItem,
  rowA: number,
  colA: number,
  itemB: DesktopItem,
  rowB: number,
  colB: number,
  cols: number,
): boolean {
  return gridRectsOverlap(
    getItemGridRect(itemA, rowA, colA, cols),
    getItemGridRect(itemB, rowB, colB, cols),
  );
}

export function itemCoversCell(
  item: DesktopItem,
  row: number,
  col: number,
  cols: number,
): boolean {
  const rect = getItemGridRect(item, item.row, item.col, cols);
  return row >= rect.rowStart && row < rect.rowEnd
    && col >= rect.colStart && col < rect.colEnd;
}

export function findItemCoveringCell(
  pageItems: DesktopItem[],
  row: number,
  col: number,
  cols: number,
  excludeIds: string[] = [],
): DesktopItem | undefined {
  const excluded = new Set(excludeIds);
  return pageItems.find((item) => !excluded.has(item.id) && itemCoversCell(item, row, col, cols));
}

export function isFolderChildCandidate(item: DesktopItem): boolean {
  return item.type === 'app' || item.type === 'system';
}

export function folderContainsSystemItem(item: DesktopItem): boolean {
  return item.type === 'system' || Boolean(item.children?.some(folderContainsSystemItem));
}

export function isItemWithinBounds(
  item: DesktopItem,
  row: number,
  col: number,
  cols: number,
  rows: number,
): boolean {
  if (!isIntegerInRange(row, 0, rows)) return false;
  if (item.type === 'widget' && col !== 0) return false;
  if (!isIntegerInRange(col, 0, cols)) return false;
  const { rowSpan, colSpan } = getItemGridSpan(item, cols);
  return row + rowSpan <= rows && col + colSpan <= cols;
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

  return !others.some((candidate) => itemsOverlapAt(
    item,
    row,
    item.type === 'widget' ? 0 : col,
    candidate,
    candidate.row,
    candidate.col,
    cols,
  ));
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

/**
 * 启用或隐藏桌面组件时只修改组件本身，不重排普通应用。
 * 新组件优先使用已有页面中的完整空行；没有空间时创建新页。
 */
export function setDesktopWidgetEnabled(
  data: DesktopData,
  widgetType: WidgetType,
  enabled: boolean,
  cols: number,
  rows: number,
): WidgetVisibilityResult {
  const widget = createWidgetItem(widgetType, 0, 0);
  const existingPage = data.pages.findIndex((page) => page.some((item) => item.id === widget.id));

  if (!enabled) {
    if (existingPage < 0) return { ok: true, data };
    const next = deepClone(data);
    next.pages = next.pages.map((page) => page.filter((item) => item.id !== widget.id));
    return { ok: true, data: compactDesktopPages(next).data };
  }

  if (existingPage >= 0) return { ok: true, data, widgetPage: existingPage };

  const next = deepClone(data);
  if (next.pages.length === 0) next.pages.push([]);
  let slot = findFirstAvailableSlotAcrossPages(next.pages, widget, cols, rows, 0);
  if (!slot && next.pages.length < LAYOUT_LIMITS.maxPages) {
    const page = next.pages.length;
    next.pages.push([]);
    const position = findFirstAvailableSlot(next.pages[page], widget, cols, rows);
    if (position) slot = { page, ...position };
  }
  if (!slot) return { ok: false, data, reason: 'occupied' };

  next.pages[slot.page].push({
    ...widget,
    page: slot.page,
    row: slot.row,
    col: slot.col,
  });
  return { ok: true, data: next, widgetPage: slot.page };
}

function moveToPosition(item: DesktopItem, page: number, row: number, col: number): DesktopItem {
  const moved = { ...item, page, row, col };
  if (moved.children) {
    moved.children = moved.children.map((child) => ({ ...child, page, row, col }));
  }
  return moved;
}

export interface DesktopPageCompaction {
  data: DesktopData;
  /** 原页索引到新页索引；被删除的空页为 -1。 */
  pageMap: number[];
}

/**
 * 删除所有空白普通桌面页并重写 item.page；始终至少保留一个普通页。
 * 页面生命周期统一在数据层处理，避免不同拖拽/删除入口各自遗漏空页。
 */
export function compactDesktopPages(data: DesktopData): DesktopPageCompaction {
  const pageMap = data.pages.map(() => -1);
  const nonEmptyPages = data.pages
    .map((items, oldPage) => ({ items, oldPage }))
    .filter(({ items }) => items.length > 0);

  if (nonEmptyPages.length === 0) {
    return { data: { ...data, pages: [[]] }, pageMap };
  }

  if (nonEmptyPages.length === data.pages.length) {
    for (let page = 0; page < pageMap.length; page++) pageMap[page] = page;
    return { data, pageMap };
  }

  const pages = nonEmptyPages.map(({ items, oldPage }, newPage) => {
    pageMap[oldPage] = newPage;
    return items.map((item) => moveToPosition(item, newPage, item.row, item.col));
  });
  return { data: { ...data, pages }, pageMap };
}

/** 当前页被压缩掉时优先停留在原位置右侧页；尾部空页则回到上一页。 */
export function resolvePageAfterCompaction(
  page: number,
  pageMap: number[],
  pageCount: number,
): number {
  if (page < 0) return page;
  const direct = pageMap[page];
  if (direct !== undefined && direct >= 0) return direct;

  for (let oldPage = page + 1; oldPage < pageMap.length; oldPage++) {
    if (pageMap[oldPage] >= 0) return pageMap[oldPage];
  }
  for (let oldPage = Math.min(page - 1, pageMap.length - 1); oldPage >= 0; oldPage--) {
    if (pageMap[oldPage] >= 0) return pageMap[oldPage];
  }
  return Math.max(0, pageCount - 1);
}

/** 隐私页从 -1 向左递减；即使没有项目也保留一个可解锁的 -1 页。 */
export function getPrivacyPageCount(items: DesktopItem[]): number {
  const leftmost = items.reduce((minimum, item) => (
    Number.isInteger(item.page) && item.page < minimum ? item.page : minimum
  ), -1);
  return Math.min(LAYOUT_LIMITS.maxPages, Math.max(1, Math.abs(leftmost)));
}

/** 返回滑轨从左到右的隐私页码，例如 3 页为 [-3, -2, -1]。 */
export function getPrivacyPageNumbers(pageCount: number): number[] {
  const count = Math.min(LAYOUT_LIMITS.maxPages, Math.max(1, Math.floor(pageCount)));
  return Array.from({ length: count }, (_, index) => index - count);
}

/**
 * 删除隐私桌面中的空页并把剩余页紧凑重编号为 -1、-2…。
 * 与普通页相反，靠近普通桌面的页面始终保持为 -1。
 */
export function compactPrivacyPages(items: DesktopItem[]): PrivacyPageCompaction {
  const normalized = items.map((item) => {
    const page = Number.isInteger(item.page) && item.page < 0 ? item.page : -1;
    return moveToPosition(item, page, item.row, item.col);
  });
  const occupiedPages = [...new Set(normalized.map((item) => item.page))]
    .sort((a, b) => b - a);
  const pageMap = new Map<number, number>();
  occupiedPages.forEach((oldPage, index) => pageMap.set(oldPage, -(index + 1)));
  return {
    items: normalized.map((item) => moveToPosition(
      item,
      pageMap.get(item.page) ?? -1,
      item.row,
      item.col,
    )),
    pageMap,
  };
}

export function resolvePrivacyPageAfterCompaction(
  page: number,
  pageMap: Map<number, number>,
  pageCount: number,
): number {
  if (page >= 0) return page;
  const direct = pageMap.get(page);
  if (direct !== undefined) return direct;
  const count = Math.max(1, pageCount);
  return Math.max(-count, Math.min(-1, page));
}

/** 优先在指定隐私页找空位，全部已满时按需创建更靠左的新负页。 */
export function findFirstAvailablePrivacySlot(
  items: DesktopItem[],
  item: DesktopItem,
  cols: number,
  rows: number,
  preferPage = -1,
): { page: number; row: number; col: number } | null {
  const pageCount = getPrivacyPageCount(items);
  const pageOrder = Array.from({ length: pageCount }, (_, index) => -(index + 1));
  if (preferPage < 0 && preferPage >= -pageCount) {
    pageOrder.splice(pageOrder.indexOf(preferPage), 1);
    pageOrder.unshift(preferPage);
  }
  for (const page of pageOrder) {
    const slot = findFirstAvailableSlot(
      items.filter((candidate) => candidate.page === page),
      item,
      cols,
      rows,
    );
    if (slot) return { page, ...slot };
  }
  if (pageCount >= LAYOUT_LIMITS.maxPages) return null;
  const page = -(pageCount + 1);
  const slot = findFirstAvailableSlot([], item, cols, rows);
  return slot ? { page, ...slot } : null;
}

/** 隐私桌面内跨负页移动；命中项目时原子交换，并自动清理来源空页。 */
export function movePrivacyItem(
  privacyItems: DesktopItem[],
  itemId: string,
  toPage: number,
  row: number,
  col: number,
  cols: number,
  rows: number,
): PrivacyLayoutMutationResult {
  const source = privacyItems.find((item) => item.id === itemId);
  if (!source) return { ok: false, privacyItems, reason: 'item-not-found' };
  if (source.type === 'widget' || source.type === 'system') {
    return { ok: false, privacyItems, reason: 'protected-item' };
  }
  const pageCount = getPrivacyPageCount(privacyItems);
  if (
    !Number.isInteger(toPage)
    || toPage >= 0
    || toPage < -LAYOUT_LIMITS.maxPages
    || toPage < -(pageCount + 1)
  ) {
    return { ok: false, privacyItems, reason: 'invalid-page' };
  }
  if (!isItemWithinBounds(source, row, col, cols, rows)) {
    return { ok: false, privacyItems, reason: 'invalid-position' };
  }
  if (source.page === toPage && source.row === row && source.col === col) {
    return { ok: true, privacyItems };
  }

  const destinationItems = privacyItems.filter((item) => item.page === toPage);
  const overlappingTargets = destinationItems.filter((candidate) => (
    candidate.id !== source.id
    && itemsOverlapAt(source, row, col, candidate, candidate.row, candidate.col, cols)
  ));
  if (overlappingTargets.length > 1) {
    return { ok: false, privacyItems, reason: 'occupied' };
  }
  const target = overlappingTargets[0];
  if (!canPlaceItem(destinationItems, source, row, col, cols, rows, [source.id, target?.id ?? ''])) {
    return { ok: false, privacyItems, reason: 'occupied' };
  }
  if (target) {
    const sourcePageItems = privacyItems.filter((item) => item.page === source.page);
    if (
      target.type === 'widget'
      || target.type === 'system'
      || !canPlaceItem(
        sourcePageItems,
        target,
        source.row,
        source.col,
        cols,
        rows,
        [source.id, target.id],
      )
      || (
        source.page === toPage
        && itemsOverlapAt(source, row, col, target, source.row, source.col, cols)
      )
    ) {
      return { ok: false, privacyItems, reason: 'occupied' };
    }
  }

  const next = deepClone(privacyItems);
  const sourceIndex = next.findIndex((item) => item.id === itemId);
  if (target) {
    const targetIndex = next.findIndex((item) => item.id === target.id);
    next[targetIndex] = moveToPosition(target, source.page, source.row, source.col);
  }
  next[sourceIndex] = moveToPosition(source, toPage, row, col);
  const compacted = compactPrivacyPages(next);
  return {
    ok: true,
    privacyItems: compacted.items,
    pageMap: compacted.pageMap,
  };
}

/** 网格尺寸改变时稳定重排隐私项目，并按需增加或回收负页。 */
export function reflowPrivacyItems(
  privacyItems: DesktopItem[],
  cols: number,
  rows: number,
): DesktopItem[] {
  const source = compactPrivacyPages(privacyItems).items
    .sort((a, b) => (b.page - a.page) || (a.row - b.row) || (a.col - b.col));
  const output: DesktopItem[] = [];
  for (const item of source) {
    const slot = findFirstAvailablePrivacySlot(output, item, cols, rows, item.page);
    if (!slot) throw new Error('隐私桌面页数已达到上限');
    output.push(moveToPosition(item, slot.page, slot.row, slot.col));
  }
  return compactPrivacyPages(output).items;
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
  const overlappingTargets = destination.filter((candidate) => (
    candidate.id !== source.id
    && itemsOverlapAt(source, row, targetCol, candidate, candidate.row, candidate.col, cols)
  ));
  if (overlappingTargets.length > 1) {
    return { ok: false, data, reason: 'occupied' };
  }
  const target = overlappingTargets[0];
  if (!canPlaceItem(
    destination,
    source,
    row,
    targetCol,
    cols,
    rows,
    [source.id, target?.id ?? ''],
  )) {
    return {
      ok: false,
      data,
      reason: source.type === 'widget' || target?.type === 'widget' ? 'widget-overlap' : 'occupied',
    };
  }
  if (target) {
    if (source.type === 'widget' || target.type === 'widget') {
      return { ok: false, data, reason: 'widget-overlap' };
    }
    const sourcePageItems = data.pages[fromPage];
    if (
      !canPlaceItem(
        sourcePageItems,
        target,
        source.row,
        source.col,
        cols,
        rows,
        [source.id, target.id],
      )
      || (
        fromPage === toPage
        && itemsOverlapAt(source, row, targetCol, target, source.row, source.col, cols)
      )
    ) {
      return { ok: false, data, reason: 'occupied' };
    }
  }

  const next = deepClone(data);
  if (fromPage === toPage) {
    next.pages[fromPage] = next.pages[fromPage].filter((item) => (
      item.id !== source.id && item.id !== target?.id
    ));
  } else {
    next.pages[fromPage] = next.pages[fromPage].filter((item) => item.id !== source.id);
    if (target) {
      next.pages[toPage] = next.pages[toPage].filter((item) => item.id !== target.id);
    }
  }
  if (target) {
    next.pages[fromPage].push(moveToPosition(target, fromPage, source.row, source.col));
  }
  next.pages[toPage].push(moveToPosition(source, toPage, row, targetCol));
  return { ok: true, data: next };
}

/**
 * 普通桌面 → 隐私桌面。
 * 隐私边界不做隐式交换：目标必须为空，且仅应用或文件夹可跨越隐私边界。
 */
export function transferDesktopToPrivacy(
  data: DesktopData,
  privacyItems: DesktopItem[],
  itemId: string,
  toPage: number,
  row: number,
  col: number,
  cols: number,
  rows: number,
): PrivacyTransferResult {
  const privacyPageCount = getPrivacyPageCount(privacyItems);
  if (
    !Number.isInteger(toPage)
    || toPage >= 0
    || toPage < -LAYOUT_LIMITS.maxPages
    || toPage < -(privacyPageCount + 1)
    || !isIntegerInRange(row, 0, rows)
    || !isIntegerInRange(col, 0, cols)
  ) {
    return { ok: false, data, privacyItems, reason: 'invalid-position' };
  }
  let sourcePage = -1;
  let source: DesktopItem | undefined;
  for (let page = 0; page < data.pages.length; page++) {
    source = data.pages[page].find((item) => item.id === itemId);
    if (source) { sourcePage = page; break; }
  }
  if (!source) return { ok: false, data, privacyItems, reason: 'item-not-found' };
  if (
    source.type === 'system'
    || source.type === 'widget'
    || folderContainsSystemItem(source)
  ) {
    return { ok: false, data, privacyItems, reason: 'protected-item' };
  }
  if (!isItemWithinBounds(source, row, col, cols, rows)) {
    return { ok: false, data, privacyItems, reason: 'invalid-position' };
  }
  const destinationItems = privacyItems.filter((item) => item.page === toPage);
  if (!canPlaceItem(destinationItems, source, row, col, cols, rows, [source.id])) {
    return { ok: false, data, privacyItems, reason: 'occupied' };
  }

  const nextData = deepClone(data);
  nextData.pages[sourcePage] = nextData.pages[sourcePage].filter((item) => item.id !== itemId);
  const nextPrivacy = privacyItems.filter((item) => item.id !== itemId).map((item) => ({ ...item }));
  nextPrivacy.push(moveToPosition(source, toPage, row, col));
  return { ok: true, data: nextData, privacyItems: compactPrivacyPages(nextPrivacy).items };
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
  if (source.type === 'system' || source.type === 'widget') {
    return { ok: false, data, privacyItems, reason: 'protected-item' };
  }
  if (!isItemWithinBounds(source, row, col, cols, rows)) {
    return { ok: false, data, privacyItems, reason: 'invalid-position' };
  }
  if (!canPlaceItem(data.pages[toPage], source, row, col, cols, rows)) {
    const widgetBlocked = data.pages[toPage].some((candidate) => (
      candidate.type === 'widget'
      && itemsOverlapAt(source, row, col, candidate, candidate.row, candidate.col, cols)
    ));
    return { ok: false, data, privacyItems, reason: widgetBlocked ? 'widget-overlap' : 'occupied' };
  }

  const nextData = deepClone(data);
  nextData.pages[toPage].push(moveToPosition(source, toPage, row, col));
  const nextPrivacy = compactPrivacyPages(
    privacyItems.filter((item) => item.id !== itemId).map((item) => ({ ...item })),
  ).items;
  return { ok: true, data: nextData, privacyItems: nextPrivacy };
}

/**
 * 切换普通桌面文件夹占位。优先原地扩展；空间不足时只移动该文件夹到最近可用页，
 * 不挤压或覆盖已有项目。
 */
export function updateDesktopFolderLayout(
  data: DesktopData,
  folderId: string,
  folderLayout: FolderLayout,
  cols: number,
  rows: number,
): LayoutMutationResult {
  let folderPage = -1;
  let folder: DesktopItem | undefined;
  for (let page = 0; page < data.pages.length; page++) {
    folder = data.pages[page].find((item) => item.id === folderId);
    if (folder) { folderPage = page; break; }
  }
  if (!folder || folder.type !== 'folder') {
    return { ok: false, data, reason: 'item-not-found' };
  }
  if ((folder.folderLayout ?? '1x1') === folderLayout) return { ok: true, data };

  const next = deepClone(data);
  const current = next.pages[folderPage].find((item) => item.id === folderId)!;
  next.pages[folderPage] = next.pages[folderPage].filter((item) => item.id !== folderId);
  const resized = { ...current, folderLayout };

  let slot = canPlaceItem(
    next.pages[folderPage],
    resized,
    current.row,
    current.col,
    cols,
    rows,
  )
    ? { page: folderPage, row: current.row, col: current.col }
    : findFirstAvailableSlotAcrossPages(next.pages, resized, cols, rows, folderPage);

  if (!slot && next.pages.length < LAYOUT_LIMITS.maxPages) {
    const page = next.pages.length;
    next.pages.push([]);
    const position = findFirstAvailableSlot(next.pages[page], resized, cols, rows);
    if (position) slot = { page, ...position };
  }
  if (!slot) return { ok: false, data, reason: 'occupied' };

  next.pages[slot.page].push(moveToPosition(resized, slot.page, slot.row, slot.col));
  return { ok: true, data: next };
}

/** 隐私桌面文件夹布局切换；沿用负页自动创建与空页压缩规则。 */
export function updatePrivacyFolderLayout(
  privacyItems: DesktopItem[],
  folderId: string,
  folderLayout: FolderLayout,
  cols: number,
  rows: number,
): PrivacyLayoutMutationResult {
  const folder = privacyItems.find((item) => item.id === folderId);
  if (!folder || folder.type !== 'folder') {
    return { ok: false, privacyItems, reason: 'item-not-found' };
  }
  if ((folder.folderLayout ?? '1x1') === folderLayout) {
    return { ok: true, privacyItems };
  }

  const next = deepClone(privacyItems).filter((item) => item.id !== folderId);
  const resized = { ...folder, folderLayout };
  const currentPageItems = next.filter((item) => item.page === folder.page);
  const slot = canPlaceItem(
    currentPageItems,
    resized,
    folder.row,
    folder.col,
    cols,
    rows,
  )
    ? { page: folder.page, row: folder.row, col: folder.col }
    : findFirstAvailablePrivacySlot(next, resized, cols, rows, folder.page);
  if (!slot) return { ok: false, privacyItems, reason: 'occupied' };

  next.push(moveToPosition(resized, slot.page, slot.row, slot.col));
  const compacted = compactPrivacyPages(next);
  return {
    ok: true,
    privacyItems: compacted.items,
    pageMap: compacted.pageMap,
  };
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

  return compactDesktopPages({ ...source, pages: output.length ? output : [[]] }).data;
}

export function minimumRowsForEnabledWidgets(data: DesktopData): number {
  let minimum: number = LAYOUT_LIMITS.minRows;
  for (const item of data.pages.flat()) {
    minimum = Math.max(minimum, getItemRowSpan(item));
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
      const collision = pageItems.find((candidate) => (
        candidate.id !== item.id
        && itemsOverlapAt(
          item,
          item.row,
          item.col,
          candidate,
          candidate.row,
          candidate.col,
          cols,
        )
      ));
      if (collision) {
        const involvesWidget = item.type === 'widget' || collision.type === 'widget';
        issues.push({
          code: involvesWidget ? 'widget-overlap' : 'cell-collision',
          message: `${item.id} 与 ${collision.id} 的网格占位重叠`,
          itemId: item.id,
          page,
        });
      }
    }
  });
  return issues;
}
