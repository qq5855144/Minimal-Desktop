import { describe, expect, it } from 'vitest';
import type { DesktopData, DesktopItem } from '@/types';
import {
  canPlaceItem,
  compactDesktopPages,
  compactPrivacyPages,
  getPrivacyPageCount,
  getPrivacyPageNumbers,
  moveDesktopItem,
  movePrivacyItem,
  reflowDesktopData,
  reflowPrivacyItems,
  reorderFolderChildren,
  resolvePageAfterCompaction,
  transferDesktopToPrivacy,
  transferPrivacyToDesktop,
  validateDesktopLayout,
} from './layoutEngine';

const app = (id: string, page: number, row: number, col: number): DesktopItem => ({
  id, type: 'app', name: id, color: 'blue', page, row, col, url: `https://${id}.example.com`,
});

const clock = (page = 0, row = 0): DesktopItem => ({
  id: 'widget-clock', type: 'widget', widgetType: 'clock', name: '时钟', color: 'blue', page, row, col: 0,
});

const data = (pages: DesktopItem[][]): DesktopData => ({ pages, version: 3 });

describe('layoutEngine', () => {
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

  it('普通桌面项目命中普通项目时原子交换', () => {
    const original = data([[app('a', 0, 2, 0), app('b', 0, 2, 1)]]);
    const result = moveDesktopItem(original, 'a', 0, 0, 2, 1, 4, 8);
    expect(result.ok).toBe(true);
    expect(result.data.pages[0].find((item) => item.id === 'a')).toMatchObject({ row: 2, col: 1 });
    expect(result.data.pages[0].find((item) => item.id === 'b')).toMatchObject({ row: 2, col: 0 });
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
