import React, { useEffect, useRef } from 'react';
import { Pencil, Trash2, FolderOpen, FolderMinus } from 'lucide-react';

export interface ContextMenuPosition {
  x: number;
  y: number;
  itemId: string;
  isSystem: boolean;
  isFolder?: boolean;
}

interface ContextMenuProps {
  pos: ContextMenuPosition;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRenameFolder?: (id: string) => void;
  onDissolveFolder?: (id: string) => void;
  onClose: () => void;
}

const MENU_W = 160;

const ContextMenu: React.FC<ContextMenuProps> = ({
  pos, onEdit, onDelete, onRenameFolder, onDissolveFolder, onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuH = pos.isFolder ? 120 : 96;
  const left = Math.min(Math.max(pos.x, 8), vw - MENU_W - 8);
  const top  = Math.min(Math.max(pos.y, 8), vh - menuH - 8);

  useEffect(() => {
    const handle = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [onClose]);

  const btn = 'flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/90 hover:bg-white/15 transition-colors rounded-lg text-left';
  const divider = <div className="h-px bg-white/10 my-0.5" />;

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={menuRef}
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
            <>
              <button type="button" className={btn}
                onClick={() => { onRenameFolder?.(pos.itemId); onClose(); }}>
                <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                重命名
              </button>
              {divider}
              <button type="button" className={`${btn} text-orange-400`}
                onClick={() => { onDissolveFolder?.(pos.itemId); onClose(); }}>
                <FolderMinus className="w-4 h-4 shrink-0" />
                解散文件夹
              </button>
            </>
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
