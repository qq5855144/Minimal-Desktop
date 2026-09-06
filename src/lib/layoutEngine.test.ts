import { describe, expect, it } from 'vitest';
import type { DesktopData, DesktopItem } from '@/types';
import {
  canPlaceItem,
  compactDesktopPages,
  compactPrivacyPages,
  getPrivacyPageCount,
  getPrivacyPageNumbers,
  isFolderChildCandidate,
  moveDesktopItem,
  movePrivacyItem,
  normalizeDesktopColumnCount,
  normalizeResponsiveColumnCount,
  resolveResponsiveColumnState,
  reflowDesktopData,
  reflowPrivacyItems,
  reorderFolderChildren,
  resolvePageAfterCompaction,
  setDesktopWidgetEnabled,
  transferDesktopToPrivacy,
  transferPrivacyToDesktop,
  updateDesktopFolderLayout,
  updatePrivacyFolderLayout,
  validateDesktopLayout,
} from './layoutEngine';

const app = (id: string, page: number, row: number, col: number): DesktopItem => ({
  id, type: 'app', name: id, color: 'blue', page, row, col, url: `https://${id}.example.com`,
});

const clock = (page = 0, row = 0): DesktopItem => ({
  id: 'widget-clock', type: 'widget', widgetType: 'clock', name: '时钟', color: 'blue', page, row, col: 0,
});

const system = (id: string, page: number, row: number, col: number): DesktopItem => ({
  id, type: 'system', name: id, color: 'gray', page, row, col,
});

const folder = (
  id: string,
  page: number,
  row: number,
  col: number,
  folderLayout: DesktopItem['folderLayout'] = '1x1',
  children: DesktopItem[] = [app(`${id}-a`, page, row, col), app(`${id}-b`, page, row, col)],
): DesktopItem => ({
  id, type: 'folder', name: id, color: 'gray', page, row, col, folderLayout, children,
});

const data = (pages: DesktopItem[][]): DesktopData => ({ pages, version: 3 });

