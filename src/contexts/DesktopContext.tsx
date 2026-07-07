// @refresh reset
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { DesktopData, DesktopItem, IconColor, ItemType, DesktopSettings } from '@/types';
import { loadDesktopData, saveDesktopData, loadSettings, saveSettings } from '@/lib/storage';
import { pruneIconCaches } from '@/lib/iconCache';

const MAX_ROWS = 6;
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
  // 编辑应用
  updateItem: (id: string, patch: Partial<DesktopItem>) => void;
  // 删除应用
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
  // 拖拽：从 Dock 移到桌面
  moveDockToDesktop: (itemId: string, page: number, row: number, col: number) => void;
  // 拖拽：从桌面移到 Dock
  moveDesktopToDock: (itemId: string, dockIdx: number) => void;
  // 合并两个应用为文件夹
  mergeToFolder: (sourceId: string, targetId: string) => void;
  // 重命名文件夹
  renameFolder: (folderId: string, name: string) => void;
  // 解散文件夹（单应用）
  dissolveFolder: (folderId: string) => void;
  // 新增页面
  addPage: () => void;
  // Dock 操作
  addToDock: (item: DesktopItem) => void;
  removeFromDock: (id: string) => void;
  // 同步
  importData: (data: DesktopData) => void;
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
  data.dock.forEach(addItem);
  return urls;
}

