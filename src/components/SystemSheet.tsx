import { ChevronLeft, X } from 'lucide-react';
import React from 'react';
import { getPanelTheme } from '@/lib/panelTheme';

interface SystemSheetProps {
  open: boolean;
  isNeu: boolean;
  title: string;
  description?: string;
  icon: React.ReactNode;
  iconClassName?: string;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  bodyClassName?: string;
  zIndexClassName?: string;
}

/** 桌面系统入口共用的响应式弹层骨架。 */
const SystemSheet: React.FC<SystemSheetProps> = ({
  open,
  isNeu,
  title,
  description,
  icon,
  iconClassName = 'bg-primary/15 text-primary',
  onClose,
  onBack,
  children,
  footer,
  bodyClassName = 'overflow-y-auto px-4 py-5 sm:px-6',
  zIndexClassName = 'z-[80]',
}) => {
  const t = getPanelTheme(isNeu);
  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:p-4`}
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex w-full max-w-xl flex-col overflow-hidden rounded-t-[30px] border-t animate-slide-up sm:rounded-[30px] sm:border ${t.sheetBg} ${t.sheetBorder}`}
        style={{
          maxHeight: 'min(var(--desktop-sheet-max-height, 88dvh), calc(100dvh - 12px))',
          ...t.sheetStyle,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-2.5 sm:hidden">
          <div className={`h-1 w-10 rounded-full ${t.handle}`} />
        </div>

        <header className={`flex shrink-0 items-center gap-3 border-b px-4 pb-4 pt-3 sm:px-6 sm:pt-5 ${t.itemBorder}`}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="返回"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${t.closeBtn} ${t.closeBtnHover}`}
            >
              <ChevronLeft className={`h-5 w-5 ${t.textMuted}`} />
            </button>
          )}
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${iconClassName}`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className={`truncate text-[17px] font-semibold tracking-tight ${t.textPrimary}`}>{title}</h2>
            {description && <p className={`mt-0.5 truncate text-xs ${t.textDim}`}>{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${t.closeBtn} ${t.closeBtnHover}`}
          >
            <X className={`h-4 w-4 ${t.textMuted}`} />
          </button>
        </header>

        <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>

        {footer && (
          <footer className={`shrink-0 border-t px-4 py-3 sm:px-6 ${t.itemBorder}`}>
            {footer}
          </footer>
        )}
        <div className="h-[env(safe-area-inset-bottom,0px)] shrink-0" />
      </section>
    </div>
  );
};

export default SystemSheet;
