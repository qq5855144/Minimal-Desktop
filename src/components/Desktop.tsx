import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDesktop, MAX_ROWS, MAX_COLS } from '@/contexts/DesktopContext';
import type { DesktopItem, DragSource } from '@/types';
import AppIcon from './AppIcon';
import SkeletonIcon from './SkeletonIcon';
import WidgetGridCell from './WidgetGridCell';
import FolderView from './FolderView';
import AddEditDialog from './AddEditDialog';
import SettingsView from './SettingsView';
import SyncView from './SyncView';
import ContextMenu, { type ContextMenuPosition } from './ContextMenu';
import { toast } from 'sonner';

// 仅在屏幕最边缘 8px 的极窄区域才触发翻页，避免与边缘列拖拽冲突
const EDGE_THRESHOLD = 8;
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
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const edgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [ghost, setGhost] = useState<GhostState | null>(null);
  const ghostRef = useRef<GhostState | null>(null);
  const mergeHoverIdRef = useRef<string | null>(null);
  // 同步跟踪当前悬停的目标图标 ID（onMove 实时写入，onUp 最先读取后清零）
  const dragOverItemRef = useRef<string | null>(null);

  // 响应式列数：优先使用用户设置(4/5)，桌面端最大 MAX_COLS
  const [screenMd, setScreenMd] = useState<boolean>(
    () => window.matchMedia('(min-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setScreenMd(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // 实际渲染列数：移动端使用 settings.cols，md+ 不超过 MAX_COLS
  const gridCols = screenMd ? MAX_COLS : (settings.cols ?? 4);

  useEffect(() => { ghostRef.current = ghost; }, [ghost]);

  const latestRef = useRef({
    data, currentPage, gridCols, moveItemTo, mergeToFolder,
    moveFromFolderToDesktop,
    setCurrentPage, clearEdgeFn: null as (() => void) | null,
  });
  React.useLayoutEffect(() => {
    latestRef.current = {
      data, currentPage, gridCols, moveItemTo, mergeToFolder,
      moveFromFolderToDesktop,
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
      const next = { ...g, x: e.clientX, y: e.clientY };
      ghostRef.current = next;
      setGhost(next);
      setIsDragging(true);
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
      setDragOverItem(hoverId ?? null);
      // 同步更新 ref，供 onUp 在清理前读取（state 异步，ref 同步）
      dragOverItemRef.current = hoverId;

      // widget 不参与合并，只有普通 app/folder 之间才合并
      if (hoverId && hoverId !== g.source.itemId && g.source.type === 'desktop') {
        if (hoverId !== mergeHoverIdRef.current) {
          clearMergeTimer();
          mergeHoverIdRef.current = hoverId;
          mergeTimerRef.current = setTimeout(() => {
            const cur = ghostRef.current;
            if (!cur) return;
            const { data: d, mergeToFolder: merge } = latestRef.current;
            const dragItem = d.pages.flat().find(it => it.id === cur.source.itemId);
            const target = d.pages.flat().find(it => it.id === hoverId);
            // widget 不合并
            if (dragItem?.type === 'widget' || target?.type === 'widget') return;
            if (target && target.type !== 'system') {
              merge(cur.source.itemId, hoverId);
              toast.success('已创建文件夹');
              ghostRef.current = null;
              setGhost(null);
              setIsDragging(false);
              setDragSource(null);
              setDragOverItem(null);
              mergeHoverIdRef.current = null;
            }
          }, MERGE_DELAY);
        }
      } else if (hoverId === g.source.itemId || g.source.type !== 'desktop') {
        // 回到自身格子或非桌面拖拽时才取消计时器；
        // hoverId=null（空白区）时保持计时器继续，避免手指微抖频繁重置
        clearMergeTimer();
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = ghostRef.current;
      // 在任何清理前捕获松手瞬间的悬停目标（onMove 同步写入，比 pointerup 坐标更可靠）
      const dropTargetId = dragOverItemRef.current;
      dragOverItemRef.current = null;
      ghostRef.current = null;
      setGhost(null);
      setIsDragging(false);
      setDragSource(null);
      setDragOverItem(null);
      clearEdgeTimer();
      clearMergeTimer();
      if (!g) return;

      // 文件夹拖出：无论是否命中有效格子都关闭文件夹
      if (g.source.type === 'folder') {
        setOpenFolderId(null);
        setFolderRenameId(null);
      }

      const { data: d, currentPage: cp,
              moveItemTo: moveTo, moveFromFolderToDesktop: moveOut } = latestRef.current;
      const isWidget = g.item.type === 'widget';

      if (g.source.type === 'folder') {
        // 坐标检测：文件夹拖出落点
        let cell: HTMLElement | null = null;
        const allCells = document.querySelectorAll<HTMLElement>('[data-cell]');
        for (const cellEl of allCells) {
          const r = cellEl.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            cell = cellEl; break;
          }
        }
        if (!cell) return;
        const targetRow = Number(cell.dataset.row);
        const rawPage = Number(cell.dataset.page);
        const targetPage = isNaN(rawPage) ? cp : rawPage;
        const targetCol = Number(cell.dataset.col);
        if (g.source.folderId) {
          moveOut(g.source.folderId, g.source.itemId, targetPage, targetRow, targetCol);
        }
        return;
      }

      if (g.source.type === 'desktop') {
        const src = findItem(d.pages, g.source.itemId);
        if (!src) return;

        // iOS 风格：松手时正悬停在另一个图标上 → 合并为文件夹
        // 使用 dragOverItemRef（onMove 同步写入的最后悬停目标），比 pointerup 坐标更可靠
        if (!isWidget && dropTargetId && dropTargetId !== g.source.itemId) {
          const tgt = d.pages.flat().find(it => it.id === dropTargetId);
          if (tgt && tgt.type !== 'widget' && tgt.type !== 'system') {
            const { mergeToFolder: merge } = latestRef.current;
            merge(g.source.itemId, dropTargetId);
            toast.success('已创建文件夹');
            return;
          }
        }

        // 悬停在空白格子或自身 → 坐标检测落点，移动到该格子
        let cell: HTMLElement | null = null;
        const allCells = document.querySelectorAll<HTMLElement>('[data-cell]');
        for (const cellEl of allCells) {
          const r = cellEl.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            cell = cellEl; break;
          }
        }
        if (!cell) return; // 落在间隙 → 原位回弹

        const targetRow = Number(cell.dataset.row);
        const rawPage = Number(cell.dataset.page);
        const targetPage = isNaN(rawPage) ? cp : rawPage;
        const targetCol = isWidget ? 0 : Number(cell.dataset.col);

        if (!isWidget) {
          const widgetOnRow = d.pages[targetPage]?.find(it => it.row === targetRow && it.type === 'widget');
          if (widgetOnRow) return;
          const cellItemId = cell.dataset.itemid ?? null;
          if (cellItemId) {
            const tgt = d.pages[targetPage]?.find(it => it.id === cellItemId);
            if (tgt?.type === 'widget') return;
          }
        }

        moveTo(g.source.itemId, src.page, targetPage, targetRow, targetCol);
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

  const pageItems = data.pages[currentPage] || [];
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
      if (dx > dy && dx > 10) e.preventDefault();
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
  const renderGrid = () => {
    if (loading) {
      return (
        <div className={`grid grid-cols-${gridCols} gap-x-4 gap-y-5`}>
          {Array.from({ length: gridCols * 4 }).map((_, i) => <SkeletonIcon key={`sk-${i}`} />)}
        </div>
      );
    }

    const cells: React.ReactNode[] = [];

    for (let r = 0; r < MAX_ROWS; r++) {
      const widgetItem = pageItems.find((it) => it.row === r && it.col === 0 && it.type === 'widget');

      if (widgetItem) {
        const isGhost = ghost?.source.itemId === widgetItem.id;
        cells.push(
          <div
            key={`widget-row-${r}`}
            data-cell="1"
            data-row={r}
            data-col={0}
            data-page={currentPage}
            data-itemid={widgetItem.id}
            style={{ gridColumn: `1 / -1` }}
            className={`transition-all duration-150 ${dragOverItem === widgetItem.id ? 'scale-[1.01] brightness-110' : ''}`}
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

      // 普通行：按当前响应式列数渲染
      for (let c = 0; c < gridCols; c++) {
        const item = pageItems.find((it) => it.row === r && it.col === c);
        if (item) {
          cells.push(
            <div
              key={`${r}-${c}`}
              data-cell="1"
              data-row={r}
              data-col={c}
              data-page={currentPage}
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
              key={`${r}-${c}`}
              data-cell="1"
              data-row={r}
              data-col={c}
              data-page={currentPage}
              className="min-h-[88px] md:min-h-[96px] rounded-xl"
            >
              {isDragging && <SkeletonIcon />}
            </div>,
          );
        }
      }
    }

    return (
      <div
        className="grid gap-x-3 gap-y-4"
        style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
      >
        {cells}
      </div>
    );
  };

  return (
    <div
      className="relative w-full h-screen overflow-hidden select-none"
      data-style={settings.style}
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

      {/* 主内容区（无单独 widget 头部，全部在统一网格中） */}
      <div ref={containerRef} className="relative z-10 flex flex-col h-full">
        {/* 统一网格：widget 行 + 应用图标行全在同一个 grid 中；监听 swipe 手势翻页 */}
        <div
          ref={swipeContainerRef}
          className="flex-1 flex items-start justify-center px-4 md:px-8 pt-2 pb-2 overflow-y-auto min-h-0"
        >
          <div className="w-full max-w-2xl">{renderGrid()}</div>
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
      <AddEditDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} onAdd={handleAddApp} />

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

      {/* 统一拖拽 Ghost：widget 显示标签卡片，app 显示图标 */}
      {ghost && (
        <div
          className="fixed pointer-events-none z-[300] opacity-80 transition-none"
          style={
            ghost.item.type === 'widget'
              ? { left: ghost.x - 120, top: ghost.y - 28 }
              : { left: ghost.x - 36, top: ghost.y - 36 }
          }
        >
          {ghost.item.type === 'widget' ? (
            <div className="bg-black/40 backdrop-blur-md rounded-2xl px-5 py-3 min-w-[240px] flex items-center gap-3 border border-white/20 scale-105">
              <span className="text-white/90 text-sm font-medium">
                {ghost.item.widgetType === 'combined' ? '🕐 时钟与搜索' : ghost.item.widgetType === 'clock' ? '🕐 时钟' : '🔍 搜索栏'}
              </span>
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
): { page: number; row: number; col: number } | null {
  const order = [preferPage, ...Array.from({ length: pages.length }, (_, i) => i).filter(i => i !== preferPage)];
  for (const p of order) {
    for (let r = 0; r < MAX_ROWS; r++) {
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