// 查找空白位置（maxCols 限制实际渲染列数，避免图标放到不可见列）
function findEmptySlot(
  pages: DesktopItem[][],
  preferPage?: number,
  maxCols: number = MAX_COLS,
): { page: number; row: number; col: number } | null {
  // 从 preferPage 开始搜索，保证新应用优先出现在当前页
  const order = preferPage !== undefined
    ? [preferPage, ...Array.from({ length: pages.length }, (_, i) => i).filter(i => i !== preferPage)]
    : Array.from({ length: pages.length }, (_, i) => i);

  for (const p of order) {
    for (let r = 0; r < MAX_ROWS; r++) {
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

export const DesktopProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<DesktopData>(() => loadDesktopData());
  const [currentPage, setCurrentPage] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<DesktopSettings>(() => loadSettings());
  const firstRender = useRef(true);

  // 持久化
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    saveDesktopData(data);
  }, [data]);

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
    let targetPage = 0;
    setData((prev) => {
      const next = structuredClone(prev);
      const slot = findEmptySlot(next.pages, preferPage, gridCols);
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
  }, [settings.cols]);

  const updateItem = useCallback((id: string, patch: Partial<DesktopItem>) => {
    setData((prev) => {
      const next = structuredClone(prev);
      for (const page of next.pages) {
        const idx = page.findIndex((it) => it.id === id);
        if (idx >= 0) {
          page[idx] = { ...page[idx], ...patch };
          return next;
        }
        // 文件夹内
        for (const item of page) {
          if (item.type === 'folder' && item.children) {
            const ci = item.children.findIndex((c) => c.id === id);
            if (ci >= 0) {
              item.children[ci] = { ...item.children[ci], ...patch };
              return next;
            }
          }
        }
      }
      const di = next.dock.findIndex((it) => it.id === id);
      if (di >= 0) {
        next.dock[di] = { ...next.dock[di], ...patch };
      }
      return next;
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setData((prev) => {
      const next = structuredClone(prev);
      for (let p = 0; p < next.pages.length; p++) {
        const idx = next.pages[p].findIndex((it) => it.id === id);
        if (idx >= 0) {
          next.pages[p].splice(idx, 1);
          // 清理孤儿图标缓存（延迟到下一宏任务，不阻塞状态更新）
          setTimeout(() => pruneIconCaches(collectIconUrls(next)), 0);
          return next;
        }
        for (const item of next.pages[p]) {
          if (item.type === 'folder' && item.children) {
            const ci = item.children.findIndex((c) => c.id === id);
            if (ci >= 0) {
              item.children.splice(ci, 1);
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
        setTimeout(() => pruneIconCaches(collectIconUrls(next)), 0);
      }
      return next;
    });
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
        const next = structuredClone(prev);
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
      const next = structuredClone(prev);
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
      const next = structuredClone(prev);
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
        target.page = folderPageIdx;
        target.row = folder.row;
        target.col = folder.col;
        folder.children.push(target);
      }
      child.page = page;
      child.row = row;
      child.col = col;
      next.pages[page].push(child);
      // 单应用解散
      if (folder.children.length <= 1) {
        const last = folder.children[0];
        if (last) {
          last.page = folder.page;
          last.row = folder.row;
          last.col = folder.col;
          next.pages[folderPageIdx].push(last);
        }
        const fi = next.pages[folderPageIdx].findIndex((it) => it.id === folderId);
        if (fi >= 0) next.pages[folderPageIdx].splice(fi, 1);
      }
      return next;
    });
  }, []);

  const moveDesktopToFolder = useCallback((itemId: string, folderId: string): boolean => {
    let success = false;
    setData((prev) => {
      const next = structuredClone(prev);
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
      const next = structuredClone(prev);
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

  const moveDockToDesktop = useCallback((itemId: string, page: number, row: number, col: number) => {
    setData((prev) => {
      const next = structuredClone(prev);
      const di = next.dock.findIndex((it) => it.id === itemId);
      if (di < 0) return prev;
      const item = next.dock.splice(di, 1)[0];
      const targetIdx = next.pages[page]?.findIndex((it) => it.row === row && it.col === col);
      if (targetIdx !== undefined && targetIdx >= 0) {
        const target = next.pages[page][targetIdx];
        target.page = -1;
        next.dock.push(target);
      }
      item.page = page;
      item.row = row;
      item.col = col;
      next.pages[page].push(item);
      return next;
    });
  }, []);

  const moveDesktopToDock = useCallback((itemId: string, dockIdx: number) => {
    setData((prev) => {
      const next = structuredClone(prev);
      let item: DesktopItem | null = null;
      let itemPage = -1;
      let itemIdx = -1;
      for (let p = 0; p < next.pages.length; p++) {
        const ii = next.pages[p].findIndex((it) => it.id === itemId);
        if (ii >= 0) {
          item = next.pages[p][ii];
          itemPage = p;
          itemIdx = ii;
        }
      }
      if (!item) return prev;
      if (dockIdx < next.dock.length) {
        const swapped = next.dock[dockIdx];
        swapped.page = itemPage;
        swapped.row = item.row;
        swapped.col = item.col;
        next.pages[itemPage].push(swapped);
        next.dock[dockIdx] = { ...item, page: -1 };
      } else {
        next.dock.push({ ...item, page: -1 });
      }
      next.pages[itemPage].splice(itemIdx, 1);
      return next;
    });
  }, []);

  const mergeToFolder = useCallback((sourceId: string, targetId: string) => {
    setData((prev) => {
      const next = structuredClone(prev);
      let source: DesktopItem | null = null;
      let target: DesktopItem | null = null;
      let sourcePage = -1;
      let sourceIdx = -1;
      let targetPage = -1;
      let targetIdx = -1;
      for (let p = 0; p < next.pages.length; p++) {
        const si = next.pages[p].findIndex((it) => it.id === sourceId);
        if (si >= 0) {
          source = next.pages[p][si];
          sourcePage = p;
          sourceIdx = si;
        }
        const ti = next.pages[p].findIndex((it) => it.id === targetId);
        if (ti >= 0) {
          target = next.pages[p][ti];
          targetPage = p;
          targetIdx = ti;
        }
      }
      if (!source || !target || source.type === 'system' || target.type === 'system') return prev;
      // 如果 target 已是文件夹
      if (target.type === 'folder' && target.children) {
        if (target.children.length >= MAX_FOLDER_APPS) return prev;
        target.children.push(source);
        next.pages[sourcePage].splice(sourceIdx, 1);
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
      next.pages[sourcePage].splice(sourceIdx, 1);
      return next;
    });
  }, []);

  const renameFolder = useCallback((folderId: string, name: string) => {
    setData((prev) => {
      const next = structuredClone(prev);
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
      const next = structuredClone(prev);
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
          // 先在当前页 p 找空位
          for (let r = 0; r < MAX_ROWS && !placed; r++) {
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
              for (let r = 0; r < MAX_ROWS; r++) {
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
      const next = structuredClone(prev);
      if (next.pages.length < 20) next.pages.push([]);
      return next;
    });
  }, []);

  const addToDock = useCallback((item: DesktopItem) => {
    setData((prev) => {
      const next = structuredClone(prev);
      if (next.dock.length < 4) {
        next.dock.push({ ...item, page: -1 });
      }
      return next;
    });
  }, []);

  const removeFromDock = useCallback((id: string) => {
    setData((prev) => {
      const next = structuredClone(prev);
      next.dock = next.dock.filter((it) => it.id !== id);
      return next;
    });
  }, []);

  const importData = useCallback((newData: DesktopData) => {
    setData(newData);
    setCurrentPage(0);
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
        moveDockToDesktop,
        moveDesktopToDock,
        mergeToFolder,
        renameFolder,
        dissolveFolder,
        addPage,
        addToDock,
        removeFromDock,
        importData,
      }}
    >
      {children}
    </DesktopContext.Provider>
  );
};

export { MAX_ROWS, MAX_COLS, MAX_FOLDER_APPS };
export type { IconColor, ItemType };