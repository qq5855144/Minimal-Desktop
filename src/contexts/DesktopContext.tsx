// @refresh reset
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CURRENT_DESKTOP_VERSION, parseDesktopData } from '@/lib/desktopSchema';
import { HistoryBuffer } from '@/lib/historyBuffer';
import { pruneIconCaches } from '@/lib/iconCache';
import {
  compactDesktopPages,
  compactPrivacyPages,
  findFirstAvailablePrivacySlot,
  findFirstAvailableSlot,
  findFirstAvailableSlotAcrossPages,
  getPrivacyPageCount,
  LAYOUT_LIMITS,
  minimumRowsForEnabledWidgets,
  moveDesktopItem,
  movePrivacyItem,
  reflowDesktopData,
  reflowPrivacyItems,
  reorderFolderChildren as reorderFolderChildrenLayout,
  resolvePageAfterCompaction,
  resolvePrivacyPageAfterCompaction,
  transferDesktopToPrivacy,
  transferPrivacyToDesktop,
  validateDesktopLayout,
} from '@/lib/layoutEngine';
import { encryptItems, LEGACY_PBKDF2_ITERATIONS } from '@/lib/privacyCrypto';
import {
  dissolvePrivacyFolder,
  mergePrivacyItemsToFolder,
  movePrivacyFolderChild,
} from '@/lib/privacyWorkspace';
import { loadDesktopData, loadPrivacyVault, loadSettings, saveDesktopData, savePrivacyVault, saveSettings } from '@/lib/storage';
import { deepClone } from '@/lib/utils/deepClone';
import { IDB_VIDEO_MARKER, loadVideoDB } from '@/lib/videoStorage';
import { IDB_WALLPAPER_MARKER, loadWallpaperDB } from '@/lib/wallpaperStorage';
import { isRowCoveredByWidget } from '@/lib/widgetConfig';
import type { DesktopData, DesktopItem, DesktopSettings, IconColor, ItemType } from '@/types';

const MAX_ROWS = LAYOUT_LIMITS.maxRows;
const MAX_COLS = LAYOUT_LIMITS.maxCols;
const MAX_FOLDER_APPS = LAYOUT_LIMITS.maxFolderApps;

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
  moveItemTo: (id: string, fromPage: number, toPage: number, row: number, col: number) => boolean;
  // 拖拽：从文件夹移到桌面
  moveFromFolderToDesktop: (folderId: string, childId: string, page: number, row: number, col: number) => boolean;
  // 拖拽：从桌面移到文件夹
  moveDesktopToFolder: (itemId: string, folderId: string) => boolean;
  // 拖拽：文件夹内排序
  reorderFolderChildren: (folderId: string, fromIdx: number, toIdx: number) => void;
  // 拖拽：移动到隐私页
  moveItemToPrivacy: (id: string, page: number, row: number, col: number) => boolean;
  // 拖拽：从隐私页移到普通页
  movePrivacyToPage: (id: string, toPage: number, row: number, col: number) => boolean;
  reorderPrivacyItems: (id: string, page: number, row: number, col: number) => boolean;
  privacyPageItems: DesktopItem[];
  privacyPageCount: number;
  /** 隐私桌面当前是否处于解锁状态（会话内保持，刷新/手动锁定后为 false） */
  privacyUnlocked: boolean;
  /** 每次加密 vault 成功落盘后递增，供自动同步捕获纯隐私数据变化。 */
  privacyRevision: number;
  setPrivacyUnlockData: (items: DesktopItem[], key: CryptoKey) => void;
  mergeToFolder: (sourceId: string, targetId: string, sourceFolderId?: string) => boolean;
  renameFolder: (folderId: string, name: string) => void;
  dissolveFolder: (folderId: string) => void;
  importData: (data: unknown, options?: { recordHistory?: boolean }) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  /** 恢复云端数据后重置隐私解锁状态（防止旧密钥 effect 覆盖还原的 vault） */
  resetPrivacyLock: () => void;
  /** 正常锁定：先把最新明文加密落盘，再清除内存密钥与明文。 */
  lockPrivacy: () => Promise<void>;
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

interface DesktopHistoryState {
  data: DesktopData;
  cols: 4 | 5;
  rows: number;
}

