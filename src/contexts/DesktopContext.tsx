// @refresh reset
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { DesktopData, DesktopItem, IconColor, ItemType, DesktopSettings } from '@/types';
import { loadDesktopData, saveDesktopData, loadSettings, saveSettings, savePrivacyVault, loadPrivacyVault } from '@/lib/storage';
import { encryptItems } from '@/lib/privacyCrypto';
import { deepClone } from '@/lib/utils/deepClone';
import { pruneIconCaches } from '@/lib/iconCache';
import { loadVideoDB, IDB_VIDEO_MARKER } from '@/lib/videoStorage';

const MAX_ROWS = 14;  // 绝对上限，用户可配置 1-14
const MAX_COLS = 6;
const MAX_FOLDER_APPS = 9;

interface DesktopContextType {
  data: DesktopData;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  loading: boolean;
  // 外观设置
  settings: DesktopSettings;
  updateSettings: (patch: Partial<DesktopSettings>) => void;
  // 添加应用（preferPage：优先放置到指定页面）
  addItem: (item: Omit<DesktopItem, 'id' | 'page' | 'row' | 'col'>, preferPage?: number) => void;
  updateItem: (id: string, patch: Partial<DesktopItem>) => void;
  removeItem: (id: string) => void;
  // 拖拽：交换桌面位置
  swapDesktopItems: (idA: string, pageA: number, rowA: number, colA: string, idB: string, pageB: number, rowB: number, colB: string) => void;
  // 拖拽：移动到空白位置
  moveItemTo: (id: string, fromPage: number, toPage: number, row: number, col: number) => void;
  // 拖拽：从文件夹移到桌面
  moveFromFolderToDesktop: (folderId: string, childId: string, page: number, row: number, col: number) => void;
  // 拖拽：从桌面移到文件夹
  moveDesktopToFolder: (itemId: string, folderId: string) => boolean;
  // 拖拽：文件夹内排序
  reorderFolderChildren: (folderId: string, fromIdx: number, toIdx: number) => void;
  // 拖拽：移动到隐私页
  moveItemToPrivacy: (id: string, row: number, col: number) => void;
  // 拖拽：从隐私页移到普通页
  movePrivacyToPage: (id: string, toPage: number, row: number, col: number) => void;
  reorderPrivacyItems: (id: string, row: number, col: number) => void;
  privacyPageItems: DesktopItem[];
  setPrivacyUnlockData: (items: DesktopItem[], key: CryptoKey) => void;
  mergeToFolder: (sourceId: string, targetId: string, sourceFolderId?: string) => boolean;
  renameFolder: (folderId: string, name: string) => void;
  dissolveFolder: (folderId: string) => void;
  addPage: () => void;
  importData: (data: DesktopData) => void;
  /** 恢复云端数据后重置隐私解锁状态（防止旧密钥 effect 覆盖还原的 vault） */
  resetPrivacyLock: () => void;
}

// HMR 热重载时 createContext 会生成新对象，导致 Provider 与 useContext 不匹配。
// 通过 globalThis 缓存同一实例，保证跨 HMR 重载的 context 引用稳定。
declare global { var __DesktopCtx: React.Context<DesktopContextType | null> | undefined; }
const DesktopContext: React.Context<DesktopContextType | null> =
  globalThis.__DesktopCtx ?? (globalThis.__DesktopCtx = createContext<DesktopContextType | null>(null));

export function useDesktop() {
  const ctx = useContext(DesktopContext);
  if (!ctx) throw new Error('useDesktop must be used within DesktopProvider');
  return ctx;
}

