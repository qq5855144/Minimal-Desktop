import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDesktop, MAX_ROWS, MAX_COLS, MAX_FOLDER_APPS } from '@/contexts/DesktopContext';
import type { DesktopItem, DragSource, BgOverlayScheme } from '@/types';
import { getIconLayoutMetrics } from '@/lib/iconLayout';
import { getWidgetLayoutMetrics } from '@/lib/widgetLayout';
import { getWidgetComponent } from './widgetRenderer';
import AppIcon from './AppIcon';
import SkeletonIcon from './SkeletonIcon';
import WidgetGridCell from './WidgetGridCell';
import FolderView from './FolderView';
import AddEditDialog from './AddEditDialog';
import SettingsView from './SettingsView';
import SyncView from './SyncView';
import ContextMenu, { type ContextMenuPosition } from './ContextMenu';
import { toast } from 'sonner';

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
    addItem,
    updateItem,
    removeItem,
    moveItemTo,
    swapDesktopItems,
    mergeToFolder,
    moveFromFolderToDesktop,
    dissolveFolder,
  } = useDesktop();

  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [folderRenameId, setFolderRenameId] = useState<string | null>(null);
  const openFolder = openFolderId
    ? data.pages.flat().find((it) => it.id === openFolderId) ?? null
    : null;
  const [openSettings, setOpenSettings] = useState(false);
  const [openSync, setOpenSync] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DesktopItem | null>(null);
  // 剪藏预填数据（扩展工具栏点击后传入）
  const [clipPrefill, setClipPrefill] = useState<{ name: string; url: string; iconUrl?: string } | null>(null);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const edgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ghostLayerRef = useRef<HTMLDivElement>(null);

  const [ghost, setGhost] = useState<GhostState | null>(null);
  const ghostRef = useRef<GhostState | null>(null);
  const mergeHoverIdRef = useRef<string | null>(null);
  // 同步跟踪当前悬停的目标图标 ID（onMove 实时写入，onUp 最先读取后清零）
  const dragOverItemRef = useRef<string | null>(null);

  // 响应式列数：始终使用用户设置，桌面端不强制扩展为 MAX_COLS（避免图标偏左不对称）
  const [screenMd, setScreenMd] = useState<boolean>(
    () => window.matchMedia('(min-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setScreenMd(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // 实际渲染列数：始终使用用户设置（4 或 5），不随屏幕宽度强制变为 6
  const gridCols = settings.cols ?? 4;

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

  useEffect(() => { ghostRef.current = ghost; }, [ghost]);

  // ghost 出现时通过直接 DOM 操作设置初始位置，避免 React style prop 在 re-render 时重置坐标
  useEffect(() => {
    if (!ghost) return;
    const el = ghostLayerRef.current;
    if (!el) return;
    if (ghost.item.type === 'widget') {
      el.style.left = `${ghost.x}px`;
      el.style.top = `${ghost.y}px`;
      el.style.transform = 'translate(-50%, -50%)';
    } else {
      el.style.left = `${ghost.x}px`;
      el.style.top = `${ghost.y}px`;
      el.style.transform = 'translate(-50%, -50%)';
    }
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

  const latestRef = useRef({
    data, currentPage, gridCols, moveItemTo, swapDesktopItems, mergeToFolder,
    moveFromFolderToDesktop, gridRows: settings.rows ?? 7,
    setCurrentPage, clearEdgeFn: null as (() => void) | null,
  });
  React.useLayoutEffect(() => {
    latestRef.current = {
      data, currentPage, gridCols, moveItemTo, swapDesktopItems, mergeToFolder,
      moveFromFolderToDesktop, gridRows: settings.rows ?? 7,
      setCurrentPage, clearEdgeFn: latestRef.current.clearEdgeFn,
    };
  });

  const clearEdgeTimer = useCallback(() => {
    if (edgeTimerRef.current) { clearTimeout(edgeTimerRef.current); edgeTimerRef.current = null; }
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
    const { currentPage: page, data: d, setCurrentPage: nav } = latestRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const relX = clientX - rect.left;
    if (relX < EDGE_THRESHOLD && page > 0) {
      if (!edgeTimerRef.current) edgeTimerRef.current = setTimeout(() => { nav(page - 1); clearEdgeTimer(); }, EDGE_DELAY);
    } else if (relX > rect.width - EDGE_THRESHOLD && page < d.pages.length - 1) {
      if (!edgeTimerRef.current) edgeTimerRef.current = setTimeout(() => { nav(page + 1); clearEdgeTimer(); }, EDGE_DELAY);
    } else {
      clearEdgeTimer();
    }
  }, [clearEdgeTimer]);

  // 全局 pointer 监听
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = ghostRef.current;
      if (!g) return;
      g.x = e.clientX;
      g.y = e.clientY;
      if (ghostLayerRef.current) {
        const el = ghostLayerRef.current;
        if (g.item.type === 'widget') {
          el.style.left = `${e.clientX}px`;
          el.style.top = `${e.clientY}px`;
          el.style.transform = 'translate(-50%, -50%)';
        } else {
          el.style.left = `${e.clientX}px`;
          el.style.top = `${e.clientY}px`;
          el.style.transform = 'translate(-50%, -50%)';
        }
      }
      handleEdgeHover(e.clientX);

      // 用几何矩形检测穿透 ghost：遍历所有带 data-itemid 的格子，判断指针是否在其内
      // 比 elementsFromPoint 更可靠，不受 z-index / pointer-events 影响
      let hoverId: string | null = null;
      const itemCells = document.querySelectorAll<HTMLElement>('[data-cell][data-itemid]');
      for (const cellEl of itemCells) {
        const r = cellEl.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          hoverId = cellEl.dataset.itemid!;
          break;
        }
      }

      // 提前查询悬停目标项类型：用于判断是否可合并、是否高亮
      const { data: dataNow } = latestRef.current;
      const hoverItem = hoverId !== null
        ? dataNow.pages.flat().find(it => it.id === hoverId) ?? null
        : null;
      const isHoverWidget = hoverItem?.type === 'widget';

      // 文件夹拖出时不高亮 widget（无法合并/放置），避免误导用户以为可放入组件
      const isFolderDrag = g.source.type === 'folder';
      const effectiveHoverId = (isFolderDrag && isHoverWidget) ? null : (hoverId ?? null);
      if (effectiveHoverId !== dragOverItemRef.current) {
        setDragOverItem(effectiveHoverId);
        dragOverItemRef.current = effectiveHoverId;
      }

      // 仅桌面图标参与悬停合并；widget/system/dock(page=-1)全部排除
      // 提前排除 widget/system 目标，避免启动 800ms 计时器后才发现无法合并
      const isDesktopDrag = g.source.type === 'desktop' || g.source.type === 'folder';
      const isValidMergeTarget =
        hoverId !== null &&
        hoverId !== g.source.itemId &&
        isDesktopDrag &&
        hoverItem !== null &&
        hoverItem.type !== 'widget' &&
        hoverItem.type !== 'system';

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
            const { data: d, mergeToFolder: merge } = latestRef.current;
            const dragItem = cur.source.type === 'folder'
              ? d.pages.flat().find((it) => it.id === cur.source.folderId)?.children?.find((child) => child.id === cur.source.itemId)
              : d.pages.flat().find((it) => it.id === cur.source.itemId);
            const target = d.pages.flat().find(it => it.id === hoverIdNonNull);
            // widget / system 不参与合并（兜底：数据可能在 800ms 内变化）
            if (dragItem?.type === 'widget' || target?.type === 'widget') return;
            if (!target || target.type === 'system') return;
            // 阻止 folder 拖入 folder（避免无限嵌套）
            if (dragItem?.type === 'folder' && target.type === 'folder') {
              toast.error('暂不支持文件夹嵌套');
              return;
            }
            // 检查目标文件夹容量
            if (target.type === 'folder' && (target.children?.length ?? 0) >= MAX_FOLDER_APPS) {
              toast.error('文件夹已满，最多容纳 9 个图标');
              return;
            }
            const merged = merge(
              cur.source.itemId,
              hoverIdNonNull,
              cur.source.type === 'folder' ? cur.source.folderId : undefined,
            );
            if (!merged) return;
            // 合并成功后若来源是文件夹，需立即关闭文件夹：
            // onUp 会因 ghostRef 已被清空而提前 return，跳过关闭逻辑，
            // 导致 openFolderId 残留、文件夹遮罩（已被 DOM display:none 隐藏）无法再次打开
            const wasFromFolder = cur.source.type === 'folder';
            ghostRef.current = null;
            setGhost(null);
            setIsDragging(false);
            setDragSource(null);
            setDragOverItem(null);
            dragOverItemRef.current = null;
            mergeHoverIdRef.current = null;
            mergeTimerRef.current = null;
            if (wasFromFolder) {
              setOpenFolderId(null);
              setFolderRenameId(null);
            }
          }, MERGE_DELAY);
        }
        // hoverId 未变化 → 继续等待计时器，无需任何操作
      } else {
        // 离开有效合并目标（到空白、回到自身、非桌面拖拽、widget/system）→ 清除计时器
        clearMergeTimer();
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = ghostRef.current;
      dragOverItemRef.current = null;
      ghostRef.current = null;
      setGhost(null);
      setIsDragging(false);
      setDragSource(null);
      setDragOverItem(null);
      clearEdgeTimer();
      clearMergeTimer(); // 若 800ms 计时器还未触发，取消它（快速松手走交换分支）
      if (!g) return;

      // 文件夹拖出：无论是否命中有效格子都关闭文件夹
      if (g.source.type === 'folder') {
        setOpenFolderId(null);
        setFolderRenameId(null);
      }

      const { data: d, currentPage: cp,
              moveItemTo: moveTo,
              swapDesktopItems: swap,
              moveFromFolderToDesktop: moveOut,
              gridCols: gc } = latestRef.current;
      const isWidget = g.item.type === 'widget';

      // 几何矩形检测落点格子（含空格子），不受 z-index/pointer-events 影响
      let cell: HTMLElement | null = null;
      const allCells = document.querySelectorAll<HTMLElement>('[data-cell]');
      for (const cellEl of allCells) {
        const r = cellEl.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          cell = cellEl; break;
        }
      }
      // 落在行/列间隙时（gap 区域无命中），改为找中心点最近的格子，
      // 避免触发 findFirstEmpty 把图标甩到第一行
      if (!cell) {
        let minDist = Infinity;
        for (const cellEl of allCells) {
          const r = cellEl.getBoundingClientRect();
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
          if (dist < minDist) { minDist = dist; cell = cellEl; }
        }
      }
      // 极端情况（指针完全飞出屏幕外）：findFirstEmpty 兜底
      if (!cell) {
        const { data: d2, currentPage: cp2, gridCols: gc2, gridRows: gr } = latestRef.current;
        const slot = findFirstEmpty(d2.pages, cp2, g.source.itemId, gc2, gr);
        if (!slot) return;
        if (g.source.type === 'folder' && g.source.folderId) {
          const { moveFromFolderToDesktop: moveOut2 } = latestRef.current;
          moveOut2(g.source.folderId, g.source.itemId, slot.page, slot.row, slot.col);
        } else if (g.source.type === 'desktop') {
          const { moveItemTo: moveTo2 } = latestRef.current;
          const src2 = findItem(d2.pages, g.source.itemId);
          if (src2) moveTo2(g.source.itemId, src2.page, slot.page, slot.row, slot.col);
        }
        return;
      }

      const targetRow = Number(cell.dataset.row);
      const rawPage = Number(cell.dataset.page);
      const targetPage = isNaN(rawPage) ? cp : rawPage;
      // 截断 col：防止旧数据 col >= gridCols 导致 item 落入不可见列消失
      const rawCol = isWidget ? 0 : Number(cell.dataset.col);
      const targetCol = isNaN(rawCol) ? 0 : Math.min(rawCol, gc - 1);
      const targetItemId = cell.dataset.itemid ?? null;

      if (!isWidget) {
        // widget 独占整行，不允许其他图标放入该行
        const widgetOnRow = d.pages[targetPage]?.find(it => it.row === targetRow && it.type === 'widget');
        if (widgetOnRow) return;
        if (targetItemId) {
          const tgt = d.pages[targetPage]?.find(it => it.id === targetItemId);
          if (tgt?.type === 'widget') return; // widget 格子不可放置
        }
      }

      // ── 文件夹拖出到桌面 ──
      if (g.source.type === 'folder') {
        if (g.source.folderId) {
          moveOut(g.source.folderId, g.source.itemId, targetPage, targetRow, targetCol);
        }
        return;
      }

      // ── 桌面图标拖拽 ──
      if (g.source.type === 'desktop') {
        const src = findItem(d.pages, g.source.itemId);
        if (!src) return;

        if (isWidget) {
          // ── 组件拖拽 ──
          // 用行的 Y 范围确定目标行：优先命中，其次最近边缘距离（gap区精准）
          type RowBound = { top: number; bottom: number };
          const rowBounds = new Map<number, RowBound>();
          for (const cellEl of allCells) {
            const rPage = Number(cellEl.dataset.page);
            if (rPage !== targetPage) continue;
            const rNum = Number(cellEl.dataset.row);
            const rect = cellEl.getBoundingClientRect();
            const prev = rowBounds.get(rNum);
            if (!prev) {
              rowBounds.set(rNum, { top: rect.top, bottom: rect.bottom });
            } else {
              rowBounds.set(rNum, {
                top: Math.min(prev.top, rect.top),
                bottom: Math.max(prev.bottom, rect.bottom),
              });
            }
          }
          let widgetTargetRow = targetRow;
          let hit = false;
          // 第一步：直接命中
          rowBounds.forEach((b, rowIdx) => {
            if (!hit && e.clientY >= b.top && e.clientY <= b.bottom) {
              widgetTargetRow = rowIdx; hit = true;
            }
          });
          // 第二步：在行间隙时 → 比较到各行最近边缘距离（避免中心距偏向高行）
          if (!hit) {
            let minEdgeDist = Infinity;
            rowBounds.forEach((b, rowIdx) => {
              const dist = e.clientY < b.top ? b.top - e.clientY : e.clientY - b.bottom;
              if (dist < minEdgeDist) { minEdgeDist = dist; widgetTargetRow = rowIdx; }
            });
          }

          // 检查落点是否是另一个组件（widget ↔ widget 交换）
          const targetPageItems = d.pages[targetPage] ?? [];
          const otherWidget = targetPageItems.find(
            it => it.row === widgetTargetRow && it.type === 'widget' && it.id !== g.source.itemId,
          );

          if (otherWidget) {
            // 两个组件互换行位置
            swap(
              g.source.itemId, src.page, src.row, '0',
              otherWidget.id, targetPage, otherWidget.row, '0',
            );
          } else {
            // 检查目标行是否有普通应用（排除自身）
            const hasApps = targetPageItems.some(
              it => it.row === widgetTargetRow && it.id !== g.source.itemId && it.type !== 'widget',
            );
            if (hasApps) {
              toast.error('空间不足');
              return; // 不移动，组件自动复位
            }
            moveTo(g.source.itemId, src.page, targetPage, widgetTargetRow, 0);
          }
        } else if (!targetItemId || targetItemId === g.source.itemId) {
          // 普通图标落在空格或自身格 → 移动
          moveTo(g.source.itemId, src.page, targetPage, targetRow, targetCol);
        } else {
          // 落在其他图标上（快速松手，未满 800ms）→ 交换位置
          const tgt = d.pages[targetPage]?.find(it => it.id === targetItemId);
          if (!tgt || tgt.type === 'widget') return;
          swap(
            g.source.itemId, src.page, src.row, String(src.col),
            tgt.id, tgt.page, tgt.row, String(tgt.col),
          );
        }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    // pointercancel：浏览器取消指针序列时（如系统手势介入）清理拖拽状态，防止 ghost 残留
    const onCancel = () => {
      if (!ghostRef.current) return;
      ghostRef.current = null;
      setGhost(null);
      setIsDragging(false);
      setDragSource(null);
      setDragOverItem(null);
      clearEdgeTimer();
      clearMergeTimer();
    };
    document.addEventListener('pointercancel', onCancel);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
  }, [handleEdgeHover, clearEdgeTimer, clearMergeTimer]);

  const handleDragBegin = useCallback((item: DesktopItem, srcType: 'desktop' | 'dock', x: number, y: number) => {
    const source: DragSource = srcType === 'dock'
      ? { type: 'dock', itemId: item.id }
      : { type: 'desktop', itemId: item.id, page: latestRef.current.currentPage };
    const g: GhostState = { item, source, x, y };
    ghostRef.current = g;
    setGhost(g);
    setDragSource(source);
    setIsDragging(true);
  }, []);

  // 从文件夹内拖出到桌面
  const handleDragFromFolder = useCallback((child: DesktopItem, folderId: string, x: number, y: number) => {
    const source: DragSource = { type: 'folder', itemId: child.id, folderId };
    const g: GhostState = { item: child, source, x, y };
    ghostRef.current = g;
    setGhost(g);
    setDragSource(source);
    setIsDragging(true);
  }, []);

  const handleLongPress = useCallback((item: DesktopItem, x: number, y: number) => {
    // widget 暂不支持上下文菜单
    if (item.type === 'widget') return;
    setContextMenu({ x, y, itemId: item.id, isSystem: item.type === 'system', isFolder: item.type === 'folder' });
  }, []);

  const handleSystemClick = useCallback((item: DesktopItem) => {
    if (item.id === 'sys-settings') setOpenSettings(true);
    else if (item.id === 'sys-sync') setOpenSync(true);
    else if (item.id === 'sys-add') setAddDialogOpen(true);
  }, []);

  const handleFolderClick = useCallback((folder: DesktopItem) => {
    setOpenFolderId(folder.id);
  }, []);

  const handleAddApp = useCallback(
    (app: { name: string; url: string; iconUrl?: string }) => {
      addItem(
        { type: 'app', name: app.name, url: app.url, iconUrl: app.iconUrl, color: 'blue' },
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
  const SWIPE_MIN_X = 50;   // 最小水平位移触发翻页
  const SWIPE_MAX_Y = 60;   // 垂直位移超出此值视为滚动，不翻页

  // swipe 翻页容器 ref（与 containerRef 区分）
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  // 用 ref 避免 native touch 回调中的 stale closure
  const currentPageRef = useRef(currentPage);
  const pageCountRef = useRef(data.pages.length);
  const isDraggingRef = useRef(isDragging);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { pageCountRef.current = data.pages.length; }, [data.pages.length]);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);

  // 原生 touch 翻页：touchmove 非 passive 以便 preventDefault 阻止水平滑动时的滚动取消
  useEffect(() => {
    const el = swipeContainerRef.current;
    if (!el) return;
    let startX = 0, startY = 0, tracking = false;

    const onTouchStart = (e: TouchEvent) => {
      if (isDraggingRef.current || ghostRef.current) return;
      const target = e.target as HTMLElement;
      // 输入框内保留浏览器默认长按行为，不启动翻页追踪
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      // 搜索全屏覆盖层打开时禁用翻页（双重保险：SearchScreen 已在原生冒泡阶段 stopPropagation）
      if (target.closest('[data-search-overlay="true"]')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return;
      // 拖拽已开始（ghostRef 同步设置）→ 立即退出翻页追踪，避免 preventDefault 取消指针事件
      if (ghostRef.current) { tracking = false; return; }
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      // 明确水平滑动：阻止浏览器默认行为（防止 pointercancel / scroll 覆盖）
      // cancelable=false 时浏览器已提交原生滚动，跳过以避免控制台警告
      if (dx > dy && dx > 10 && e.cancelable) e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = Math.abs(e.changedTouches[0].clientY - startY);
      if (dy > SWIPE_MAX_Y) return;
      if (dx < -SWIPE_MIN_X && currentPageRef.current < pageCountRef.current - 1) {
        setCurrentPage(currentPageRef.current + 1);
      } else if (dx > SWIPE_MIN_X && currentPageRef.current > 0) {
        setCurrentPage(currentPageRef.current - 1);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false }); // non-passive 以支持 preventDefault
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [setCurrentPage]); // setCurrentPage 是稳定引用

  /**
   * 渲染网格
   * ─ widget 行（row 中 col=0 的项为 widget 类型）：渲染一个 col-span-4 md:col-span-6 全宽单元格
   * ─ 普通行：按列渲染 AppIcon / 空骨架格
   */
  /**
   * 渲染单页网格（pageIndex + items 参数化）
   * 所有页同时挂载，非当前页用 display:none 隐藏，
   * 保证 AppIcon 不随翻页卸载，避免图标重新加载。
   */
  const renderPageGrid = (pageIndex: number, items: DesktopItem[]) => {
    const cells: React.ReactNode[] = [];
    const renderRows = settings.rows ?? 7;
    const iconMetrics = getIconLayoutMetrics('normal', settings.iconSize);

    for (let r = 0; r < renderRows; r++) {
      const widgetItem = items.find((it) => it.row === r && it.col === 0 && it.type === 'widget');

      if (widgetItem) {
        const isGhost = ghost?.source.itemId === widgetItem.id;
        cells.push(
          <div
            key={widgetItem.id}
            data-cell="1"
            data-row={r}
            data-col={0}
            data-page={pageIndex}
            data-itemid={widgetItem.id}
            style={{ gridColumn: `1 / -1` }}
            className={`w-full transition-all duration-150 ${dragOverItem === widgetItem.id ? 'scale-[1.01] brightness-110' : ''}`}
          >
            <WidgetGridCell
              item={widgetItem}
              ghost={isGhost}
              onDragBegin={(it, x, y) => handleDragBegin(it, 'desktop', x, y)}
              onLongPress={(x, y) => handleLongPress(widgetItem, x, y)}
            />
          </div>,
        );
        continue;
      }

      for (let c = 0; c < gridCols; c++) {
        const item = items.find((it) => it.row === r && it.col === c);
        if (item) {
          cells.push(
            <div
              key={item.id}
              data-cell="1"
              data-row={r}
              data-col={c}
              data-page={pageIndex}
              data-itemid={item.id}
              className={`relative transition-all duration-150 ${dragOverItem === item.id ? 'brightness-110 z-10' : ''}`}
            >
              <AppIcon
                item={item}
                ghost={ghost?.source.itemId === item.id}
                onClick={() => {
                  if (item.type === 'folder') handleFolderClick(item);
                  else if (item.type === 'system') handleSystemClick(item);
                }}
                onLongPress={(x, y) => handleLongPress(item, x, y)}
                onDragBegin={(it, x, y) => handleDragBegin(it, 'desktop', x, y)}
                onDeleteInEditMode={(id) => handleDeleteApp(id)}
              />
            </div>,
          );
        } else {
          cells.push(
            <div
              key={`empty-${r}-${c}`}
              data-cell="1"
              data-row={r}
              data-col={c}
              data-page={pageIndex}
              className="flex items-center justify-center rounded-xl"
              style={{ minHeight: iconMetrics.cellMinHeightPx }}
            >
              {isDragging && <SkeletonIcon iconPx={settings.iconSize} />}
            </div>,
          );
        }
      }
    }

    return (
      <div
        className="grid gap-x-3 gap-y-3"
        style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, justifyItems: 'center' }}
      >
        {cells}
      </div>
    );
  };

  const ghostWidgetLayout = ghost?.item.type === 'widget'
    ? getWidgetLayoutMetrics(ghost.item.widgetType, settings.iconSize, screenMd)
    : null;
  const GhostWidgetComponent = ghost?.item.type === 'widget'
    ? getWidgetComponent(ghost.item.widgetType)
    : null;

  return (
    <div
      className="relative w-full h-screen overflow-hidden select-none"
      data-style={settings.style}
      style={{ WebkitTouchCallout: 'none' } as React.CSSProperties}
      onContextMenu={(e) => {
        // 输入框 / 文本域长按唤起系统菜单，不拦截
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, [contenteditable]')) return;
        e.preventDefault();
      }}
    >
      {/* 壁纸背景 —— neumorphism 不使用壁纸，固定浅灰色背景 */}
      {settings.style === 'neumorphism' ? (
        <div className="absolute inset-0 neu-bg" />
      ) : settings.bgType === 'video' && settings.bgVideo ? (
        <video
          className="absolute inset-0 w-full h-full object-cover"
          src={settings.bgVideo}
          autoPlay loop muted playsInline
        />
      ) : settings.bgType === 'image' && settings.bgImage ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${settings.bgImage})` }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-background" />
      )}
      {/* 光晕叠层：仅毛玻璃 + 无自定义壁纸时显示 */}
      {settings.style !== 'neumorphism' && !settings.bgImage && !settings.bgVideo && (
        <div className="absolute inset-0 opacity-30">
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
          style={{ background: getOverlayGradient(settings.bgOverlayScheme ?? 'aurora') }}
        />
      )}

      {/* 主内容区（无单独 widget 头部，全部在统一网格中） */}
      <div ref={containerRef} className="relative z-10 flex flex-col h-full">
        {/* 统一网格：widget 行 + 应用图标行全在同一个 grid 中；监听 swipe 手势翻页 */}
        <div
          ref={swipeContainerRef}
          className="flex-1 flex items-start justify-center px-4 md:px-8 pt-2 pb-2 overflow-y-auto min-h-0"
        >
          <div className="w-full max-w-2xl">
            {loading ? (
              /* 加载骨架屏：只在初次加载时显示 */
              <div className="grid gap-x-3 gap-y-3" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
                {Array.from({ length: gridCols * (settings.rows ?? 7) }).map((_, i) => (
                  <SkeletonIcon key={`sk-${i}`} iconPx={settings.iconSize} />
                ))}
              </div>
            ) : (
              /* 所有页同时挂载，非当前页用 display:none 隐藏，AppIcon 不卸载 → 不重新加载图标 */
              data.pages.map((pageData, i) => (
                <div key={`page-layer-${i}`} className={i === currentPage ? undefined : 'hidden'}>
                  {renderPageGrid(i, pageData)}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 页面指示器 */}
        <div className="flex items-center justify-center gap-1.5 pb-3">
          {data.pages.map((_, i) => (
            <button
              key={`page-${i}`}
              type="button"
              onClick={() => setCurrentPage(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentPage
                  ? `w-4 ${settings.style === 'neumorphism' ? 'bg-blue-500' : 'bg-white'}`
                  : `w-1.5 ${settings.style === 'neumorphism' ? 'bg-slate-400 hover:bg-slate-500' : 'bg-white/40 hover:bg-white/60'}`
              }`}
            />
          ))}
        </div>
      </div>

      {/* 文件夹展开 */}
      {openFolder && (
        <FolderView
          folder={openFolder}
          onClose={() => { setOpenFolderId(null); setFolderRenameId(null); }}
          onLongPress={(item, x, y) => handleLongPress(item, x, y)}
          triggerRenameId={folderRenameId}
          onRenameDone={() => setFolderRenameId(null)}
          onDragOutBegin={(child, folderId, x, y) => {
            // 不在此处关闭文件夹：遮罩已 pointer-events:none，onUp 落点后再关
            handleDragFromFolder(child, folderId, x, y);
          }}
        />
      )}

      {/* 添加应用弹窗 */}
      <AddEditDialog
        open={addDialogOpen}
        onOpenChange={(v) => { setAddDialogOpen(v); if (!v) setClipPrefill(null); }}
        onAdd={handleAddApp}
        prefill={clipPrefill ?? undefined}
      />

      {/* 编辑应用弹窗 */}
      <AddEditDialog
        open={!!editingItem}
        onOpenChange={(v) => !v && setEditingItem(null)}
        item={editingItem}
        onEdit={handleEditApp}
        onDelete={handleDeleteApp}
      />

      {/* ContextMenu */}
      {contextMenu && !contextMenu.isSystem && (
        <ContextMenu
          pos={contextMenu}
          onEdit={(id) => {
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
            if (found) setEditingItem(found);
          }}
          onDelete={(id) => handleDeleteApp(id)}
          onRenameFolder={(id) => {
            setOpenFolderId(id);
            // 延迟触发重命名，等文件夹视图打开后激活输入框
            setTimeout(() => setFolderRenameId(id), 100);
          }}
          onDissolveFolder={(id) => {
            dissolveFolder(id);
            toast.success('文件夹已解散');
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      <SettingsView open={openSettings} onClose={() => setOpenSettings(false)} />
      <SyncView open={openSync} onClose={() => setOpenSync(false)} />

      {/* 统一拖拽 Ghost：widget 渲染真实组件，app 显示图标 */}
      {ghost && (
        <div
          ref={ghostLayerRef}
          className="fixed pointer-events-none z-[300] opacity-80 transition-none"
          // 位置完全由 useEffect（初始）和 onMove（实时）通过直接 DOM 操作维护，
          // 不放在 React style prop 中，防止 re-render 时坐标被重置到拖拽起点
        >
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
            <AppIcon item={ghost.item} size="normal" />
          )}
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

// 辅助：在 preferPage 上找第一个空格（跳过被拖拽项自身），用于边缘松手时的回退落点
function findFirstEmpty(
  pages: DesktopItem[][],
  preferPage: number,
  excludeId?: string,
  maxCols: number = MAX_COLS,
  maxRows: number = MAX_ROWS,
): { page: number; row: number; col: number } | null {
  const order = [preferPage, ...Array.from({ length: pages.length }, (_, i) => i).filter(i => i !== preferPage)];
  for (const p of order) {
    for (let r = 0; r < maxRows; r++) {
      if (pages[p].some((it) => it.row === r && it.type === 'widget')) continue;
      for (let c = 0; c < maxCols; c++) {
        const occupied = pages[p].some((it) => it.row === r && it.col === c && it.id !== excludeId);
        if (!occupied) return { page: p, row: r, col: c };
      }
    }
  }
  return null;
}

export default Desktop;
