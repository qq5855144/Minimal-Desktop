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

export function projectLandscapeItems(
  items: DesktopItem[],
  cols: number,
  rows: number,
  privacy = false,
): DesktopItem[] {
  const positioned: DesktopItem[] = [];
  const inherited: DesktopItem[] = [];
  for (const item of items) {
    const { landscapePosition, ...shared } = item;
    if (landscapePosition) positioned.push(place(shared, landscapePosition));
    else inherited.push(item);
  }
  if (positioned.length === 0) return items;
  return fitDesktopPositions([...positioned, ...inherited], cols, rows, privacy)
    ?? items.map(({ landscapePosition: _position, ...item }) => item);
}

export function projectLandscape(data: DesktopData, cols: number, rows: number): DesktopData {
  const items = data.pages.flat();
  const projected = projectLandscapeItems(items, cols, rows);
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
  return portrait?.map((item) => {
    const shared = withoutLandscapePosition(item);
    const actual = editedById.get(item.id)!;
    return samePosition(item, actual)
      ? shared
      : { ...shared, landscapePosition: { page: actual.page, row: actual.row, col: actual.col } };
  }) ?? null;
}

export function saveLandscape(
  previous: DesktopData,
  edited: DesktopData,
  portraitCols: number,
  rows: number,
): DesktopData | null {
  if (previous.pages === edited.pages) return edited;
  const items = saveLandscapeItems(previous.pages.flat(), edited.pages.flat(), portraitCols, rows);
  return items ? groupDesktopPositions(edited, items) : null;
}

export function normalizePortraitData(data: DesktopData, cols: number, rows: number): DesktopData | null {
  const source = data.pages.flatMap((items, page) => items.map((item) => (
    item.page === page ? item : place(item, { page, row: item.row, col: item.col })
  )));
  const items = fitDesktopPositions(source, cols, rows);
  return items ? groupDesktopPositions(data, items) : null;
}
