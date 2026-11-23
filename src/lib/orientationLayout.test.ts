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

describe('orientation layout', () => {
  it('keeps sparse positions, page boundaries and widget anchors on rotations without edits', () => {
    const portrait = data(
      [app('a', 0, 2, 3)],
      [app('b', 1, 7, 1), { ...app('clock', 1, 1, 0), type: 'widget', widgetType: 'clock' }],
    );
    expect(projectLandscape(portrait, 6, 8)).toBe(portrait);
    expect(validateDesktopLayout(portrait, { cols: 6, rows: 8 })).toEqual([]);
  });

  it('preserves portrait coordinates when landscape drag and bookmark changes survive reload', () => {
    const portrait = data([app('a', 0, 2, 3), app('b', 0, 5, 1)]);
    const landscape = projectLandscape(portrait, 6, 8);
    const moved = moveDesktopItem(landscape, 'a', 0, 0, 0, 5, 6, 8);
    expect(moved.ok).toBe(true);
    const saved = saveLandscape(portrait, moved.data, 4, 8);
    expect(saved?.pages[0]).toEqual([
      { ...portrait.pages[0][1] },
      { ...portrait.pages[0][0], landscapePosition: { page: 0, row: 0, col: 5 } },
    ]);

    const parsed = parseDesktopData(JSON.parse(JSON.stringify({
      ...saved,
      bookmarks: { groups: [{ id: 'g', name: '常用' }], items: [] },
    })));
    if (!parsed.ok) throw new Error(parsed.message);
    expect(projectLandscape(parsed.data, 6, 8).pages[0].find((item) => item.id === 'a'))
      .toMatchObject({ row: 0, col: 5 });
    expect(parsed.data.pages[0].find((item) => item.id === 'a'))
      .toMatchObject({ row: 2, col: 3 });
    expect(parsed.data.bookmarks?.groups[0].name).toBe('常用');
  });

  it('preserves portrait pages when landscape compacts a page after moving its only item', () => {
    const portrait = data([app('a', 0, 0, 0)], [app('b', 1, 3, 0)]);
    const moved = moveDesktopItem(portrait, 'a', 0, 1, 0, 5, 6, 8);
    expect(moved.ok).toBe(true);
    const saved = saveLandscape(portrait, moved.data, 4, 8);
    expect(saved?.pages.map((page) => page.map((item) => item.id))).toEqual([['a'], ['b']]);
    expect(saved && projectLandscape(saved, 6, 8).pages).toHaveLength(1);
    expect(saved && projectLandscape(saved, 6, 8).pages[0]).toEqual(expect.arrayContaining([
      app('a', 0, 0, 5),
      app('b', 0, 3, 0),
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
    const saved = saveLandscape(portrait, edited, 4, 8);
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
    const landscape = projectLandscape(portrait, 6, 8);
    expect(validateDesktopLayout(landscape, { cols: 6, rows: 8 })).toEqual([]);
    expect(landscape.pages[0].find((candidate) => candidate.id === 'neighbor'))
      .toMatchObject({ row: 0, col: 2 });
    expect(item.landscapePosition?.col).toBe(6);
  });

  it('keeps private coordinates in their own workspace', () => {
    const portrait = [app('private', -1, 2, 3)];
    const landscape = [app('private', -1, 1, 5)];
    const saved = saveLandscapeItems(portrait, landscape, 4, 8, true);
    if (!saved) throw new Error('无法保存隐私页测试布局');
    expect(saved[0]).toMatchObject({ page: -1, row: 2, col: 3 });
    expect(projectLandscapeItems(saved, 6, 8, true)).toEqual(landscape);
    expect(savePortraitItems([], [{ ...saved[0], page: 0 }])).toEqual([app('private', 0, 2, 3)]);
  });

  it('rejects an addition if all portrait pages are full', () => {
    const portrait = data(...Array.from({ length: 20 }, (_, page) => Array.from(
      { length: 4 }, (_, col) => app(`app-${page}-${col}`, page, 0, col),
    )));
    const edited = data(...portrait.pages.map((page, index) => (
      index === 0 ? [...page, app('new', 0, 0, 5)] : page
    )));
    expect(saveLandscape(portrait, edited, 4, 1)).toBeNull();
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
