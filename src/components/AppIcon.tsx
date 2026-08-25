import { Folder, Globe, Plus, RefreshCw, Settings, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import { useLongPressIntent } from '@/hooks/use-long-press-intent';
import { getColorStyle } from '@/lib/colors';
import { getDirectFaviconUrl, normalizeUrl } from '@/lib/favicon';
import { fetchAndCacheIcon, getIconCache } from '@/lib/iconCache';
import {
  canActivateFolderChildDirectly,
  getFolderPreviewGrid,
  resolveFolderChildVisualKind,
  SYSTEM_GLYPH_SCALE,
  SYSTEM_GLYPH_STROKE_WIDTH,
} from '@/lib/iconPresentation';
import {
  DESKTOP_GRID_GAP_PX,
  getExpandedFolderLayoutMetrics,
  getIconLayoutMetrics,
  getLargeFolderLayoutMetrics,
  type LargeFolderLayoutMetrics,
} from '@/lib/iconLayout';
import { openExternalUrl } from '@/lib/openExternal';
import type { DesktopItem, FolderLayout } from '@/types';

interface AppIconProps {
  item: DesktopItem;
  onClick?: (item: DesktopItem) => void;
  onLongPress?: (item: DesktopItem, x: number, y: number) => void;
  onDragBegin?: (item: DesktopItem, x: number, y: number, pointerId: number) => void;
  onDeleteInEditMode?: (id: string) => void;
  size?: 'normal' | 'small';
  ghost?: boolean;
  /** 覆盖图标尺寸（px），不传则使用 settings.iconSize */
  iconPx?: number;
  /** 由桌面真实列宽计算的扩展文件夹几何锚点。 */
  largeFolderLayout?: LargeFolderLayoutMetrics;
}

const SYSTEM_ICON_MAP: Record<string, React.ElementType> = {
  'sys-settings': Settings,
  'sys-sync': RefreshCw,
  'sys-add': Plus,
};

/** 文件夹缩略图内的子图标 */
const FolderChildIcon: React.FC<{
  child: DesktopItem;
  cellPx: number;
  iconFontPx: number;
  radius: string;
  onActivate?: () => void;
}> = ({
  child, cellPx, iconFontPx, radius, onActivate,
}) => {
  const src = getIconCache(child.iconUrl ?? '') ?? child.iconUrl;
  const crop = child.iconCrop;
  const SystemIcon = child.type === 'system' ? (SYSTEM_ICON_MAP[child.id] ?? Globe) : null;
  const visualKind = resolveFolderChildVisualKind(child, Boolean(src));

  // 有裁剪参数时用 CSS transform 渲染，与 AppIcon 保持一致
  const imgStyle: React.CSSProperties = crop ? {
    position: 'absolute' as const,
    width: '100%', height: '100%',
    objectFit: 'contain' as const,
    transform: `scale(${100 / crop.size})`,
    transformOrigin: `${crop.x + crop.size / 2}% ${crop.y + crop.size / 2}%`,
    zIndex: 1, display: 'block',
  } : {
    position: 'absolute' as const, inset: 0,
    width: '100%', height: '100%',
    objectFit: 'contain' as const,
    zIndex: 1, display: 'block',
  };

  const content = (
    <>
      {visualKind === 'system' && SystemIcon ? (
        <SystemIcon
          className="text-white drop-shadow"
          style={{
            width: cellPx * SYSTEM_GLYPH_SCALE,
            height: cellPx * SYSTEM_GLYPH_SCALE,
          }}
          strokeWidth={SYSTEM_GLYPH_STROKE_WIDTH}
        />
      ) : visualKind === 'image' && src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          style={imgStyle}
        />
      ) : (
        <span className="text-white font-bold drop-shadow" style={{ fontSize: iconFontPx }}>
          {child.name.slice(0, 1)}
        </span>
      )}
    </>
  );
  const style: React.CSSProperties = {
    width: cellPx,
    height: cellPx,
    borderRadius: radius,
    flexShrink: 0,
    background: visualKind === 'image' ? '#fff' : getColorStyle(child.color),
  };

  if (onActivate) {
    return (
      <button
        type="button"
        data-folder-child-id={child.id}
        data-folder-child-link="true"
        data-press-intent-surface="true"
        aria-label={`打开 ${child.name}`}
        className="overflow-hidden relative flex items-center justify-center border-0 p-0 cursor-pointer active:scale-95"
        style={style}
        onClick={(event) => {
          event.stopPropagation();
          onActivate();
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      data-folder-child-id={child.id}
      className="overflow-hidden relative flex items-center justify-center"
      style={style}
    >
      {content}
    </div>
  );
};

const AppIcon: React.FC<AppIconProps> = ({
  item, onClick, onLongPress, onDragBegin,
  onDeleteInEditMode, size = 'normal', ghost = false, iconPx, largeFolderLayout,
}) => {
  const { editMode, settings } = useDesktop();
  const [imgError, setImgError] = useState(false);
  const pressedFolderChildIdRef = useRef<string | null>(null);
  // 优先使用本地缓存的 DataURL，无缓存时使用远程 URL
  const [iconSrc, setIconSrc] = useState<string | undefined>(() =>
    item.iconUrl ? (getIconCache(item.iconUrl) ?? item.iconUrl) : undefined
  );

  // item.iconUrl 变化时（编辑后）同步更新 iconSrc
  useEffect(() => {
    setImgError(false);
    setIconSrc(item.iconUrl ? (getIconCache(item.iconUrl) ?? item.iconUrl) : undefined);
  }, [item.iconUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!item.iconUrl || item.iconUrl.startsWith('data:') || item.iconUrl.startsWith('blob:')) return;

    const cached = getIconCache(item.iconUrl);
    if (cached) {
      setIconSrc(cached);
      return;
    }

    fetchAndCacheIcon(item.iconUrl).then((dataUrl) => {
      if (!cancelled && dataUrl) setIconSrc(dataUrl);
    });

    return () => { cancelled = true; };
  }, [item.iconUrl]);

  const metrics = getIconLayoutMetrics(size, iconPx ?? settings.iconSize, settings.iconRadiusPct);
  const px = metrics.iconPx;
  const folderLayout: FolderLayout = item.type === 'folder' ? (item.folderLayout ?? '1x1') : '1x1';
  const isExpandedFolder = item.type === 'folder' && folderLayout !== '1x1';
  const resolvedLargeFolderLayout = isExpandedFolder
    ? (largeFolderLayout ?? getLargeFolderLayoutMetrics(metrics, {
      columnWidthPx: metrics.iconPx,
      columnGapPx: DESKTOP_GRID_GAP_PX,
    }))
    : null;
  const expandedFolderLayout = isExpandedFolder
    ? getExpandedFolderLayoutMetrics(
      folderLayout as Exclude<FolderLayout, '1x1'>,
      metrics,
      resolvedLargeFolderLayout!,
    )
    : null;

  // 新拟态风格阴影
  const isNeumorphism = settings.style === 'neumorphism';

  const pressIntent = useLongPressIntent<HTMLElement>({
    onLongPress: (x, y) => onLongPress?.(item, x, y),
    onDragStart: (x, y, pointerId) => onDragBegin?.(item, x, y, pointerId),
  });

  const activateFolderChild = useCallback((child: DesktopItem) => {
    if (child.type === 'app' && child.url) {
      openExternalUrl(child.url);
      return;
    }
    if (child.type === 'system') onClick?.(child);
  }, [onClick]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const pressedFolderChildId = pressedFolderChildIdRef.current;
    pressedFolderChildIdRef.current = null;
    if (pressIntent.consumeClick()) {
      e.preventDefault();
      return;
    }
    if (editMode && item.type !== 'system') return;
    if (item.type === 'folder' && pressedFolderChildId) {
      const child = item.children?.find((candidate) => candidate.id === pressedFolderChildId);
      if (child && canActivateFolderChildDirectly(folderLayout, child)) {
        activateFolderChild(child);
        return;
      }
    }
    if (item.type === 'app' && item.url) {
      e.currentTarget.blur();
      openExternalUrl(item.url);
      return;
    }
    onClick?.(item);
  }, [activateFolderChild, editMode, folderLayout, item, onClick, pressIntent]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as Element;
    pressedFolderChildIdRef.current = target.closest<HTMLElement>('[data-folder-child-id]')
      ?.dataset.folderChildId ?? null;
    pressIntent.onPointerDown(event);
  }, [pressIntent]);

  const iconStyle: React.CSSProperties = {
    width: px, height: px,
    borderRadius: metrics.iconRadius,
    flexShrink: 0,
  };

  const renderIconContent = () => {
    if (item.type === 'system') {
      const Icon = SYSTEM_ICON_MAP[item.id] ?? Globe;
      return (
        <div className="flex items-center justify-center ios-icon-shadow transition-transform duration-200"
          style={{ ...iconStyle, background: getColorStyle(item.color) }}>
          <Icon
            style={{ width: px * SYSTEM_GLYPH_SCALE, height: px * SYSTEM_GLYPH_SCALE }}
            className="text-white"
            strokeWidth={SYSTEM_GLYPH_STROKE_WIDTH}
          />
        </div>
      );
    }
    if (item.type === 'folder') {
      const previewGrid = getFolderPreviewGrid(folderLayout);
      const preview = (item.children || []).slice(0, previewGrid.rows * previewGrid.cols);
      const isNeu = settings.style === 'neumorphism';
      const cellPx = isExpandedFolder
        ? expandedFolderLayout!.previewCellPx
        : metrics.folderPreviewCellPx;
      const previewColumnGapPx = isExpandedFolder
        ? expandedFolderLayout!.columnGapPx
        : metrics.folderPreviewGapPx;
      const previewRowGapPx = isExpandedFolder
        ? expandedFolderLayout!.rowGapPx
        : metrics.folderPreviewGapPx;
      return (
        <div
          data-folder-surface={folderLayout}
          className={`ios-icon-shadow overflow-hidden ${
            isExpandedFolder && preview.length > 0 ? 'grid' : 'flex items-center justify-center'
          }`}
          style={{
            ...iconStyle,
            ...(isExpandedFolder ? {
              width: expandedFolderLayout!.widthPx,
              height: expandedFolderLayout!.heightPx,
              borderRadius: expandedFolderLayout!.radius,
              boxSizing: 'border-box',
              flex: '0 0 auto',
              padding: preview.length > 0
                ? `${expandedFolderLayout!.paddingYPx}px ${expandedFolderLayout!.paddingXPx}px`
                : 0,
              columnGap: preview.length > 0 ? previewColumnGapPx : 0,
              rowGap: preview.length > 0 ? previewRowGapPx : 0,
              gridTemplateColumns: preview.length > 0
                ? `repeat(${previewGrid.cols}, ${cellPx}px)`
                : undefined,
              gridTemplateRows: preview.length > 0
                ? `repeat(${previewGrid.rows}, ${cellPx}px)`
                : undefined,
            } : {}),
            background: isNeu ? '#e8edf5' : 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {preview.length > 0 ? (
            isExpandedFolder ? (
              preview.map((child) => (
                <FolderChildIcon
                  key={child.id}
                  child={child}
                  cellPx={cellPx}
                  iconFontPx={expandedFolderLayout!.previewFontPx}
                  radius={metrics.iconRadius}
                  onActivate={canActivateFolderChildDirectly(folderLayout, child)
                    ? () => {
                      pressedFolderChildIdRef.current = null;
                      if (pressIntent.consumeClick() || editMode) return;
                      activateFolderChild(child);
                    }
                    : undefined}
                />
              ))
            ) : (
              <div
                className="grid"
                style={{
                  columnGap: previewColumnGapPx,
                  rowGap: previewRowGapPx,
                  gridTemplateColumns: `repeat(${previewGrid.cols}, ${cellPx}px)`,
                  gridTemplateRows: `repeat(${previewGrid.rows}, ${cellPx}px)`,
                }}
              >
                {preview.map((child) => (
                  <FolderChildIcon
                    key={child.id}
                    child={child}
                    cellPx={cellPx}
                    iconFontPx={px * 0.16}
                    radius={metrics.iconRadius}
                  />
                ))}
              </div>
            )
          ) : (
            <Folder
              style={{
                width: isExpandedFolder ? cellPx * 1.4 : metrics.glyphPx,
                height: isExpandedFolder ? cellPx * 1.4 : metrics.glyphPx,
              }}
              className="text-white drop-shadow"
            />
          )}
        </div>
      );
    }
    // 普通 app 图标：支持 iconCrop CSS 裁剪渲染（无 canvas，无跨域限制）
    if (iconSrc && !imgError) {
      const crop = item.iconCrop;
      // 有裁剪参数：用 CSS transform 实现裁剪，不需要 canvas
      const imgStyle: React.CSSProperties = crop ? (() => {
        const scale = 100 / crop.size;
        return {
          position: 'absolute' as const,
          width: '100%', height: '100%',
          objectFit: 'contain' as const,
          transform: `scale(${scale})`,
          transformOrigin: `${crop.x + crop.size / 2}% ${crop.y + crop.size / 2}%`,
        };
      })() : {
        position: 'absolute' as const, inset: 0,
        width: '100%', height: '100%',
        objectFit: 'contain' as const,
      };
      return (
        <div
          className="ios-icon-shadow relative flex items-center justify-center"
          style={{ ...iconStyle, overflow: 'hidden', background: '#fff' }}
        >
          <img
            src={iconSrc}
            alt={item.name}
            draggable={false}
            decoding="async"
            style={imgStyle}
            onLoad={undefined}
            onError={(e) => {
              const img = e.currentTarget;
              if (item.url && !img.dataset.fallbackTried) {
                img.dataset.fallbackTried = '1';
                const fallback = getDirectFaviconUrl(normalizeUrl(item.url));
                if (fallback && fallback !== iconSrc) { img.src = fallback; return; }
              }
              setImgError(true);
            }}
          />
        </div>
      );
    }
    // 无图标 fallback：有 iconUrl 但加载失败 → Globe；无 iconUrl → 首字母色块
    return (
      <div
        className="flex items-center justify-center ios-icon-shadow"
        style={{ ...iconStyle, background: getColorStyle(item.color) }}
      >
        {item.url ? (
          <Globe style={{ width: metrics.glyphPx, height: metrics.glyphPx }} className="text-white drop-shadow" />
        ) : (
          <span className="text-white font-bold uppercase drop-shadow" style={{ fontSize: metrics.initialFontPx }}>{item.name.slice(0, 1)}</span>
        )}
      </div>
    );
  };

  const pressFeedbackClass =
    ghost || (item.type === 'app' && item.url)
      ? ''
      : 'transition-transform active:scale-95';

  const appIconContent = (
    <>
      {renderIconContent()}
      <span
        className={`app-icon-label ${metrics.textClass} font-medium truncate ${isNeumorphism ? 'text-slate-600' : 'text-white drop-shadow-md'}`}
        style={{ maxWidth: isExpandedFolder ? expandedFolderLayout!.widthPx : metrics.labelMaxWidthPx }}
      >
        {item.name}
      </span>
    </>
  );
  const interactionClass = `app-icon-button flex flex-col items-center select-none touch-none ${
    isExpandedFolder ? 'w-full' : ''
  } ${editMode ? 'animate-wiggle' : ''} ${pressFeedbackClass}`;

  return (
    <div
      className={`relative ${ghost ? 'opacity-40' : ''}`}
      style={isExpandedFolder ? {
        width: expandedFolderLayout!.widthPx,
        maxWidth: '100%',
        marginInline: 'auto',
      } : undefined}
    >
      {isExpandedFolder ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={`打开文件夹 ${item.name}`}
          onClick={handleClick}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            if (!editMode) onClick?.(item);
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={pressIntent.onPointerMove}
          onPointerUp={pressIntent.onPointerUp}
          onPointerCancel={pressIntent.onPointerCancel}
          onDragStart={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
          className={interactionClass}
          style={{ gap: metrics.labelGapPx }}
        >
          {appIconContent}
        </div>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={pressIntent.onPointerMove}
          onPointerUp={pressIntent.onPointerUp}
          onPointerCancel={pressIntent.onPointerCancel}
          onDragStart={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
          className={interactionClass}
          style={{ gap: metrics.labelGapPx }}
        >
          {appIconContent}
        </button>
      )}
      {editMode && item.type !== 'system' && onDeleteInEditMode && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDeleteInEditMode(item.id); }}
          className="absolute -top-1 -left-1 z-20 w-5 h-5 rounded-full bg-destructive flex items-center justify-center shadow-md"
          aria-label="删除"
        >
          <X className="w-3 h-3 text-white" strokeWidth={3} />
        </button>
      )}
    </div>
  );
};

export default React.memo(AppIcon);
