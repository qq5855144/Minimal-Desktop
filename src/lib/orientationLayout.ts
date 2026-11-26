import type { DesktopData, DesktopItem, DesktopPosition, DesktopSettings } from '@/types';
import {
  canPlaceItem,
  findFirstAvailableSlot,
  getItemGridSpan,
  LAYOUT_LIMITS,
  normalizeDesktopColumnCount,
  normalizeResponsiveColumnCount,
} from './layoutEngine';

export function normalizeOrientationSettings(settings: DesktopSettings): DesktopSettings {
  const { portraitCols, ...rest } = settings;
  const cols = normalizeDesktopColumnCount(portraitCols ?? settings.cols);
  // Older versions stored the active column count in cols.
  const legacyLandscape = portraitCols !== undefined && settings.cols > Math.max(6, cols)
    ? settings.cols
    : undefined;
  return { ...rest, cols, landscapeCols: settings.landscapeCols ?? legacyLandscape };
}

export function getLandscapeColumns(settings: DesktopSettings) {
  return normalizeResponsiveColumnCount(Math.max(settings.cols, settings.landscapeCols ?? 0), true);
}

function samePosition(a: DesktopPosition, b: DesktopPosition): boolean {
  return a.page === b.page && a.row === b.row && a.col === b.col;
}

function place(item: DesktopItem, position: DesktopPosition): DesktopItem {
  return {
    ...item,
    ...position,
    ...(item.children && {
      children: item.children.map((child) => ({ ...child, ...position })),
    }),
  };
}

/** Reserve valid anchors first so a displaced or new item cannot take another item's cell. */
export function fitDesktopPositions(
  items: DesktopItem[],
  cols: number,
  rows: number,
  privacy = false,
): DesktopItem[] | null {
  const pages: DesktopItem[][] = Array.from({ length: LAYOUT_LIMITS.maxPages }, () => []);
  const pageIndex = (page: number) => privacy ? -page - 1 : page;
  const pageNumber = (index: number) => privacy ? -index - 1 : index;
  const unplaced: DesktopItem[] = [];
  for (const item of items) {
    const page = pages[pageIndex(item.page)];
    if (page && canPlaceItem(page, item, item.row, item.col, cols, rows)) {
      page.push(item);
    } else {
      unplaced.push(item);
    }
  }

  for (const item of unplaced) {
    const preferred = pageIndex(item.page);
    const order = pages.map((_, index) => index);
    if (pages[preferred]) {
      order.splice(preferred, 1);
      order.unshift(preferred);
    }
    // Try the preferred and occupied pages before creating one.
    const existing = order.filter((index) => index === preferred || pages[index].length > 0);
    const empty = order.find((index) => !existing.includes(index));
    if (empty !== undefined) existing.push(empty);
    let placed = false;
    for (const index of existing) {
      const slot = findFirstAvailableSlot(pages[index], item, cols, rows);
      if (!slot) continue;
      pages[index].push(place(item, { page: pageNumber(index), ...slot }));
      placed = true;
      break;
    }
    if (!placed) return null;
  }

  return pages.filter((page) => page.length > 0)
    .flatMap((page, index) => page.map((item) => (
      item.page === pageNumber(index) ? item : place(item, { page: pageNumber(index), row: item.row, col: item.col })
    )));
}

export function groupDesktopPositions(data: DesktopData, items: DesktopItem[]): DesktopData {
  const pages: DesktopItem[][] = [[]];
  for (const item of items) (pages[item.page] ??= []).push(item);
  return { ...data, pages };
}

function packPage(
  widgets: DesktopItem[],
  ordered: DesktopItem[],
  cols: number,
  rows: number,
  reserveOriginalSlots = false,
): DesktopItem[] | null {
  const arranged = [...widgets];
  let cursor = 0;
  for (const [index, item] of ordered.entries()) {
    const occupied = reserveOriginalSlots ? arranged.concat(ordered.slice(index + 1)) : arranged;
    const lastCell = reserveOriginalSlots ? item.row * cols + item.col : cols * rows - 1;
    while (cursor <= lastCell
      && !canPlaceItem(occupied, item, Math.floor(cursor / cols), cursor % cols, cols, rows)) {
      cursor++;
    }
    if (cursor > lastCell) return null;
    arranged.push(place(item, { page: item.page, row: Math.floor(cursor / cols), col: cursor % cols }));
    cursor++;
  }
  return arranged;
}

/** 按原先从左到右、从上到下的顺序放置图标，文件夹占满矩形区域。 */
function arrangePage(items: DesktopItem[], cols: number, rows: number): DesktopItem[] {
  const widgets = items.filter((item) => item.type === 'widget');
  const ordered = items.filter((item) => item.type !== 'widget')
    .sort((a, b) => a.row - b.row || a.col - b.col);
  // 紧凑排布可能堵住后续文件夹的落点。重试时保留尚未放置项目的原格位。
  return packPage(widgets, ordered, cols, rows)
    ?? packPage(widgets, ordered, cols, rows, true)
    ?? items;
}

function arrangePages(items: DesktopItem[], cols: number, rows: number): DesktopItem[] {
  const pages = new Map<number, DesktopItem[]>();
  for (const item of items) {
    const page = pages.get(item.page) ?? [];
    page.push(item);
    pages.set(item.page, page);
  }
  return Array.from(pages.values()).flatMap((page) => arrangePage(page, cols, rows));
}

function automaticLandscapeItems(items: DesktopItem[], portraitCols: number, cols: number, rows: number): DesktopItem[] {
  return cols > portraitCols ? arrangePages(items, cols, rows) : items;
}

