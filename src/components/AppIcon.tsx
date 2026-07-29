import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { DesktopItem } from '@/types';
import { getColorStyle } from '@/lib/colors';
import { getIconLayoutMetrics } from '@/lib/iconLayout';
import { openExternalUrl } from '@/lib/openExternal';
import { useDesktop } from '@/contexts/DesktopContext';
import { Folder, Settings, RefreshCw, Globe, Plus, X } from 'lucide-react';
import { getIconCache, fetchAndCacheIcon } from '@/lib/iconCache';
import { getDirectFaviconUrl, normalizeUrl } from '@/lib/favicon';
import { fetchIconBgColor, getBgColorCache, extractBgColorFromImg, setBgColorCache } from '@/lib/iconBgColor';

/**
 * 图标背景层：将图标图片放大+模糊作为背景，视觉上与图标边缘颜色完全一致。
 * 完全不依赖 canvas 读像素，零 CORS 问题。
 * 当取色失败（iconBg 为 null）时作为兜底背景层。
 */
const IconBlurBg: React.FC<{ src: string; radius: string | number }> = ({ src, radius }) => (
  <span
    aria-hidden
    style={{
      position: 'absolute', inset: 0,
      borderRadius: radius,
      overflow: 'hidden',
      display: 'block',
      zIndex: 0,
    }}
  >
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        inset: '-20%',
        width: '140%',
        height: '140%',
        objectFit: 'cover',
        filter: 'blur(12px) saturate(1.4)',
        transform: 'scale(1.1)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    />
  </span>
);

interface AppIconProps {
  item: DesktopItem;
  onClick?: () => void;
  onLongPress?: (x: number, y: number) => void;
  onDragBegin?: (item: DesktopItem, x: number, y: number) => void;
  onDeleteInEditMode?: (id: string) => void;
  size?: 'normal' | 'small';
  ghost?: boolean;
  /** 覆盖图标尺寸（px），不传则使用 settings.iconSize */
  iconPx?: number;
}

const LONG_PRESS_MS = 500;
// 手机端手指轻微抖动约 5-10px，阈值设为 14px 以避免误触取消长按
const DRAG_THRESHOLD = 14;

/** 文件夹缩略图内的子图标 —— 独立组件，使用 blur 背景层填充透明区域 */
const FolderChildIcon: React.FC<{ child: DesktopItem; cellPx: number; iconFontPx: number }> = ({
  child, cellPx, iconFontPx,
}) => {
  const src = getIconCache(child.iconUrl ?? '') ?? child.iconUrl;
  const RADIUS = '25%';

  return (
    <div
      className="rounded-[25%] overflow-hidden relative flex items-center justify-center"
      style={{ width: cellPx, height: cellPx, flexShrink: 0, background: '#e8e8e8' }}
    >
      {src ? (
        <>
          {/* 背景扩图层：放大+模糊填充透明区域 */}
          <IconBlurBg src={src} radius={RADIUS} />
          <img
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain',
              zIndex: 1, display: 'block',
            }}
          />
        </>
      ) : (
        <span className="text-white font-bold drop-shadow" style={{ fontSize: iconFontPx }}>
          {child.name.slice(0, 1)}
        </span>
      )}
    </div>
  );
};

