import { changeBookmarks, emptyBookmarks, type BookmarkAction } from '@/lib/bookmarks';
import { toast } from 'sonner';
import { persistDesktopChanges, readDesktopStorage, shareUnchangedPages } from '@/lib/desktopPersistence';
// @refresh reset
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useViewportGeometry } from '@/hooks/use-viewport-geometry';
import { CURRENT_DESKTOP_VERSION, parseDesktopData } from '@/lib/desktopSchema';
import { HistoryBuffer } from '@/lib/historyBuffer';
import { pruneIconCaches } from '@/lib/iconCache';
import {
  canPlaceItem,
  clampPageForGridChange,
  compactDesktopPages,
  compactPrivacyPages,
  findItemCoveringCell,
  findFirstAvailablePrivacySlot,
  findFirstAvailableSlot,
  findFirstAvailableSlotAcrossPages,
  folderContainsSystemItem,
  getPrivacyPageCount,
  isFolderChildCandidate,
  LAYOUT_LIMITS,
  minimumRowsForEnabledWidgets,
  moveDesktopItem,
  resizeWeatherWidget,
  movePrivacyItem,
  normalizeDesktopColumnCount,
  reflowPrivacyItems,
  reorderFolderChildren as reorderFolderChildrenLayout,
  resolvePageAfterCompaction,
  resolvePrivacyPageAfterCompaction,
  setDesktopWidgetEnabled,
  transferDesktopToPrivacy,
  transferPrivacyToDesktop,
  updateDesktopFolderLayout,
  updatePrivacyFolderLayout,
  validateDesktopLayout,
} from '@/lib/layoutEngine';
import {
  fitDesktopPositions,
  getLandscapeColumns,
  groupDesktopPositions,
  normalizeOrientationSettings,
  normalizePortraitData,
  projectLandscape,
  projectLandscapeItems,
  resizeDesktopGrid,
  saveLandscape,
  saveLandscapeItems,
  savePortraitItems,
} from '@/lib/orientationLayout';
import { encryptItems, LEGACY_PBKDF2_ITERATIONS } from '@/lib/privacyCrypto';
import {
  dissolvePrivacyFolder,
  mergePrivacyItemsToFolder,
  movePrivacyFolderChild,
} from '@/lib/privacyWorkspace';
import { loadDesktopData, loadPrivacyVault, loadSettings, savePrivacyVault, saveSettings } from '@/lib/storage';
import { deepClone } from '@/lib/utils/deepClone';
import { IDB_VIDEO_MARKER, loadVideoDB } from '@/lib/videoStorage';
import { IDB_WALLPAPER_MARKER, loadWallpaperDB } from '@/lib/wallpaperStorage';
import { getWidgetConfig } from '@/lib/widgetConfig';
import type {
  DesktopColumnCount,
  DesktopData,
  DesktopItem,
  DesktopSettings,
  FolderLayout,
  IconColor,
  ItemType,
  WidgetType,
} from '@/types';

const MAX_ROWS = LAYOUT_LIMITS.maxRows;
const MAX_COLS = LAYOUT_LIMITS.maxCols;
const MAX_FOLDER_APPS = LAYOUT_LIMITS.maxFolderApps;

interface DesktopContextType {
  data: DesktopData;
  savedData: DesktopData;
  persistedData: DesktopData | null;
  flushDesktopSave: () => Promise<boolean>;
  viewport: ReturnType<typeof useViewportGeometry>;
  gridCols: DesktopColumnCount;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  // 外观设置
  settings: DesktopSettings;
  updateSettings: (patch: Partial<DesktopSettings>) => void;
  // 添加应用（preferPage：优先放置到指定页面）
  updateBookmarks: (action: BookmarkAction) => boolean;
  addItem: (item: Omit<DesktopItem, 'id' | 'page' | 'row' | 'col'>, preferPage?: number) => boolean;
  setWidgetEnabled: (widgetType: WidgetType, enabled: boolean) => boolean;
  setWeatherSize: (id: string, size: 'small' | 'large') => boolean;
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
  setFolderLayout: (folderId: string, layout: FolderLayout) => boolean;
  dissolveFolder: (folderId: string) => void;
  importData: (
    data: unknown,
    options?: { recordHistory?: boolean; settings?: DesktopSettings },
  ) => boolean;
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
  cols: DesktopColumnCount;
  landscapeCols?: DesktopColumnCount;
  rows: number;
}