describe('layoutEngine', () => {
  it('将列数限制扩展到 10，并安全归一化旧值或越界值', () => {
    expect(normalizeDesktopColumnCount(4)).toBe(4);
    expect(normalizeDesktopColumnCount(8)).toBe(8);
    expect(normalizeDesktopColumnCount(10)).toBe(10);
    expect(normalizeDesktopColumnCount(3)).toBe(4);
    expect(normalizeDesktopColumnCount(12)).toBe(10);
  });

  it('电脑端以 6 列为下限，窄屏仍保留 4/5 列', () => {
    expect(normalizeResponsiveColumnCount(4, true)).toBe(6);
    expect(normalizeResponsiveColumnCount(5, true)).toBe(6);
    expect(normalizeResponsiveColumnCount(8, true)).toBe(8);
    expect(normalizeResponsiveColumnCount(4, false)).toBe(4);
    expect(normalizeResponsiveColumnCount(5, false)).toBe(5);
  });

  it('横屏自动扩为 6 列后，返回竖屏会恢复用户的 4 列设置', () => {
    const landscape = resolveResponsiveColumnState(4, undefined, true);
    expect(landscape).toEqual({
      gridCols: 6,
      patch: { cols: 6, portraitCols: 4 },
    });

    const portrait = resolveResponsiveColumnState(
      landscape.patch?.cols,
      landscape.patch?.portraitCols,
      false,
    );
    expect(portrait).toEqual({
      gridCols: 4,
      patch: { cols: 4 },
    });
  });

  it('切换方向时保留 5 列竖屏偏好与用户选择的横屏列数', () => {
    expect(resolveResponsiveColumnState(5, 5, true)).toEqual({
      gridCols: 6,
      patch: { cols: 6 },
    });
    expect(resolveResponsiveColumnState(8, 5, true)).toEqual({
      gridCols: 8,
      patch: null,
    });
    expect(resolveResponsiveColumnState(8, 5, false)).toEqual({
      gridCols: 5,
      patch: { cols: 5 },
    });
  });

  it('10 列布局可完整放置一整行应用及位于末两列的 2×2 文件夹', () => {
    const apps = Array.from({ length: 10 }, (_, index) => app(`app-${index}`, 0, 0, 0));
    const reflowed = reflowDesktopData(data([apps]), 10, 4);

    expect(reflowed.pages[0].map((item) => item.col)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(validateDesktopLayout(reflowed, { cols: 10, rows: 4 })).toEqual([]);

    const edgeFolder = data([[folder('wide-folder', 0, 0, 8, '2x2')]]);
    expect(validateDesktopLayout(edgeFolder, { cols: 10, rows: 4 })).toEqual([]);
    expect(validateDesktopLayout(
      data([[folder('overflow-folder', 0, 0, 9, '2x2')]]),
      { cols: 10, rows: 4 },
    )).not.toEqual([]);
  });

  it('widget rowSpan 覆盖区不允许放普通应用', () => {
    expect(canPlaceItem([clock()], app('a', 0, 1, 2), 1, 2, 4, 8)).toBe(false);
    expect(canPlaceItem([clock()], app('a', 0, 2, 2), 2, 2, 4, 8)).toBe(true);
  });

  it('widget 不能被移动到可见网格之外', () => {
    const original = data([[clock(0, 0)]]);
    const result = moveDesktopItem(original, 'widget-clock', 0, 0, 7, 0, 4, 8);
    expect(result.ok).toBe(false);
    expect(result.data).toBe(original);
  });

  it('隐藏和重新启用组件时保持普通应用的行列坐标不变', () => {
    const original = data([[
      clock(0, 0),
      { ...clock(0, 2), id: 'widget-search', widgetType: 'search', name: '搜索栏' },
      app('a', 0, 3, 0),
      app('b', 0, 4, 2),
    ]]);
    const appPositions = original.pages[0]
      .filter((item) => item.type === 'app')
      .map(({ id, page, row, col }) => ({ id, page, row, col }));

    const hidden = setDesktopWidgetEnabled(original, 'clock', false, 4, 8);
    expect(hidden.ok).toBe(true);
    expect(hidden.data.pages[0].some((item) => item.id === 'widget-clock')).toBe(false);
    expect(hidden.data.pages[0]
      .filter((item) => item.type === 'app')
      .map(({ id, page, row, col }) => ({ id, page, row, col }))).toEqual(appPositions);

    const restored = setDesktopWidgetEnabled(hidden.data, 'clock', true, 4, 8);
    expect(restored.ok).toBe(true);
    expect(restored.data.pages[0].find((item) => item.id === 'widget-clock')).toMatchObject({
      page: 0, row: 0, col: 0,
    });
    expect(restored.data.pages[0]
      .filter((item) => item.type === 'app')
      .map(({ id, page, row, col }) => ({ id, page, row, col }))).toEqual(appPositions);
  });

  it('组件无完整空行时创建新页且不挪动现有应用', () => {
    const apps = Array.from({ length: 8 }, (_, row) => app(`app-${row}`, 0, row, row % 4));
    const original = data([apps]);
    const added = setDesktopWidgetEnabled(original, 'clock', true, 4, 8);

    expect(added.ok).toBe(true);
    expect(added.widgetPage).toBe(1);
    expect(added.data.pages[0]).toEqual(original.pages[0]);
    expect(added.data.pages[1][0]).toMatchObject({
      id: 'widget-clock', page: 1, row: 0, col: 0,
    });
  });

  it('2×2 文件夹真实占用四格并受行列边界约束', () => {
    const largeFolder = folder('large', 0, 0, 0, '2x2');
    expect(canPlaceItem([largeFolder], app('right', 0, 0, 1), 0, 1, 4, 8)).toBe(false);
    expect(canPlaceItem([largeFolder], app('below', 0, 1, 0), 1, 0, 4, 8)).toBe(false);
    expect(canPlaceItem([largeFolder], app('diagonal', 0, 1, 1), 1, 1, 4, 8)).toBe(false);
    expect(canPlaceItem([largeFolder], app('free', 0, 0, 2), 0, 2, 4, 8)).toBe(true);
    expect(canPlaceItem([], largeFolder, 7, 0, 4, 8)).toBe(false);
    expect(canPlaceItem([], largeFolder, 0, 3, 4, 8)).toBe(false);
  });

  it('1×2 与 2×1 文件夹按方向占用两个网格并受边界约束', () => {
    const horizontal = folder('horizontal', 0, 0, 0, '1x2');
    expect(canPlaceItem([horizontal], app('right', 0, 0, 1), 0, 1, 4, 8)).toBe(false);
    expect(canPlaceItem([horizontal], app('below', 0, 1, 0), 1, 0, 4, 8)).toBe(true);
    expect(canPlaceItem([], horizontal, 0, 3, 4, 8)).toBe(false);

    const vertical = folder('vertical', 0, 0, 0, '2x1');
    expect(canPlaceItem([vertical], app('below', 0, 1, 0), 1, 0, 4, 8)).toBe(false);
    expect(canPlaceItem([vertical], app('right', 0, 0, 1), 0, 1, 4, 8)).toBe(true);
    expect(canPlaceItem([], vertical, 7, 0, 4, 8)).toBe(false);
  });

  it.each(['1x2', '2x1'] as const)('普通与隐私文件夹均能切换为 %s', (layout) => {
    const desktop = updateDesktopFolderLayout(
      data([[folder('folder', 0, 0, 0)]]),
      'folder',
      layout,
      4,
      4,
    );
    expect(desktop.ok).toBe(true);
    expect(desktop.data.pages[0][0]).toMatchObject({ folderLayout: layout, row: 0, col: 0 });
    expect(validateDesktopLayout(desktop.data, { cols: 4, rows: 4 })).toEqual([]);

    const privacy = updatePrivacyFolderLayout(
      [folder('private-folder', -1, 0, 0)],
      'private-folder',
      layout,
      4,
      4,
    );
    expect(privacy.ok).toBe(true);
    expect(privacy.privacyItems[0]).toMatchObject({ folderLayout: layout, page: -1, row: 0, col: 0 });
  });

  it('文件夹放大时优先原地，否则只把文件夹迁移到可容纳的 2×2 空间', () => {
    const original = data([[
      folder('folder', 0, 0, 0),
      app('blocker', 0, 0, 1),
    ]]);
    const resized = updateDesktopFolderLayout(original, 'folder', '2x2', 4, 4);
    expect(resized.ok).toBe(true);
    expect(resized.data.pages[0].find((item) => item.id === 'folder')).toMatchObject({
      folderLayout: '2x2', row: 0, col: 2,
    });
    expect(validateDesktopLayout(resized.data, { cols: 4, rows: 4 })).toEqual([]);
    expect(original.pages[0].find((item) => item.id === 'folder')?.folderLayout).toBe('1x1');
  });

  it('隐私文件夹也能切换 2×2 并保持负页紧凑规则', () => {
    const privacy = [
      folder('private-folder', -1, 0, 0),
      app('blocker', -1, 0, 1),
    ];
    const resized = updatePrivacyFolderLayout(privacy, 'private-folder', '2x2', 4, 4);
    expect(resized.ok).toBe(true);
    expect(resized.privacyItems.find((item) => item.id === 'private-folder')).toMatchObject({
      folderLayout: '2x2', page: -1, row: 0, col: 2,
    });
    expect(getPrivacyPageCount(resized.privacyItems)).toBe(1);
  });

  it('系统入口可以成为普通文件夹子项，但包含系统入口的文件夹不能移入隐私桌面', () => {
    const settings = system('sys-settings', 0, 0, 0);
    expect(isFolderChildCandidate(settings)).toBe(true);
    const systemFolder = folder('tools', 0, 2, 0, '1x1', [
      settings,
      app('regular', 0, 2, 0),
    ]);
    const result = transferDesktopToPrivacy(data([[systemFolder]]), [], 'tools', -1, 0, 0, 4, 8);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('protected-item');
  });

  it('2×2 文件夹部分重叠移动时将多个图标交换到腾出的格子', () => {
    const original = data([[
      folder('large', 0, 0, 0, '2x2'),
      app('a', 0, 2, 0),
      app('b', 0, 2, 1),
    ]]);
    const snapshot = JSON.stringify(original);
    const result = moveDesktopItem(original, 'large', 0, 0, 1, 0, 4, 8);
    expect(result.ok).toBe(true);
    expect(result.data.pages[0].find((item) => item.id === 'a')).toMatchObject({ row: 0, col: 0 });
    expect(result.data.pages[0].find((item) => item.id === 'b')).toMatchObject({ row: 0, col: 1 });
    expect(validateDesktopLayout(result.data, { cols: 4, rows: 8 })).toEqual([]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('普通桌面项目命中普通项目时原子交换', () => {
    const original = data([[app('a', 0, 2, 0), app('b', 0, 2, 1)]]);
    const result = moveDesktopItem(original, 'a', 0, 0, 2, 1, 4, 8);
    expect(result.ok).toBe(true);
    expect(result.data.pages[0].find((item) => item.id === 'a')).toMatchObject({ row: 2, col: 1 });
    expect(result.data.pages[0].find((item) => item.id === 'b')).toMatchObject({ row: 2, col: 0 });
  });

  it('跨页相同坐标上的项目仍可原子交换', () => {
    const original = data([
      [app('a', 0, 2, 0)],
      [app('b', 1, 2, 0)],
    ]);
    const moved = moveDesktopItem(original, 'a', 0, 1, 2, 0, 4, 8);
    expect(moved.ok).toBe(true);
    expect(moved.data.pages[0][0]).toMatchObject({ id: 'b', page: 0, row: 2, col: 0 });
    expect(moved.data.pages[1][0]).toMatchObject({ id: 'a', page: 1, row: 2, col: 0 });

    const privacyMoved = movePrivacyItem(
      [app('near', -1, 2, 0), app('far', -2, 2, 0)],
      'near',
      -2,
      2,
      0,
      4,
      8,
    );
    expect(privacyMoved.ok).toBe(true);
    expect(privacyMoved.privacyItems.find((item) => item.id === 'near')).toMatchObject({ page: -2 });
    expect(privacyMoved.privacyItems.find((item) => item.id === 'far')).toMatchObject({ page: -1 });
  });

  it('隐私项目移出时绝不删除目标项目', () => {
    const original = data([[app('public', 0, 2, 0)]]);
    const privacy = [app('private', -1, 0, 0)];
    const result = transferPrivacyToDesktop(original, privacy, 'private', 0, 2, 0, 4, 8);
    expect(result.ok).toBe(false);
    expect(result.data.pages[0].map((item) => item.id)).toEqual(['public']);
    expect(result.privacyItems.map((item) => item.id)).toEqual(['private']);
  });

  it('隐私项目不能覆盖 widget', () => {
    const original = data([[clock()]]);
    const privacy = [app('private', -1, 0, 0)];
    const result = transferPrivacyToDesktop(original, privacy, 'private', 0, 1, 2, 4, 8);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('widget-overlap');
  });

  it('系统项与组件不能被误拖入隐私桌面，但文件夹可以安全迁移', () => {
    const system: DesktopItem = { id: 'sys', type: 'system', name: '设置', color: 'gray', page: 0, row: 2, col: 0 };
    const folder: DesktopItem = {
      id: 'folder', type: 'folder', name: '文件夹', color: 'gray', page: 0, row: 2, col: 1,
      children: [app('child', 0, 2, 1)],
    };
    expect(transferDesktopToPrivacy(data([[system]]), [], 'sys', -1, 0, 0, 4, 8).reason).toBe('protected-item');
    expect(transferDesktopToPrivacy(data([[clock()]]), [], 'widget-clock', -1, 0, 0, 4, 8).reason).toBe('protected-item');
    const moved = transferDesktopToPrivacy(data([[folder]]), [], 'folder', -1, 0, 0, 4, 8);
    expect(moved.ok).toBe(true);
    expect(moved.privacyItems[0]).toMatchObject({ id: 'folder', page: -1 });
    expect(moved.privacyItems[0].children?.[0]).toMatchObject({ id: 'child', page: -1 });

    const restored = transferPrivacyToDesktop(data([[]]), moved.privacyItems, 'folder', 0, 1, 1, 4, 8);
    expect(restored.ok).toBe(true);
    expect(restored.data.pages[0][0]).toMatchObject({ id: 'folder', page: 0, row: 1, col: 1 });
    expect(restored.data.pages[0][0].children?.[0]).toMatchObject({ id: 'child', page: 0 });
  });

  it('隐私负页会清理空洞并保持 -1 靠近普通桌面', () => {
    const compacted = compactPrivacyPages([
      app('near', -1, 0, 0),
      app('far', -3, 0, 0),
    ]);
    expect(compacted.items.map((item) => [item.id, item.page])).toEqual([
      ['near', -1],
      ['far', -2],
    ]);
    expect(getPrivacyPageCount(compacted.items)).toBe(2);
    expect(getPrivacyPageNumbers(2)).toEqual([-2, -1]);
  });

  it('隐私项目可拖到临时负页，并在来源页变空时自动回收空页', () => {
    const privacy = [
      app('moving', -1, 0, 0),
      app('kept', -1, 0, 1),
    ];
    const moved = movePrivacyItem(privacy, 'moving', -2, 2, 1, 4, 8);
    expect(moved.ok).toBe(true);
    expect(moved.privacyItems.find((item) => item.id === 'moving')).toMatchObject({ page: -2, row: 2, col: 1 });
    expect(getPrivacyPageCount(moved.privacyItems)).toBe(2);

    const collapsed = movePrivacyItem(
      [app('only', -1, 0, 0)],
      'only',
      -2,
      1,
      1,
      4,
      8,
    );
    expect(collapsed.privacyItems[0]).toMatchObject({ id: 'only', page: -1 });
    expect(getPrivacyPageCount(collapsed.privacyItems)).toBe(1);
  });

  it('隐私桌面调整网格后维持边界与唯一占位', () => {
    const privacy = Array.from({ length: 11 }, (_, index) => (
      app(`private-${index}`, -1, Math.floor(index / 4), index % 4)
    ));
    const reflowed = reflowPrivacyItems(privacy, 4, 2);
    expect(reflowed).toHaveLength(privacy.length);
    expect(getPrivacyPageCount(reflowed)).toBe(2);
    for (const page of getPrivacyPageNumbers(2)) {
      const positions = reflowed
        .filter((item) => item.page === page)
        .map((item) => `${item.row}:${item.col}`);
      expect(new Set(positions).size).toBe(positions.length);
      expect(positions.length).toBeLessThanOrEqual(8);
    }
  });

  it('改变行列数时不会产生越界或重叠布局', () => {
    const original = data([[
      clock(),
      app('a', 0, 2, 0), app('b', 0, 2, 1), app('c', 0, 2, 2), app('d', 0, 2, 3),
      app('e', 0, 3, 0), app('f', 0, 3, 1),
    ]]);
    const reflowed = reflowDesktopData(original, 4, 2);
    expect(validateDesktopLayout(reflowed, { cols: 4, rows: 2 })).toEqual([]);
    expect(reflowed.pages.flat().map((item) => item.id).sort()).toEqual(original.pages.flat().map((item) => item.id).sort());
  });

  it('连续随机移动后始终维持布局 invariant', () => {
    let current = data([[
      clock(),
      ...Array.from({ length: 12 }, (_, index) => app(`app-${index}`, 0, 2 + Math.floor(index / 4), index % 4)),
    ], []]);
    let seed = 0x5eed1234;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let i = 0; i < 500; i++) {
      const candidates = current.pages.flat().filter((item) => item.type === 'app');
      const item = candidates[Math.floor(random() * candidates.length)];
      const toPage = Math.floor(random() * current.pages.length);
      const row = Math.floor(random() * 8);
      const col = Math.floor(random() * 4);
      const result = moveDesktopItem(current, item.id, item.page, toPage, row, col, 4, 8);
      if (result.ok) current = result.data;
      expect(validateDesktopLayout(current, { cols: 4, rows: 8 })).toEqual([]);
    }
  });

  it('文件夹项目可拖到空槽并稳定追加到末尾', () => {
    const children = [app('a', 0, 0, 0), app('b', 0, 0, 0), app('c', 0, 0, 0)];
    const reordered = reorderFolderChildren(children, 0, 8);
    expect(reordered?.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(children.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('文件夹排序拒绝越界和无变化操作', () => {
    const children = [app('a', 0, 0, 0), app('b', 0, 0, 0)];
    expect(reorderFolderChildren(children, -1, 0)).toBeNull();
    expect(reorderFolderChildren(children, 0, 9)).toBeNull();
    expect(reorderFolderChildren(children, 1, 1)).toBeNull();
    expect(reorderFolderChildren(children, 1, 8)).toBeNull();
  });

  it('自动删除所有空桌面页并重写项目与文件夹子项页号', () => {
    const folder: DesktopItem = {
      id: 'folder', type: 'folder', name: 'folder', color: 'gray', page: 2, row: 1, col: 0,
      children: [app('child', 2, 1, 0)],
    };
    const compacted = compactDesktopPages(data([
      [app('a', 0, 0, 0)],
      [],
      [folder],
      [],
    ]));

    expect(compacted.pageMap).toEqual([0, -1, 1, -1]);
    expect(compacted.data.pages).toHaveLength(2);
    expect(compacted.data.pages[1][0]).toMatchObject({ id: 'folder', page: 1 });
    expect(compacted.data.pages[1][0].children?.[0]).toMatchObject({ id: 'child', page: 1 });
  });

  it('空页删除后把当前页稳定映射到相邻有效页', () => {
    const { data: compacted, pageMap } = compactDesktopPages(data([
      [app('a', 0, 0, 0)],
      [],
      [app('b', 2, 0, 0)],
      [],
    ]));
    expect(resolvePageAfterCompaction(1, pageMap, compacted.pages.length)).toBe(1);
    expect(resolvePageAfterCompaction(3, pageMap, compacted.pages.length)).toBe(1);
    expect(resolvePageAfterCompaction(-1, pageMap, compacted.pages.length)).toBe(-1);
  });

  it('所有普通页为空时仍保留一个可用桌面页', () => {
    const compacted = compactDesktopPages(data([[], [], []]));
    expect(compacted.data.pages).toEqual([[]]);
    expect(resolvePageAfterCompaction(2, compacted.pageMap, 1)).toBe(0);
  });

  it('拖到临时尾页后原子落位，并在来源页变空时保持目标页可见', () => {
    const withTrailingPage = data([
      [app('moved', 0, 0, 0)],
      [app('kept', 1, 0, 0)],
      [],
    ]);
    const moved = moveDesktopItem(withTrailingPage, 'moved', 0, 2, 2, 1, 4, 8);
    expect(moved.ok).toBe(true);

    const compacted = compactDesktopPages(moved.data);
    expect(compacted.data.pages.map((page) => page.map((item) => item.id))).toEqual([
      ['kept'],
      ['moved'],
    ]);
    expect(resolvePageAfterCompaction(2, compacted.pageMap, 2)).toBe(1);
  });
});

describe('position-based folder exchanges', () => {
  const layouts = ['1x1', '1x2', '2x1', '2x2'] as const;
  const fill = (items: DesktopItem[], cols: number, rows: number, page = 0) => {
    const result = [...items];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const candidate = app(`app-${page}-${row}-${col}`, page, row, col);
        if (canPlaceItem(result, candidate, row, col, cols, rows)) result.push(candidate);
      }
    }
    return result;
  };
  const verify = (before: DesktopData, after: DesktopData, cols: number, rows: number) => {
    expect(validateDesktopLayout(after, { cols, rows })).toEqual([]);
    const content = (value: DesktopData) => value.pages.flat()
      .map(({ page: _page, row: _row, col: _col, children, ...item }) => ({
        ...item,
        children: children?.map(({ page: _p, row: _r, col: _c, ...child }) => child),
      })).sort((a, b) => a.id.localeCompare(b.id));
    expect(content(after)).toEqual(content(before));
    for (const item of after.pages.flat()) {
      for (const child of item.children ?? []) {
        expect(child).toMatchObject({ page: item.page, row: item.row, col: item.col });
      }
    }
  };

  for (let cols = 4; cols <= 10; cols++) {
    for (const layout of layouts) {
      it(`${cols} columns: ${layout} swaps with apps on a full grid in both directions`, () => {
        const original = data([fill([folder('f', 0, 0, 0, layout)], cols, 4)]);
        const row = layout.startsWith('2') ? 2 : 3;
        const col = layout.endsWith('2') ? cols - 2 : cols - 1;
        const snapshot = JSON.stringify(original);
        const forward = moveDesktopItem(original, 'f', 0, 0, row, col, cols, 4);
        expect(forward.ok).toBe(true);
        expect(forward.data.pages[0].find((item) => item.id === 'f')).toMatchObject({ row, col, folderLayout: layout });
        verify(original, forward.data, cols, 4);
        // Every occupied subcell must be a valid, distinct app drop target.
        for (let r = 0; r <= (layout.startsWith('2') ? 1 : 0); r++) {
          for (let c = 0; c <= (layout.endsWith('2') ? 1 : 0); c++) {
            const id = `app-0-3-${cols - 1}`;
            const reverse = moveDesktopItem(original, id, 0, 0, r, c, cols, 4);
            expect(reverse.ok).toBe(true);
            expect(reverse.data.pages[0].find((item) => item.id === id)).toMatchObject({ row: r, col: c });
            verify(original, reverse.data, cols, 4);
          }
        }
        expect(JSON.stringify(original)).toBe(snapshot);
      });
    }
  }

  it('exchanges a large folder across full pages and preserves child coordinates', () => {
    const original = data([
      fill([folder('f', 0, 0, 0, '2x2')], 4, 4), fill([], 4, 4, 1),
    ]);
    const result = moveDesktopItem(original, 'f', 0, 1, 2, 2, 4, 4);
    expect(result.ok).toBe(true);
    verify(original, result.data, 4, 4);
    expect(result.data.pages[1].find((item) => item.id === 'f')).toMatchObject({ row: 2, col: 2 });
  });

  for (const from of layouts) {
    for (const to of layouts) {
      it(`exchanges ${from} and ${to} folders on a full grid`, () => {
        const original = data([fill([
          folder('a', 0, 0, 0, from), folder('b', 0, 2, 2, to),
        ], 4, 4)]);
        const result = moveDesktopItem(original, 'a', 0, 0, 2, 2, 4, 4);
        expect(result.ok).toBe(true);
        verify(original, result.data, 4, 4);
      });
    }
  }

  it('uses the same exchange rules across privacy pages', () => {
    const items = [folder('f', -1, 0, 0, '2x2'), ...fill([], 4, 4, -2)];
    const snapshot = JSON.stringify(items);
    const result = movePrivacyItem(items, 'f', -2, 2, 2, 4, 4);
    expect(result.ok).toBe(true);
    expect(result.privacyItems.find((item) => item.id === 'f')).toMatchObject({ page: -2, row: 2, col: 2 });
    expect(result.privacyItems.filter((item) => item.page === -1)).toHaveLength(4);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it('rejects a blocked return footprint atomically without moving widgets', () => {
    const original = data([[clock(), app('a', 0, 2, 0), folder('f', 0, 4, 0, '2x2')]]);
    // Dropping onto the bottom cell would return the folder into the clock.
    const result = moveDesktopItem(original, 'a', 0, 0, 5, 0, 4, 6);
    expect(result.ok).toBe(false);
    expect(result.data).toBe(original);
    const blocked = moveDesktopItem(original, 'f', 0, 0, 0, 0, 4, 6);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('widget-overlap');
    expect(blocked.data).toBe(original);
  });
});

describe('weather widget rectangles', () => {
  const weather = (size: 'small' | 'large' = 'small', col = 0): DesktopItem => ({
    id: 'widget-weather', type: 'widget', widgetType: 'weather', weatherSize: size,
    name: '天气', color: 'blue', page: 0, row: 0, col,
  });
  it('small weather occupies only 2 columns and 2 rows', () => {
    const original = data([[weather('small', 1), app('adjacent', 0, 0, 3)]]);
    expect(validateDesktopLayout(original, { cols: 4, rows: 4 })).toEqual([]);
    expect(canPlaceItem(original.pages[0], app('new', 0, 0, 0), 0, 0, 4, 4)).toBe(true);
    expect(canPlaceItem(original.pages[0], app('new', 0, 1, 2), 1, 2, 4, 4)).toBe(false);
  });
  it('allows weather in nonzero columns while preserving widget collision protection', () => {
    const original = data([[weather(), app('blocked', 0, 2, 0)]]);
    const moved = moveDesktopItem(original, 'widget-weather', 0, 0, 2, 2, 4, 4);
    expect(moved.ok).toBe(true);
    expect(moved.data.pages[0].find((item) => item.id === 'widget-weather')).toMatchObject({ row: 2, col: 2 });
    expect(moveDesktopItem(original, 'widget-weather', 0, 0, 2, 0, 4, 4).ok).toBe(false);
  });
  it('expands atomically, uses another page if necessary and remains valid after reflow', async () => {
    const { resizeWeatherWidget } = await import('./layoutEngine');
    const original = data([[weather(), app('neighbor', 0, 0, 2)]]);
    const expanded = resizeWeatherWidget(original, 'widget-weather', 'large', 4, 2);
    expect(expanded.ok).toBe(true);
    expect(expanded.data.pages).toHaveLength(2);
    expect(expanded.data.pages[1][0]).toMatchObject({ weatherSize: 'large', col: 0 });
    expect(original.pages[0][0].weatherSize).toBe('small');
    expect(validateDesktopLayout(reflowDesktopData(expanded.data, 6, 4), { cols: 6, rows: 4 })).toEqual([]);
    const shrunk = resizeWeatherWidget(expanded.data, 'widget-weather', 'small', 4, 2);
    expect(shrunk.ok).toBe(true);
    expect(validateDesktopLayout(shrunk.data, { cols: 4, rows: 2 })).toEqual([]);
  });
  it('retains the original layout when no expansion fits', async () => {
    const { resizeWeatherWidget } = await import('./layoutEngine');
    const original = data(Array.from({ length: 20 }, (_, page) => page === 0
      ? [weather(), app('neighbor', 0, 0, 2)]
      : [folder(`full-${page}`, page, 0, 0, '2x2'), folder(`other-${page}`, page, 0, 2, '2x2')]));
    const result = resizeWeatherWidget(original, 'widget-weather', 'large', 4, 2);
    expect(result.ok).toBe(false); expect(result.data).toBe(original);
  });
});
