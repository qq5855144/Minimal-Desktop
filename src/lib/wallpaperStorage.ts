const DB_NAME = 'ios_desktop_wallpaper';
const STORE_NAME = 'wallpaper';
const WALLPAPER_KEY = 'bg_wallpaper';

export const WALLPAPER_MAX_BYTES = 20 * 1024 * 1024;
export const IDB_WALLPAPER_MARKER = '__idb_wallpaper__';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWallpaperDB(file: File): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(file, WALLPAPER_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadWallpaperDB(): Promise<File | null> {
  try {
    const db = await openDB();
    const result = await new Promise<File | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(WALLPAPER_KEY);
      req.onsuccess = () => resolve((req.result as File) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearWallpaperDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(WALLPAPER_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // 清理失败不影响设置流程。
  }
}