export function projectLandscapeItems(
  items: DesktopItem[],
  portraitCols: number,
  cols: number,
  rows: number,
  privacy = false,
): DesktopItem[] {
  const automatic = automaticLandscapeItems(items, portraitCols, cols, rows);
  if (!items.some((item) => item.landscapePosition)) return automatic;
  const positioned: DesktopItem[] = [];
  const inherited: DesktopItem[] = [];
  for (const item of automatic) {
    const { landscapePosition, ...shared } = item;
    if (landscapePosition) positioned.push(place(shared, landscapePosition));
    else inherited.push(item);
  }
  return fitDesktopPositions([...positioned, ...inherited], cols, rows, privacy)
    ?? automatic.map(withoutLandscapePosition);
}

export function projectLandscape(data: DesktopData, portraitCols: number, cols: number, rows: number): DesktopData {
  const items = data.pages.flat();
  const projected = projectLandscapeItems(items, portraitCols, cols, rows);
  return projected === items ? data : groupDesktopPositions(data, projected);
}

function withoutLandscapePosition(item: DesktopItem): DesktopItem {
  const { landscapePosition: _position, ...shared } = item;
  return item.children
    ? { ...shared, children: item.children.map(withoutLandscapePosition) }
    : shared;
}

/** Carry positions only for items that remain on the same workspace's grid. */
export function savePortraitItems(previous: DesktopItem[], edited: DesktopItem[]): DesktopItem[] {
  const positions = new Map(previous.map((item) => [item.id, item.landscapePosition]));
  return edited.map((item) => {
    const shared = withoutLandscapePosition(item);
    const landscapePosition = positions.get(item.id);
    return landscapePosition ? { ...shared, landscapePosition } : shared;
  });
}

/** Copy shared content from the edit, preserving established portrait anchors by item ID. */
export function saveLandscapeItems(
  previous: DesktopItem[],
  edited: DesktopItem[],
  portraitCols: number,
  landscapeCols: number,
  rows: number,
  privacy = false,
): DesktopItem[] | null {
  const portraitById = new Map(previous.map((item) => [item.id, item]));
  const editedById = new Map(edited.map((item) => [item.id, item]));
  const fixed: DesktopItem[] = [];
  const changed: DesktopItem[] = [];
  for (const item of edited) {
    const old = portraitById.get(item.id);
    const source = old ?? (item.children && portraitById.get(item.children[0]?.id));
    const anchor = source ?? item;
    const a = old && getItemGridSpan(old, portraitCols);
    const b = getItemGridSpan(item, portraitCols);
    const anchored = place(item, { page: anchor.page, row: anchor.row, col: anchor.col });
    if (a && a.rowSpan === b.rowSpan && a.colSpan === b.colSpan) fixed.push(anchored);
    else changed.push(anchored);
  }
  const portrait = fitDesktopPositions([...fixed, ...changed], portraitCols, rows, privacy);
  if (!portrait) return null;

  const automatic = new Map(automaticLandscapeItems(portrait, portraitCols, landscapeCols, rows)
    .map((item) => [item.id, item]));
  return portrait.map((item) => {
    const shared = withoutLandscapePosition(item);
    const actual = editedById.get(item.id)!;
    const saved = portraitById.get(item.id)?.landscapePosition;
    if (saved && samePosition(saved, actual)) return { ...shared, landscapePosition: saved };
    return samePosition(automatic.get(item.id)!, actual)
      ? shared
      : { ...shared, landscapePosition: { page: actual.page, row: actual.row, col: actual.col } };
  });
}

export function saveLandscape(
  previous: DesktopData,
  edited: DesktopData,
  portraitCols: number,
  landscapeCols: number,
  rows: number,
): DesktopData | null {
  if (previous.pages === edited.pages) return edited;
  const items = saveLandscapeItems(previous.pages.flat(), edited.pages.flat(), portraitCols, landscapeCols, rows);
  return items ? groupDesktopPositions(edited, items) : null;
}

export function normalizePortraitData(data: DesktopData, cols: number, rows: number): DesktopData | null {
  const source = data.pages.flatMap((items, page) => items.map((item) => (
    item.page === page ? item : place(item, { page, row: item.row, col: item.col })
  )));
  const items = fitDesktopPositions(source, cols, rows);
  return items ? groupDesktopPositions(data, items) : null;
}

export function resizeDesktopGrid(data: DesktopData, previous: DesktopSettings, next: DesktopSettings): DesktopData | null {
  const { cols, rows } = next;
  if (cols !== previous.cols || rows !== previous.rows) {
    const normalized = normalizePortraitData(data, cols, rows);
    if (!normalized || cols <= previous.cols) return normalized;
    return groupDesktopPositions(normalized, arrangePages(normalized.pages.flat(), cols, rows));
  }

  const oldLandscapeCols = getLandscapeColumns(previous);
  const landscapeCols = getLandscapeColumns(next);
  if (landscapeCols <= oldLandscapeCols || !data.pages.some((page) => page.some((item) => item.landscapePosition))) {
    return data;
  }
  // 使用当前横屏的顺序处理手动拖动过的图标，再写回横屏坐标。
  const landscape = projectLandscape(data, cols, oldLandscapeCols, rows);
  const resized = groupDesktopPositions(landscape, arrangePages(landscape.pages.flat(), landscapeCols, rows));
  return saveLandscape(data, resized, cols, landscapeCols, rows);
}
