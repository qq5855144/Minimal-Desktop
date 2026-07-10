// IndexedDB 视频壁纸存储
// 使用 IndexedDB 持久化本地视频文件，规避 localStorage 5MB 大小限制

const DB_NAME = 'ios_desktop_video';
const STORE_NAME = 'video';
const VIDEO_KEY = 'bg_video';

/** 50 MB 上传大小限制 */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 将视频 File 存入 IndexedDB，返回持久化标记字符串 '__idb__' */
export async function saveVideoDB(file: File): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(file, VIDEO_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 从 IndexedDB 读取视频 File，若不存在返回 null */
export async function loadVideoDB(): Promise<File | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(VIDEO_KEY);
      req.onsuccess = () => resolve((req.result as File) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** 删除 IndexedDB 中存储的视频 */
export async function clearVideoDB(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(VIDEO_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // 删除失败不阻塞
    });
  } catch {
    // 忽略错误
  }
}

/** IndexedDB 存储视频的占位标记（保存在 localStorage settings 中） */
export const IDB_VIDEO_MARKER = '__idb__';
