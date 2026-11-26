import { describe, expect, it } from 'vitest';
import type { DesktopData, DesktopItem, DesktopSettings } from '@/types';
import { parseDesktopData } from './desktopSchema';
import { moveDesktopItem, validateDesktopLayout } from './layoutEngine';
import {
  getLandscapeColumns,
  normalizeOrientationSettings,
  normalizePortraitData,
  projectLandscape,
  projectLandscapeItems,
  resizeDesktopGrid,
  saveLandscape,
  saveLandscapeItems,
  savePortraitItems,
} from './orientationLayout';

function app(id: string, page: number, row: number, col: number): DesktopItem {
  return { id, page, row, col, type: 'app', name: id, color: 'blue' };
}

function data(...pages: DesktopItem[][]): DesktopData {
  return { version: 6, pages };
}

const defaults: DesktopSettings = {
  cols: 4, rows: 8, iconSize: 46, iconRadiusPct: 25, style: 'glassmorphism',
};

describe('increasing the configured grid width', () => {
  it('fills the new portrait column in reading order and keeps widgets and page boundaries', () => {
    const clock: DesktopItem = { ...app('clock', 0, 0, 0), type: 'widget', widgetType: 'clock' };
    const apps = Array.from({ length: 8 }, (_, index) => app(
      `app-${index + 1}`, 0, 2 + Math.floor(index / 4), index % 4,
    ));
    const original = data([clock, ...apps.toReversed()], [app('second-page', 1, 0, 0)]);
    const updated = resizeDesktopGrid(original, defaults, { ...defaults, cols: 5 })!;

    expect(updated.pages).toEqual([
      [clock, ...apps.map((item, index) => ({ ...item, row: 2 + Math.floor(index / 5), col: index % 5 }))],
      original.pages[1],
    ]);
    expect(validateDesktopLayout(updated, { cols: 5, rows: 8 })).toEqual([]);
    expect(original.pages[0].find((item) => item.id === 'app-5')).toMatchObject({ row: 3, col: 0 });
  });

  it('reserves both rows of an enlarged folder when filling the new column', () => {
    const folder = {
      ...app('folder', 0, 1, 0), type: 'folder', folderLayout: '2x2',
      children: [app('child', 0, 1, 0)],
    } satisfies DesktopItem;
    const before = data([
      ...Array.from({ length: 4 }, (_, col) => app(`app-${col}`, 0, 0, col)),
      folder, app('a', 0, 1, 2), app('b', 0, 1, 3), app('c', 0, 2, 2), app('d', 0, 2, 3),
    ]);
    const updated = resizeDesktopGrid(before, defaults, { ...defaults, cols: 6 })!;

    expect(updated.pages[0].slice(4)).toEqual([
      { ...folder, row: 0, col: 4, children: [app('child', 0, 0, 4)] },
      app('a', 0, 1, 0), app('b', 0, 1, 1), app('c', 0, 1, 2), app('d', 0, 1, 3),
    ]);
    expect(validateDesktopLayout(updated, { cols: 6, rows: 8 })).toEqual([]);
  });

  it('reflows the visible landscape order and keeps the saved portrait anchors', () => {
    const apps = Array.from({ length: 8 }, (_, index) => ({
      ...app(`app-${index + 1}`, 0, Math.floor(index / 4), index % 4),
      landscapePosition: { page: 0, row: Math.floor((7 - index) / 4), col: (7 - index) % 4 },
    }));
    const portrait = data(apps);
    const updated = resizeDesktopGrid(portrait, defaults, { ...defaults, landscapeCols: 7 })!;
    const landscape = projectLandscape(updated, 4, 7, 8);

    const readingOrder = landscape.pages[0].toSorted((a, b) => a.row - b.row || a.col - b.col);
    expect(readingOrder.map(({ id, row, col }) => ({ id, row, col }))).toEqual(
      apps.toReversed().map(({ id }, index) => ({ id, row: Math.floor(index / 7), col: index % 7 })),
    );
    for (const item of apps) {
      expect(updated.pages[0].find((candidate) => candidate.id === item.id)).toMatchObject({
        page: item.page, row: item.row, col: item.col,
      });
    }
    expect(validateDesktopLayout(landscape, { cols: 7, rows: 8 })).toEqual([]);
  });
});

