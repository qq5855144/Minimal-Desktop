import { describe, it, expect } from 'vitest';
import { changeBookmarks, emptyBookmarks, type Bookmark } from './bookmarks';
import { parseDesktopBackup, CURRENT_DESKTOP_VERSION } from './desktopSchema';
import { compactDesktopPages } from './layoutEngine';
const bookmark = (id: string, groupId = 'default'): Bookmark => ({ id, name: id, url: `https://example.com/${id}`, groupId });
const state = () => ({ groups: [...emptyBookmarks().groups, { id: 'work', name: '工作' }], items: [bookmark('a'), bookmark('b'), bookmark('c', 'work')] });
describe('bookmark collection', () => {
  it('creates a default group for first clip without adding desktop cells', () => {
    const bookmarks = changeBookmarks(undefined, { type: 'add', item: bookmark('clip') });
    const data = { pages: [[]], version: CURRENT_DESKTOP_VERSION, bookmarks };
    expect(compactDesktopPages(data).data.bookmarks).toEqual(bookmarks);
    expect(data.pages).toEqual([[]]);
    expect(bookmarks.groups[0].name).toBe('默认分组');
  });
  it('deduplicates a repeated clip id and rejects executable URLs', () => {
    const original = state();
    expect(changeBookmarks(original, { type: 'add', item: bookmark('a') })).toBe(original);
    expect(changeBookmarks(original, { type: 'add', item: { ...bookmark('d'), url: 'javascript:alert(1)' } })).toBe(original);
  });
  it('moves only selected items and rejects a nonexistent group', () => {
    const original = state();
    const moved = changeBookmarks(original, { type: 'move', ids: ['a'], groupId: 'work' });
    expect(moved.items.map((item) => item.groupId)).toEqual(['work', 'default', 'work']);
    expect(original.items[0].groupId).toBe('default');
    expect(changeBookmarks(original, { type: 'move', ids: ['a'], groupId: 'missing' })).toBe(original);
  });
  it('deletes selected bookmarks without deleting their groups', () => {
    const result = changeBookmarks(state(), { type: 'delete', ids: ['a', 'c'] });
    expect(result.items.map((item) => item.id)).toEqual(['b']); expect(result.groups).toHaveLength(2);
  });
  it('supports moving to the first and last positions without changing groups', () => {
    const first = changeBookmarks(state(), { type: 'reorder', id: 'c', beforeId: 'a' });
    expect(first.items.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    const last = changeBookmarks(first, { type: 'reorder', id: 'c', beforeId: 'b', after: true });
    expect(last.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(last.items[2].groupId).toBe('work');
  });
  it('validates names and normalizes URLs when editing', () => {
    const result = changeBookmarks(state(), { type: 'update', id: 'a', name: ' 新名称 ', url: 'example.org' });
    expect(result.items[0]).toMatchObject({ name: '新名称', url: 'https://example.org/' });
    const original = state();
    expect(changeBookmarks(original, { type: 'createGroup', id: 'x', name: ' 工作 ' })).toBe(original);
  });
  it('preserves groups, order and bookmarks through backup validation', () => {
    const result = parseDesktopBackup({ pages: [[]], version: CURRENT_DESKTOP_VERSION, bookmarks: state() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.bookmarks).toEqual(state());
    expect(parseDesktopBackup({ pages: [[]], version: 5 }).ok).toBe(true);
  });
  it('rejects dangling group references and duplicate bookmark IDs on import', () => {
    const data = { pages: [[]], version: CURRENT_DESKTOP_VERSION, bookmarks: state() };
    expect(parseDesktopBackup({ ...data, bookmarks: { ...state(), items: [bookmark('a', 'missing')] } }).ok).toBe(false);
    expect(parseDesktopBackup({ ...data, bookmarks: { ...state(), items: [bookmark('a'), bookmark('a')] } }).ok).toBe(false);
  });
});
