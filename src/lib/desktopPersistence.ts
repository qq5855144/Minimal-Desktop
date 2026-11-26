import type { DesktopData, DesktopSettings } from '@/types';
import { emptyBookmarks } from './bookmarks';
import { parseDesktopData } from './desktopSchema';
import { validateDesktopLayout } from './layoutEngine';
import { groupDesktopPositions, normalizePortraitData } from './orientationLayout';
import { DESKTOP_DATA_KEY, serializeDesktopData } from './storage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!isRecord(left) || !isRecord(right) || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  return keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length
    && keys.every((key) => sameValue(left[key], right[key]));
}

export function shareUnchangedPages(previous: DesktopData, next: DesktopData): DesktopData {
  const pages = next.pages.map((page, index) => {
    const before = previous.pages[index];
    if (!before || page === before) return page;
    // Layout operations may clone a whole desktop to move one icon.
    const byId = new Map(before.map((item) => [item.id, item]));
    const items = page.map((item) => {
      const old = byId.get(item.id);
      return old && sameValue(old, item) ? old : item;
    });
    return items.length === before.length && items.every((item, i) => item === before[i]) ? before : items;
  });
  return { ...next, pages };
}

function mergeById<T extends { id: string }>(base: T[], local: T[], remote: T[]): T[] | null {
  const index = (items: T[]) => new Map(items.map((item) => [item.id, item]));
  const original = index(base);
  const localById = index(local);
  const remoteById = index(remote);
  const merged: T[] = [];
  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const before = original.get(id);
    const ours = localById.get(id);
    const theirs = remoteById.get(id);
    if (sameValue(theirs, before) || sameValue(ours, theirs)) {
      if (ours) merged.push(ours);
    } else if (sameValue(ours, before)) {
      if (theirs) merged.push(theirs);
    } else {
      return null;
    }
  }
  return merged;
}

export function readDesktopStorage(): string | null {
  try { return localStorage.getItem(DESKTOP_DATA_KEY); } catch { return null; }
}

export type DesktopSaveResult =
  | { status: 'saved'; data: DesktopData; raw: string }
  | { status: 'conflict' | 'unavailable' };

export function persistDesktopChanges(
  base: DesktopData, expectedRaw: string | null, local: DesktopData, settings: Pick<DesktopSettings, 'cols' | 'rows'>,
): DesktopSaveResult {
  try {
    const raw = localStorage.getItem(DESKTOP_DATA_KEY);
    let data = local;
    if (raw !== expectedRaw) {
      if (!raw) return { status: 'conflict' };
      const parsed = parseDesktopData(JSON.parse(raw));
      if (!parsed.ok) return { status: 'conflict' };
      const remote = parsed.data;
      const apps = mergeById(base.pages.flat(), local.pages.flat(), remote.pages.flat());
      const [before, ours, theirs] = [base, local, remote].map((state) => state.bookmarks ?? emptyBookmarks());
      // Bookmark order is user data as well as each item's metadata.
      const bookmarks = sameValue(theirs, before) || sameValue(ours, theirs)
        ? local.bookmarks
        : sameValue(ours, before) ? remote.bookmarks : null;
      if (!apps || bookmarks === null) return { status: 'conflict' };
      const merged = normalizePortraitData(groupDesktopPositions({ ...local, bookmarks }, apps), settings.cols, settings.rows);
      if (!merged || validateDesktopLayout(merged, settings).length) return { status: 'conflict' };
      data = merged;
    }
    const nextRaw = serializeDesktopData(data);
    if (nextRaw !== raw) localStorage.setItem(DESKTOP_DATA_KEY, nextRaw);
    return { status: 'saved', data, raw: nextRaw };
  } catch {
    return { status: 'unavailable' };
  }
}

const WORKSPACE_LOCK = 'minimal-desktop-local-save';
let database: Promise<IDBDatabase | null> | undefined;

function openLockDatabase(): Promise<IDBDatabase | null> {
  return database ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    try {
      const request = indexedDB.open(WORKSPACE_LOCK, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspace');
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
      request.onsuccess = () => resolve(request.result);
    } catch { resolve(null); }
  });
}

export async function withDesktopSaveLock<T>(save: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    try { return await navigator.locks.request(WORKSPACE_LOCK, () => save()); } catch { /* use IndexedDB */ }
  }
  const db = await openLockDatabase();
  if (!db) return save();
  // readwrite transactions serialize across tabs, including browsers without Web Locks.
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite');
    const request = transaction.objectStore('workspace').get(WORKSPACE_LOCK);
    request.onsuccess = () => resolve(save());
    transaction.onabort = () => reject(transaction.error);
  }).catch(save);
}
