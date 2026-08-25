import { ChevronLeft, X } from 'lucide-react';
import React from 'react';
import { getPanelTheme } from '@/lib/panelTheme';

interface SystemSheetProps {
  open: boolean;
  isNeu: boolean;
  title: string;
  description?: string;
  icon: React.ReactNode;
  iconClassName: string;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
  bodyClassName?: string;
}

/** 设置与同步共用的紧凑型响应式弹层。 */
const SystemSheet: React.FC<SystemSheetProps> = ({
  open, isNeu, title, description, icon, iconClassName,
  onClose, onBack, children, bodyClassName = 'overflow-y-auto',
}) => {
  const t = getPanelTheme(isNeu);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex w-full max-w-lg flex-col overflow-hidden rounded-t-3xl animate-slide-up sm:rounded-3xl sm:border ${t.sheetBg} ${t.sheetBorder}`}
        style={{
          maxHeight: 'min(var(--desktop-sheet-max-height, 85dvh), calc(100dvh - 10px))',
          ...t.sheetStyle,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-2.5 sm:hidden">
          <div className={`h-1 w-10 rounded-full ${t.handle}`} />
        </div>
        <header className={`flex min-h-14 shrink-0 items-center gap-2.5 border-b px-4 py-2.5 ${t.itemBorder}`}>
          {onBack && (
            <button type="button" onClick={onBack} aria-label="返回" className={`flex h-8 w-8 items-center justify-center rounded-xl ${t.closeBtn} ${t.closeBtnHover}`}>
              <ChevronLeft className={`h-4 w-4 ${t.textMuted}`} />
            </button>
          )}
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>{icon}</div>
          <div className="min-w-0 flex-1">
            <h2 className={`truncate text-sm font-semibold ${t.textPrimary}`}>{title}</h2>
            {description && <p className={`truncate text-[11px] ${t.textDim}`}>{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className={`flex h-8 w-8 items-center justify-center rounded-xl ${t.closeBtn} ${t.closeBtnHover}`}>
            <X className={`h-4 w-4 ${t.textMuted}`} />
          </button>
        </header>
        <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
        <div className="h-[env(safe-area-inset-bottom,0px)] shrink-0" />
      </section>
    </div>
  );
};

export default SystemSheet;
