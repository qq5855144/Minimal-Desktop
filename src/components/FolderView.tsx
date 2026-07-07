import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDesktop, MAX_FOLDER_APPS } from '@/contexts/DesktopContext';
import type { DesktopItem } from '@/types';
import AppIcon from './AppIcon';
import SkeletonIcon from './SkeletonIcon';
import { X, Check } from 'lucide-react';

interface FolderViewProps {
  folder: DesktopItem;
  onClose: () => void;
  onLongPress?: (item: DesktopItem, x: number, y: number) => void;
  triggerRenameId?: string | null;
  onRenameDone?: () => void;
  onDragOutBegin?: (child: DesktopItem, folderId: string, x: number, y: number) => void;
}

const DRAG_OUT_THRESHOLD = 32; // 超出 grid 边界多少 px 触发拖出
const DRAG_MOVE_MIN = 6;       // 最小位移识别为拖拽

const FolderView: React.FC<FolderViewProps> = ({
  folder, onClose, onLongPress, triggerRenameId, onRenameDone, onDragOutBegin,
}) => {
  const { loading, renameFolder, reorderFolderChildren } = useDesktop();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);

  // 内部拖拽视觉状态
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // 内部浮动幽灵图标（跟随手指）
  const [ghostItem, setGhostItem] = useState<DesktopItem | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // 整个遮罩 ref：drag-out 时 display:none 隐藏，无 React 状态更新
  const overlayRef = useRef<HTMLDivElement>(null);
  // 幽灵 DOM ref：imperatively 更新位置，零重渲染
  const ghostDomRef = useRef<HTMLDivElement>(null);

  // 拖拽状态 refs
  const dragIdxRef = useRef<number | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const dragMovedRef = useRef(false);
  const dragOutFiredRef = useRef(false);

  // 稳定 ref：避免 document 监听器里的闭包过期
  const folderRef = useRef(folder);
  const onDragOutBeginRef = useRef(onDragOutBegin);
  const onCloseRef = useRef(onClose);
  const reorderRef = useRef(reorderFolderChildren);
  useEffect(() => { folderRef.current = folder; }, [folder]);
  useEffect(() => { onDragOutBeginRef.current = onDragOutBegin; }, [onDragOutBegin]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { reorderRef.current = reorderFolderChildren; }, [reorderFolderChildren]);

  useEffect(() => { setName(folder.name); }, [folder.name]);
  useEffect(() => { if (editing) nameInputRef.current?.focus(); }, [editing]);
  useEffect(() => {
    if (triggerRenameId === folder.id) setEditing(true);
  }, [triggerRenameId, folder.id]);

  // 卸载时清理可能残留的拖拽状态（文件夹关闭时若有拖拽仍在进行）
  useEffect(() => {
    return () => {
      if (ghostDomRef.current) ghostDomRef.current.style.display = 'none';
    };
  }, []);

  const handleRename = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed) { renameFolder(folder.id, trimmed); setEditing(false); onRenameDone?.(); }
  }, [name, folder.id, renameFolder, onRenameDone]);

  const resetDrag = useCallback(() => {
    dragIdxRef.current = null;
    dragMovedRef.current = false;
    dragOutFiredRef.current = false;
    setDragIdx(null);
    setDragOverIdx(null);
    setGhostItem(null);
    if (ghostDomRef.current) ghostDomRef.current.style.display = 'none';
  }, []);

  // 通过 data-child-idx 找到指针下的槽位（含空槽）
  const getSlotIdxAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    const cel = el?.closest('[data-child-idx]') as HTMLElement | null;
    if (!cel) return null;
    const n = Number(cel.dataset.childIdx);
    return isNaN(n) ? null : n;
  };

  // ★ document 级全局监听：与 Desktop 全局拖拽同构，彻底绕开元素边界
  const attachDocListeners = useCallback((fromIdx: number) => {
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - dragStartXRef.current;
      const dy = e.clientY - dragStartYRef.current;

      // 超过最小位移：进入拖拽模式，显示浮动幽灵
      if (!dragMovedRef.current && Math.hypot(dx, dy) > DRAG_MOVE_MIN) {
        dragMovedRef.current = true;
        if (ghostDomRef.current) {
          ghostDomRef.current.style.display = 'block';
          ghostDomRef.current.style.left = `${e.clientX}px`;
          ghostDomRef.current.style.top = `${e.clientY}px`;
        }
      }
      if (!dragMovedRef.current || dragOutFiredRef.current) return;

      // imperatively 更新幽灵位置（不触发 re-render）
      if (ghostDomRef.current) {
        ghostDomRef.current.style.left = `${e.clientX}px`;
        ghostDomRef.current.style.top = `${e.clientY}px`;
      }

      const grid = gridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      const outside =
        e.clientX < rect.left - DRAG_OUT_THRESHOLD ||
        e.clientX > rect.right + DRAG_OUT_THRESHOLD ||
        e.clientY < rect.top - DRAG_OUT_THRESHOLD ||
        e.clientY > rect.bottom + DRAG_OUT_THRESHOLD;

      if (outside) {
        // ─── 拖出到桌面 ───
        dragOutFiredRef.current = true;
        const child = folderRef.current.children?.[fromIdx];
        const folderId = folderRef.current.id;
        const dragOutCb = onDragOutBeginRef.current;

        cleanup();
        setDragIdx(null);
        setDragOverIdx(null);
        setGhostItem(null);
        if (ghostDomRef.current) ghostDomRef.current.style.display = 'none';
        if (!child) return;

        // ★ 纯 DOM 操作隐藏遮罩（零 React 状态更新），确保拖拽不卡顿：
        //   - display:none 让遮罩及所有子元素立即从命中测试中消失
        //   - Desktop onUp 里的 setOpenFolderId(null) 负责最终状态清理
        //   - 不在此处调用 onClose()，避免 React 批量更新重置 document 监听器
        if (overlayRef.current) overlayRef.current.style.display = 'none';

        // 移交给 Desktop 全局拖拽接管
        dragOutCb?.(child, folderId, e.clientX, e.clientY);
        return;
      }

      // ─── 在文件夹内移动：更新目标槽高亮 ───
      const hoverIdx = getSlotIdxAt(e.clientX, e.clientY);
      setDragOverIdx(hoverIdx !== fromIdx ? hoverIdx : null);
    };

    const onUp = (e: PointerEvent) => {
      cleanup();
      if (ghostDomRef.current) ghostDomRef.current.style.display = 'none';
      if (dragOutFiredRef.current) return; // Desktop 的 onUp 会处理
      if (!dragMovedRef.current) { resetDrag(); return; } // 点击，非拖拽

      const toIdx = getSlotIdxAt(e.clientX, e.clientY);
      const from = fromIdx;
      resetDrag();
      if (toIdx !== null && from !== toIdx) {
        // 松手处是有效槽（含空槽）：执行内部排序/移动
        reorderRef.current(folderRef.current.id, from, toIdx);
      }
    };

    // pointercancel：系统手势/多指打断时清理文件夹内部拖拽状态
    const onCancel = () => {
      cleanup();
      if (ghostDomRef.current) ghostDomRef.current.style.display = 'none';
      resetDrag();
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }, [resetDrag]);

  const handleChildPointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    e.stopPropagation();
    const child = folder.children?.[idx];
    if (!child) return; // 空槽不可拖起
    dragIdxRef.current = idx;
    dragStartXRef.current = e.clientX;
    dragStartYRef.current = e.clientY;
    dragMovedRef.current = false;
    dragOutFiredRef.current = false;
    setDragIdx(idx);
    setDragOverIdx(null);
    setGhostItem(child);
    attachDocListeners(idx);
  }, [folder.children, attachDocListeners]);

  // ─── 9 个固定槽（0–8），空槽含标签占位，确保每行高度一致 ───
  const TOTAL_SLOTS = MAX_FOLDER_APPS; // = 9

  return (
    <>
      {/* 遮罩 + 卡片 */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

        <div
          className="relative z-10 w-[92%] max-w-xs animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 文件夹名称 */}
          <div className="flex items-center justify-center gap-2 mb-3">
            {editing ? (
              <>
                <input
                  ref={nameInputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  className="bg-white/20 text-white text-center text-lg font-semibold rounded-lg px-3 py-1 outline-none border border-white/30 max-w-[200px]"
                  maxLength={20}
                />
                <button type="button" onClick={handleRename} className="text-white/80 hover:text-white">
                  <Check className="w-5 h-5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-white text-lg font-semibold drop-shadow-md hover:text-white/80 transition-colors"
                onClick={() => setEditing(true)}
              >
                {folder.name}
              </button>
            )}
          </div>

          {/* ── 3×3 固定 9 格网格 ── */}
          <div ref={gridRef} className="glass rounded-3xl p-4">
            {loading ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <SkeletonIcon key={`fv-sk-${i}`} size="small" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: TOTAL_SLOTS }).map((_, slotIdx) => {
                  const child = folder.children?.[slotIdx] ?? null;
                  const isSource = dragIdx === slotIdx && child !== null;
                  const isTarget = dragOverIdx === slotIdx && dragIdx !== slotIdx;

                  return (
                    <div
                      key={`slot-${slotIdx}`}
                      data-child-idx={slotIdx}
                      className={`
                        flex flex-col items-center gap-1 transition-all duration-150 touch-none
                        ${isTarget ? 'scale-110' : ''}
                      `}
                      onPointerDown={child ? (e) => handleChildPointerDown(e, slotIdx) : undefined}
                    >
                      {child ? (
                        /* ─ 已填充槽：正常 AppIcon，拖动时半透明 ─ */
                        <div className={`transition-opacity duration-150 ${isSource ? 'opacity-20' : 'opacity-100'}`}>
                          <AppIcon
                            item={child}
                            size="small"
                            onLongPress={onLongPress ? (x, y) => onLongPress(child, x, y) : undefined}
                          />
                        </div>
                      ) : (
                        /* ─ 空槽：虚线占位框 + 透明标签行（保持与 AppIcon 等高）─ */
                        <>
                          <div
                            className={`
                              w-12 h-12 rounded-[22%] border-2 border-dashed
                              transition-all duration-150
                              ${isTarget
                                ? 'border-white/60 bg-white/15'
                                : 'border-white/20 bg-white/5'}
                            `}
                          />
                          {/* 占位标签行：与 AppIcon 的 <span> 等高（text-[10px] leading normal ≈ 14px）*/}
                          <div className="h-[14px] w-10" />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 关闭按钮 */}
          <div className="flex justify-center mt-4">
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full glass flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── 内部拖拽幽灵（fixed 定位，pointer-events:none，挂在文件夹遮罩外侧）── */}
      {ghostItem && (
        <div
          ref={ghostDomRef}
          className="pointer-events-none"
          style={{
            display: 'none',
            position: 'fixed',
            zIndex: 200,
            transform: 'translate(-50%, -50%) scale(1.12)',
            filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.45))',
          }}
        >
          <AppIcon item={ghostItem} size="small" />
        </div>
      )}
    </>
  );
};

export default FolderView;