function dataForHistory(data: DesktopData): DesktopData {
  const {
    privacyVault: _privacyVault,
    privacyItems: _privacyItems,
    pinHash: _pinHash,
    ...desktop
  } = data;
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
  const viewport = useViewportGeometry();
  const isLandscape = viewport.isLandscape;
  const [settings, setSettings] = useState(() => normalizeOrientationSettings(loadSettings()));
  const lastDesktopStorageRef = useRef<string | null>(null);
  const [savedData, setSavedData] = useState<DesktopData>(() => {
    lastDesktopStorageRef.current = readDesktopStorage();
    return compactDesktopPages(loadDesktopData()).data;
  });
  const [persistedData, setPersistedData] = useState<DesktopData | null>(savedData);
  const [saveAttempt, retrySave] = useState(0);
  const [savedPrivacyItems, setSavedPrivacyItems] = useState<DesktopItem[]>([]);
  const [pages, setPages] = useState<{ portrait: number; landscape?: number }>({ portrait: 0 });
  const currentPage = isLandscape ? pages.landscape ?? pages.portrait : pages.portrait;
  const [editMode, setEditMode] = useState(false);
  const gridCols = isLandscape ? getLandscapeColumns(settings) : settings.cols;
  const data = useMemo(() => isLandscape
    ? projectLandscape(savedData, settings.cols, gridCols, settings.rows)
    : savedData, [gridCols, isLandscape, savedData, settings.cols, settings.rows]);
  const privacyPageItems = useMemo(() => isLandscape
    ? projectLandscapeItems(savedPrivacyItems, settings.cols, gridCols, settings.rows, true)
    : savedPrivacyItems, [gridCols, isLandscape, savedPrivacyItems, settings.cols, settings.rows]);
  // 解锁状态：会话内保持，刷新或手动锁定后为 false。
  const [privacyUnlocked, setPrivacyUnlocked] = useState(false);
  // 解锁后的 AES-256-GCM 密钥（内存态，刷新自动清除）
  const [privacyCryptoKey, setPrivacyCryptoKey] = useState<{
    key: CryptoKey;
    salt: Uint8Array;
    iterations: number;
  } | null>(null);
  const [privacyRevision, setPrivacyRevision] = useState(0);
  const lastSavedDataRef = useRef(savedData);
  const savedDataRef = useRef(savedData);
  const savedPrivacyItemsRef = useRef(savedPrivacyItems);
  const isLandscapeRef = useRef(isLandscape);
  const gridColsRef = useRef(gridCols);
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
  dataRef.current = data;
  privacyPageItemsRef.current = privacyPageItems;
  settingsRef.current = settings;
  privacyCryptoKeyRef.current = privacyCryptoKey;
  isLandscapeRef.current = isLandscape;
  gridColsRef.current = gridCols;

  const setCurrentPage = useCallback((value: React.SetStateAction<number>) => {
    const landscape = isLandscapeRef.current;
    setPages((previous) => {
      if (landscape) {
        const landscape = typeof value === 'function' ? value(previous.landscape ?? previous.portrait) : value;
        return previous.landscape === landscape ? previous : { ...previous, landscape };
      }
      const portrait = typeof value === 'function' ? value(previous.portrait) : value;
      return previous.portrait === portrait ? previous : { ...previous, portrait };
    });
  }, []);

  useLayoutEffect(() => {
    setCurrentPage((page) => clampPageForGridChange(
      page,
      dataRef.current.pages.length,
      getPrivacyPageCount(privacyPageItemsRef.current),
    ));
  }, [isLandscape, setCurrentPage]);

  const captureHistoryState = useCallback((): DesktopHistoryState => ({
    data: dataForHistory(savedDataRef.current),
    cols: settingsRef.current.cols,
    landscapeCols: settingsRef.current.landscapeCols,
    rows: settingsRef.current.rows,
  }), []);

  const applySavedData = useCallback((next: DesktopData, nextSettings = settingsRef.current) => {
    const shared = shareUnchangedPages(savedDataRef.current, next);
    savedDataRef.current = shared;
    dataRef.current = isLandscapeRef.current
      ? projectLandscape(shared, nextSettings.cols, getLandscapeColumns(nextSettings), nextSettings.rows)
      : shared;
    setSavedData(shared);
    setPersistedData(null);
    return shared;
  }, []);

  const applySavedPrivacyItems = useCallback((next: DesktopItem[], nextSettings = settingsRef.current) => {
    savedPrivacyItemsRef.current = next;
    privacyPageItemsRef.current = isLandscapeRef.current
      ? projectLandscapeItems(next, nextSettings.cols, getLandscapeColumns(nextSettings), nextSettings.rows, true)
      : next;
    setSavedPrivacyItems(next);
  }, []);

  const applySettings = useCallback((next: DesktopSettings) => {
    settingsRef.current = next;
    gridColsRef.current = isLandscapeRef.current ? getLandscapeColumns(next) : next.cols;
    setSettings(next);
    saveSettings(next);
  }, []);

  const commitLayouts = useCallback((
    nextData: DesktopData | null,
    nextPrivacy: DesktopItem[] | null,
    history: 'record' | 'clear' | 'skip' = 'record',
    nextSettings = settingsRef.current,
  ): boolean => {
    const desktop = nextData && compactDesktopPages(nextData);
    const privacy = nextPrivacy && compactPrivacyPages(nextPrivacy);
    const landscape = isLandscapeRef.current;
    const { cols, rows } = nextSettings;
    const landscapeCols = getLandscapeColumns(nextSettings);
    const savedDesktop = desktop && (landscape
      ? saveLandscape(savedDataRef.current, desktop.data, cols, landscapeCols, rows)
      : groupDesktopPositions(desktop.data, savePortraitItems(
        savedDataRef.current.pages.flat(), desktop.data.pages.flat(),
      )));
    const savedPrivacy = privacy && (landscape
      ? saveLandscapeItems(savedPrivacyItemsRef.current, privacy.items, cols, landscapeCols, rows, true)
      : savePortraitItems(savedPrivacyItemsRef.current, privacy.items));
    // Validate both workspaces before committing a move across the privacy boundary.
    if ((desktop && !savedDesktop) || (privacy && !savedPrivacy)) return false;

    if (history === 'clear') historyRef.current.clear();
    if (desktop && savedDesktop) {
      if (history === 'record') historyRef.current.record(captureHistoryState());
      applySavedData(savedDesktop, nextSettings);
      setCurrentPage((page) => resolvePageAfterCompaction(page, desktop.pageMap, desktop.data.pages.length));
    }
    if (privacy && savedPrivacy) {
      applySavedPrivacyItems(savedPrivacy, nextSettings);
      setCurrentPage((page) => resolvePrivacyPageAfterCompaction(
        page, privacy.pageMap, getPrivacyPageCount(privacy.items),
      ));
    }
    return true;
  }, [applySavedData, applySavedPrivacyItems, captureHistoryState, setCurrentPage]);

  const commitDesktopData = useCallback((next: DesktopData): boolean => {
    if (next === dataRef.current) return false;
    return commitLayouts(next, null);
  }, [commitLayouts]);

  const commitPrivacyItems = useCallback((next: DesktopItem[]): boolean => (
    commitLayouts(null, next, 'skip')
  ), [commitLayouts]);

  const updateBookmarks = useCallback((action: BookmarkAction) => {
    const previous = savedDataRef.current.bookmarks;
    const bookmarks = changeBookmarks(previous, action);
    if (JSON.stringify(previous ?? emptyBookmarks()) === JSON.stringify(bookmarks)) return false;
    historyRef.current.record(captureHistoryState());
    applySavedData({ ...savedDataRef.current, bookmarks });
    return true;
  }, [applySavedData, captureHistoryState]);

  const applyHistoryState = useCallback((state: DesktopHistoryState) => {
    const { cols: previousCols, rows: previousRows } = settingsRef.current;
    const nextData = compactDesktopPages(state.data).data;
    const nextSettings: DesktopSettings = {
      ...settingsRef.current,
      cols: state.cols,
      landscapeCols: state.landscapeCols,
      rows: state.rows,
    };
    const privacy = fitDesktopPositions(savedPrivacyItemsRef.current, nextSettings.cols, nextSettings.rows, true);
    if (!privacy) return false;
    applySettings(nextSettings);
    applySavedData(nextData, nextSettings);
    if (privacyUnlocked && (state.cols !== previousCols || state.rows !== previousRows)) {
      applySavedPrivacyItems(privacy, nextSettings);
    }
    setCurrentPage((page) => clampPageForGridChange(
      page, dataRef.current.pages.length, getPrivacyPageCount(privacyPageItemsRef.current),
    ));
    return true;
  }, [applySavedData, applySavedPrivacyItems, applySettings, privacyUnlocked, setCurrentPage]);

  const undo = useCallback(() => {
    const previous = historyRef.current.undo(captureHistoryState());
    if (!previous) return false;
    if (applyHistoryState(previous)) return true;
    historyRef.current.redo(previous);
    toast.error('空间不足');
    return false;
  }, [applyHistoryState, captureHistoryState]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(captureHistoryState());
    if (!next) return false;
    if (applyHistoryState(next)) return true;
    historyRef.current.undo(next);
    toast.error('空间不足');
    return false;
  }, [applyHistoryState, captureHistoryState]);

  useLayoutEffect(() => {
    const current = settingsRef.current;
    const cols = current.cols;
    const minRows = minimumRowsForEnabledWidgets(savedDataRef.current);
    const rows = Math.min(LAYOUT_LIMITS.maxRows, Math.max(minRows, current.rows ?? 8));
    const nextSettings = rows === current.rows ? current : { ...current, rows };
    if (nextSettings !== current) applySettings(nextSettings);
    if (validateDesktopLayout(savedDataRef.current, { cols, rows }).length > 0) {
      const normalized = normalizePortraitData(savedDataRef.current, cols, rows);
      if (normalized) applySavedData(normalized, nextSettings);
    }
  }, [applySavedData, applySettings]);

  // 启动时：若视频壁纸存储在 IndexedDB，恢复 blob URL
  useEffect(() => {
    const s = normalizeOrientationSettings(loadSettings());
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

  const flushDesktopSave = useCallback(async (): Promise<boolean> => {
    const persist = () => {
      const draft = savedDataRef.current;
      if (lastSavedDataRef.current === draft) return true;
      const result = persistDesktopChanges(
        lastSavedDataRef.current, lastDesktopStorageRef.current, draft, settingsRef.current,
      );
      if (result.status !== 'saved') {
        toast.error(result.status === 'conflict'
          ? '另一个标签页已修改同一数据，本机改动仍保留在此页'
          : '桌面保存失败，本机改动仍保留在此页', {
          id: 'desktop-save-error',
          duration: Infinity,
          action: { label: '重试保存', onClick: () => retrySave((attempt) => attempt + 1) },
        });
        return false;
      }
      toast.dismiss('desktop-save-error');
      lastDesktopStorageRef.current = result.raw;
      const committed = result.data === draft ? draft : applySavedData(result.data);
      lastSavedDataRef.current = committed;
      setPersistedData(committed);
      if (committed !== draft) {
        historyRef.current.clear();
        setCurrentPage((page) => clampPageForGridChange(
          page, dataRef.current.pages.length, getPrivacyPageCount(privacyPageItemsRef.current),
        ));
      }
      return true;
    };
    if (!navigator.locks) return persist();
    return navigator.locks.request('minimal-desktop-local-save', persist).catch(persist);
  }, [applySavedData, setCurrentPage]);

  useEffect(() => {
    void flushDesktopSave();
  }, [flushDesktopSave, saveAttempt, savedData]);

  useEffect(() => {
    if (persistedData) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (lastSavedDataRef.current === savedDataRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [persistedData]);

  // 隐私页持久化（加密保存，仅在密钥可用时执行）
  // 同时依赖 privacyCryptoKey state，确保密钥清空后立即停止写入，不存在竞态
  useEffect(() => {
    if (!privacyCryptoKey) return; // 未解锁 / 已重置 → 不写 vault
    const writeSeq = ++privacyWriteSeqRef.current;
    const { key, salt, iterations } = privacyCryptoKey;
    const snapshot = deepClone(savedPrivacyItems);
    encryptItems(snapshot, key, salt, iterations).then((vault) => {
      // 慢的旧加密任务完成时不得覆盖更新的数据。
      if (writeSeq !== privacyWriteSeqRef.current) return;
      if (!savePrivacyVault(vault)) throw new Error('隐私桌面保存失败');
      setPrivacyRevision((revision) => revision + 1);
    }).catch(() => {
      if (writeSeq === privacyWriteSeqRef.current) toast.error('隐私桌面保存失败，请释放存储空间后重试');
    });
  }, [savedPrivacyItems, privacyCryptoKey]);

  const addItem = useCallback((
    item: Omit<DesktopItem, 'id' | 'page' | 'row' | 'col'>,
    preferPage?: number,
  ) => {
    const gridCols = gridColsRef.current;
    const gridRows = settingsRef.current.rows;
    const draft = { ...item, id: uid(), page: 0, row: 0, col: 0 } as DesktopItem;

    // 添加到隐私桌面；当前负页已满时自动创建更靠左的新页。
    if (preferPage !== undefined && preferPage < 0) {
      if (draft.type !== 'app' && draft.type !== 'folder') return false;
      const slot = findFirstAvailablePrivacySlot(
        privacyPageItemsRef.current,
        draft,
        gridCols,
        gridRows,
        preferPage,
      );
      if (!slot) return false;
      const nextPrivacy = [
        ...privacyPageItemsRef.current.map((candidate) => ({ ...candidate })),
        { ...draft, page: slot.page, row: slot.row, col: slot.col },
      ];
      if (!commitPrivacyItems(nextPrivacy)) return false;
      const inserted = privacyPageItemsRef.current.find((candidate) => candidate.id === draft.id);
      if (inserted) setCurrentPage(inserted.page);
      return true;
    }

    const next = deepClone(dataRef.current);
    let slot = findFirstAvailableSlotAcrossPages(next.pages, draft, gridCols, gridRows, preferPage);
    if (!slot && next.pages.length < LAYOUT_LIMITS.maxPages) {
      const page = next.pages.length;
      next.pages.push([]);
      const position = findFirstAvailableSlot(next.pages[page], draft, gridCols, gridRows);
      if (position) slot = { page, ...position };
    }
    if (!slot) return false;
    next.pages[slot.page].push({ ...draft, page: slot.page, row: slot.row, col: slot.col });
    if (!commitDesktopData(next)) return false;
    setCurrentPage(slot.page);
    return true;
  }, [commitPrivacyItems, commitDesktopData, setCurrentPage]);

  const setWidgetEnabled = useCallback((widgetType: WidgetType, enabled: boolean): boolean => {
    const cols = gridColsRef.current;
    const currentRows = settingsRef.current.rows ?? 8;
    const rows = Math.min(
      LAYOUT_LIMITS.maxRows,
      Math.max(currentRows, getWidgetConfig(widgetType).rowSpan),
    );
    const result = setDesktopWidgetEnabled(dataRef.current, widgetType, enabled, cols, rows);
    if (!result.ok) return false;

    if (result.data !== dataRef.current) {
      const nextSettings = { ...settingsRef.current, rows };
      if (!commitLayouts(result.data, null, 'record', nextSettings)) return false;
      if (rows !== currentRows) applySettings(nextSettings);
    }
    if (enabled && result.widgetPage !== undefined) setCurrentPage(result.widgetPage);
    return true;
  }, [applySettings, commitLayouts, setCurrentPage]);

  const setWeatherSize = useCallback((id: string, size: 'small' | 'large') => {
    const result = resizeWeatherWidget(dataRef.current, id, size,
      gridColsRef.current, settingsRef.current.rows ?? 8);
    if (!result.ok) return false;
    if (result.data !== dataRef.current && !commitDesktopData(result.data)) return false;
    const page = result.data.pages.findIndex((items) => items.some((item) => item.id === id));
    if (page >= 0) setCurrentPage(page);
    return true;
  }, [commitDesktopData, setCurrentPage]);

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
      commitPrivacyItems(nextPrivacy);
      return;
    }
    for (const candidate of nextPrivacy) {
      const childIndex = candidate.children?.findIndex((child) => child.id === id) ?? -1;
      if (childIndex < 0 || !candidate.children) continue;
      candidate.children[childIndex] = { ...candidate.children[childIndex], ...patch };
      commitPrivacyItems(nextPrivacy);
      return;
    }
  }, [commitPrivacyItems, commitDesktopData]);

  const removeItem = useCallback((id: string) => {
    const protectedSystemItem = dataRef.current.pages.some((page) => page.some((item) => (
      (item.id === id && folderContainsSystemItem(item))
      || item.children?.some((child) => child.id === id && child.type === 'system')
    )));
    if (protectedSystemItem) return;
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
      commitPrivacyItems(nextPrivacy);
      return;
    }
    for (const candidate of nextPrivacy) {
      if (candidate.type !== 'folder' || !candidate.children) continue;
      const childIndex = candidate.children.findIndex((child) => child.id === id);
      if (childIndex < 0) continue;
      candidate.children.splice(childIndex, 1);
      collapsePrivacyFolderAfterChildRemoval(nextPrivacy, candidate.id);
      commitPrivacyItems(nextPrivacy);
      return;
    }
  }, [commitPrivacyItems, commitDesktopData]);

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
        gridColsRef.current, settingsRef.current.rows ?? 8,
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
      gridColsRef.current, settingsRef.current.rows,
    );
    if (!result.ok) return false;
    // 原位放回是成功的无变化操作；调用层不应把它误报为空间冲突。
    if (result.data === dataRef.current) return true;
    return commitDesktopData(result.data);
  }, [commitDesktopData]);

  const moveFromFolderToDesktop = useCallback((folderId: string, childId: string, page: number, row: number, col: number) => {
    const nextData = deepClone(dataRef.current);
    const nextPrivacy = deepClone(privacyPageItemsRef.current);
    const rows = settingsRef.current.rows ?? 8;
    const cols = gridColsRef.current;
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
    const child = folder.children[childIndex];
    const targetIsPrivacy = page < 0;
    if (sourceIsPrivacy !== targetIsPrivacy && child.type === 'system') return false;

    if (targetIsPrivacy) {
      const pageCount = getPrivacyPageCount(nextPrivacy);
      if (page < -LAYOUT_LIMITS.maxPages || page < -(pageCount + 1)) return false;
    } else {
      if (page === nextData.pages.length && nextData.pages.length < LAYOUT_LIMITS.maxPages) {
        nextData.pages.push([]);
      }
      if (!nextData.pages[page]) return false;
    }

    // 跨隐私边界时目标必须为空，避免一次操作同时搬运无关项目。
    if (sourceIsPrivacy !== targetIsPrivacy) {
      const destinationItems = targetIsPrivacy
        ? nextPrivacy.filter((item) => item.page === page)
        : nextData.pages[page];
      if (!canPlaceItem(destinationItems, child, row, col, cols, rows)) return false;
      folder.children.splice(childIndex, 1);
      if (sourceIsPrivacy) {
        collapsePrivacyFolderAfterChildRemoval(nextPrivacy, folderId);
        nextData.pages[page].push({ ...child, page, row, col });
      } else {
        collapseFolderAfterChildRemoval(nextData.pages, normalFolderPage, folderId);
        nextPrivacy.push({ ...child, page, row, col });
      }
      return commitLayouts(nextData, nextPrivacy, 'clear');
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
      return commitPrivacyItems(result.items);
    }

    const target = findItemCoveringCell(nextData.pages[page], row, col, cols);
    if (target?.type === 'widget' || target?.id === folderId) return false;
    if (target?.type === 'folder' && (
      !target.children || target.children.length >= MAX_FOLDER_APPS
    )) return false;
    if (target && target.type !== 'folder' && !isFolderChildCandidate(target)) return false;
    if (!target && !canPlaceItem(nextData.pages[page], child, row, col, cols, rows)) return false;

    folder.children.splice(childIndex, 1);
    if (target) {
      if (target.type === 'folder') {
        target.children!.push({ ...child, page: target.page, row: target.row, col: target.col });
        collapseFolderAfterChildRemoval(nextData.pages, normalFolderPage, folderId);
        return commitDesktopData(nextData);
      }
      folder.children.push({
        ...target,
        page: folder.page,
        row: folder.row,
        col: folder.col,
      });
      const targetIndex = nextData.pages[page].findIndex((item) => item.id === target.id);
      nextData.pages[page].splice(targetIndex, 1);
    }
    nextData.pages[page].push({ ...child, page, row, col });
    collapseFolderAfterChildRemoval(nextData.pages, normalFolderPage, folderId);
    return commitDesktopData(nextData);
  }, [
    commitLayouts,
    commitPrivacyItems,
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
      return commitPrivacyItems(nextPrivacy);
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
    if (
      !folder
      || folder.type !== 'folder'
      || !folder.children
      || !item
      || !isFolderChildCandidate(item)
    ) return false;
    if (folder.children.length >= MAX_FOLDER_APPS) return false;
    folder.children.push({ ...item, page: folder.page, row: folder.row, col: folder.col });
    next.pages[itemPage].splice(itemIdx, 1);
    return commitDesktopData(next);
  }, [commitPrivacyItems, commitDesktopData]);

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
    commitPrivacyItems(nextPrivacy);
  }, [commitPrivacyItems, commitDesktopData]);

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
        return commitPrivacyItems(result.items);
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
      if (!isFolderChildCandidate(source)) return false;
      if (target.type !== 'folder' && !isFolderChildCandidate(target)) return false;
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
        return commitDesktopData(next);
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
        folderLayout: '1x1',
        children: [target, source].map((child) => ({
          ...child,
          page: targetPage,
          row: target.row,
          col: target.col,
        })),
      };
      next.pages[targetPage][targetIdx] = folder;
      if (!sourceFolderId) {
        next.pages[sourcePage].splice(sourceIdx, 1);
      } else {
        collapseFolderAfterChildRemoval(next.pages, sourceFolderPage, sourceFolderId);
      }
      return commitDesktopData(next);
  }, [commitPrivacyItems, commitDesktopData]);

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
    commitPrivacyItems(nextPrivacy);
  }, [commitPrivacyItems, commitDesktopData]);

  const setFolderLayout = useCallback((folderId: string, layout: FolderLayout): boolean => {
    const isDesktopFolder = dataRef.current.pages.some((page) => (
      page.some((item) => item.id === folderId && item.type === 'folder')
    ));
    const cols = gridColsRef.current;
    const rows = settingsRef.current.rows ?? 8;
    if (isDesktopFolder) {
      const result = updateDesktopFolderLayout(dataRef.current, folderId, layout, cols, rows);
      if (!result.ok) return false;
      return result.data === dataRef.current || commitDesktopData(result.data);
    }

    const result = updatePrivacyFolderLayout(
      privacyPageItemsRef.current,
      folderId,
      layout,
      cols,
      rows,
    );
    if (!result.ok) return false;
    return result.privacyItems === privacyPageItemsRef.current || commitPrivacyItems(result.privacyItems);
  }, [commitPrivacyItems, commitDesktopData]);

  const dissolveFolder = useCallback((folderId: string) => {
    const next = deepClone(dataRef.current);
    const folderPage = next.pages.findIndex((page) => page.some((item) => item.id === folderId));
    if (folderPage < 0) {
      const result = dissolvePrivacyFolder(
        privacyPageItemsRef.current,
        folderId,
        gridColsRef.current,
        settingsRef.current.rows ?? 8,
      );
      if (!result.ok) return;
      commitPrivacyItems(result.items);
      return;
    }
    const folderIndex = next.pages[folderPage].findIndex((item) => item.id === folderId);
    const folder = next.pages[folderPage][folderIndex];
    if (folder.type !== 'folder') return;
    const children = folder.children ?? [];
    next.pages[folderPage].splice(folderIndex, 1);
    const cols = gridColsRef.current;
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
  }, [commitPrivacyItems, commitDesktopData]);

  const importData = useCallback((
    newData: unknown,
    options: { recordHistory?: boolean; settings?: DesktopSettings } = {},
  ) => {
    const parsed = parseDesktopData(newData);
    if (!parsed.ok) return false;
    try {
      const requestedSettings = normalizeOrientationSettings(options.settings ?? settingsRef.current);
      const minRows = minimumRowsForEnabledWidgets(parsed.data);
      const rows = Math.min(LAYOUT_LIMITS.maxRows, Math.max(minRows, Math.round(requestedSettings.rows ?? 8)));
      const nextSettings = { ...requestedSettings, rows };
      const next = normalizePortraitData(
        { ...parsed.data, version: CURRENT_DESKTOP_VERSION }, nextSettings.cols, rows,
      );
      if (!next) return false;
      if (options.recordHistory ?? true) historyRef.current.record(captureHistoryState());
      else historyRef.current.clear();
      if (options.settings || rows !== settingsRef.current.rows) applySettings(nextSettings);
      applySavedData(next, nextSettings);
      setCurrentPage(0);
      return true;
    } catch {
      return false;
    }
  }, [applySavedData, applySettings, captureHistoryState, setCurrentPage]);

  /**
   * 恢复云端数据后调用：清除内存中的密钥和明文隐私数据。
   * 防止 privacyPageItems effect 用旧密钥重新加密空数据，覆盖刚恢复的 vault。
   */
  const resetPrivacyLock = useCallback(() => {
    privacyEpochRef.current += 1;
    privacyWriteSeqRef.current += 1;
    privacyCryptoKeyRef.current = null;
    setPrivacyCryptoKey(null);
    applySavedPrivacyItems([]);
    setPrivacyUnlocked(false);
    setCurrentPage((page) => page < 0 ? -1 : page);
  }, [applySavedPrivacyItems, setCurrentPage]);

  const lockPrivacy = useCallback((): Promise<void> => {
    if (privacyLockPromiseRef.current) return privacyLockPromiseRef.current;
    const cryptoState = privacyCryptoKeyRef.current;
    if (!cryptoState) {
      applySavedPrivacyItems([]);
      setPrivacyUnlocked(false);
      setCurrentPage((page) => page < 0 ? -1 : page);
      return Promise.resolve();
    }
    const epoch = privacyEpochRef.current;
    const snapshot = deepClone(savedPrivacyItemsRef.current);
    const lockToken = {};
    privacyLockTokenRef.current = lockToken;
    const task = (async () => {
      try {
        const vault = await encryptItems(
          snapshot, cryptoState.key, cryptoState.salt, cryptoState.iterations,
        );
        // 云端恢复/reset 或新的解锁会推进 epoch；旧锁定任务不得覆盖它们。
        if (epoch !== privacyEpochRef.current || privacyCryptoKeyRef.current !== cryptoState) return;
        if (!savePrivacyVault(vault)) throw new Error('隐私桌面保存失败');
        setPrivacyRevision((revision) => revision + 1);
        privacyWriteSeqRef.current += 1;
        privacyCryptoKeyRef.current = null;
        applySavedPrivacyItems([]);
        setPrivacyCryptoKey(null);
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
  }, [applySavedPrivacyItems, setCurrentPage]);

  /** 解锁隐私桌面后注入解密数据和内存密钥 */
  const setPrivacyUnlockData = useCallback((items: DesktopItem[], key: CryptoKey) => {
    const vault = loadPrivacyVault();
    const salt = vault ? Uint8Array.from(atob(vault.salt), (c) => c.charCodeAt(0)) : new Uint8Array(16);
    const iterations = vault?.iterations ?? LEGACY_PBKDF2_ITERATIONS;
    privacyEpochRef.current += 1;
    const compacted = compactPrivacyPages(deepClone(items)).items;
    const { cols, rows } = settingsRef.current;
    const normalized = fitDesktopPositions(compacted, cols, rows, true)
      ?? reflowPrivacyItems(compacted, cols, rows);
    const cryptoState = { key, salt, iterations };
    privacyCryptoKeyRef.current = cryptoState;
    setPrivacyCryptoKey(cryptoState);
    applySavedPrivacyItems(normalized);
    setPrivacyUnlocked(true);
  }, [applySavedPrivacyItems]);

  /** 将普通桌面图标移入隐私页 */
  const moveItemToPrivacy = useCallback((id: string, page: number, row: number, col: number) => {
    const result = transferDesktopToPrivacy(
      dataRef.current, privacyPageItemsRef.current, id, page, row, col,
      gridColsRef.current, settingsRef.current.rows ?? 8,
    );
    if (!result.ok) return false;
    // 隐私数据不进入普通桌面历史；跨边界移动后清空历史，避免撤销造成数据复制。
    return commitLayouts(result.data, result.privacyItems, 'clear');
  }, [commitLayouts]);

  /** 隐私页内部图标重新排列（拖拽换位） */
  const reorderPrivacyItems = useCallback((id: string, page: number, row: number, col: number) => {
    const result = movePrivacyItem(
      privacyPageItemsRef.current,
      id,
      page,
      row,
      col,
      gridColsRef.current,
      settingsRef.current.rows ?? 8,
    );
    if (!result.ok) return false;
    return commitPrivacyItems(result.privacyItems);
  }, [commitPrivacyItems]);

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
      gridColsRef.current, settingsRef.current.rows ?? 8,
    );
    if (!result.ok) return false;
    return commitLayouts(result.data, result.privacyItems, 'clear');
  }, [commitLayouts]);

  const updateSettings = useCallback((patch: Partial<DesktopSettings>) => {
    const previous = settingsRef.current;
    const requested = { ...previous, ...patch };
    const cols = normalizeDesktopColumnCount(requested.cols);
    const minRows = minimumRowsForEnabledWidgets(savedDataRef.current);
    const rows = Math.min(LAYOUT_LIMITS.maxRows, Math.max(minRows, Math.round(requested.rows ?? 8)));
    const nextSettings: DesktopSettings = { ...requested, cols, rows };
    const portraitGridChanged = cols !== previous.cols || rows !== previous.rows;
    const landscapeGridChanged = getLandscapeColumns(nextSettings) !== getLandscapeColumns(previous);
    if (portraitGridChanged || landscapeGridChanged) {
      const next = resizeDesktopGrid(savedDataRef.current, previous, nextSettings);
      const privacy = portraitGridChanged && privacyUnlocked
        ? fitDesktopPositions(savedPrivacyItemsRef.current, cols, rows, true)
        : savedPrivacyItemsRef.current;
      if (!next || !privacy) return;
      historyRef.current.record(captureHistoryState());
      if (next !== savedDataRef.current) applySavedData(next, nextSettings);
      if (privacy !== savedPrivacyItemsRef.current) applySavedPrivacyItems(privacy, nextSettings);
    }
    applySettings(nextSettings);
    if (portraitGridChanged || landscapeGridChanged) {
      const landscape = isLandscapeRef.current;
      const landscapeCols = getLandscapeColumns(nextSettings);
      const desktop = landscape ? projectLandscape(savedDataRef.current, cols, landscapeCols, rows) : savedDataRef.current;
      const privacy = landscape
        ? projectLandscapeItems(savedPrivacyItemsRef.current, cols, landscapeCols, rows, true)
        : savedPrivacyItemsRef.current;
      setCurrentPage((page) => clampPageForGridChange(
        page, desktop.pages.length, getPrivacyPageCount(privacy),
      ));
    }
  }, [applySavedData, applySavedPrivacyItems, applySettings, captureHistoryState, privacyUnlocked, setCurrentPage]);

  return (
    <DesktopContext.Provider
      value={{
        data,
        savedData,
        persistedData,
        flushDesktopSave,
        viewport,
        gridCols,
        currentPage,
        setCurrentPage,
        editMode,
        setEditMode,
        settings,
        updateSettings,
        addItem,
        updateBookmarks,
        setWidgetEnabled,
        setWeatherSize,
        updateItem,
        removeItem,
        swapDesktopItems,
        moveItemTo,
        moveFromFolderToDesktop,
        moveDesktopToFolder,
        reorderFolderChildren,
        mergeToFolder,
        renameFolder,
        setFolderLayout,
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