function dataForHistory(data: DesktopData): DesktopData {
  const {
    privacyVault: _privacyVault,
    privacyItems: _privacyItems,
    pinHash: _pinHash,
    ...desktop
  } = deepClone(data);
  return desktop;
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

function collapsePrivacyFolderAfterChildRemoval(
  items: DesktopItem[],
  folderId: string,
): void {
  const folderIndex = items.findIndex((item) => item.id === folderId);
  if (folderIndex < 0) return;
  const folder = items[folderIndex];
  if (folder.type !== 'folder' || !folder.children) return;
  if (folder.children.length === 0) {
    items.splice(folderIndex, 1);
    return;
  }
  if (folder.children.length === 1) {
    items[folderIndex] = {
      ...folder.children[0],
      page: folder.page,
      row: folder.row,
      col: folder.col,
    };
  }
}

export const DesktopProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<DesktopData>(() => compactDesktopPages(loadDesktopData()).data);
  const [currentPage, setCurrentPage] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<DesktopSettings>(() => loadSettings());
  // 加密架构下，隐私数据在解锁时由 PrivacyScreen 解密注入，初始为空
  const [privacyPageItems, setPrivacyPageItems] = useState<DesktopItem[]>([]);
  // 解锁状态：会话内保持（切换普通页不重置），刷新/重载或手动锁定后为 false
  const [privacyUnlocked, setPrivacyUnlocked] = useState(false);
  // 解锁后的 AES-256-GCM 密钥（内存态，刷新自动清除）
  const [privacyCryptoKey, setPrivacyCryptoKey] = useState<{
    key: CryptoKey;
    salt: Uint8Array;
    iterations: number;
  } | null>(null);
  const [privacyRevision, setPrivacyRevision] = useState(0);
  const firstRender = useRef(true);
  const dataRef = useRef<DesktopData>(data);
  const privacyPageItemsRef = useRef<DesktopItem[]>(privacyPageItems);
  const settingsRef = useRef<DesktopSettings>(settings);
  const privacyCryptoKeyRef = useRef(privacyCryptoKey);
  const privacyWriteSeqRef = useRef(0);
  const privacyEpochRef = useRef(0);
  const privacyLockPromiseRef = useRef<Promise<void> | null>(null);
  const privacyLockTokenRef = useRef<object | null>(null);
  const historyRef = useRef(new HistoryBuffer<DesktopHistoryState>(50));
  const privacyPageCount = getPrivacyPageCount(privacyPageItems);
  // render 阶段同步 ref，使同一事件循环里的连续命令也读取到最近一次 state。
  dataRef.current = data;
  privacyPageItemsRef.current = privacyPageItems;
  settingsRef.current = settings;
  privacyCryptoKeyRef.current = privacyCryptoKey;

  const captureHistoryState = useCallback((): DesktopHistoryState => ({
    data: dataForHistory(dataRef.current),
    cols: settingsRef.current.cols === 5 ? 5 : 4,
    rows: settingsRef.current.rows ?? 8,
  }), []);

  const applyCompactedDesktopData = useCallback((next: DesktopData): DesktopData => {
    const compacted = compactDesktopPages(next);
    dataRef.current = compacted.data;
    setData(compacted.data);
    setCurrentPage((page) => resolvePageAfterCompaction(
      page,
      compacted.pageMap,
      compacted.data.pages.length,
    ));
    return compacted.data;
  }, []);

  const applyCompactedPrivacyItems = useCallback((next: DesktopItem[]): DesktopItem[] => {
    const compacted = compactPrivacyPages(next);
    const pageCount = getPrivacyPageCount(compacted.items);
    privacyPageItemsRef.current = compacted.items;
    setPrivacyPageItems(compacted.items);
    setCurrentPage((page) => resolvePrivacyPageAfterCompaction(
      page,
      compacted.pageMap,
      pageCount,
    ));
    return compacted.items;
  }, []);

  const commitDesktopData = useCallback((next: DesktopData, recordHistory = true): boolean => {
    if (next === dataRef.current) return false;
    if (recordHistory) historyRef.current.record(captureHistoryState());
    else historyRef.current.clear();
    applyCompactedDesktopData(next);
    return true;
  }, [applyCompactedDesktopData, captureHistoryState]);

  const applyHistoryState = useCallback((state: DesktopHistoryState) => {
    const nextData = compactDesktopPages(dataForHistory(state.data)).data;
    const nextSettings: DesktopSettings = {
      ...settingsRef.current,
      cols: state.cols,
      rows: state.rows,
    };
    dataRef.current = nextData;
    settingsRef.current = nextSettings;
    setData(nextData);
    setSettings(nextSettings);
    saveSettings(nextSettings);
    setCurrentPage((page) => Math.min(page, Math.max(0, nextData.pages.length - 1)));
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.undo(captureHistoryState());
    if (!previous) return false;
    applyHistoryState(previous);
    return true;
  }, [applyHistoryState, captureHistoryState]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(captureHistoryState());
    if (!next) return false;
    applyHistoryState(next);
    return true;
  }, [applyHistoryState, captureHistoryState]);

  const clearDesktopHistory = useCallback(() => {
    historyRef.current.clear();
  }, []);

  const initialLayoutNormalizedRef = useRef(false);
  useEffect(() => {
    if (initialLayoutNormalizedRef.current) return;
    initialLayoutNormalizedRef.current = true;
    const minRows = minimumRowsForEnabledWidgets(dataRef.current);
    const safeRows = Math.min(LAYOUT_LIMITS.maxRows, Math.max(minRows, settingsRef.current.rows ?? 8));
    const safeCols = Math.min(
      LAYOUT_LIMITS.maxCols,
      Math.max(LAYOUT_LIMITS.minCols, settingsRef.current.cols ?? 4),
    ) as 4 | 5;
    const safeSettings: DesktopSettings = { ...settingsRef.current, rows: safeRows, cols: safeCols };
    if (safeRows !== settingsRef.current.rows || safeCols !== settingsRef.current.cols) {
      settingsRef.current = safeSettings;
      setSettings(safeSettings);
      saveSettings(safeSettings);
    }
    if (validateDesktopLayout(dataRef.current, safeSettings).length > 0) {
      try {
        const normalized = reflowDesktopData(dataRef.current, safeCols, safeRows);
        dataRef.current = normalized;
        setData(normalized);
      } catch {
        // 极端损坏数据保持原状，后续导入/设置操作仍会拒绝不合法写入。
      }
    }
  }, []);

  // 启动时：若视频壁纸存储在 IndexedDB，恢复 blob URL
  useEffect(() => {
    const s = loadSettings();
    let cancelled = false;
    const restoredUrls = new Set<string>();
    if (s.bgType === 'video' && s.bgVideo === IDB_VIDEO_MARKER) {
      loadVideoDB().then((file) => {
        if (file) {
          const url = URL.createObjectURL(file);
          if (cancelled) { URL.revokeObjectURL(url); return; }
          restoredUrls.add(url);
          setSettings((prev) => ({ ...prev, bgVideo: url }));
        } else if (!cancelled) {
          setSettings((prev) => ({ ...prev, bgVideo: undefined, bgType: 'default' }));
          saveSettings({ ...s, bgVideo: undefined, bgType: 'default' });
        }
      });
    }
    if (s.bgType === 'image' && s.bgImage === IDB_WALLPAPER_MARKER) {
      loadWallpaperDB().then((file) => {
        if (file) {
          const url = URL.createObjectURL(file);
          if (cancelled) { URL.revokeObjectURL(url); return; }
          restoredUrls.add(url);
          setSettings((prev) => ({ ...prev, bgImage: url }));
        } else if (!cancelled) {
          setSettings((prev) => ({ ...prev, bgImage: undefined, bgType: 'default' }));
          saveSettings({ ...s, bgImage: undefined, bgType: 'default' });
        }
      });
    }
    return () => {
      cancelled = true;
      restoredUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // data 变更时持久化（跳过首次挂载）
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    saveDesktopData(data);
  }, [data]);

  // 隐私页持久化（加密保存，仅在密钥可用时执行）
  // 同时依赖 privacyCryptoKey state，确保密钥清空后立即停止写入，不存在竞态
  useEffect(() => {
    if (!privacyCryptoKey) return; // 未解锁 / 已重置 → 不写 vault
    const writeSeq = ++privacyWriteSeqRef.current;
    const { key, salt, iterations } = privacyCryptoKey;
    const snapshot = deepClone(privacyPageItems);
    encryptItems(snapshot, key, salt, iterations).then((vault) => {
      // 慢的旧加密任务完成时不得覆盖更新的数据。
      if (writeSeq !== privacyWriteSeqRef.current) return;
      savePrivacyVault(vault);
      setPrivacyRevision((revision) => revision + 1);
    }).catch(() => {/* 静默失败 */});
  }, [privacyPageItems, privacyCryptoKey]);

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
    const gridRows = settings.rows ?? 8;
    const draft = { ...item, id: uid(), page: 0, row: 0, col: 0 } as DesktopItem;

    // 添加到隐私桌面；当前负页已满时自动创建更靠左的新页。
    if (preferPage !== undefined && preferPage < 0) {
      if (draft.type !== 'app' && draft.type !== 'folder') return;
      const slot = findFirstAvailablePrivacySlot(
        privacyPageItemsRef.current,
        draft,
        gridCols,
        gridRows,
        preferPage,
      );
      if (!slot) return;
      const nextPrivacy = [
        ...privacyPageItemsRef.current.map((candidate) => ({ ...candidate })),
        { ...draft, page: slot.page, row: slot.row, col: slot.col },
      ];
      const compacted = applyCompactedPrivacyItems(nextPrivacy);
      const inserted = compacted.find((candidate) => candidate.id === draft.id);
      if (inserted) setCurrentPage(inserted.page);
      return;
    }

    const next = deepClone(dataRef.current);
    let slot = findFirstAvailableSlotAcrossPages(next.pages, draft, gridCols, gridRows, preferPage);
    if (!slot && next.pages.length < LAYOUT_LIMITS.maxPages) {
      const page = next.pages.length;
      next.pages.push([]);
      const position = findFirstAvailableSlot(next.pages[page], draft, gridCols, gridRows);
      if (position) slot = { page, ...position };
    }
    if (!slot) return;
    next.pages[slot.page].push({ ...draft, page: slot.page, row: slot.row, col: slot.col });
    commitDesktopData(next);
    setCurrentPage(slot.page);
  }, [applyCompactedPrivacyItems, commitDesktopData, settings.cols, settings.rows]);

  const updateItem = useCallback((id: string, patch: Partial<DesktopItem>) => {
    const next = deepClone(dataRef.current);
    for (const page of next.pages) {
      const idx = page.findIndex((it) => it.id === id);
      if (idx >= 0) {
        page[idx] = { ...page[idx], ...patch };
        commitDesktopData(next);
        return;
      }
      for (const candidate of page) {
        const childIndex = candidate.children?.findIndex((child) => child.id === id) ?? -1;
        if (childIndex >= 0 && candidate.children) {
          candidate.children[childIndex] = { ...candidate.children[childIndex], ...patch };
          commitDesktopData(next);
          return;
        }
      }
    }
    const nextPrivacy = deepClone(privacyPageItemsRef.current);
    const privacyIndex = nextPrivacy.findIndex((candidate) => candidate.id === id);
    if (privacyIndex >= 0) {
      nextPrivacy[privacyIndex] = { ...nextPrivacy[privacyIndex], ...patch };
      applyCompactedPrivacyItems(nextPrivacy);
      return;
    }
    for (const candidate of nextPrivacy) {
      const childIndex = candidate.children?.findIndex((child) => child.id === id) ?? -1;
      if (childIndex < 0 || !candidate.children) continue;
      candidate.children[childIndex] = { ...candidate.children[childIndex], ...patch };
      applyCompactedPrivacyItems(nextPrivacy);
      return;
    }
  }, [applyCompactedPrivacyItems, commitDesktopData]);

  const removeItem = useCallback((id: string) => {
    const next = deepClone(dataRef.current);
    for (let p = 0; p < next.pages.length; p++) {
      const idx = next.pages[p].findIndex((it) => it.id === id);
      if (idx >= 0) {
        next.pages[p].splice(idx, 1);
        commitDesktopData(next);
        setTimeout(() => pruneIconCaches(collectIconUrls(next)), 0);
        return;
      }
      for (const item of next.pages[p]) {
        if (item.type !== 'folder' || !item.children) continue;
        const childIndex = item.children.findIndex((child) => child.id === id);
        if (childIndex < 0) continue;
        item.children.splice(childIndex, 1);
        if (item.children.length <= 1) {
          const child = item.children[0];
          if (child) next.pages[p].push({ ...child, page: item.page, row: item.row, col: item.col });
          const folderIndex = next.pages[p].findIndex((candidate) => candidate.id === item.id);
          if (folderIndex >= 0) next.pages[p].splice(folderIndex, 1);
        }
        commitDesktopData(next);
        setTimeout(() => pruneIconCaches(collectIconUrls(next)), 0);
        return;
      }
    }
    const nextPrivacy = deepClone(privacyPageItemsRef.current);
    const privacyIndex = nextPrivacy.findIndex((candidate) => candidate.id === id);
    if (privacyIndex >= 0) {
      nextPrivacy.splice(privacyIndex, 1);
      applyCompactedPrivacyItems(nextPrivacy);
      return;
    }
    for (const candidate of nextPrivacy) {
      if (candidate.type !== 'folder' || !candidate.children) continue;
      const childIndex = candidate.children.findIndex((child) => child.id === id);
      if (childIndex < 0) continue;
      candidate.children.splice(childIndex, 1);
      collapsePrivacyFolderAfterChildRemoval(nextPrivacy, candidate.id);
      applyCompactedPrivacyItems(nextPrivacy);
      return;
    }
  }, [applyCompactedPrivacyItems, commitDesktopData]);

  const swapDesktopItems = useCallback(
    (
      _idA: string,
      _pageA: number,
      _rowA: number,
      _colA: string,
      _idB: string,
      _pageB: number,
      _rowB: number,
      colB: string,
    ) => {
      const cb = Number.parseInt(colB, 10);
      const expectedTarget = dataRef.current.pages[_pageB]?.find((item) => (
        item.id === _idB && item.row === _rowB && item.col === cb
      ));
      if (!expectedTarget) return;
      const result = moveDesktopItem(
        dataRef.current, _idA, _pageA, _pageB, _rowB, cb,
        settingsRef.current.cols ?? 4, settingsRef.current.rows ?? 8,
      );
      if (!result.ok || result.data === dataRef.current) return;
      commitDesktopData(result.data);
    },
    [commitDesktopData],
  );

  const moveItemTo = useCallback((id: string, fromPage: number, toPage: number, row: number, col: number) => {
    let sourceData = dataRef.current;
    if (toPage === sourceData.pages.length) {
      if (sourceData.pages.length >= LAYOUT_LIMITS.maxPages) return false;
      sourceData = deepClone(sourceData);
      sourceData.pages.push([]);
    }
    const result = moveDesktopItem(
      sourceData, id, fromPage, toPage, row, col,
      settings.cols ?? 4, settings.rows ?? 8,
    );
    if (!result.ok || result.data === dataRef.current) return false;
    return commitDesktopData(result.data);
  }, [commitDesktopData, settings.cols, settings.rows]);

  const moveFromFolderToDesktop = useCallback((folderId: string, childId: string, page: number, row: number, col: number) => {
    const nextData = deepClone(dataRef.current);
    const nextPrivacy = deepClone(privacyPageItemsRef.current);
    const rows = settingsRef.current.rows ?? 8;
    const cols = settingsRef.current.cols ?? 4;
    if (!Number.isInteger(row) || row < 0 || row >= rows
      || !Number.isInteger(col) || col < 0 || col >= cols) return false;

    let normalFolder: DesktopItem | null = null;
    let normalFolderPage = -1;
    for (let candidatePage = 0; candidatePage < nextData.pages.length; candidatePage++) {
      const folder = nextData.pages[candidatePage].find((item) => item.id === folderId);
      if (folder) {
        normalFolder = folder;
        normalFolderPage = candidatePage;
        break;
      }
    }
    const privacyFolder = nextPrivacy.find((item) => item.id === folderId) ?? null;
    const sourceIsPrivacy = privacyFolder !== null;
    const folder = privacyFolder ?? normalFolder;
    if (!folder?.children) return false;
    const childIndex = folder.children.findIndex((child) => child.id === childId);
    if (childIndex < 0) return false;
    const targetIsPrivacy = page < 0;

    if (targetIsPrivacy) {
      const pageCount = getPrivacyPageCount(nextPrivacy);
      if (page < -LAYOUT_LIMITS.maxPages || page < -(pageCount + 1)) return false;
    } else {
      if (page === nextData.pages.length && nextData.pages.length < LAYOUT_LIMITS.maxPages) {
        nextData.pages.push([]);
      }
      if (!nextData.pages[page] || isRowCoveredByWidget(nextData.pages[page], row)) return false;
    }

    // 跨隐私边界时目标必须为空，避免一次操作同时搬运无关项目。
    if (sourceIsPrivacy !== targetIsPrivacy) {
      const occupied = targetIsPrivacy
        ? nextPrivacy.some((item) => item.page === page && item.row === row && item.col === col)
        : nextData.pages[page].some((item) => item.row === row && item.col === col);
      if (occupied) return false;
      const [child] = folder.children.splice(childIndex, 1);
      clearDesktopHistory();
      if (sourceIsPrivacy) {
        collapsePrivacyFolderAfterChildRemoval(nextPrivacy, folderId);
        nextData.pages[page].push({ ...child, page, row, col });
      } else {
        collapseFolderAfterChildRemoval(nextData.pages, normalFolderPage, folderId);
        nextPrivacy.push({ ...child, page, row, col });
      }
      applyCompactedDesktopData(nextData);
      applyCompactedPrivacyItems(nextPrivacy);
      return true;
    }

    if (sourceIsPrivacy) {
      const result = movePrivacyFolderChild(
        privacyPageItemsRef.current,
        folderId,
        childId,
        page,
        row,
        col,
        cols,
        rows,
      );
      if (!result.ok) return false;
      applyCompactedPrivacyItems(result.items);
      return true;
    }

    const [child] = folder.children.splice(childIndex, 1);
    const targetIndex = nextData.pages[page].findIndex((item) => item.row === row && item.col === col);
    if (targetIndex >= 0) {
      const target = nextData.pages[page][targetIndex];
      if (target.type === 'widget' || target.type === 'system' || target.id === folderId) return false;
      if (target.type === 'folder') {
        if (!target.children || target.children.length >= MAX_FOLDER_APPS) return false;
        target.children.push({ ...child, page, row, col });
        collapseFolderAfterChildRemoval(nextData.pages, normalFolderPage, folderId);
        return commitDesktopData(nextData);
      }
      folder.children.push({
        ...target,
        page: folder.page,
        row: folder.row,
        col: folder.col,
      });
      nextData.pages[page].splice(targetIndex, 1);
    }
    nextData.pages[page].push({ ...child, page, row, col });
    collapseFolderAfterChildRemoval(nextData.pages, normalFolderPage, folderId);
    return commitDesktopData(nextData);
  }, [
    applyCompactedDesktopData,
    applyCompactedPrivacyItems,
    clearDesktopHistory,
    commitDesktopData,
  ]);

  const moveDesktopToFolder = useCallback((itemId: string, folderId: string): boolean => {
    const nextPrivacy = deepClone(privacyPageItemsRef.current);
    const privacyFolder = nextPrivacy.find((candidate) => candidate.id === folderId);
    const privacyItemIndex = nextPrivacy.findIndex((candidate) => candidate.id === itemId);
    const privacyItem = privacyItemIndex >= 0 ? nextPrivacy[privacyItemIndex] : null;
    if (privacyFolder || privacyItem) {
      if (
        !privacyFolder
        || privacyFolder.type !== 'folder'
        || !privacyFolder.children
        || !privacyItem
        || privacyItem.type !== 'app'
        || privacyFolder.children.length >= MAX_FOLDER_APPS
      ) return false;
      privacyFolder.children.push({
        ...privacyItem,
        page: privacyFolder.page,
        row: privacyFolder.row,
        col: privacyFolder.col,
      });
      nextPrivacy.splice(privacyItemIndex, 1);
      applyCompactedPrivacyItems(nextPrivacy);
      return true;
    }

    const next = deepClone(dataRef.current);
    let folder: DesktopItem | null = null;
    let item: DesktopItem | null = null;
    let itemPage = -1;
    let itemIdx = -1;
    for (let p = 0; p < next.pages.length; p++) {
      const folderIndex = next.pages[p].findIndex((candidate) => candidate.id === folderId);
      if (folderIndex >= 0) folder = next.pages[p][folderIndex];
      const sourceIndex = next.pages[p].findIndex((candidate) => candidate.id === itemId);
      if (sourceIndex >= 0) {
        item = next.pages[p][sourceIndex];
        itemPage = p;
        itemIdx = sourceIndex;
      }
    }
    if (!folder || folder.type !== 'folder' || !folder.children || !item || item.type !== 'app') return false;
    if (folder.children.length >= MAX_FOLDER_APPS) return false;
    folder.children.push({ ...item, page: folder.page, row: folder.row, col: folder.col });
    next.pages[itemPage].splice(itemIdx, 1);
    commitDesktopData(next);
    return true;
  }, [applyCompactedPrivacyItems, commitDesktopData]);

  const reorderFolderChildren = useCallback((folderId: string, fromIdx: number, toIdx: number) => {
    const next = deepClone(dataRef.current);
    for (const page of next.pages) {
      const folder = page.find((it) => it.id === folderId);
      if (folder?.children) {
        const reordered = reorderFolderChildrenLayout(folder.children, fromIdx, toIdx);
        if (!reordered) return;
        folder.children = reordered;
        commitDesktopData(next);
        return;
      }
    }
    const nextPrivacy = deepClone(privacyPageItemsRef.current);
    const folder = nextPrivacy.find((item) => item.id === folderId);
    if (!folder?.children) return;
    const reordered = reorderFolderChildrenLayout(folder.children, fromIdx, toIdx);
    if (!reordered) return;
    folder.children = reordered;
    applyCompactedPrivacyItems(nextPrivacy);
  }, [applyCompactedPrivacyItems, commitDesktopData]);

  const mergeToFolder = useCallback((sourceId: string, targetId: string, sourceFolderId?: string): boolean => {
      const privacyTargetIndex = privacyPageItemsRef.current.findIndex((item) => item.id === targetId);
      if (privacyTargetIndex >= 0) {
        const result = mergePrivacyItemsToFolder(
          privacyPageItemsRef.current,
          sourceId,
          targetId,
          uid,
          sourceFolderId,
        );
        if (!result.ok) return false;
        applyCompactedPrivacyItems(result.items);
        return true;
      }

      const next = deepClone(dataRef.current);
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
      if (!source || !target) return false;
      if (source.type !== 'app') return false;
      if (target.type === 'system' || target.type === 'widget') return false;
      if (sourceFolderId && target.id === sourceFolderId) return false;

      if (sourceFolder && sourceChildIdx >= 0) {
        source = sourceFolder.children!.splice(sourceChildIdx, 1)[0];
      }
      // 如果 target 已是文件夹
      if (target.type === 'folder' && target.children) {
        if (target.children.length >= MAX_FOLDER_APPS) {
          return false;
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
        commitDesktopData(next);
        return true;
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
      commitDesktopData(next);
      return true;
  }, [applyCompactedPrivacyItems, commitDesktopData]);

  const renameFolder = useCallback((folderId: string, name: string) => {
    const next = deepClone(dataRef.current);
    for (const page of next.pages) {
      const folder = page.find((it) => it.id === folderId);
      if (folder) {
        if (folder.name === name) return;
        folder.name = name;
        commitDesktopData(next);
        return;
      }
    }
    const nextPrivacy = deepClone(privacyPageItemsRef.current);
    const folder = nextPrivacy.find((item) => item.id === folderId);
    if (!folder || folder.type !== 'folder' || folder.name === name) return;
    folder.name = name;
    applyCompactedPrivacyItems(nextPrivacy);
  }, [applyCompactedPrivacyItems, commitDesktopData]);

  const dissolveFolder = useCallback((folderId: string) => {
    const next = deepClone(dataRef.current);
    const folderPage = next.pages.findIndex((page) => page.some((item) => item.id === folderId));
    if (folderPage < 0) {
      const result = dissolvePrivacyFolder(
        privacyPageItemsRef.current,
        folderId,
        settingsRef.current.cols ?? 4,
        settingsRef.current.rows ?? 8,
      );
      if (!result.ok) return;
      applyCompactedPrivacyItems(result.items);
      return;
    }
    const folderIndex = next.pages[folderPage].findIndex((item) => item.id === folderId);
    const folder = next.pages[folderPage][folderIndex];
    if (folder.type !== 'folder') return;
    const children = folder.children ?? [];
    next.pages[folderPage].splice(folderIndex, 1);
    const cols = settingsRef.current.cols ?? 4;
    const rows = settingsRef.current.rows ?? 8;
    for (const child of children) {
      let slot = findFirstAvailableSlotAcrossPages(next.pages, child, cols, rows, folderPage);
      if (!slot && next.pages.length < LAYOUT_LIMITS.maxPages) {
        const page = next.pages.length;
        next.pages.push([]);
        const position = findFirstAvailableSlot(next.pages[page], child, cols, rows);
        if (position) slot = { page, ...position };
      }
      if (!slot) return; // 整个操作不提交，避免解散时丢失子应用。
      next.pages[slot.page].push({ ...child, page: slot.page, row: slot.row, col: slot.col });
    }
    commitDesktopData(next);
  }, [applyCompactedPrivacyItems, commitDesktopData]);

  const importData = useCallback((newData: unknown, options: { recordHistory?: boolean } = {}) => {
    const parsed = parseDesktopData(newData);
    if (!parsed.ok) return false;
    try {
      const next = reflowDesktopData(
        { ...parsed.data, version: CURRENT_DESKTOP_VERSION },
        settingsRef.current.cols ?? 4,
        settingsRef.current.rows ?? 8,
      );
      commitDesktopData(next, options.recordHistory ?? true);
      setCurrentPage(0);
      return true;
    } catch {
      return false;
    }
  }, [commitDesktopData]);

  /**
   * 恢复云端数据后调用：清除内存中的密钥和明文隐私数据。
   * 防止 privacyPageItems effect 用旧密钥重新加密空数据，覆盖刚恢复的 vault。
   */
  const resetPrivacyLock = useCallback(() => {
    privacyEpochRef.current += 1;
    privacyWriteSeqRef.current += 1;
    privacyCryptoKeyRef.current = null;
    setPrivacyCryptoKey(null);
    privacyPageItemsRef.current = [];
    setPrivacyPageItems([]);
    setPrivacyUnlocked(false);
    setCurrentPage((page) => page < 0 ? -1 : page);
  }, []);

  const lockPrivacy = useCallback((): Promise<void> => {
    if (privacyLockPromiseRef.current) return privacyLockPromiseRef.current;
    const cryptoState = privacyCryptoKeyRef.current;
    if (!cryptoState) {
      privacyPageItemsRef.current = [];
      setPrivacyPageItems([]);
      setPrivacyUnlocked(false);
      setCurrentPage((page) => page < 0 ? -1 : page);
      return Promise.resolve();
    }
    const epoch = privacyEpochRef.current;
    const snapshot = deepClone(privacyPageItemsRef.current);
    const lockToken = {};
    privacyLockTokenRef.current = lockToken;
    const task = (async () => {
      try {
        const vault = await encryptItems(
          snapshot, cryptoState.key, cryptoState.salt, cryptoState.iterations,
        );
        // 云端恢复/reset 或新的解锁会推进 epoch；旧锁定任务不得覆盖它们。
        if (epoch !== privacyEpochRef.current || privacyCryptoKeyRef.current !== cryptoState) return;
        savePrivacyVault(vault);
        setPrivacyRevision((revision) => revision + 1);
        privacyWriteSeqRef.current += 1;
        privacyCryptoKeyRef.current = null;
        privacyPageItemsRef.current = [];
        setPrivacyCryptoKey(null);
        setPrivacyPageItems([]);
        setPrivacyUnlocked(false);
        setCurrentPage((page) => page < 0 ? -1 : page);
      } finally {
        if (privacyLockTokenRef.current === lockToken) {
          privacyLockPromiseRef.current = null;
          privacyLockTokenRef.current = null;
        }
      }
    })();
    privacyLockPromiseRef.current = task;
    return task;
  }, []);

  /** 解锁隐私桌面后注入解密数据和内存密钥 */
  const setPrivacyUnlockData = useCallback((items: DesktopItem[], key: CryptoKey) => {
    const vault = loadPrivacyVault();
    const salt = vault ? Uint8Array.from(atob(vault.salt), (c) => c.charCodeAt(0)) : new Uint8Array(16);
    const iterations = vault?.iterations ?? LEGACY_PBKDF2_ITERATIONS;
    privacyEpochRef.current += 1;
    const normalized = reflowPrivacyItems(
      compactPrivacyPages(deepClone(items)).items,
      settingsRef.current.cols ?? 4,
      settingsRef.current.rows ?? 8,
    );
    privacyPageItemsRef.current = normalized;
    privacyCryptoKeyRef.current = { key, salt, iterations };
    setPrivacyCryptoKey({ key, salt, iterations });
    setPrivacyPageItems(normalized);
    setPrivacyUnlocked(true);
  }, []);

  /** 将普通桌面图标移入隐私页 */
  const moveItemToPrivacy = useCallback((id: string, page: number, row: number, col: number) => {
    const result = transferDesktopToPrivacy(
      dataRef.current, privacyPageItemsRef.current, id, page, row, col,
      settingsRef.current.cols ?? 4, settingsRef.current.rows ?? 8,
    );
    if (!result.ok) return false;
    // 隐私数据不进入普通桌面历史；跨边界移动后清空历史，避免撤销造成数据复制。
    clearDesktopHistory();
    applyCompactedDesktopData(result.data);
    applyCompactedPrivacyItems(result.privacyItems);
    return true;
  }, [applyCompactedDesktopData, applyCompactedPrivacyItems, clearDesktopHistory]);

  /** 隐私页内部图标重新排列（拖拽换位） */
  const reorderPrivacyItems = useCallback((id: string, page: number, row: number, col: number) => {
    const result = movePrivacyItem(
      privacyPageItemsRef.current,
      id,
      page,
      row,
      col,
      settingsRef.current.cols ?? 4,
      settingsRef.current.rows ?? 8,
    );
    if (!result.ok) return false;
    applyCompactedPrivacyItems(result.privacyItems);
    return true;
  }, [applyCompactedPrivacyItems]);

  /** 将隐私页图标移回普通桌面指定页 */
  const movePrivacyToPage = useCallback((id: string, toPage: number, row: number, col: number) => {
    let targetData = dataRef.current;
    if (toPage === targetData.pages.length) {
      if (targetData.pages.length >= LAYOUT_LIMITS.maxPages) return false;
      targetData = deepClone(targetData);
      targetData.pages.push([]);
    }
    const result = transferPrivacyToDesktop(
      targetData, privacyPageItemsRef.current, id, toPage, row, col,
      settingsRef.current.cols ?? 4, settingsRef.current.rows ?? 8,
    );
    if (!result.ok) return false;
    clearDesktopHistory();
    applyCompactedDesktopData(result.data);
    applyCompactedPrivacyItems(result.privacyItems);
    return true;
  }, [applyCompactedDesktopData, applyCompactedPrivacyItems, clearDesktopHistory]);

  const updateSettings = useCallback((patch: Partial<DesktopSettings>) => {
    const prev = settingsRef.current;
    const requested = { ...prev, ...patch };
    const cols = Math.min(LAYOUT_LIMITS.maxCols, Math.max(LAYOUT_LIMITS.minCols, requested.cols ?? 4)) as 4 | 5;
    const minRows = minimumRowsForEnabledWidgets(dataRef.current);
    const rows = Math.min(LAYOUT_LIMITS.maxRows, Math.max(minRows, Math.round(requested.rows ?? 8)));
    const next: DesktopSettings = { ...requested, cols, rows };
    const gridChanged = cols !== prev.cols || rows !== prev.rows;
    if (gridChanged) {
      try {
        const reflowed = reflowDesktopData(dataRef.current, cols, rows);
        const reflowedPrivacy = privacyUnlocked
          ? reflowPrivacyItems(privacyPageItemsRef.current, cols, rows)
          : null;
        commitDesktopData(reflowed);
        if (reflowedPrivacy) applyCompactedPrivacyItems(reflowedPrivacy);
        setCurrentPage(0);
      } catch {
        return;
      }
    }
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, [applyCompactedPrivacyItems, commitDesktopData, privacyUnlocked]);

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
        importData,
        undo,
        redo,
        resetPrivacyLock,
        lockPrivacy,
        moveItemToPrivacy,
        movePrivacyToPage,
        reorderPrivacyItems,
        privacyPageItems,
        privacyPageCount,
        privacyUnlocked,
        privacyRevision,
        setPrivacyUnlockData,
      }}
    >
      {children}
    </DesktopContext.Provider>
  );
};

export { MAX_ROWS, MAX_COLS, MAX_FOLDER_APPS };
export type { IconColor, ItemType };
