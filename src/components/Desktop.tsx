import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MAX_FOLDER_APPS, useDesktop } from '@/contexts/DesktopContext';
import { useDragMotion } from '@/hooks/use-drag-motion';
import { useViewportGeometry } from '@/hooks/use-viewport-geometry';
import {
  AUTO_SYNC_DELAY_MS,
  AUTO_SYNC_REQUEST_EVENT,
  AutoSyncScheduler,
} from '@/lib/autoSyncScheduler';
import { isNoopGridDrop, resolveCenteredGridDropPosition } from '@/lib/gridDrop';
import {
  getDesktopGridLayoutMetrics,
  getExpandedFolderLayoutMetrics,
  getIconLayoutMetrics,
  getLargeFolderLayoutMetrics,
} from '@/lib/iconLayout';
import {
  canPlaceItem,
  folderContainsSystemItem,
  getItemGridSpan,
  getPrivacyPageNumbers,
  LAYOUT_LIMITS,
  resolveResponsiveColumnState,
} from '@/lib/layoutEngine';
import {
  getPageTrackIndex,
  resolveDragEdgeTarget,
  resolvePageSwipeTarget,
  resolveSwipeAxis,
  type SwipeAxis,
  shouldCommitPageSwipe,
} from '@/lib/pageNavigation';
import { loadSyncConfig, SYNC_CONFIG_CHANGED_EVENT, updateSyncConfig } from '@/lib/storage';
import { uploadSyncSnapshot } from '@/lib/syncCoordinator';
import { buildSyncSnapshot } from '@/lib/syncSnapshot';
import { IDB_VIDEO_MARKER } from '@/lib/videoStorage';
import { getRenderableWallpaperSource } from '@/lib/wallpaperStorage';
import {
  getWidgetBottomClearancePx,
  getWidgetLayoutMetrics,
  resolveGridRowAtY,
} from '@/lib/widgetLayout';
import type { BgOverlayScheme, DesktopItem, DragSource } from '@/types';
import AppIcon from './AppIcon';
import type { ContextMenuPosition } from './ContextMenu';
import SkeletonIcon from './SkeletonIcon';
import WidgetGridCell from './WidgetGridCell';
import { getWidgetComponent } from './widgetRenderer';

const FolderView = React.lazy(() => import('./FolderView'));
const AddEditDialog = React.lazy(() => import('./AddEditDialog'));
const SettingsView = React.lazy(() => import('./SettingsView'));
const SyncView = React.lazy(() => import('./SyncView'));
const ContextMenu = React.lazy(() => import('./ContextMenu'));
const PrivacyScreen = React.lazy(() => import('./PrivacyScreen'));

function getOverlayGradient(scheme: BgOverlayScheme): string {
  switch (scheme) {
    case 'sunset':
      return 'linear-gradient(180deg, rgba(140,60,30,0.45) 0%, rgba(120,40,80,0.38) 45%, rgba(60,40,120,0.35) 100%)';
    case 'forest':
      return 'linear-gradient(180deg, rgba(20,60,50,0.48) 0%, rgba(40,90,60,0.38) 45%, rgba(30,80,100,0.35) 100%)';
    case 'midnight':
      return 'linear-gradient(180deg, rgba(10,25,60,0.55) 0%, rgba(20,40,90,0.45) 45%, rgba(10,20,50,0.40) 100%)';
    case 'warm':
      return 'linear-gradient(180deg, rgba(120,80,20,0.45) 0%, rgba(140,90,30,0.38) 45%, rgba(80,50,30,0.35) 100%)';
    default:
      return 'linear-gradient(180deg, rgba(60,40,120,0.45) 0%, rgba(30,70,140,0.38) 45%, rgba(20,110,130,0.35) 100%)';
  }
}

// 屏幕左右边缘 24px 内触发翻页（8px 太窄，移动端难以精确触达）
const EDGE_THRESHOLD = 24;
const EDGE_DELAY = 900;
const MERGE_DELAY = 800;

interface GhostState {
  item: DesktopItem;
  source: DragSource;
  pointerId: number;
  x: number;
  y: number;
}

