import { describe, expect, it } from 'vitest';
import type { DesktopItem } from '@/types';
import {
  dissolvePrivacyFolder,
  mergePrivacyItemsToFolder,
  movePrivacyFolderChild,
} from './privacyWorkspace';

const app = (id: string, page: number, row: number, col: number): DesktopItem => ({
  id,
  type: 'app',
  name: id,
  color: 'blue',
  page,
  row,
  col,
  url: `https://${id}.example.com`,
});

describe('privacyWorkspace', () => {
  it('两个隐私应用可合并为文件夹，并可继续加入第三个应用', () => {
    const created = mergePrivacyItemsToFolder(
      [app('source', -1, 0, 0), app('target', -1, 0, 1)],
      'source',
      'target',
      () => 'private-folder',
    );
    expect(created.ok).toBe(true);
    expect(created.items).toHaveLength(1);
    expect(created.items[0]).toMatchObject({ id: 'private-folder', type: 'folder', page: -1 });
    expect(created.items[0].children?.map((item) => item.id)).toEqual(['target', 'source']);

    const added = mergePrivacyItemsToFolder(
      [...created.items, app('third', -1, 1, 0)],
      'third',
      'private-folder',
      () => 'unused',
    );
    expect(added.ok).toBe(true);
    expect(added.items[0].children?.map((item) => item.id)).toEqual(['target', 'source', 'third']);
  });

  it('从隐私文件夹拖出后会折叠只剩一个子项的文件夹并保留负页规则', () => {
    const folder: DesktopItem = {
      id: 'folder',
      type: 'folder',
      name: '文件夹',
      color: 'gray',
      page: -1,
      row: 0,
      col: 0,
      children: [app('a', -1, 0, 0), app('b', -1, 0, 0)],
    };
    const moved = movePrivacyFolderChild([folder, app('kept', -1, 1, 0)], 'folder', 'a', -2, 0, 1, 4, 8);
    expect(moved.ok).toBe(true);
    expect(moved.items.find((item) => item.id === 'folder')).toBeUndefined();
    expect(moved.items.find((item) => item.id === 'b')).toMatchObject({ page: -1, row: 0, col: 0 });
    expect(moved.items.find((item) => item.id === 'a')).toMatchObject({ page: -2, row: 0, col: 1 });
  });

  it('解散隐私文件夹时不会丢失子项或制造重复占位', () => {
    const folder: DesktopItem = {
      id: 'folder',
      type: 'folder',
      name: '文件夹',
      color: 'gray',
      page: -1,
      row: 0,
      col: 0,
      children: [app('a', -1, 0, 0), app('b', -1, 0, 0), app('c', -1, 0, 0)],
    };
    const dissolved = dissolvePrivacyFolder([folder, app('kept', -1, 0, 1)], 'folder', 4, 8);
    expect(dissolved.ok).toBe(true);
    expect(dissolved.items.map((item) => item.id).sort()).toEqual(['a', 'b', 'c', 'kept']);
    const positions = dissolved.items.map((item) => `${item.page}:${item.row}:${item.col}`);
    expect(new Set(positions).size).toBe(positions.length);
  });
});
