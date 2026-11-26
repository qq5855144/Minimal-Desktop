import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopData, DesktopItem } from '@/types';
import { persistDesktopChanges, shareUnchangedPages } from './desktopPersistence';
import { DESKTOP_DATA_KEY, serializeDesktopData } from './storage';

const base: DesktopData = { version: 6, pages: [[]] };
const grid = { cols: 4, rows: 8 } as const;
const app = (id: string): DesktopItem => ({ id, name: id, type: 'app', color: 'blue', page: 0, row: 0, col: 0 });
const withApp = (item: DesktopItem): DesktopData => ({ ...base, pages: [[item]] });

describe('desktop persistence', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('merges independent additions even when they use the same cell', () => {
    const raw = serializeDesktopData(base);
    store.set(DESKTOP_DATA_KEY, raw);
    expect(persistDesktopChanges(base, raw, withApp(app('A')), grid).status).toBe('saved');
    const merged = persistDesktopChanges(base, raw, withApp(app('B')), grid);
    expect(merged.status).toBe('saved');
    if (merged.status !== 'saved') return;
    expect(merged.data.pages[0].map(({ id, col }) => [id, col])).toEqual([['B', 0], ['A', 1]]);
  });

  it('keeps the stored copy unchanged when two tabs edit the same item', () => {
    const original = withApp(app('A'));
    const baseline = serializeDesktopData(original);
    const other = serializeDesktopData(withApp({ ...app('A'), name: 'other' }));
    store.set(DESKTOP_DATA_KEY, other);
    const local = withApp({ ...app('A'), name: 'local' });
    expect(persistDesktopChanges(original, baseline, local, grid)).toEqual({ status: 'conflict' });
    expect(store.get(DESKTOP_DATA_KEY)).toBe(other);
    expect(local.pages[0][0].name).toBe('local');
  });

  it('propagates quota failures and allows retrying the same draft', () => {
    const local = withApp(app('A'));
    const storage = localStorage;
    vi.stubGlobal('localStorage', {
      getItem: storage.getItem,
      setItem: () => { throw new Error('Quota exceeded'); },
    });
    expect(persistDesktopChanges(base, null, local, grid)).toEqual({ status: 'unavailable' });
    vi.stubGlobal('localStorage', storage);
    expect(persistDesktopChanges(base, null, local, grid).status).toBe('saved');
  });

  it('reuses unchanged item and page objects in undo history', () => {
    const original = { ...base, pages: [[app('A'), app('B')], [{ ...app('C'), page: 1 }]] };
    const copy = structuredClone(original);
    copy.pages[0][0].name = 'updated';
    const shared = shareUnchangedPages(original, copy);
    expect(shared.pages[0][0]).not.toBe(original.pages[0][0]);
    expect(shared.pages[0][1]).toBe(original.pages[0][1]);
    expect(shared.pages[1]).toBe(original.pages[1]);
  });
});