const Desktop: React.FC = () => {
  const {
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
    moveItemTo,
    mergeToFolder,
    moveFromFolderToDesktop,
    dissolveFolder,
    setFolderLayout,
    moveItemToPrivacy,
    movePrivacyToPage,
    reorderPrivacyItems,
    privacyPageItems,
    privacyPageCount,
    privacyUnlocked,
    privacyRevision,
    setPrivacyUnlockData,
    lockPrivacy,
    undo,
    redo,
  } = useDesktop();

  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [folderRenameId, setFolderRenameId] = useState<string | null>(null);
  // 解锁状态提升至 DesktopContext（会话内保持：切换普通页不重置，刷新/重载或手动锁定后需重新输入）
  const handleUnlock = useCallback((items: import('@/types').DesktopItem[], key: CryptoKey) => {
    setPrivacyUnlockData(items, key);
  }, [setPrivacyUnlockData]);
  const openFolder = openFolderId
    ? data.pages.flat().find((it) => it.id === openFolderId)
      ?? privacyPageItems.find((it) => it.id === openFolderId)
      ?? null
    : null;
  const [openSettings, setOpenSettings] = useState(false);
  const [openSync, setOpenSync] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DesktopItem | null>(null);
  // 剪藏预填数据（扩展工具栏点击后传入）
  const [clipPrefill, setClipPrefill] = useState<{ name: string; url: string; iconUrl?: string } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const bgImageSource = getRenderableWallpaperSource(settings.bgImage);
  const bgVideoSource = settings.bgVideo === IDB_VIDEO_MARKER ? undefined : settings.bgVideo;
  // 壁纸加载失败标记：失败时回退默认渐变背景；切换壁纸后重置
  const [bgLoadFailed, setBgLoadFailed] = useState(false);
  const bgErrorToastRef = useRef(false);
  useEffect(() => {
    setBgLoadFailed(false);
    bgErrorToastRef.current = false;
  }, [bgImageSource, bgVideoSource]);

  // 隐私解锁状态在会话内保持：离开隐私页（切换普通页/翻页）不重置、不清除内存密钥，
  // 无需重复输入密码；页面刷新/重载或点击锁图标手动锁定后才需重新解锁。
  // 数据持久化不受影响：解锁期间 privacyPageItems 变更仍会加密写入 vault（见 DesktopContext）。

  const edgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeTargetPageRef = useRef<number | null>(null);
  const mergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ghostLayerRef = useRef<HTMLDivElement>(null);
  const { captureDrop, cancelMotion } = useDragMotion(containerRef);

  const [ghost, setGhost] = useState<GhostState | null>(null);
  const ghostRef = useRef<GhostState | null>(null);
  const mergeHoverIdRef = useRef<string | null>(null);
  // 同步跟踪当前悬停的目标图标 ID（onMove 实时写入，onUp 最先读取后清零）
  const dragOverItemRef = useRef<string | null>(null);
  // 拖到最后一页右边缘时只渲染临时落点页；成功放置才由数据层原子创建。
  const [trailingDropPage, setTrailingDropPage] = useState(false);
  const trailingDropPageRef = useRef(false);
  // 拖到最左隐私页左边缘时渲染临时负页；成功放置后才写入加密数据。
  const [leadingPrivacyDropPage, setLeadingPrivacyDropPage] = useState(false);
  const leadingPrivacyDropPageRef = useRef(false);
  const currentPageRef = useRef(currentPage);
  const normalPageCountRef = useRef(data.pages.length);
  const privacyPageCountRef = useRef(privacyPageCount);
  const trackMaxIndexRef = useRef(privacyPageCount + data.pages.length - 1);
  const isDraggingRef = useRef(isDragging);
  // render 阶段同步，消除快速连续翻页时 useEffect 尚未运行的短暂旧值窗口。
  currentPageRef.current = currentPage;
  normalPageCountRef.current = data.pages.length;
  privacyPageCountRef.current = privacyPageCount;
  trackMaxIndexRef.current = privacyPageCount
    + data.pages.length
    + (leadingPrivacyDropPage ? 1 : 0)
    + (trailingDropPage ? 1 : 0)
    - 1;
  isDraggingRef.current = isDragging;

  // 手机浏览器“电脑模式”可能把布局视口伪装为 980px，但实际可视区仍很窄。
  // 网格、响应式断点、弹层和根容器统一使用已归一化的有效视口。
  const viewport = useViewportGeometry();
  const toShellPoint = useCallback((x: number, y: number) => ({
    x: x - viewport.shell.left,
    y: y - viewport.shell.top,
  }), [viewport.shell.left, viewport.shell.top]);

  // 窄屏允许 4/5 列；有效宽度达到电脑端断点后至少使用 6 列。
  const responsiveColumns = resolveResponsiveColumnState(
    settings.cols,
    settings.portraitCols,
    viewport.isWide,
  );
  const gridCols = responsiveColumns.gridCols;
  const gridRows = settings.rows ?? 8;
  const desktopGridMetrics = getDesktopGridLayoutMetrics(
    viewport.shell.width,
    gridCols,
    settings.iconSize,
    viewport.shell.height,
    gridRows,
  );
  const desktopIconMetrics = getIconLayoutMetrics(
    'normal',
    desktopGridMetrics.iconPx,
    settings.iconRadiusPct,
  );
  const largeFolderLayout = getLargeFolderLayoutMetrics(
    desktopIconMetrics,
    desktopGridMetrics,
  );
  const gridColumnGapPx = desktopGridMetrics.columnGapPx;
  const gridRowGapPx = desktopGridMetrics.rowGapPx;
  const privacyPageNumbers = getPrivacyPageNumbers(privacyPageCount);
  const pagePaddingClass = viewport.isWide ? 'px-8' : 'px-4';
  const pageVerticalPaddingStyle: React.CSSProperties = {
    paddingTop: 8 + gridRowGapPx,
    paddingBottom: 8,
  };

  // 按当前方向原子重排，但横屏自动扩列不能覆盖用户的竖屏列数。
  useEffect(() => {
    if (responsiveColumns.patch) updateSettings(responsiveColumns.patch);
  }, [responsiveColumns.patch, updateSettings]);

  // 同步 <html>/<body>/#root 背景色：打开新标签页时浏览器会短暂丢弃合成层，
  // 页面降级为纯色渲染。html 默认透明、body 默认 bg-background（近乎白色），
  // 三层同时设为桌面底色才能彻底消除白屏闪烁。
  useEffect(() => {
    let bg: string;
    if (settings.style === 'neumorphism') {
      bg = '#e8edf5';
    } else if (settings.bgType === 'image' || settings.bgType === 'video') {
      bg = '#1a1a2e';
    } else {
      bg = 'hsl(240, 50%, 50%)';
    }
    const html = document.documentElement;
    const body = document.body;
    const appRoot = document.getElementById('root');
    html.style.backgroundColor = bg;
    if (body) body.style.backgroundColor = bg;
    if (appRoot) appRoot.style.backgroundColor = bg;
    return () => {
      html.style.backgroundColor = '';
      if (body) body.style.backgroundColor = '';
      if (appRoot) appRoot.style.backgroundColor = '';
    };
  }, [settings.style, settings.bgType]);

  // 扩展环境：启动时检测 pendingClip（用户点击工具栏「剪藏」后留下的数据）
  // 直接添加到桌面，无需打开编辑对话框
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    chrome.storage.local.get(['pendingClip'], (result: Record<string, unknown>) => {
      const clip = result.pendingClip as { url: string; title: string; favicon?: string } | undefined;
      if (!clip) return;
      chrome.storage.local.remove(['pendingClip']);
      addItem({ name: clip.title, url: clip.url, iconUrl: clip.favicon, type: 'app', color: 'blue' }, currentPage);
      toast.success(`已添加「${clip.title}」到桌面`);
    });
  }, [addItem]);

  // 自动同步：5 秒静默期合并编辑，远端抢先更新时由 GitHub 层自动基于最新 HEAD 重试。
  // 临时失败保留 dirty 状态后台重试，不再用“冲突锁”永久暂停队列。
  const autoSyncLatestRef = useRef({ data, settings });
  autoSyncLatestRef.current = { data, settings };
  const autoSyncSchedulerRef = useRef<AutoSyncScheduler | null>(null);
  const isFirstAutoSyncRenderRef = useRef(true);

  useEffect(() => {
    const scheduler = new AutoSyncScheduler({
      getDelayMs: () => AUTO_SYNC_DELAY_MS,
      run: async ({ isSuperseded }) => {
        const initialConfig = loadSyncConfig();
        if (
          !initialConfig?.autoSync
          || !initialConfig.token
          || !initialConfig.owner
          || !initialConfig.repo
        ) {
          return 'paused';
        }

        try {
          const latest = autoSyncLatestRef.current;
          const snapshot = await buildSyncSnapshot(latest.data, latest.settings);
          if (isSuperseded()) return 'complete';

          // 构建壁纸快照可能耗时，上传前再次读取配置，避免使用已切换或已暂停的目标。
          const currentConfig = loadSyncConfig();
          if (
            !currentConfig?.autoSync
            || !currentConfig.token
            || !currentConfig.owner
            || !currentConfig.repo
          ) {
            return 'paused';
          }

          const result = await uploadSyncSnapshot(
            { ...currentConfig, path: currentConfig.path || 'desktop_backup.json' },
            snapshot,
            { source: 'auto' },
          );
          return result.ok ? 'complete' : 'retry';
        } catch (error) {
          const message = error instanceof Error ? error.message : '网络连接异常';
          updateSyncConfig({
            syncStatus: 'retrying',
            lastSyncError: `${message}，将自动重试`,
          });
          return 'retry';
        }
      },
    });
    autoSyncSchedulerRef.current = scheduler;
    const handleConfigChange = () => scheduler.reschedule();
    const handleSyncRequest = () => scheduler.request();
    window.addEventListener(SYNC_CONFIG_CHANGED_EVENT, handleConfigChange);
    window.addEventListener('storage', handleConfigChange);
    window.addEventListener(AUTO_SYNC_REQUEST_EVENT, handleSyncRequest);
    const initialConfig = loadSyncConfig();
    if (
      initialConfig?.autoSync
      && ['pending', 'retrying', 'syncing'].includes(initialConfig.syncStatus ?? '')
    ) {
      scheduler.request();
    }
    return () => {
      window.removeEventListener(SYNC_CONFIG_CHANGED_EVENT, handleConfigChange);
      window.removeEventListener('storage', handleConfigChange);
      window.removeEventListener(AUTO_SYNC_REQUEST_EVENT, handleSyncRequest);
      scheduler.dispose();
      if (autoSyncSchedulerRef.current === scheduler) autoSyncSchedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    // 即使首次挂载不上传，也立即触发旧版配置迁移。
    const syncConfig = loadSyncConfig();
    // 跳过首次挂载（避免页面刚加载就触发上传）
    if (isFirstAutoSyncRenderRef.current) {
      isFirstAutoSyncRenderRef.current = false;
      return;
    }
    if (
      !syncConfig?.autoSync
      || !syncConfig.token
      || !syncConfig.owner
      || !syncConfig.repo
    ) return;
    updateSyncConfig({ syncStatus: 'pending', lastSyncError: undefined });
    autoSyncSchedulerRef.current?.request();
  }, [data, privacyRevision, settings]);

  useEffect(() => { ghostRef.current = ghost; }, [ghost]);

  // ghost 出现时只更新 transform，避免 left/top 引发布局并防止 React re-render 重置坐标。
  useEffect(() => {
    if (!ghost) return;
    const el = ghostLayerRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${ghost.x}px, ${ghost.y}px, 0) translate(-50%, -50%)`;
  }, [ghost]);

  // ── 全局 contextmenu 捕获（capture 阶段）─────────────────────────────────
  // 移动端长按空白处时，React onContextMenu 冒泡可能晚于浏览器弹菜单；
  // 在 document capture 阶段拦截，保证任何区域（含空白）均不弹系统菜单。
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 输入框/文本域保留系统菜单
      if (target.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handler, { capture: true });
    return () => document.removeEventListener('contextmenu', handler, { capture: true });
  }, []);

  // 桌面操作历史快捷键：⌘/Ctrl+Z 撤销，⌘/Ctrl+Shift+Z 或 Ctrl+Y 重做。
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (currentPage < 0 || openFolderId || openSync || addDialogOpen || editingItem || contextMenu || isDragging) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        const changed = event.shiftKey ? redo() : undo();
        if (changed) toast.success(event.shiftKey ? '已重做桌面操作' : '已撤销上一步桌面操作');
      } else if (key === 'y' && event.ctrlKey) {
        event.preventDefault();
        if (redo()) toast.success('已重做桌面操作');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addDialogOpen, contextMenu, currentPage, editingItem, isDragging, openFolderId, openSync, redo, undo]);

  const navigateToPage = useCallback((page: number) => {
    currentPageRef.current = page;
    setCurrentPage(page);
  }, [setCurrentPage]);

  const latestRef = useRef({
    data, currentPage, gridCols, moveItemTo, mergeToFolder,
    moveFromFolderToDesktop, gridRows,
    gridRowHeightPx: desktopGridMetrics.rowHeightPx,
    gridColumnGapPx,
    gridRowGapPx,
    setCurrentPage: navigateToPage, clearEdgeFn: null as (() => void) | null,
    moveItemToPrivacy, movePrivacyToPage, reorderPrivacyItems,
    privacyPageItems, privacyPageCount, privacyUnlocked,
  });
  React.useLayoutEffect(() => {
    latestRef.current = {
      data, currentPage, gridCols, moveItemTo, mergeToFolder,
      moveFromFolderToDesktop, gridRows,
      gridRowHeightPx: desktopGridMetrics.rowHeightPx,
      gridColumnGapPx,
      gridRowGapPx,
      setCurrentPage: navigateToPage, clearEdgeFn: latestRef.current.clearEdgeFn,
      moveItemToPrivacy, movePrivacyToPage, reorderPrivacyItems,
      privacyPageItems, privacyPageCount, privacyUnlocked,
    };
  });

  const clearEdgeTimer = useCallback(() => {
    if (edgeTimerRef.current) { clearTimeout(edgeTimerRef.current); edgeTimerRef.current = null; }
    edgeTargetPageRef.current = null;
  }, []);
  const clearMergeTimer = useCallback(() => {
    if (mergeTimerRef.current) { clearTimeout(mergeTimerRef.current); mergeTimerRef.current = null; }
    mergeHoverIdRef.current = null;
  }, []);

  useEffect(() => {
    latestRef.current.clearEdgeFn = clearEdgeTimer;
    return () => { clearEdgeTimer(); clearMergeTimer(); };
  }, [clearEdgeTimer, clearMergeTimer]);

  const handleEdgeHover = useCallback((clientX: number) => {
    if (!containerRef.current || !ghostRef.current) return;
    const { data: d, setCurrentPage: nav } = latestRef.current;
    const page = currentPageRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const relX = clientX - rect.left;
    const edge = relX < EDGE_THRESHOLD
      ? 'left'
      : relX > rect.width - EDGE_THRESHOLD
        ? 'right'
        : null;
    const activeDrag = ghostRef.current;
    const edgeTarget = edge && activeDrag
      ? resolveDragEdgeTarget({
        currentPage: page,
        pageCount: d.pages.length,
        privacyPageCount: latestRef.current.privacyPageCount,
        edge,
        allowPrivacyPage:
          activeDrag.item.type === 'app'
          || (activeDrag.item.type === 'folder' && !folderContainsSystemItem(activeDrag.item)),
        hasLeadingPrivacyPage: leadingPrivacyDropPageRef.current,
        canCreateLeadingPrivacyPage:
          latestRef.current.privacyUnlocked
          && latestRef.current.privacyPageCount < LAYOUT_LIMITS.maxPages
          && (
            activeDrag.item.type === 'app'
            || (activeDrag.item.type === 'folder' && !folderContainsSystemItem(activeDrag.item))
          ),
        hasTrailingPage: trailingDropPageRef.current,
        canCreateTrailingPage:
          d.pages.length < LAYOUT_LIMITS.maxPages && activeDrag.item.type !== 'system',
      })
      : null;
    const targetPage = edgeTarget?.page ?? null;
    const createsTrailingPage = edgeTarget?.createsTrailingPage ?? false;
    const createsLeadingPrivacyPage = edgeTarget?.createsLeadingPrivacyPage ?? false;

    if (targetPage === null) {
      clearEdgeTimer();
      return;
    }

    // 指针从左边缘直接移到右边缘时必须更换目标；旧实现会保留第一侧的计时器，
    // 最终向相反方向翻页。
    if (edgeTargetPageRef.current === targetPage && edgeTimerRef.current) return;
    clearEdgeTimer();
    edgeTargetPageRef.current = targetPage;
    edgeTimerRef.current = setTimeout(() => {
      if (edgeTargetPageRef.current !== targetPage) return;
      let resolvedTargetPage = targetPage;
      if (createsLeadingPrivacyPage) {
        const latest = latestRef.current;
        if (
          currentPageRef.current !== -latest.privacyPageCount
          || latest.privacyPageCount >= LAYOUT_LIMITS.maxPages
          || !latest.privacyUnlocked
          || !ghostRef.current
        ) {
          clearEdgeTimer();
          return;
        }
        leadingPrivacyDropPageRef.current = true;
        setLeadingPrivacyDropPage(true);
        resolvedTargetPage = -(latest.privacyPageCount + 1);
      }
      if (createsTrailingPage) {
        const latest = latestRef.current;
        if (
          currentPageRef.current !== latest.data.pages.length - 1
          || latest.data.pages.length >= LAYOUT_LIMITS.maxPages
          || !ghostRef.current
        ) {
          clearEdgeTimer();
          return;
        }
        trailingDropPageRef.current = true;
        setTrailingDropPage(true);
        resolvedTargetPage = latest.data.pages.length;
      }
      nav(resolvedTargetPage);
      clearEdgeTimer();
    }, EDGE_DELAY);
  }, [clearEdgeTimer]);

  // 全局 pointer 监听
  useEffect(() => {
    const processMove = (e: PointerEvent) => {
      const g = ghostRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const shellPoint = toShellPoint(e.clientX, e.clientY);
      g.x = shellPoint.x;
      g.y = shellPoint.y;
      if (ghostLayerRef.current) {
        ghostLayerRef.current.style.transform = `translate3d(${shellPoint.x}px, ${shellPoint.y}px, 0) translate(-50%, -50%)`;
      }
      handleEdgeHover(e.clientX);

      // ghost 已禁用 pointer-events，常规命中可直接走浏览器命中树，避免每帧遍历全部页面
      // 并读取大量 getBoundingClientRect（后者会强制同步布局）。
      const hitElement = document.elementFromPoint(e.clientX, e.clientY);
      const hoverCell = hitElement?.closest<HTMLElement>('[data-cell]') ?? null;
      const hoverId = hoverCell?.dataset.itemid ?? null;

      // 提前查询悬停目标项类型：用于判断是否可合并、是否高亮
      const { data: dataNow, privacyPageItems: privacyNow } = latestRef.current;
      const hoverPage = Number(hoverCell?.dataset.page);
      const hoverItem = hoverId !== null && Number.isInteger(hoverPage)
        ? hoverPage >= 0
          ? dataNow.pages[hoverPage]?.find((item) => item.id === hoverId) ?? null
          : privacyNow.find((item) => item.page === hoverPage && item.id === hoverId) ?? null
        : null;
      const isHoverWidget = hoverItem?.type === 'widget';

      // 文件夹拖出时不高亮 widget（无法合并/放置），避免误导用户以为可放入组件
      const isFolderDrag = g.source.type === 'folder';
      const effectiveHoverId = (isFolderDrag && isHoverWidget) ? null : (hoverId ?? null);
      if (effectiveHoverId !== dragOverItemRef.current) {
        setDragOverItem(effectiveHoverId);
        dragOverItemRef.current = effectiveHoverId;
      }

      // 应用与普通桌面的系统入口可参与文件夹合并；widget 和文件夹本身不能作为来源。
      const isWorkspaceDrag = g.source.type === 'desktop'
        || g.source.type === 'privacy'
        || g.source.type === 'folder';
      const sourceIsPrivacy = g.source.type === 'privacy' || (g.source.page ?? g.item.page) < 0;
      const hoverIsPrivacy = hoverPage < 0;
      const sourceCanMerge = g.item.type === 'app'
        || (g.item.type === 'system' && !sourceIsPrivacy);
      const targetCanMerge = hoverItem?.type === 'app'
        || hoverItem?.type === 'folder'
        || (hoverItem?.type === 'system' && !hoverIsPrivacy);
      const isValidMergeTarget =
        edgeTargetPageRef.current === null &&
        hoverId !== null &&
        hoverId !== g.source.itemId &&
        isWorkspaceDrag &&
        sourceIsPrivacy === hoverIsPrivacy &&
        hoverItem !== null &&
        sourceCanMerge &&
        targetCanMerge;

      if (isValidMergeTarget) {
        if (hoverId !== mergeHoverIdRef.current) {
          // 悬停目标变化 → 重置计时器，对新目标重新计时
          clearMergeTimer();
          // hoverId 此处已由 isValidMergeTarget 确保非 null
          const hoverIdNonNull = hoverId!;
          mergeHoverIdRef.current = hoverIdNonNull;
          mergeTimerRef.current = setTimeout(() => {
            const cur = ghostRef.current;
            if (!cur) return;
            const {
              data: d,
              privacyPageItems: privateItems,
              mergeToFolder: merge,
            } = latestRef.current;
            const dragItem = cur.source.type === 'folder'
              ? (
                d.pages.flat().find((item) => item.id === cur.source.folderId)
                ?? privateItems.find((item) => item.id === cur.source.folderId)
              )?.children?.find((child) => child.id === cur.source.itemId)
              : d.pages.flat().find((item) => item.id === cur.source.itemId)
                ?? privateItems.find((item) => item.id === cur.source.itemId);
            const target = d.pages.flat().find((item) => item.id === hoverIdNonNull)
              ?? privateItems.find((item) => item.id === hoverIdNonNull);
            // 兜底：计时期间数据可能变化；只允许 app/system 成为子项。
            if (!dragItem || (dragItem.type !== 'app' && dragItem.type !== 'system')) return;
            if (!target || (target.type !== 'app' && target.type !== 'system' && target.type !== 'folder')) return;
            // 检查目标文件夹容量
            if (target.type === 'folder' && (target.children?.length ?? 0) >= MAX_FOLDER_APPS) {
              toast.error('文件夹已满');
              return;
            }
            const ghostRect = ghostLayerRef.current?.getBoundingClientRect();
            if (ghostRect) captureDrop(cur.source.itemId, {
              x: ghostRect.left + ghostRect.width / 2,
              y: ghostRect.top + ghostRect.height / 2,
            });
            const merged = merge(
              cur.source.itemId,
              hoverIdNonNull,
              cur.source.type === 'folder' ? cur.source.folderId : undefined,
            );
            if (!merged) { cancelMotion(); return; }
            // 合并成功后若来源是文件夹，需立即关闭文件夹：
            // onUp 会因 ghostRef 已被清空而提前 return，跳过关闭逻辑，
            // 导致 openFolderId 残留、文件夹遮罩（已被 DOM display:none 隐藏）无法再次打开
            const wasFromFolder = cur.source.type === 'folder';
            ghostRef.current = null;
            setGhost(null);
            setIsDragging(false);
            setDragOverItem(null);
            dragOverItemRef.current = null;
            mergeHoverIdRef.current = null;
            mergeTimerRef.current = null;
            if (trailingDropPageRef.current) {
              trailingDropPageRef.current = false;
              setTrailingDropPage(false);
            }
            if (leadingPrivacyDropPageRef.current) {
              leadingPrivacyDropPageRef.current = false;
              setLeadingPrivacyDropPage(false);
            }
            if (wasFromFolder) {
              setOpenFolderId(null);
              setFolderRenameId(null);
            }
          }, MERGE_DELAY);
        }
        // hoverId 未变化 → 继续等待计时器，无需任何操作
      } else {
        // 离开有效合并目标（空白、自身、组件或不允许的隐私系统项）→ 清除计时器
        clearMergeTimer();
      }
    };

    // 指针事件可能远高于屏幕刷新率；DOM 几何扫描最多每帧执行一次。
    let moveFrame: number | null = null;
    let latestMoveEvent: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      const active = ghostRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      latestMoveEvent = e;
      if (moveFrame !== null) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = null;
        const event = latestMoveEvent;
        latestMoveEvent = null;
        if (event) processMove(event);
      });
    };

    const onUp = (e: PointerEvent) => {
      const g = ghostRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      captureDrop(g.source.itemId, { x: e.clientX, y: e.clientY });
      const hadTrailingDropPage = trailingDropPageRef.current;
      const trailingPageIndex = latestRef.current.data.pages.length;
      const hadLeadingPrivacyDropPage = leadingPrivacyDropPageRef.current;
      const leadingPrivacyPageIndex = -(latestRef.current.privacyPageCount + 1);
      let committedToTrailingPage = false;
      let committedToLeadingPrivacyPage = false;
      try {
      dragOverItemRef.current = null;
      ghostRef.current = null;
      setGhost(null);
      setIsDragging(false);
      setDragOverItem(null);
      clearEdgeTimer();
      clearMergeTimer(); // 若 800ms 计时器还未触发，取消它（快速松手走交换分支）

      // 文件夹拖出：无论是否命中有效格子都关闭文件夹
      if (g.source.type === 'folder') {
        setOpenFolderId(null);
        setFolderRenameId(null);
      }

      const { data: d, currentPage: cp,
              moveItemTo: moveTo,
              moveFromFolderToDesktop: moveOut,
              gridCols: gc } = latestRef.current;
      const isWidget = g.item.type === 'widget';

      // 常规位置使用浏览器命中树；只有落在 grid gap 时才读取当前页格子几何。
      // 释放在桌面之外会取消本次移动，避免旧版兜底把图标意外甩到第一空位。
      const hitElement = document.elementFromPoint(e.clientX, e.clientY);
      let cell = hitElement?.closest<HTMLElement>('[data-cell]') ?? null;
      if (cell && !containerRef.current?.contains(cell)) cell = null;

      if (!cell) {
        const pageGrid = containerRef.current?.querySelector<HTMLElement>(
          `[data-page-grid="${cp}"]`,
        );
        const gridRect = pageGrid?.getBoundingClientRect();
        const insideGrid = gridRect
          && e.clientX >= gridRect.left
          && e.clientX <= gridRect.right
          && e.clientY >= gridRect.top
          && e.clientY <= gridRect.bottom;
        if (!insideGrid) return;

        const currentPageCells = containerRef.current?.querySelectorAll<HTMLElement>(
          `[data-cell][data-page="${cp}"]`,
        ) ?? [];
        let minDistanceSquared = Number.POSITIVE_INFINITY;
        for (const cellEl of currentPageCells) {
          const rect = cellEl.getBoundingClientRect();
          const dx = e.clientX - (rect.left + rect.right) / 2;
          const dy = e.clientY - (rect.top + rect.bottom) / 2;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < minDistanceSquared) {
            minDistanceSquared = distanceSquared;
            cell = cellEl;
          }
        }
      }
      if (!cell) return;

      let targetRow = Number(cell.dataset.row);
      const rawPage = Number(cell.dataset.page);
      const targetPage = isNaN(rawPage) ? cp : rawPage;
      // 截断 col：防止旧数据 col >= gridCols 导致 item 落入不可见列消失
      const rawCol = isWidget ? 0 : Number(cell.dataset.col);
      let targetCol = isNaN(rawCol) ? 0 : Math.min(rawCol, gc - 1);
      const targetItemId = cell.dataset.itemid ?? null;
      const draggedGridSpan = getItemGridSpan(g.item, gc);
      // Resolve every icon from grid geometry, including individual cells inside a large folder.
      if (!isWidget) {
        const targetGrid = containerRef.current?.querySelector<HTMLElement>(
          `[data-page-grid="${targetPage}"]`,
        );
        const targetGridRect = targetGrid?.getBoundingClientRect();
        const centeredTarget = targetGridRect
          ? resolveCenteredGridDropPosition(
            e.clientX,
            e.clientY,
            targetGridRect,
            gc,
            latestRef.current.gridRows,
            latestRef.current.gridColumnGapPx,
            latestRef.current.gridRowGapPx,
            draggedGridSpan.colSpan,
            draggedGridSpan.rowSpan,
          )
          : null;
        if (!centeredTarget) return;
        targetRow = centeredTarget.row;
        targetCol = centeredTarget.col;
      }

      if (!isWidget && g.source.type !== 'folder' && isNoopGridDrop(
        g.item, targetPage, targetRow, targetCol, targetItemId,
      )) return;

      // ── 普通桌面顶层项目拖入任意隐私负页 ──
      if (targetPage < 0 && g.source.type === 'desktop') {
        const { moveItemToPrivacy: toPrivacy, privacyUnlocked: unlocked, setCurrentPage: nav } = latestRef.current;
        // 防御：隐私桌面未解锁时中止移动，图标原地不动，跳转到隐私页触发密码认证
        if (!unlocked) {
          nav(-1);
          return;
        }
        const srcItem = findItem(d.pages, g.source.itemId);
        const moved = srcItem
          ? toPrivacy(g.source.itemId, targetPage, targetRow, targetCol)
          : false;
        if (moved && targetPage === leadingPrivacyPageIndex) {
          committedToLeadingPrivacyPage = true;
        }
        if (srcItem && !moved) {
          toast.error(
            g.item.type === 'folder' && folderContainsSystemItem(g.item)
              ? '该文件夹不可移入隐私桌面'
              : g.item.type === 'app' || g.item.type === 'folder'
                ? '空间不足'
                : '仅支持应用和文件夹',
          );
        }
        return;
      }

      // ── 从隐私页拖到普通桌面 ──
      if (targetPage >= 0 && g.source.type === 'privacy') {
        const { movePrivacyToPage: fromPrivacy } = latestRef.current;
        const moved = fromPrivacy(g.source.itemId, targetPage, targetRow, targetCol);
        if (moved && targetPage === trailingPageIndex) committedToTrailingPage = true;
        if (!moved) {
          toast.error('空间不足');
        }
        return;
      }

      // ── 隐私负页内部或跨负页拖拽换位 ──
      if (targetPage < 0 && g.source.type === 'privacy') {
        const { reorderPrivacyItems: reorder } = latestRef.current;
        const moved = reorder(g.source.itemId, targetPage, targetRow, targetCol);
        if (moved && targetPage === leadingPrivacyPageIndex) {
          committedToLeadingPrivacyPage = true;
        }
        if (!moved) toast.error('空间不足');
        return;
      }

      // ── 文件夹内项目拖出：支持普通页、隐私负页以及跨边界 ──
      if (g.source.type === 'folder') {
        if (targetPage < 0 && !latestRef.current.privacyUnlocked) {
          latestRef.current.setCurrentPage(-1);
          return;
        }
        if (g.source.folderId) {
          const moved = moveOut(g.source.folderId, g.source.itemId, targetPage, targetRow, targetCol);
          if (moved && targetPage === trailingPageIndex) committedToTrailingPage = true;
          if (moved && targetPage === leadingPrivacyPageIndex) {
            committedToLeadingPrivacyPage = true;
          }
          if (!moved) toast.error('空间不足');
        }
        return;
      }

      // ── 桌面图标拖拽 ──
      if (g.source.type === 'desktop') {
        const src = findItem(d.pages, g.source.itemId);
        if (!src) return;

        if (isWidget) {
          // ── 组件拖拽落点 ──
          // 网格显式使用统一逻辑行高；直接按 grid top + row height + gap 换算，
          // 不再从跨行组件 DOM 高度反推 rowSpan，避免搜索栏与时钟混排时落点漂移。
          const widgetGrid = containerRef.current?.querySelector<HTMLElement>(
            `[data-page-grid="${targetPage}"]`,
          );
          const widgetGridRect = widgetGrid?.getBoundingClientRect();
          const widgetTargetRow = widgetGridRect
            ? resolveGridRowAtY(
              e.clientY,
              widgetGridRect.top,
              latestRef.current.gridRowHeightPx,
              latestRef.current.gridRowGapPx,
              latestRef.current.gridRows,
            )
            : null;
          if (widgetTargetRow === null) return;

          // ── widget 拖拽落点判定 ──
          // 规则：
          //   1. 落点与自身起始行重叠（未移动）→ 忽略
          //   2. 目标 rowSpan 范围必须完整为空，避免组件覆盖其他组件或普通项目
          const targetPageItems = d.pages[targetPage] ?? [];
          const srcFull0 = d.pages[src.page]?.find(it => it.id === g.source.itemId);
          if (!srcFull0) return;
          const draggedSpan0 = getItemGridSpan(srcFull0, gc).rowSpan;

          if (widgetTargetRow < 0 || widgetTargetRow + draggedSpan0 > latestRef.current.gridRows) {
            toast.error('空间不足');
            return;
          }

          // 未移动：落回自身起始行 → 忽略
          if (widgetTargetRow === src.row && src.page === targetPage) return;

          // 与数据层共用矩形占位规则，同时识别 widget 跨行和 2×2 文件夹跨行跨列。
          if (!canPlaceItem(
            targetPageItems,
            srcFull0,
            widgetTargetRow,
            0,
            gc,
            latestRef.current.gridRows,
            [g.source.itemId],
          )) {
            toast.error('空间不足');
            return;
          }
          const moved = moveTo(g.source.itemId, src.page, targetPage, widgetTargetRow, 0);
          if (moved && targetPage === trailingPageIndex) committedToTrailingPage = true;
        } else {
          if (isNoopGridDrop(
            { ...src, id: g.source.itemId },
            targetPage, targetRow, targetCol, targetItemId,
          )) return;
          const moved = moveTo(g.source.itemId, src.page, targetPage, targetRow, targetCol);
          if (moved && targetPage === trailingPageIndex) committedToTrailingPage = true;
          if (!moved) toast.error('空间不足');
        }
      }
      } finally {
        if (hadTrailingDropPage) {
          trailingDropPageRef.current = false;
          setTrailingDropPage(false);
          if (
            !committedToTrailingPage
            && currentPageRef.current >= latestRef.current.data.pages.length
          ) {
            latestRef.current.setCurrentPage(Math.max(0, latestRef.current.data.pages.length - 1));
          }
        }
        if (hadLeadingPrivacyDropPage) {
          leadingPrivacyDropPageRef.current = false;
          setLeadingPrivacyDropPage(false);
          if (
            !committedToLeadingPrivacyPage
            && currentPageRef.current < -latestRef.current.privacyPageCount
          ) {
            latestRef.current.setCurrentPage(-latestRef.current.privacyPageCount);
          }
        }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    // pointercancel：浏览器取消指针序列时（如系统手势介入）清理拖拽状态，防止 ghost 残留
    const onCancel = (event: PointerEvent) => {
      const active = ghostRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      ghostRef.current = null;
      dragOverItemRef.current = null;
      setGhost(null);
      setIsDragging(false);
      setDragOverItem(null);
      clearEdgeTimer();
      clearMergeTimer();
      if (trailingDropPageRef.current) {
        trailingDropPageRef.current = false;
        setTrailingDropPage(false);
        if (currentPageRef.current >= latestRef.current.data.pages.length) {
          latestRef.current.setCurrentPage(Math.max(0, latestRef.current.data.pages.length - 1));
        }
      }
      if (leadingPrivacyDropPageRef.current) {
        leadingPrivacyDropPageRef.current = false;
        setLeadingPrivacyDropPage(false);
        if (currentPageRef.current < -latestRef.current.privacyPageCount) {
          latestRef.current.setCurrentPage(-latestRef.current.privacyPageCount);
        }
      }
      if (active.source.type === 'folder') {
        setOpenFolderId(null);
        setFolderRenameId(null);
      }
    };
    document.addEventListener('pointercancel', onCancel);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      if (moveFrame !== null) cancelAnimationFrame(moveFrame);
    };
  }, [handleEdgeHover, clearEdgeTimer, clearMergeTimer, toShellPoint, captureDrop, cancelMotion]);

  const handleDragBegin = useCallback((
    item: DesktopItem,
    srcType: 'desktop' | 'privacy',
    x: number,
    y: number,
    pointerId: number,
  ) => {
    if (ghostRef.current) return;
    cancelMotion();
    setContextMenu(null);
    let source: DragSource;
    if (srcType === 'privacy') {
      source = { type: 'privacy', itemId: item.id, page: item.page };
    } else {
      source = { type: 'desktop', itemId: item.id, page: latestRef.current.currentPage };
    }
    const shellPoint = toShellPoint(x, y);
    const g: GhostState = { item, source, pointerId, ...shellPoint };
    ghostRef.current = g;
    setGhost(g);
    setIsDragging(true);
  }, [toShellPoint, cancelMotion]);

  const handleDesktopDragBegin = useCallback((
    item: DesktopItem,
    x: number,
    y: number,
    pointerId: number,
  ) => handleDragBegin(item, 'desktop', x, y, pointerId), [handleDragBegin]);

  const handlePrivacyDragBegin = useCallback((
    item: DesktopItem,
    x: number,
    y: number,
    pointerId: number,
  ) => handleDragBegin(item, 'privacy', x, y, pointerId), [handleDragBegin]);

  // 从文件夹内拖出到桌面
  const handleDragFromFolder = useCallback((
    child: DesktopItem,
    folderId: string,
    x: number,
    y: number,
    pointerId: number,
  ) => {
    if (ghostRef.current) return;
    cancelMotion();
    setContextMenu(null);
    const source: DragSource = {
      type: 'folder',
      itemId: child.id,
      folderId,
      page: child.page,
    };
    const shellPoint = toShellPoint(x, y);
    const g: GhostState = { item: child, source, pointerId, ...shellPoint };
    ghostRef.current = g;
    setGhost(g);
    setIsDragging(true);
  }, [toShellPoint, cancelMotion]);

  const handleLongPress = useCallback((item: DesktopItem, x: number, y: number) => {
    // widget / system 仅进入拖拽待命，不显示编辑菜单。
    if (item.type === 'widget' || item.type === 'system') return;
    setContextMenu({
      x,
      y,
      itemId: item.id,
      isFolder: item.type === 'folder',
      folderLayout: item.type === 'folder' ? (item.folderLayout ?? '1x1') : undefined,
    });
  }, []);

  const handleSystemClick = useCallback((item: DesktopItem) => {
    if (item.id === 'sys-settings') setOpenSettings(true);
    else if (item.id === 'sys-sync') setOpenSync(true);
    else if (item.id === 'sys-add') setAddDialogOpen(true);
  }, []);

  const handleFolderClick = useCallback((folder: DesktopItem) => {
    setOpenFolderId(folder.id);
  }, []);

  const handleItemClick = useCallback((item: DesktopItem) => {
    if (item.type === 'folder') handleFolderClick(item);
    else if (item.type === 'system') handleSystemClick(item);
  }, [handleFolderClick, handleSystemClick]);

  const handleFolderItemClick = useCallback((item: DesktopItem) => {
    if (item.type === 'system') {
      setOpenFolderId(null);
      setFolderRenameId(null);
    }
    handleItemClick(item);
  }, [handleItemClick]);

  const handleAddApp = useCallback(
    (app: { name: string; url: string; iconUrl?: string; iconCrop?: import('@/types').IconCrop }) => {
      addItem(
        { type: 'app', name: app.name, url: app.url, iconUrl: app.iconUrl, iconCrop: app.iconCrop, color: 'blue' },
        currentPage,
      );
      toast.success(`已添加「${app.name}」`);
    }, [addItem, currentPage],
  );

  const handleEditApp = useCallback(
    (id: string, patch: Partial<DesktopItem>) => { updateItem(id, patch); toast.success('已更新应用'); },
    [updateItem],
  );

  const handleDeleteApp = useCallback(
    (id: string) => { removeItem(id); toast.success('已删除应用'); },
    [removeItem],
  );

  // pageItems 已不再需要（全页渲染后每页自行从 data.pages[i] 取数据）
  // const pageItems = data.pages[currentPage] || [];
  // swipe 翻页容器 ref（与 containerRef 区分）
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  // 横向滑轨：所有页面（隐私页在最左）并排，translateX 驱动翻页动画
  const pageTrackRef = useRef<HTMLDivElement>(null);
  // 跟手滑动起始偏移（逻辑页序：隐私页=0，普通页 i 对应 i+1）
  const startOffsetRef = useRef(0);

  // 翻页动画统一入口：currentPage 变化（指示器点击 / 边缘拖拽 / 手势 / 锁隐私 / 拖拽收尾）
  // 均由本 effect 将滑轨平滑移动到目标位置，无需在各调用点重复动画逻辑。
  // 首次挂载时 React 内联 style 已含正确 transform（见滑轨 style），此处设置相同值不会产生入场动画。
  useEffect(() => {
    const track = pageTrackRef.current;
    if (!track) return;
    track.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
    const offset = getPageTrackIndex(currentPage, privacyPageCount, leadingPrivacyDropPage);
    track.style.transform = `translateX(${-offset * 100}%)`;
  }, [currentPage, leadingPrivacyDropPage, privacyPageCount]);
  // 原生 touch 翻页（跟手）：touchmove 非 passive 以便 preventDefault 阻止水平滑动时的滚动取消；
  // 滑动期间实时驱动滑轨 translateX，松手后按位移决定翻页或回弹（与 iOS 主屏一致）
  useEffect(() => {
    const el = swipeContainerRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let viewportWidth = 1;
    let touchId = -1;
    let axis: SwipeAxis = 'pending';
    let tracking = false;

    // 跟手：关闭 transition，按手指位移实时移动滑轨（逻辑偏移 = 起始偏移 - dx/宽度）
    const applyTrack = (offset: number) => {
      const track = pageTrackRef.current;
      if (!track) return;
      track.style.transition = 'none';
      track.style.transform = `translateX(${-offset * 100}%)`;
    };
    // 回弹/到位：开启 transition，平滑移动到目标偏移
    const settleTrack = (offset: number) => {
      const track = pageTrackRef.current;
      if (!track) return;
      track.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
      track.style.transform = `translateX(${-offset * 100}%)`;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (isDraggingRef.current || ghostRef.current || e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      // 输入框内保留浏览器默认长按行为，不启动翻页追踪
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      // 搜索全屏覆盖层打开时禁用翻页（双重保险：SearchScreen 已在原生冒泡阶段 stopPropagation）
      if (target.closest('[data-search-overlay="true"]')) return;
      const touch = e.touches[0];
      touchId = touch.identifier;
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = e.timeStamp;
      viewportWidth = el.clientWidth || 1;
      startOffsetRef.current = getPageTrackIndex(
        currentPageRef.current,
        privacyPageCountRef.current,
      );
      axis = 'pending';
      tracking = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return;
      // 拖拽已开始（ghostRef 同步设置）→ 立即退出翻页追踪，避免 preventDefault 取消指针事件
      if (ghostRef.current) {
        tracking = false;
        settleTrack(getPageTrackIndex(currentPageRef.current, privacyPageCountRef.current));
        return;
      }
      if (e.touches.length !== 1) {
        tracking = false;
        settleTrack(getPageTrackIndex(currentPageRef.current, privacyPageCountRef.current));
        return;
      }
      const touch = Array.from(e.touches).find((candidate) => candidate.identifier === touchId);
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (axis === 'pending') axis = resolveSwipeAxis(dx, dy);
      if (axis === 'vertical') {
        tracking = false;
        return;
      }
      // 明确水平滑动：阻止浏览器默认行为（防止 pointercancel / scroll 覆盖）
      // cancelable=false 时浏览器已提交原生滚动，跳过以避免控制台警告。
      if (axis === 'horizontal' && e.cancelable) e.preventDefault();
      if (axis === 'horizontal') {
        // 跟手：滑轨随手指移动，并夹取在 [隐私页(0), 最后一页] 范围内
        const raw = startOffsetRef.current - dx / viewportWidth;
        const clamped = Math.max(0, Math.min(trackMaxIndexRef.current, raw));
        applyTrack(clamped);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = Array.from(e.changedTouches).find((candidate) => candidate.identifier === touchId);
      if (!touch) {
        settleTrack(getPageTrackIndex(currentPageRef.current, privacyPageCountRef.current));
        return;
      }
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (axis === 'pending') axis = resolveSwipeAxis(dx, dy);
      const cur = currentPageRef.current;
      if (!shouldCommitPageSwipe({
        dx,
        durationMs: e.timeStamp - startTime,
        viewportWidth,
        axis,
      })) {
        settleTrack(getPageTrackIndex(cur, privacyPageCountRef.current));
        return;
      }
      const targetPage = resolvePageSwipeTarget(
        cur,
        normalPageCountRef.current,
        dx,
        privacyPageCountRef.current,
      );
      if (targetPage === null) {
        settleTrack(getPageTrackIndex(cur, privacyPageCountRef.current));
        return;
      }
      settleTrack(getPageTrackIndex(targetPage, privacyPageCountRef.current));
      navigateToPage(targetPage);
    };

    const onTouchCancel = () => {
      tracking = false;
      axis = 'pending';
      settleTrack(getPageTrackIndex(currentPageRef.current, privacyPageCountRef.current));
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false }); // non-passive 以支持 preventDefault
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [navigateToPage]);

  /**
   * 渲染网格
   * ─ widget 行（row 中 col=0 的项为 widget 类型）：按当前用户列数横跨整行
   * ─ 普通行：按列渲染 AppIcon / 空骨架格
   */
  /**
   * 渲染单页网格（pageIndex + items 参数化）
   * 所有页同时挂载在横向滑轨中，保证 AppIcon 不随翻页卸载，避免图标重新加载。
   */
  const renderPageGrid = (pageIndex: number, items: DesktopItem[]) => {
    const cells: React.ReactNode[] = [];
    const renderRows = gridRows;
    const itemsByCell = new Map(items.map((item) => [`${item.row}:${item.col}`, item] as const));
    const coveredCells = new Set<string>();
    const dragBegin = pageIndex < 0 ? handlePrivacyDragBegin : handleDesktopDragBegin;

    for (const item of items) {
      const { rowSpan, colSpan } = getItemGridSpan(item, gridCols);
      for (let row = item.row; row < item.row + rowSpan; row++) {
        for (let col = item.col; col < item.col + colSpan; col++) {
          coveredCells.add(`${row}:${col}`);
        }
      }
    }

    for (let r = 0; r < renderRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const item = itemsByCell.get(`${r}:${c}`);
        if (item) {
          const { rowSpan, colSpan } = getItemGridSpan(item, gridCols);
          const spansMultipleCells = rowSpan > 1 || colSpan > 1;
          const gridSpanHeightPx = desktopGridMetrics.rowHeightPx * rowSpan
            + gridRowGapPx * (rowSpan - 1);
          if (item.type === 'widget') {
            const nextRow = r + rowSpan;
            const isFollowedByDesktopItem = items.some((candidate) => (
              candidate.row === nextRow && candidate.type !== 'widget'
            ));
            const widgetBottomClearancePx = getWidgetBottomClearancePx(
              desktopIconMetrics.cellMinHeightPx,
              desktopGridMetrics.rowHeightPx,
              isFollowedByDesktopItem,
            );
            cells.push(
              <div
                key={item.id}
                data-cell="1"
                data-row={r}
                data-col={0}
                data-page={pageIndex}
                data-itemid={item.id}
                data-row-span={rowSpan}
                data-col-span={colSpan}
                style={{
                  gridColumn: `1 / span ${colSpan}`,
                  gridRow: `${r + 1} / span ${rowSpan}`,
                  justifySelf: 'stretch',
                }}
                className={`w-full drag-grid-item ${dragOverItem === item.id ? 'brightness-105' : ''}`}
              >
                <WidgetGridCell
                  item={item}
                  ghost={ghost?.source.itemId === item.id}
                  iconPx={desktopIconMetrics.iconPx}
                  cellHeightPx={gridSpanHeightPx}
                  bottomClearancePx={widgetBottomClearancePx}
                  onDragBegin={dragBegin}
                  onLongPress={handleLongPress}
                />
              </div>,
            );
            continue;
          }
          cells.push(
            <div
              key={item.id}
              data-cell="1"
              data-row={r}
              data-col={c}
              data-page={pageIndex}
              data-itemid={item.id}
              data-item-type={item.type}
              data-row-span={rowSpan}
              data-col-span={colSpan}
              style={{
                gridColumn: `${c + 1} / span ${colSpan}`,
                gridRow: `${r + 1} / span ${rowSpan}`,
                justifySelf: spansMultipleCells ? 'stretch' : 'center',
                // 单格应用贴齐行轨底部；2×2 文件夹名称与第二行应用名称保持同一基线。
                alignSelf: spansMultipleCells ? 'stretch' : 'end',
                width: spansMultipleCells ? '100%' : undefined,
                height: spansMultipleCells ? '100%' : undefined,
                display: spansMultipleCells ? 'flex' : undefined,
                alignItems: spansMultipleCells ? 'flex-end' : undefined,
                justifyContent: spansMultipleCells ? 'center' : undefined,
              }}
              className={`relative min-w-0 drag-grid-item ${dragOverItem === item.id && item.type !== 'folder' ? 'brightness-105 z-10' : ''}`}
            >
              <AppIcon
                item={item}
                ghost={ghost?.source.itemId === item.id}
                iconPx={desktopIconMetrics.iconPx}
                largeFolderLayout={largeFolderLayout}
                onClick={handleItemClick}
                onLongPress={handleLongPress}
                onDragBegin={dragBegin}
                onDeleteInEditMode={handleDeleteApp}
              />
            </div>,
          );
        // 空格只在当前页拖拽期间临时挂载：保留精确命中与骨架反馈，
        // 静止时不再让布局检查器/无障碍树识别整页空 DOM 网格。
        } else if (
          isDragging
          && pageIndex === currentPage
          && !coveredCells.has(`${r}:${c}`)
        ) {
          cells.push(
            <div
              key={`empty-${r}-${c}`}
              data-cell="1"
              data-row={r}
              data-col={c}
              data-page={pageIndex}
              aria-hidden="true"
              className="flex items-end justify-center rounded-xl"
              style={{
                gridColumnStart: c + 1,
                gridRowStart: r + 1,
                minHeight: desktopGridMetrics.rowHeightPx,
              }}
            >
              <SkeletonIcon iconPx={desktopIconMetrics.iconPx} />
            </div>,
          );
        }
      }
    }

    return (
      <div
        data-page-grid={pageIndex}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${renderRows}, ${desktopGridMetrics.rowHeightPx}px)`,
          columnGap: gridColumnGapPx,
          rowGap: gridRowGapPx,
          justifyItems: 'center',
        }}
      >
        {cells}
      </div>
    );
  };

  const ghostWidgetLayout = ghost?.item.type === 'widget'
    ? getWidgetLayoutMetrics(
      ghost.item.widgetType,
      desktopIconMetrics.iconPx,
      viewport.isWide,
      desktopGridMetrics.rowHeightPx,
      gridRowGapPx,
    )
    : null;
  const GhostWidgetComponent = ghost?.item.type === 'widget'
    ? getWidgetComponent(ghost.item.widgetType)
    : null;
  const ghostExpandedFolderLayout = ghost?.item.type === 'folder'
    && ghost.item.folderLayout
    && ghost.item.folderLayout !== '1x1'
    ? getExpandedFolderLayoutMetrics(
      ghost.item.folderLayout,
      desktopIconMetrics,
      largeFolderLayout,
    )
    : null;
  const desktopShellStyle = {
    left: viewport.shell.left,
    top: viewport.shell.top,
    width: viewport.shell.width,
    height: viewport.shell.height,
    WebkitTouchCallout: 'none',
    WebkitTapHighlightColor: 'transparent',
    '--desktop-sheet-max-height': `${Math.max(1, viewport.shell.height * 0.85)}px`,
    '--desktop-clock-font-size': `${Math.min(88, Math.max(56, desktopGridMetrics.contentWidthPx * 0.14))}px`,
    '--desktop-combined-clock-font-size': `${Math.min(80, Math.max(52, desktopGridMetrics.contentWidthPx * 0.13))}px`,
  } as React.CSSProperties;

  return (
    <div
      className="fixed overflow-hidden select-none"
      data-desktop-shell="true"
      data-viewport-wide={viewport.isWide ? 'true' : 'false'}
      data-style={settings.style}
      style={desktopShellStyle}
      onContextMenu={(e) => {
        // 输入框 / 文本域长按唤起系统菜单，不拦截
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, [contenteditable]')) return;
        e.preventDefault();
      }}
    >
      {/* 壁纸背景 —— neumorphism 不使用壁纸，固定浅灰色背景 */}
      {settings.style === 'neumorphism' ? (
        <div className="absolute inset-0 neu-bg" data-desktop-layer="true" />
      ) : settings.bgType === 'video' && bgVideoSource ? (
        <video
          key={bgVideoSource}
          className="absolute inset-0 w-full h-full object-cover"
          data-desktop-layer="true"
          src={bgVideoSource}
          autoPlay loop muted playsInline
        />
      ) : settings.bgType === 'image' && bgImageSource && !bgLoadFailed ? (
        <img
          key={bgImageSource}
          src={bgImageSource}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover"
          data-desktop-layer="true"
          onError={(event) => {
            // key 会为新地址创建新节点；额外核对 src，忽略旧请求迟到的错误事件。
            if (event.currentTarget.getAttribute('src') !== bgImageSource) return;
            // 加载失败（链接失效/图床防盗链/格式异常）：回退默认渐变，避免静默空白
            setBgLoadFailed(true);
            if (!bgErrorToastRef.current) {
              bgErrorToastRef.current = true;
              toast.error('壁纸加载失败，已回退默认背景');
            }
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-background" data-desktop-layer="true" />
      )}
      {/* 光晕叠层：仅毛玻璃 + 无自定义壁纸时显示 */}
      {settings.style !== 'neumorphism' && !settings.bgImage && !settings.bgVideo && (
        <div className="absolute inset-0 opacity-30" data-desktop-layer="true">
          <div className="absolute top-[10%] left-[15%] w-72 h-72 rounded-full bg-primary/20 blur-[100px]" />
          <div className="absolute bottom-[20%] right-[10%] w-96 h-96 rounded-full bg-accent/20 blur-[120px]" />
          <div className="absolute top-[40%] right-[30%] w-64 h-64 rounded-full bg-purple-500/15 blur-[90px]" />
        </div>
      )}
      {/* 背景遮罩：毛玻璃模式下启用，始终在壁纸上层 */}
      {settings.style !== 'neumorphism' &&
        settings.bgOverlayEnabled &&
        (settings.applyOverlayToWallpaper || (!settings.bgImage && !settings.bgVideo)) && (
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          data-desktop-layer="true"
          style={{ background: getOverlayGradient(settings.bgOverlayScheme ?? 'aurora') }}
        />
      )}

      {/* 主内容区（无单独 widget 头部，全部在统一网格中） */}
      <div ref={containerRef} className="relative z-10 flex flex-col h-full" data-desktop-layer="true">
        {/* 统一网格：widget 行 + 应用图标行全在同一个 grid 中；监听 swipe 手势翻页 */}
        <div
          ref={swipeContainerRef}
          className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto min-h-0"
          style={{ touchAction: 'pan-y' }}
        >
          {loading ? (
            /* 加载骨架屏：只在初次加载时显示 */
            <div
              className={`${pagePaddingClass} flex shrink-0 justify-center`}
              style={pageVerticalPaddingStyle}
            >
              <div className="w-full" style={{ maxWidth: desktopGridMetrics.contentWidthPx }}>
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${gridRows}, ${desktopGridMetrics.rowHeightPx}px)`,
                    columnGap: gridColumnGapPx,
                    rowGap: gridRowGapPx,
                    alignItems: 'end',
                    justifyItems: 'center',
                  }}
                >
                  {Array.from({ length: gridCols * gridRows }).map((_, i) => (
                    <SkeletonIcon key={`sk-${i}`} iconPx={desktopIconMetrics.iconPx} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* 横向滑轨：所有页（含隐私页）并排常驻，AppIcon 不卸载；
               transform 由页面切换 effect / 跟手手势直接驱动（不走 React 渲染，保证流畅） */
            <div
              ref={pageTrackRef}
              className="flex shrink-0 items-start will-change-transform"
              style={{
                transform: `translateX(${-getPageTrackIndex(
                  currentPage,
                  privacyPageCount,
                  leadingPrivacyDropPage,
                ) * 100}%)`,
              }}
            >
              {leadingPrivacyDropPage && (
                <div
                  key="page-layer-leading-privacy-drop"
                  aria-hidden={currentPage !== -(privacyPageCount + 1)}
                  {...(currentPage === -(privacyPageCount + 1) ? {} : { inert: '' })}
                  className={`w-full shrink-0 ${pagePaddingClass}`}
                  style={pageVerticalPaddingStyle}
                >
                  <div className="relative w-full mx-auto" style={{ maxWidth: desktopGridMetrics.contentWidthPx }}>
                    <div className={`pointer-events-none absolute inset-x-0 top-2 z-10 text-center text-xs ${
                      settings.style === 'neumorphism' ? 'text-slate-500' : 'text-white/70'
                    }`}>
                      松开放置并创建隐私页 {-(privacyPageCount + 1)}
                    </div>
                    {renderPageGrid(-(privacyPageCount + 1), [])}
                  </div>
                </div>
              )}
              {privacyPageNumbers.map((privacyPage) => (
                <div
                  key={`privacy-page-layer-${privacyPage}`}
                  aria-hidden={currentPage !== privacyPage}
                  {...(currentPage === privacyPage ? {} : { inert: '' })}
                  className={`w-full shrink-0 ${pagePaddingClass}`}
                  style={pageVerticalPaddingStyle}
                >
                  <div className="w-full mx-auto" style={{ maxWidth: desktopGridMetrics.contentWidthPx }}>
                    {renderPageGrid(
                      privacyPage,
                      privacyPageItems.filter((item) => item.page === privacyPage),
                    )}
                  </div>
                </div>
              ))}
              {data.pages.map((pageData, i) => (
                <div
                  key={`page-layer-${i}`}
                  aria-hidden={currentPage !== i}
                  {...(currentPage === i ? {} : { inert: '' })}
                  className={`w-full shrink-0 ${pagePaddingClass}`}
                  style={pageVerticalPaddingStyle}
                >
                  <div className="w-full mx-auto" style={{ maxWidth: desktopGridMetrics.contentWidthPx }}>
                    {renderPageGrid(i, pageData)}
                  </div>
                </div>
              ))}
              {trailingDropPage && (
                <div
                  key="page-layer-trailing-drop"
                  aria-hidden={currentPage !== data.pages.length}
                  {...(currentPage === data.pages.length ? {} : { inert: '' })}
                  className={`w-full shrink-0 ${pagePaddingClass}`}
                  style={pageVerticalPaddingStyle}
                >
                  <div className="relative w-full mx-auto" style={{ maxWidth: desktopGridMetrics.contentWidthPx }}>
                    <div className={`pointer-events-none absolute inset-x-0 top-2 z-10 text-center text-xs ${
                      settings.style === 'neumorphism' ? 'text-slate-500' : 'text-white/70'
                    }`}>
                      松开放置并创建新桌面页
                    </div>
                    {renderPageGrid(data.pages.length, [])}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* 短网格用剩余空间将指示器推至视口底部；长网格则让它自然排在网格末尾。 */}
          <div
            data-page-indicator-flow="true"
            className="mt-auto flex shrink-0 items-center justify-center gap-1.5"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}
          >
          {leadingPrivacyDropPage && (
            <span
              className={`h-1.5 w-4 rounded-full ${settings.style === 'neumorphism' ? 'bg-blue-500' : 'bg-white'}`}
              aria-label={`拖拽新隐私页 ${-(privacyPageCount + 1)}`}
            />
          )}
          {privacyPageNumbers.map((privacyPage) => (
            <button
              key={`privacy-page-${privacyPage}`}
              type="button"
              title={currentPage === privacyPage && privacyUnlocked
                ? '再次点击锁定隐私桌面'
                : `打开隐私桌面 ${privacyPage}`}
              aria-label={`隐私桌面 ${privacyPage}`}
              onClick={() => {
                if (currentPage === privacyPage && privacyUnlocked) {
                  void lockPrivacy()
                    .then(() => navigateToPage(-1))
                    .catch(() => toast.error('隐私数据加密保存失败，请稍后重试'));
                  return;
                }
                navigateToPage(privacyPage);
              }}
              className={`flex items-center justify-center w-4 h-4 transition-all duration-300 ${
                currentPage === privacyPage ? 'opacity-100' : 'opacity-40 hover:opacity-70'
              }`}
            >
              <svg viewBox="0 0 12 14" fill="none" className={`w-3 h-3 ${settings.style === 'neumorphism' ? 'text-blue-500' : 'text-white'}`}>
                <rect x="1" y="6" width="10" height="7" rx="1.5" fill="currentColor" opacity={currentPage === privacyPage ? '1' : '0.7'} />
                <path d="M3 6V4a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          ))}
          {data.pages.map((_, i) => (
            <button
              key={`page-${i}`}
              type="button"
              onClick={() => navigateToPage(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentPage
                  ? `w-4 ${settings.style === 'neumorphism' ? 'bg-blue-500' : 'bg-white'}`
                  : `w-1.5 ${settings.style === 'neumorphism' ? 'bg-slate-400 hover:bg-slate-500' : 'bg-white/40 hover:bg-white/60'}`
              }`}
            />
          ))}
          {trailingDropPage && (
            <span
              className={`h-1.5 w-4 rounded-full ${settings.style === 'neumorphism' ? 'bg-blue-500' : 'bg-white'}`}
              aria-label="拖拽新桌面页"
            />
          )}
          </div>
        </div>
      </div>

      {/* 文件夹展开 */}
      {openFolder && (
        <React.Suspense fallback={null}>
          <FolderView
            folder={openFolder}
            onClose={() => { setOpenFolderId(null); setFolderRenameId(null); }}
            onLongPress={handleLongPress}
            onItemClick={handleFolderItemClick}
            triggerRenameId={folderRenameId}
            onRenameDone={() => setFolderRenameId(null)}
            onDragIntentStart={() => setContextMenu(null)}
            onDragOutBegin={(child, folderId, x, y, pointerId) => {
              // 不在此处关闭文件夹：遮罩已 pointer-events:none，onUp 落点后再关
              handleDragFromFolder(child, folderId, x, y, pointerId);
            }}
          />
        </React.Suspense>
      )}

      {/* 添加应用弹窗 */}
      {addDialogOpen && (
        <React.Suspense fallback={null}>
          <AddEditDialog
            open
            onOpenChange={(v) => { setAddDialogOpen(v); if (!v) setClipPrefill(null); }}
            onAdd={handleAddApp}
            prefill={clipPrefill ?? undefined}
          />
        </React.Suspense>
      )}

      {/* 编辑应用弹窗 */}
      {editingItem && (
        <React.Suspense fallback={null}>
          <AddEditDialog
            open
            onOpenChange={(v) => !v && setEditingItem(null)}
            item={editingItem}
            onEdit={handleEditApp}
            onDelete={handleDeleteApp}
          />
        </React.Suspense>
      )}

      {/* ContextMenu */}
      {contextMenu && !isDragging && (
        <React.Suspense fallback={null}><ContextMenu
          pos={contextMenu}
          onEdit={(id) => {
            // 先在普通桌面页查找
            let found = data.pages.flat().find((it) => it.id === id);
            if (!found) {
              for (const page of data.pages) {
                for (const item of page) {
                  if (item.type === 'folder') {
                    const child = item.children?.find((c) => c.id === id);
                    if (child) { found = child; break; }
                  }
                }
                if (found) break;
              }
            }
            // 普通桌面没找到，去隐私桌面找
            if (!found) found = privacyPageItems.find((it) => it.id === id);
            if (!found) {
              for (const item of privacyPageItems) {
                const child = item.children?.find((candidate) => candidate.id === id);
                if (child) { found = child; break; }
              }
            }
            if (found) setEditingItem(found);
          }}
          onDelete={(id) => handleDeleteApp(id)}
          onRenameFolder={(id) => {
            setOpenFolderId(id);
            // 延迟触发重命名，等文件夹视图打开后激活输入框
            setTimeout(() => setFolderRenameId(id), 100);
          }}
          onOpenFolder={(id) => {
            setOpenFolderId(id);
            setFolderRenameId(null);
          }}
          onDissolveFolder={(id) => {
            dissolveFolder(id);
            toast.success('文件夹已解散');
          }}
          onFolderLayoutChange={(id, layout) => {
            if (!setFolderLayout(id, layout)) {
              toast.error('空间不足');
              return;
            }
          }}
          onClose={() => setContextMenu(null)}
        /></React.Suspense>
      )}

      {openSettings && (
        <React.Suspense fallback={null}>
          <SettingsView open onClose={() => setOpenSettings(false)} />
        </React.Suspense>
      )}
      {openSync && (
        <React.Suspense fallback={null}>
          <SyncView open onClose={() => setOpenSync(false)} />
        </React.Suspense>
      )}
      {/* 隐私屏遮罩：进入隐私桌面且未解锁时显示 */}
      {currentPage < 0 && !privacyUnlocked && (
        <React.Suspense fallback={null}>
          <PrivacyScreen
            onUnlock={handleUnlock}
            onClose={() => navigateToPage(0)}
          />
        </React.Suspense>
      )}

      {/* 统一拖拽 Ghost：widget 渲染真实组件，app 显示图标 */}
      {ghost && (
        <div
          ref={ghostLayerRef}
          data-drag-ghost="true"
          className={`fixed pointer-events-none z-[300] transition-none ${ghost.item.type === 'folder' ? '' : 'opacity-80'}`}
          style={{
            left: 0,
            top: 0,
            transform: 'translate3d(0, 0, 0) translate(-50%, -50%)',
            willChange: 'transform',
            contain: 'layout paint style',
            width: ghostExpandedFolderLayout?.widthPx,
            height: ghostExpandedFolderLayout?.totalHeightPx,
          }}
          // 位置完全由 useEffect（初始）和 onMove（实时）通过直接 DOM 操作维护，
          // 不放在 React style prop 中，防止 re-render 时坐标被重置到拖拽起点
        >
          <div className="drag-lift" data-drag-type={ghost.item.type}>
            {ghost.item.type === 'widget' ? (
              <div
                className="flex items-center overflow-hidden bg-white/5 backdrop-blur-sm"
                style={{
                  width: ghostWidgetLayout?.ghostWidthPx,
                  minHeight: ghostWidgetLayout?.cellMinHeightPx,
                  borderRadius: ghostWidgetLayout?.ghostRadiusPx,
                }}
              >
                {/* w-full 确保 widget 内部的 items-center 能基于完整宽度居中 */}
                <div className="w-full">
                  {GhostWidgetComponent ? <GhostWidgetComponent /> : null}
                </div>
              </div>
            ) : (
              <AppIcon
                item={ghost.item}
                size="normal"
                iconPx={desktopIconMetrics.iconPx}
                largeFolderLayout={largeFolderLayout}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// 辅助：查找项位置
function findItem(
  pages: DesktopItem[][],
  id: string,
): { page: number; row: number; col: number } | null {
  for (let p = 0; p < pages.length; p++) {
    const item = pages[p].find((it) => it.id === id);
    if (item) return { page: p, row: item.row, col: item.col };
  }
  return null;
}

export default Desktop;