function uid(): string {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 收集 data 中所有 iconUrl，供 pruneIconCaches 使用 */
function collectIconUrls(data: DesktopData): Set<string> {
  const urls = new Set<string>();
  const addItem = (it: DesktopItem) => {
    if (it.iconUrl) urls.add(it.iconUrl);
    it.children?.forEach(addItem);
  };
  data.pages.forEach((page) => page.forEach(addItem));
  return urls;
}

// 查找空白位置（maxCols/maxRows 限制实际渲染范围，避免图标放到不可见位置）
function findEmptySlot(
  pages: DesktopItem[][],
  preferPage?: number,
  maxCols: number = MAX_COLS,
  maxRows: number = MAX_ROWS,
): { page: number; row: number; col: number } | null {
  // 从 preferPage 开始搜索，保证新应用优先出现在当前页
  const order = preferPage !== undefined
    ? [preferPage, ...Array.from({ length: pages.length }, (_, i) => i).filter(i => i !== preferPage)]
    : Array.from({ length: pages.length }, (_, i) => i);

  for (const p of order) {
    for (let r = 0; r < maxRows; r++) {
      // widget 独占整行，跳过该行所有列
      if (pages[p].some((it) => it.row === r && it.type === 'widget')) continue;
      for (let c = 0; c < maxCols; c++) {
        const occupied = pages[p].some((it) => it.row === r && it.col === c);
        if (!occupied) return { page: p, row: r, col: c };
      }
    }
  }
  return null;
}

function collapseFolderAfterChildRemoval(
  pages: DesktopItem[][],
  folderPageIdx: number,
  folderId: string,
): void {
  const folderIdx = pages[folderPageIdx]?.findIndex((it) => it.id === folderId) ?? -1;
  if (folderIdx < 0) return;
  const folder = pages[folderPageIdx][folderIdx];
  if (folder.type !== 'folder' || !folder.children) return;

  if (folder.children.length === 0) {
    pages[folderPageIdx].splice(folderIdx, 1);
    return;
  }

  if (folder.children.length === 1) {
    const [last] = folder.children;
    pages[folderPageIdx][folderIdx] = {
      ...last,
      page: folder.page,
      row: folder.row,
      col: folder.col,
    };
  }
}

export const DesktopProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<DesktopData>(() => loadDesktopData());
  const [currentPage, setCurrentPage] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<DesktopSettings>(() => loadSettings());
  // 加密架构下，隐私数据在解锁时由 PrivacyScreen 解密注入，初始为空
  const [privacyPageItems, setPrivacyPageItems] = useState<DesktopItem[]>([]);
  // 解锁后的 AES-256-GCM 密钥（内存态，刷新自动清除）
  const [privacyCryptoKey, setPrivacyCryptoKey] = useState<{ key: CryptoKey; salt: Uint8Array } | null>(null);
  const firstRender = useRef(true);

  // 启动时：若视频壁纸存储在 IndexedDB，恢复 blob URL
  useEffect(() => {
    const s = loadSettings();
    if (s.bgType === 'video' && s.bgVideo === IDB_VIDEO_MARKER) {
      loadVideoDB().then((file) => {
        if (file) {
          const url = URL.createObjectURL(file);
          setSettings((prev) => ({ ...prev, bgVideo: url }));
        } else {
          setSettings((prev) => ({ ...prev, bgVideo: undefined, bgType: 'default' }));
          saveSettings({ ...s, bgVideo: undefined, bgType: 'default' });
        }
      });
    }
  }, []);

  // data 变更时持久化（跳过首次挂载）
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    saveDesktopData(data);
  }, [data]);

  // 隐私页持久化（加密保存，仅在密钥可用时执行）
  const privacyCryptoKeyRef = useRef<{ key: CryptoKey; salt: Uint8Array } | null>(null);
  useEffect(() => { privacyCryptoKeyRef.current = privacyCryptoKey; }, [privacyCryptoKey]);
  useEffect(() => {
    const kd = privacyCryptoKeyRef.current;
    if (!kd) return; // 未解锁时不保存（密钥不在内存）
    encryptItems(privacyPageItems, kd.key, kd.salt).then(savePrivacyVault).catch(() => {/* 静默失败 */});
  }, [privacyPageItems]);

  // 模拟骨架屏加载
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, []);

  const addItem = useCallback((
    item: Omit<DesktopItem, 'id' | 'page' | 'row' | 'col'>,
    preferPage?: number,
  ) => {
    const gridCols = settings.cols ?? 4;
    const gridRows = settings.rows ?? 7;

    // 添加到隐私桌面
    if (preferPage === -1) {
      setPrivacyPageItems((prev) => {
        // 找隐私桌面的空格
        const occupied = new Set(prev.map((it) => `${it.row},${it.col}`));
        for (let r = 0; r < gridRows; r++) {
          for (let c = 0; c < gridCols; c++) {
            if (!occupied.has(`${r},${c}`)) {
              return [...prev, { ...item, id: uid(), page: -1, row: r, col: c }];
            }
          }
        }
        // 满了就追加到最后一行
        const lastRow = prev.length > 0 ? Math.max(...prev.map((it) => it.row)) + 1 : 0;
        return [...prev, { ...item, id: uid(), page: -1, row: lastRow, col: 0 }];
      });
      return;
    }

    let targetPage = 0;
    setData((prev) => {
      const next = deepClone(prev);
      const slot = findEmptySlot(next.pages, preferPage, gridCols, gridRows);
      if (!slot) {
        next.pages.push([]);
        const newSlot = { page: next.pages.length - 1, row: 0, col: 0 };
        targetPage = newSlot.page;
        next.pages[newSlot.page].push({
          ...item, id: uid(),
          page: newSlot.page, row: newSlot.row, col: newSlot.col,
        });
      } else {
        targetPage = slot.page;
        next.pages[slot.page].push({
          ...item, id: uid(),
          page: slot.page, row: slot.row, col: slot.col,
        });
      }
      return next;
    });
    // 在下一个宏任务中跳转（等 setData 的 state 已 commit）
    setTimeout(() => setCurrentPage(targetPage), 0);
  }, [settings.cols, settings.rows]);

  const updateItem = useCallback((id: string, patch: Partial<DesktopItem>) => {
    // 先尝试更新普通桌面
    let found = false;
    setData((prev) => {
      const next = deepClone(prev);
      for (const page of next.pages) {
        const idx = page.findIndex((it) => it.id === id);
        if (idx >= 0) {
          page[idx] = { ...page[idx], ...patch };
          found = true;
          return next;
        }
        // 文件夹内
        for (const item of page) {
          if (item.type === 'folder' && item.children) {
            const ci = item.children.findIndex((c) => c.id === id);
            if (ci >= 0) {
              item.children[ci] = { ...item.children[ci], ...patch };
              found = true;
              return next;
            }
          }
        }
      }
      const di = next.dock.findIndex((it) => it.id === id);
      if (di >= 0) {
        next.dock[di] = { ...next.dock[di], ...patch };
        found = true;
      }
      return next;
    });
    // 如果普通桌面没找到，尝试更新隐私桌面
    if (!found) {
      setPrivacyPageItems((prev) => {
        const idx = prev.findIndex((it) => it.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    }
  }, []);

  const removeItem = useCallback((id: string) => {
    let found = false;
    setData((prev) => {
      const next = deepClone(prev);
      for (let p = 0; p < next.pages.length; p++) {
        const idx = next.pages[p].findIndex((it) => it.id === id);
        if (idx >= 0) {
          next.pages[p].splice(idx, 1);
          found = true;
          setTimeout(() => pruneIconCaches(collectIconUrls(next)), 0);
          return next;
        }
        for (const item of next.pages[p]) {
          if (item.type === 'folder' && item.children) {
            const ci = item.children.findIndex((c) => c.id === id);
            if (ci >= 0) {
              item.children.splice(ci, 1);
              found = true;
              // 单应用解散
              if (item.children.length <= 1) {
                const child = item.children[0];
                if (child) {
                  next.pages[p].push({
                    ...child,
                    page: item.page,
                    row: item.row,
                    col: item.col,
                  });
                }
                const fi = next.pages[p].findIndex((it) => it.id === item.id);
                if (fi >= 0) next.pages[p].splice(fi, 1);
              }
              setTimeout(() => pruneIconCaches(collectIconUrls(next)), 0);
              return next;
            }
          }
        }
      }
      const di = next.dock.findIndex((it) => it.id === id);
      if (di >= 0) {
        next.dock.splice(di, 1);
        found = true;
        setTimeout(() => pruneIconCaches(collectIconUrls(next)), 0);
      }
      return next;
    });
    // 如果普通桌面没找到，尝试从隐私桌面删除
    if (!found) {
      setPrivacyPageItems((prev) => prev.filter((it) => it.id !== id));
    }
  }, []);

  const swapDesktopItems = useCallback(
    (
      _idA: string,
      _pageA: number,
      _rowA: number,
      colA: string,
      _idB: string,
      _pageB: number,
      _rowB: number,
      colB: string,
    ) => {
      const ca = Number.parseInt(colA, 10);
      const cb = Number.parseInt(colB, 10);
      setData((prev) => {
        const next = deepClone(prev);
        const idxA = next.pages[_pageA]?.findIndex((it) => it.id === _idA);
        const idxB = next.pages[_pageB]?.findIndex((it) => it.id === _idB);
        if (idxA < 0 || idxB < 0) return prev;
        const a = next.pages[_pageA][idxA];
        const b = next.pages[_pageB][idxB];
        // 更新字段
        a.row = _rowB; a.col = cb; a.page = _pageB;
        b.row = _rowA; b.col = ca; b.page = _pageA;
        // 若跨页，实际移动数组成员
        if (_pageA !== _pageB) {
          next.pages[_pageA].splice(idxA, 1);
          next.pages[_pageB].splice(idxB, 1);
          next.pages[_pageB].push(a);
          next.pages[_pageA].push(b);
        }
        return next;
      });
    },
    [],
  );

  const moveItemTo = useCallback((id: string, fromPage: number, toPage: number, row: number, col: number) => {
    setData((prev) => {
      const next = deepClone(prev);
      const fromIdx = next.pages[fromPage]?.findIndex((it) => it.id === id);
      if (fromIdx === undefined || fromIdx < 0) return prev;

      // 从源页数组中取出 item
      const [item] = next.pages[fromPage].splice(fromIdx, 1);

      // 检查目标位置是否已有项（跨页时需在目标页查找）
      const targetIdx = next.pages[toPage]?.findIndex((it) => it.row === row && it.col === col);
      if (targetIdx !== undefined && targetIdx >= 0) {
        // 交换：把目标位置的 item 移回源页原位置
        const [target] = next.pages[toPage].splice(targetIdx, 1);
        target.page = fromPage;
        target.row = item.row;
        target.col = item.col;
        next.pages[fromPage].push(target);
      }

      // 将 item 放入目标页数组
      item.page = toPage;
      item.row = row;
      item.col = col;
      next.pages[toPage].push(item);
      return next;
    });
  }, []);

  const moveFromFolderToDesktop = useCallback((folderId: string, childId: string, page: number, row: number, col: number) => {
    setData((prev) => {
      const next = deepClone(prev);
      let folder: DesktopItem | null = null;
      let folderPageIdx = -1;
      for (let p = 0; p < next.pages.length; p++) {
        const fi = next.pages[p].findIndex((it) => it.id === folderId);
        if (fi >= 0) {
          folder = next.pages[p][fi];
          folderPageIdx = p;
          break;
        }
      }
      if (!folder || !folder.children) return prev;
      const ci = folder.children.findIndex((c) => c.id === childId);
      if (ci < 0) return prev;
      const child = folder.children.splice(ci, 1)[0];
      // 检查目标位置
      const targetIdx = next.pages[page]?.findIndex((it) => it.row === row && it.col === col);
      if (targetIdx !== undefined && targetIdx >= 0) {
        const target = next.pages[page][targetIdx];
        if (target.type === 'widget' || target.type === 'system') {
          folder.children.splice(ci, 0, child);
          return prev;
        }

        if (target.type === 'folder') {
          if (target.id === folderId || !target.children || target.children.length >= MAX_FOLDER_APPS) {
            folder.children.splice(ci, 0, child);
            return prev;
          }
          target.children.push({
            ...child,
            page: target.page,
            row: target.row,
            col: target.col,
          });
          collapseFolderAfterChildRemoval(next.pages, folderPageIdx, folderId);
          return next;
        }

        target.page = folderPageIdx;
        target.row = folder.row;
        target.col = folder.col;
        folder.children.push(target);
      }
      child.page = page;
      child.row = row;
      child.col = col;
      next.pages[page].push(child);
      collapseFolderAfterChildRemoval(next.pages, folderPageIdx, folderId);
      return next;
    });
  }, []);

  const moveDesktopToFolder = useCallback((itemId: string, folderId: string): boolean => {
    let success = false;
    setData((prev) => {
      const next = deepClone(prev);
      let folder: DesktopItem | null = null;
      let item: DesktopItem | null = null;
      let itemPage = -1;
      let itemIdx = -1;
      for (let p = 0; p < next.pages.length; p++) {
        const fi = next.pages[p].findIndex((it) => it.id === folderId);
        if (fi >= 0) folder = next.pages[p][fi];
        const ii = next.pages[p].findIndex((it) => it.id === itemId);
        if (ii >= 0) {
          item = next.pages[p][ii];
          itemPage = p;
          itemIdx = ii;
        }
      }
      if (!folder || !folder.children || !item) return prev;
      if (folder.children.length >= MAX_FOLDER_APPS) return prev;
      folder.children.push(item);
      next.pages[itemPage].splice(itemIdx, 1);
      success = true;
      return next;
    });
    return success;
  }, []);

  const reorderFolderChildren = useCallback((folderId: string, fromIdx: number, toIdx: number) => {
    setData((prev) => {
      const next = deepClone(prev);
      for (const page of next.pages) {
        const folder = page.find((it) => it.id === folderId);
        if (folder?.children) {
          const [moved] = folder.children.splice(fromIdx, 1);
          folder.children.splice(toIdx, 0, moved);
          break;
        }
      }
      return next;
    });
  }, []);

  const mergeToFolder = useCallback((sourceId: string, targetId: string, sourceFolderId?: string): boolean => {
    let success = false;
    setData((prev) => {
      const next = deepClone(prev);
      let source: DesktopItem | null = null;
      let target: DesktopItem | null = null;
      let sourcePage = -1;
      let sourceIdx = -1;
      let sourceFolder: DesktopItem | null = null;
      let sourceFolderPage = -1;
      let sourceChildIdx = -1;
      let targetPage = -1;
      let targetIdx = -1;
      for (let p = 0; p < next.pages.length; p++) {
        if (sourceFolderId) {
          const fi = next.pages[p].findIndex((it) => it.id === sourceFolderId);
          if (fi >= 0) {
            const maybeFolder = next.pages[p][fi];
            if (maybeFolder.type === 'folder' && maybeFolder.children) {
              const ci = maybeFolder.children.findIndex((child) => child.id === sourceId);
              if (ci >= 0) {
                sourceFolder = maybeFolder;
                sourceFolderPage = p;
                sourceChildIdx = ci;
                source = maybeFolder.children[ci];
              }
            }
          }
        } else {
          const si = next.pages[p].findIndex((it) => it.id === sourceId);
          if (si >= 0) {
            source = next.pages[p][si];
            sourcePage = p;
            sourceIdx = si;
          }
        }
        const ti = next.pages[p].findIndex((it) => it.id === targetId);
        if (ti >= 0) {
          target = next.pages[p][ti];
          targetPage = p;
          targetIdx = ti;
        }
      }
      if (!source || !target) return prev;
      if (target.type === 'system' || target.type === 'widget') return prev;
      if (sourceFolderId && target.id === sourceFolderId) return prev;
      if (source.type === 'folder' && target.type === 'folder') return prev;

      if (sourceFolder && sourceChildIdx >= 0) {
        source = sourceFolder.children!.splice(sourceChildIdx, 1)[0];
      }
      // 如果 target 已是文件夹
      if (target.type === 'folder' && target.children) {
        if (target.children.length >= MAX_FOLDER_APPS) {
          if (sourceFolder && sourceChildIdx >= 0) sourceFolder.children!.splice(sourceChildIdx, 0, source);
          return prev;
        }
        target.children.push({
          ...source,
          page: target.page,
          row: target.row,
          col: target.col,
        });
        if (!sourceFolderId) {
          next.pages[sourcePage].splice(sourceIdx, 1);
        } else {
          collapseFolderAfterChildRemoval(next.pages, sourceFolderPage, sourceFolderId);
        }
        success = true;
        return next;
      }
      // 创建新文件夹
      const folder: DesktopItem = {
        id: uid(),
        type: 'folder',
        name: '文件夹',
        color: 'gray',
        page: targetPage,
        row: target.row,
        col: target.col,
        children: [target, source],
      };
      next.pages[targetPage][targetIdx] = folder;
      if (!sourceFolderId) {
        next.pages[sourcePage].splice(sourceIdx, 1);
      } else {
        collapseFolderAfterChildRemoval(next.pages, sourceFolderPage, sourceFolderId);
      }
      success = true;
      return next;
    });
    return success;
  }, []);

  const renameFolder = useCallback((folderId: string, name: string) => {
    setData((prev) => {
      const next = deepClone(prev);
      for (const page of next.pages) {
        const folder = page.find((it) => it.id === folderId);
        if (folder) {
          folder.name = name;
          break;
        }
      }
      return next;
    });
  }, []);

  const dissolveFolder = useCallback((folderId: string) => {
    setData((prev) => {
      const next = deepClone(prev);
      for (let p = 0; p < next.pages.length; p++) {
        const fi = next.pages[p].findIndex((it) => it.id === folderId);
        if (fi < 0) continue;
        const folder = next.pages[p][fi];
        const children = folder.children ?? [];

        // 移除文件夹本身
        next.pages[p].splice(fi, 1);

        // 将每个子应用散落到桌面（贪心找空位，优先当前页）
        for (const child of children) {
          let placed = false;
          const gr = settings.rows ?? 7;
          // 先在当前页 p 找空位
          for (let r = 0; r < gr && !placed; r++) {
            if (next.pages[p].some((it) => it.row === r && it.type === 'widget')) continue;
            for (let c = 0; c < MAX_COLS && !placed; c++) {
              if (!next.pages[p].some((it) => it.row === r && it.col === c)) {
                next.pages[p].push({ ...child, page: p, row: r, col: c });
                placed = true;
              }
            }
          }
          if (!placed) {
            // 其他页面找空位
            outer: for (let pp = 0; pp < next.pages.length; pp++) {
              for (let r = 0; r < gr; r++) {
                if (next.pages[pp].some((it) => it.row === r && it.type === 'widget')) continue;
                for (let c = 0; c < MAX_COLS; c++) {
                  if (!next.pages[pp].some((it) => it.row === r && it.col === c)) {
                    next.pages[pp].push({ ...child, page: pp, row: r, col: c });
                    placed = true;
                    break outer;
                  }
                }
              }
            }
          }
          if (!placed) {
            // 新建页面
            const np = next.pages.length;
            next.pages.push([{ ...child, page: np, row: 0, col: 0 }]);
          }
        }
        break;
      }
      return next;
    });
  }, []);

  const addPage = useCallback(() => {
    setData((prev) => {
      const next = deepClone(prev);
      if (next.pages.length < 20) next.pages.push([]);
      return next;
    });
  }, []);

  const importData = useCallback((newData: DesktopData) => {
    setData(newData);
    setCurrentPage(0);
  }, []);

  /**
   * 恢复云端数据后调用：清除内存中的密钥和明文隐私数据。
   * 防止 privacyPageItems effect 用旧密钥重新加密空数据，覆盖刚恢复的 vault。
   */
  const resetPrivacyLock = useCallback(() => {
    setPrivacyCryptoKey(null);
    setPrivacyPageItems([]);
  }, []);

  /** 解锁隐私桌面后注入解密数据和内存密钥 */
  const setPrivacyUnlockData = useCallback((items: DesktopItem[], key: CryptoKey) => {
    const vault = loadPrivacyVault();
    const salt = vault ? Uint8Array.from(atob(vault.salt), (c) => c.charCodeAt(0)) : new Uint8Array(16);
    setPrivacyCryptoKey({ key, salt });
    setPrivacyPageItems(items);
  }, []);

  /** 将普通桌面图标移入隐私页 */
  // 用 ref 跟踪 data 最新值，供 callback 中同步读取（避免 React 18 批处理闭包竞态）
  const dataRef = useRef<DesktopData>(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  const moveItemToPrivacy = useCallback((id: string, row: number, col: number) => {
    // 先从 dataRef 同步读取图标，避免闭包竞态
    let moved: DesktopItem | null = null;
    for (const page of dataRef.current.pages) {
      const found = page.find((it) => it.id === id);
      if (found) { moved = found; break; }
    }
    if (!moved) moved = dataRef.current.dock.find((it) => it.id === id) ?? null;
    if (!moved) return;
    const movedItem = moved;
    setData((prev) => {
      const next = deepClone(prev);
      for (let p = 0; p < next.pages.length; p++) {
        const idx = next.pages[p].findIndex((it) => it.id === id);
        if (idx >= 0) { next.pages[p].splice(idx, 1); return next; }
      }
      const di = next.dock.findIndex((it) => it.id === id);
      if (di >= 0) { next.dock.splice(di, 1); return next; }
      return prev;
    });
    setPrivacyPageItems((prev) => {
      const next = prev.filter((it) => it.id !== movedItem.id);
      // 目标位置已有图标则把它移回原位
      const existIdx = next.findIndex((it) => it.row === row && it.col === col);
      if (existIdx >= 0) {
        next[existIdx] = { ...next[existIdx], row: movedItem.row, col: movedItem.col, page: -1 };
      }
      next.push({ ...movedItem, page: -1, row, col });
      return next;
    });
  }, []);

  // 用 ref 跟踪 privacyPageItems 最新值，供 callback 中同步读取
  const privacyPageItemsRef = useRef<DesktopItem[]>(privacyPageItems);
  useEffect(() => { privacyPageItemsRef.current = privacyPageItems; }, [privacyPageItems]);

  /** 隐私页内部图标重新排列（拖拽换位） */
  const reorderPrivacyItems = useCallback((id: string, row: number, col: number) => {
    setPrivacyPageItems((prev) => {
      const next = prev.map((it) => ({ ...it }));
      const srcIdx = next.findIndex((it) => it.id === id);
      if (srcIdx < 0) return prev;
      const src = next[srcIdx];
      const tgtIdx = next.findIndex((it) => it.row === row && it.col === col);
      if (tgtIdx >= 0) {
        // 目标位置有图标：交换坐标
        next[tgtIdx] = { ...next[tgtIdx], row: src.row, col: src.col };
      }
      next[srcIdx] = { ...src, row, col };
      return next;
    });
  }, []);

  /** 将隐私页图标移回普通桌面指定页 */
  const movePrivacyToPage = useCallback((id: string, toPage: number, row: number, col: number) => {
    // 直接从 ref 同步读取，避免 React 18 批处理下闭包变量竞态问题
    const moved = privacyPageItemsRef.current.find((it) => it.id === id);
    if (!moved) return;
    setPrivacyPageItems((prev) => prev.filter((it) => it.id !== id));
    setData((prev) => {
      const next = deepClone(prev);
      if (!next.pages[toPage]) next.pages[toPage] = [];
      next.pages[toPage] = next.pages[toPage].filter((it) => !(it.row === row && it.col === col));
      next.pages[toPage].push({ ...moved, page: toPage, row, col });
      return next;
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<DesktopSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  return (
    <DesktopContext.Provider
      value={{
        data,
        currentPage,
        setCurrentPage,
        editMode,
        setEditMode,
        loading,
        settings,
        updateSettings,
        addItem,
        updateItem,
        removeItem,
        swapDesktopItems,
        moveItemTo,
        moveFromFolderToDesktop,
        moveDesktopToFolder,
        reorderFolderChildren,
        mergeToFolder,
        renameFolder,
        dissolveFolder,
        addPage,
        importData,
        resetPrivacyLock,
        moveItemToPrivacy,
        movePrivacyToPage,
        reorderPrivacyItems,
        privacyPageItems,
        setPrivacyUnlockData,
      }}
    >
      {children}
    </DesktopContext.Provider>
  );
};

export { MAX_ROWS, MAX_COLS, MAX_FOLDER_APPS };
export type { IconColor, ItemType };