const AppIcon: React.FC<AppIconProps> = ({
  item, onClick, onLongPress, onDragBegin,
  onDeleteInEditMode, size = 'normal', ghost = false, iconPx,
}) => {
  const { editMode, settings } = useDesktop();
  const [imgError, setImgError] = useState(false);
  // 优先使用本地缓存的 DataURL，无缓存时使用远程 URL
  const [iconSrc, setIconSrc] = useState<string | undefined>(() =>
    item.iconUrl ? (getIconCache(item.iconUrl) ?? item.iconUrl) : undefined
  );
  // 从图标外围取色后的背景色（hex 字符串），null 表示取色失败降级白色
  const [iconBg, setIconBg] = useState<string | null>(() => {
    if (!item.iconUrl) return null;
    const cached = getBgColorCache(item.iconUrl);
    return cached !== undefined ? cached : null;
  });

  // 用 ref 记录上次 iconUrl，useEffect 只在 iconUrl 真正变化时才更新 iconSrc（跳过初次挂载）
  const prevIconUrlRef = useRef(item.iconUrl);

  // item.iconUrl 变化时（编辑后）同步更新 iconSrc；初次挂载时 prevIconUrlRef === item.iconUrl → 跳过
  useEffect(() => {
    if (prevIconUrlRef.current === item.iconUrl) return;
    prevIconUrlRef.current = item.iconUrl;
    setImgError(false);
    setIconSrc(item.iconUrl ? (getIconCache(item.iconUrl) ?? item.iconUrl) : undefined);
    // iconUrl 变化时同时重置背景色
    setIconBg(item.iconUrl ? (getBgColorCache(item.iconUrl) ?? null) : null);
  }, [item.iconUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!item.iconUrl || item.iconUrl.startsWith('data:') || item.iconUrl.startsWith('blob:')) return;

    const cached = getIconCache(item.iconUrl);
    if (cached) {
      setIconSrc(cached);
      // 已有 DataURL，尝试取色
      const bgCached = getBgColorCache(item.iconUrl);
      if (bgCached === undefined) {
        fetchIconBgColor(cached, item.iconUrl).then((color) => {
          if (!cancelled) setIconBg(color);
        });
      } else {
        setIconBg(bgCached);
      }
      return;
    }

    fetchAndCacheIcon(item.iconUrl).then((dataUrl) => {
      if (!cancelled) {
        if (dataUrl) setIconSrc(dataUrl);
        // 取色：DataURL 可用就用 DataURL，否则用原始 URL
        const src = dataUrl ?? item.iconUrl!;
        const bgCached = getBgColorCache(item.iconUrl!);
        if (bgCached !== undefined) {
          setIconBg(bgCached);
        } else {
          fetchIconBgColor(src, item.iconUrl).then((color) => {
            if (!cancelled) setIconBg(color);
          });
        }
      }
    });

    return () => { cancelled = true; };
  }, [item.iconUrl]);

  const longTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef  = useRef(false);
  const startXRef     = useRef(0);
  const startYRef     = useRef(0);
  const dragStartedRef = useRef(false);
  // 只有本元素收到过 pointerdown 才允许处理 pointermove，
  // 防止释放指针捕获后路过的其他图标误触发 onDragBegin
  const pointerDownActiveRef = useRef(false);

  const metrics = getIconLayoutMetrics(size, iconPx ?? settings.iconSize, settings.iconRadiusPct);
  const px = metrics.iconPx;

  // 新拟态风格阴影
  const isNeumorphism = settings.style === 'neumorphism';

  const cancelLongPress = useCallback(() => {
    if (longTimerRef.current) { clearTimeout(longTimerRef.current); longTimerRef.current = null; }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // 阻止默认行为，防止浏览器 context-menu / text-select / callout 干扰长按
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    longFiredRef.current = false;
    dragStartedRef.current = false;
    pointerDownActiveRef.current = true;
    longTimerRef.current = setTimeout(() => {
      longFiredRef.current = true;
      onLongPress?.(e.clientX, e.clientY);
    }, LONG_PRESS_MS);
  }, [onLongPress]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // 未收到本元素的 pointerdown 时忽略：防止释放捕获后路过的图标误触发拖拽
    if (!pointerDownActiveRef.current) return;
    if (dragStartedRef.current) return;
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragStartedRef.current = true;
      pointerDownActiveRef.current = false;
      cancelLongPress();
      // 拖拽正式开始时立即释放指针捕获：
      // 若保留捕获，换页时 AppIcon 会从 DOM 卸载，浏览器因此触发 pointercancel 清除拖拽状态
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      onDragBegin?.(item, e.clientX, e.clientY);
    }
  }, [item, onDragBegin, cancelLongPress]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    dragStartedRef.current = false;
    pointerDownActiveRef.current = false;
    cancelLongPress();
    // 确保释放捕获（未达到拖拽阈值时）
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [cancelLongPress]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (longFiredRef.current || dragStartedRef.current) return;
    if (editMode && item.type !== 'system') return;
    if (item.type === 'app' && item.url) {
      e.currentTarget.blur();
      openExternalUrl(item.url);
      return;
    }
    onClick?.();
  }, [editMode, item, onClick]);

  const iconStyle: React.CSSProperties = {
    width: px, height: px,
    borderRadius: metrics.iconRadius,
    flexShrink: 0,
    ...(isNeumorphism ? {
      boxShadow: '4px 4px 10px rgba(0,0,0,0.12), -4px -4px 10px rgba(255,255,255,0.7)',
    } : {}),
  };

  const renderIconContent = () => {
    if (item.type === 'system') {
      const iconMap: Record<string, React.ElementType> = {
        'sys-settings': Settings, 'sys-sync': RefreshCw, 'sys-add': Plus,
      };
      const Icon = iconMap[item.id] ?? Globe;
      return (
        <div className="flex items-center justify-center ios-icon-shadow transition-transform duration-200"
          style={{ ...iconStyle, background: getColorStyle(item.color) }}>
          <Icon style={{ width: px * 0.5, height: px * 0.5 }} className="text-white" strokeWidth={2} />
        </div>
      );
    }
    if (item.type === 'folder') {
      // 取前 4 个子项，以 2×2 网格展示缩略图
      const preview = (item.children || []).slice(0, 4);
      const isNeu = settings.style === 'neumorphism';
      const cellPx = metrics.folderPreviewCellPx;
      return (
        <div
          className="ios-icon-shadow overflow-hidden flex items-center justify-center"
          style={{
            ...iconStyle,
            background: isNeu ? 'rgba(232,237,245,0.55)' : 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {preview.length > 0 ? (
            <div
              className="grid"
              style={{
                gap: metrics.folderPreviewGapPx,
                gridTemplateColumns: `repeat(2, ${cellPx}px)`,
                gridTemplateRows: `repeat(2, ${cellPx}px)`,
              }}
            >
              {preview.map((child) => (
                <FolderChildIcon key={child.id} child={child} cellPx={cellPx} iconFontPx={px * 0.16} />
              ))}
            </div>
          ) : (
            <Folder style={{ width: metrics.glyphPx, height: metrics.glyphPx }} className="text-white drop-shadow" />
          )}
        </div>
      );
    }
    // 普通 app 图标：
    // - 背景层：同一张图放大+模糊，填充透明区域（扩图效果），不影响无透明区域的普通图标
    // - 前景层：object-contain 等比显示原图，透明区域透出背景层颜色
    if (iconSrc && !imgError) {
      return (
        <div
          className="ios-icon-shadow relative"
          style={{ ...iconStyle, overflow: 'hidden' }}
        >
          {/* 背景扩图层：放大+模糊，填满透明区域；普通图标前景完全遮住此层不可见 */}
          <IconBlurBg src={iconSrc} radius={metrics.iconRadius} />
          <img
            src={iconSrc}
            alt={item.name}
            draggable={false}
            decoding="async"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain',   // 等比显示，透明区域透出下方背景层
              zIndex: 1,
            }}
            onLoad={(e) => {
              if (!item.iconUrl) return;
              if (getBgColorCache(item.iconUrl) !== undefined) return;
              const color = extractBgColorFromImg(e.currentTarget);
              if (color) {
                setBgColorCache(item.iconUrl, color);
                setIconBg(color);
              } else {
                fetchIconBgColor(item.iconUrl, item.iconUrl).then((c) => {
                  if (c) setIconBg(c);
                });
              }
            }}
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
    // 无图标 fallback：纯色首字母
    return (
      <div
        className="flex items-center justify-center ios-icon-shadow"
        style={{ ...iconStyle, background: '#888888' }}
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

  return (
    <div className={`relative ${ghost ? 'opacity-40' : ''}`}>
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragStart={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        className={`app-icon-button flex flex-col items-center gap-1 select-none touch-none ${editMode ? 'animate-wiggle' : ''} ${pressFeedbackClass}`}
      >
        {renderIconContent()}
        <span
          className={`app-icon-label ${metrics.textClass} font-medium truncate ${isNeumorphism ? 'text-slate-600' : 'text-white drop-shadow-md'}`}
          style={{ maxWidth: metrics.labelMaxWidthPx }}
        >
          {item.name}
        </span>
      </button>
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

export default AppIcon;