describe('orientation layout', () => {
  it('keeps page boundaries and widget anchors without changing portrait coordinates', () => {
    const clock: DesktopItem = { ...app('clock', 1, 0, 0), type: 'widget', widgetType: 'clock' };
    const portrait = data([app('a', 0, 2, 3)], [app('b', 1, 7, 1), clock]);
    const landscape = projectLandscape(portrait, 4, 6, 8);
    expect(landscape.pages[0]).toEqual([app('a', 0, 0, 0)]);
    expect(landscape.pages[1]).toEqual([clock, app('b', 1, 2, 0)]);
    expect(portrait.pages[0][0]).toMatchObject({ row: 2, col: 3 });
    expect(validateDesktopLayout(landscape, { cols: 6, rows: 8 })).toEqual([]);
  });

  it.each([8, 12])('places %i apps in portrait order with the last row starting at the left', (count) => {
    const apps = Array.from({ length: count }, (_, index) => app(
      `app-${index + 1}`, 0, Math.floor(index / 4), index % 4,
    ));
    // Stored array order may differ from the visible portrait order after a drag.
    const portrait = data([...apps].reverse());
    const landscape = projectLandscape(portrait, 4, 6, 8);
    expect(landscape.pages[0]).toEqual(apps.map((item, index) => (
      { ...item, row: Math.floor(index / 6), col: index % 6 }
    )));
    expect(validateDesktopLayout(landscape, { cols: 6, rows: 8 })).toEqual([]);
    expect(projectLandscape(portrait, 4, 4, 8)).toBe(portrait);
  });

  it('packs a 2×2 folder in reading order and skips all the cells it covers on the next row', () => {
    const folder = { ...app('folder', 0, 1, 0), type: 'folder', folderLayout: '2x2' } satisfies DesktopItem;
    const portrait = data([
      ...Array.from({ length: 4 }, (_, col) => app(`app-${col}`, 0, 0, col)),
      folder, app('a', 0, 1, 2), app('b', 0, 1, 3), app('c', 0, 2, 2), app('d', 0, 2, 3),
      app('e', 0, 3, 0),
    ]);
    const landscape = projectLandscape(portrait, 4, 6, 8);
    expect(landscape.pages[0].slice(4)).toEqual([
      { ...folder, row: 0, col: 4 },
      app('a', 0, 1, 0), app('b', 0, 1, 1), app('c', 0, 1, 2), app('d', 0, 1, 3),
      app('e', 0, 2, 0),
    ]);
    expect(validateDesktopLayout(landscape, { cols: 6, rows: 8 })).toEqual([]);
    expect(folder).toMatchObject({ row: 1, col: 0 });
  });

  it('moves a wide folder to the next row when only one column remains, keeping later icons after it', () => {
    const folder = { ...app('folder', 0, 1, 1), type: 'folder', folderLayout: '2x2' } satisfies DesktopItem;
    const portrait = data([
      ...Array.from({ length: 5 }, (_, index) => app(`app-${index}`, 0, Math.floor(index / 4), index % 4)),
      folder, app('a', 0, 1, 3), app('b', 0, 2, 0), app('c', 0, 2, 3),
    ]);
    const landscape = projectLandscape(portrait, 4, 6, 8);
    expect(landscape.pages[0].slice(5)).toEqual([
      { ...folder, col: 0 }, app('a', 0, 1, 2), app('b', 0, 1, 3), app('c', 0, 1, 4),
    ]);
    expect(validateDesktopLayout(landscape, { cols: 6, rows: 8 })).toEqual([]);
  });

  it('keeps order and all items when wide widgets and folder spans prevent the densest layout', () => {
    const column = (id: string, row: number, col: number): DesktopItem => (
      { ...app(id, 0, row, col), type: 'folder', folderLayout: '2x1' }
    );
    const wide = (id: string, row: number, col: number): DesktopItem => (
      { ...app(id, 0, row, col), type: 'folder', folderLayout: '1x2' }
    );
    const weather: DesktopItem = {
      ...app('weather', 0, 2, 1), type: 'widget', widgetType: 'weather', weatherSize: 'large',
    };
    const items = [
      app('a', 0, 0, 0), app('b', 0, 0, 1), column('c', 0, 3), wide('d', 0, 4), column('e', 0, 6),
      app('f', 0, 1, 1), app('g', 0, 1, 2), app('h', 0, 1, 4), column('i', 2, 0), wide('j', 2, 5),
      app('k', 0, 3, 5), app('l', 0, 3, 6),
    ];
    const landscape = projectLandscape(data([...items, weather]), 7, 8, 4);
    const ordered = landscape.pages[0].filter((item) => item.type !== 'widget')
      .sort((a, b) => a.row - b.row || a.col - b.col);
    expect(ordered.map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect(landscape.pages[0].find((item) => item.id === weather.id)).toEqual(weather);
    expect(ordered.at(-1)).toMatchObject({ row: 3, col: 5 });
    expect(validateDesktopLayout(landscape, { cols: 8, rows: 4 })).toEqual([]);
  });

  it('respects a saved manual position and does not pin automatically placed icons after a rename', () => {
    const portrait = data([
      app('a', 0, 3, 0), app('b', 0, 3, 1), app('c', 0, 3, 2), app('d', 0, 3, 3),
      { ...app('manual', 0, 6, 1), landscapePosition: { page: 0, row: 6, col: 5 } },
    ]);
    const landscape = projectLandscape(portrait, 4, 6, 8);
    const edited = data(landscape.pages[0].map((item) => (
      item.id === 'a' ? { ...item, name: 'Renamed' } : item
    )));
    const saved = saveLandscape(portrait, edited, 4, 6, 8);
    expect(saved?.pages[0].filter((item) => item.landscapePosition).map((item) => item.id)).toEqual(['manual']);
    expect(saved?.pages[0].find((item) => item.id === 'a')).toEqual({ ...portrait.pages[0][0], name: 'Renamed' });
  });

  it('preserves portrait coordinates when landscape drag and bookmark changes survive reload', () => {
    const portrait = data([app('a', 0, 2, 3), app('b', 0, 5, 1)]);
    const landscape = projectLandscape(portrait, 4, 6, 8);
    const moved = moveDesktopItem(landscape, 'a', 0, 0, 0, 5, 6, 8);
    expect(moved.ok).toBe(true);
    const saved = saveLandscape(portrait, moved.data, 4, 6, 8);
    expect(saved?.pages[0]).toEqual([
      { ...portrait.pages[0][1] },
      { ...portrait.pages[0][0], landscapePosition: { page: 0, row: 0, col: 5 } },
    ]);

    const parsed = parseDesktopData(JSON.parse(JSON.stringify({
      ...saved,
      bookmarks: { groups: [{ id: 'g', name: '常用' }], items: [] },
    })));
    if (!parsed.ok) throw new Error(parsed.message);
    expect(projectLandscape(parsed.data, 4, 6, 8).pages[0].find((item) => item.id === 'a'))
      .toMatchObject({ row: 0, col: 5 });
    expect(parsed.data.pages[0].find((item) => item.id === 'a'))
      .toMatchObject({ row: 2, col: 3 });
    expect(parsed.data.bookmarks?.groups[0].name).toBe('常用');
  });

  it('preserves portrait pages when landscape compacts a page after moving its only item', () => {
    const portrait = data([app('a', 0, 0, 0)], [app('b', 1, 3, 0)]);
    const landscape = projectLandscape(portrait, 4, 6, 8);
    const moved = moveDesktopItem(landscape, 'a', 0, 1, 0, 5, 6, 8);
    expect(moved.ok).toBe(true);
    const saved = saveLandscape(portrait, moved.data, 4, 6, 8);
    expect(saved?.pages.map((page) => page.map((item) => item.id))).toEqual([['a'], ['b']]);
    expect(saved && projectLandscape(saved, 4, 6, 8).pages).toHaveLength(1);
    expect(saved && projectLandscape(saved, 4, 6, 8).pages[0]).toEqual(expect.arrayContaining([
      app('a', 0, 0, 5),
      app('b', 0, 0, 0),
    ]));
  });

  it('places new shared content around established portrait anchors', () => {
    const folder = {
      ...app('folder', 0, 0, 0), type: 'folder', folderLayout: '2x2',
      children: [app('child', 0, 0, 0)],
    } satisfies DesktopItem;
    const neighbor = app('neighbor', 0, 0, 3);
    const portrait = data([folder, neighbor]);
    const edited = data([folder, neighbor, app('new', 0, 0, 5)]);
    const saved = saveLandscape(portrait, edited, 4, 6, 8);
    expect(saved?.pages[0]).toEqual([
      folder,
      neighbor,
      { ...app('new', 0, 0, 2), landscapePosition: { page: 0, row: 0, col: 5 } },
    ]);
  });

  it('repositions an override when a narrower landscape grid cannot fit its full span', () => {
    const item: DesktopItem = {
      ...app('folder', 0, 0, 0), type: 'folder', folderLayout: '2x2',
      landscapePosition: { page: 0, row: 0, col: 6 },
    };
    const portrait = data([item, app('neighbor', 0, 0, 2)]);
    const landscape = projectLandscape(portrait, 4, 6, 8);
    expect(validateDesktopLayout(landscape, { cols: 6, rows: 8 })).toEqual([]);
    expect(landscape.pages[0].find((candidate) => candidate.id === 'neighbor'))
      .toMatchObject({ row: 0, col: 2 });
    expect(item.landscapePosition?.col).toBe(6);
  });

  it('keeps private coordinates in their own workspace', () => {
    const portrait = [app('private', -1, 2, 3)];
    const landscape = [app('private', -1, 1, 5)];
    const saved = saveLandscapeItems(portrait, landscape, 4, 6, 8, true);
    if (!saved) throw new Error('无法保存隐私页测试布局');
    expect(saved[0]).toMatchObject({ page: -1, row: 2, col: 3 });
    expect(projectLandscapeItems(saved, 4, 6, 8, true)).toEqual(landscape);
    expect(savePortraitItems([], [{ ...saved[0], page: 0 }])).toEqual([app('private', 0, 2, 3)]);
  });

  it('rejects an addition if all portrait pages are full', () => {
    const portrait = data(...Array.from({ length: 20 }, (_, page) => Array.from(
      { length: 4 }, (_, col) => app(`app-${page}-${col}`, page, 0, col),
    )));
    const edited = data(...portrait.pages.map((page, index) => (
      index === 0 ? [...page, app('new', 0, 0, 5)] : page
    )));
    expect(saveLandscape(portrait, edited, 4, 6, 1)).toBeNull();
  });

  it('uses the saved portrait column count when migrating an old landscape session', () => {
    const settings = normalizeOrientationSettings({ ...defaults, cols: 8, portraitCols: 4 });
    expect(settings.cols).toBe(4);
    expect(getLandscapeColumns(settings)).toBe(8);
    expect(getLandscapeColumns(defaults)).toBe(6);
    const legacy = data([app('outside', 0, 2, 6), app('anchor', 0, 2, 3)]);
    const normalized = normalizePortraitData(legacy, settings.cols, 8);
    expect(normalized?.pages[0].find((item) => item.id === 'anchor')).toMatchObject({ row: 2, col: 3 });
    expect(normalized?.pages[0]).toHaveLength(2);
  });
});
