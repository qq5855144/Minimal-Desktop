import type { DesktopData, DesktopSettings } from '@/types';
import { CURRENT_DESKTOP_VERSION, parseDesktopData } from './desktopSchema';
import { deepClone } from './utils/deepClone';

const DB_NAME = 'ios_desktop_layout_snapshots';
const STORE_NAME = 'snapshots';
export const MAX_LAYOUT_SNAPSHOTS = 20;

export interface LayoutSnapshot {
  id: string;
  name: string;
  createdAt: string;
  data: DesktopData;
  cols: 4 | 5;
  rows: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function safeDesktopData(data: DesktopData): DesktopData {
  const {
    privacyVault: _privacyVault,
    privacyItems: _privacyItems,
    pinHash: _pinHash,
    ...desktop
  } = deepClone(data);
  return { ...desktop, version: CURRENT_DESKTOP_VERSION };
}

export function createLayoutSnapshot(
  name: string,
  data: DesktopData,
  settings: Pick<DesktopSettings, 'cols' | 'rows'>,
): LayoutSnapshot {
  return {
    id: typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim().slice(0, 60) || '未命名布局',
    createdAt: new Date().toISOString(),
    data: safeDesktopData(data),
    cols: settings.cols === 5 ? 5 : 4,
    rows: Math.max(1, Math.min(16, Math.round(settings.rows ?? 8))),
  };
}

function validateSnapshot(value: unknown): LayoutSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LayoutSnapshot>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.name !== 'string'
    || typeof candidate.createdAt !== 'string'
    || (candidate.cols !== 4 && candidate.cols !== 5)
    || !Number.isInteger(candidate.rows)
    || (candidate.rows ?? 0) < 1
    || (candidate.rows ?? 0) > 16
  ) return null;
  const parsed = parseDesktopData(candidate.data);
  if (!parsed.ok) return null;
  return {
    id: candidate.id,
    name: candidate.name.slice(0, 60),
    createdAt: candidate.createdAt,
    data: safeDesktopData(parsed.data),
    cols: candidate.cols,
    rows: candidate.rows!,
  };
}

export async function listLayoutSnapshots(): Promise<LayoutSnapshot[]> {
  try {
    const db = await openDB();
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return values
      .map(validateSnapshot)
      .filter((value): value is LayoutSnapshot => value !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function saveLayoutSnapshot(snapshot: LayoutSnapshot): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(snapshot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  const all = await listLayoutSnapshots();
  await Promise.all(all.slice(MAX_LAYOUT_SNAPSHOTS).map((item) => deleteLayoutSnapshot(item.id)));
}

export async function deleteLayoutSnapshot(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
