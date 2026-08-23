import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderMinus,
  FolderOpen,
  LayoutGrid,
  Pencil,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useViewportGeometry } from '@/hooks/use-viewport-geometry';
import { clampFloatingPosition } from '@/lib/viewport';
import type { FolderLayout } from '@/types';

export interface ContextMenuPosition {
  x: number;
  y: number;
  itemId: string;
  isFolder?: boolean;
  folderLayout?: FolderLayout;
}

interface ContextMenuProps {
  pos: ContextMenuPosition;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRenameFolder?: (id: string) => void;
  onDissolveFolder?: (id: string) => void;
  onFolderLayoutChange?: (id: string, layout: FolderLayout) => void;
  onClose: () => void;
}

const MENU_W = 160;

const ContextMenu: React.FC<ContextMenuProps> = ({
  pos,
  onEdit,
  onDelete,
  onRenameFolder,
  onDissolveFolder,
  onFolderLayoutChange,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showFolderLayouts, setShowFolderLayouts] = useState(false);
  const viewport = useViewportGeometry();

  const menuH = pos.isFolder ? (showFolderLayouts ? 142 : 168) : 96;
  const visibleLeft = viewport.visual.left - viewport.shell.left;
  const visibleTop = viewport.visual.top - viewport.shell.top;
  const left = clampFloatingPosition(
    pos.x - viewport.shell.left,
    MENU_W,
    visibleLeft,
    viewport.visual.width,
  );
  const top = clampFloatingPosition(
    pos.y - viewport.shell.top,
    menuH,
    visibleTop,
    viewport.visual.height,
  );

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => { setShowFolderLayouts(false); }, [pos.itemId]);

  const btn = 'flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/90 hover:bg-white/15 transition-colors rounded-lg text-left';
  const divider = <div className="h-px bg-white/10 my-0.5" />;

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        aria-label="项目操作"
        className="fixed z-[70] rounded-2xl overflow-hidden shadow-2xl animate-scale-in"
        style={{
          left, top, width: MENU_W,
          background: 'rgba(30,30,40,0.90)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        <div className="p-1.5 flex flex-col gap-0.5">
          {pos.isFolder ? (
            showFolderLayouts ? (
              <>
                <button type="button" className={btn} onClick={() => setShowFolderLayouts(false)}>
                  <ChevronLeft className="w-4 h-4 text-white/70 shrink-0" />
                  布局
                </button>
                {divider}
                {(['1x1', '2x2'] as const).map((layout) => (
                  <button
                    key={layout}
                    type="button"
                    role="menuitemradio"
                    aria-checked={(pos.folderLayout ?? '1x1') === layout}
                    className={btn}
                    onClick={() => {
                      onFolderLayoutChange?.(pos.itemId, layout);
                      onClose();
                    }}
                  >
                    <span className="w-4 text-center text-xs font-semibold text-primary">
                      {layout === '2x2' ? '▦' : '□'}
                    </span>
                    <span className="flex-1">{layout === '2x2' ? '2×2' : '1×1'}</span>
                    {(pos.folderLayout ?? '1x1') === layout && (
                      <Check className="w-4 h-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </>
            ) : (
              <>
                <button type="button" className={btn}
                  onClick={() => { onRenameFolder?.(pos.itemId); onClose(); }}>
                  <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                  重命名
                </button>
                {divider}
                <button type="button" className={btn} onClick={() => setShowFolderLayouts(true)}>
                  <LayoutGrid className="w-4 h-4 text-primary shrink-0" />
                  <span className="flex-1">布局</span>
                  <span className="text-xs text-white/55">
                    {(pos.folderLayout ?? '1x1') === '2x2' ? '2×2' : '1×1'}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-white/45 shrink-0" />
                </button>
                {divider}
                <button type="button" className={`${btn} text-orange-400`}
                  onClick={() => { onDissolveFolder?.(pos.itemId); onClose(); }}>
                  <FolderMinus className="w-4 h-4 shrink-0" />
                  解散文件夹
                </button>
              </>
            )
          ) : (
            <>
              <button type="button" className={btn}
                onClick={() => { onEdit(pos.itemId); onClose(); }}>
                <Pencil className="w-4 h-4 text-primary shrink-0" />
                编辑应用
              </button>
              {divider}
              <button type="button" className={`${btn} text-red-400`}
                onClick={() => { onDelete(pos.itemId); onClose(); }}>
                <Trash2 className="w-4 h-4 shrink-0" />
                删除应用
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ContextMenu;
