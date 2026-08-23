/**
 * 图标裁剪弹窗（纯 CSS 模式，无 canvas，无跨域限制）
 * - 用户拖动/缩放裁剪框选择区域
 * - 确认后输出 IconCrop（x%/y%/size%），由 AppIcon 用 CSS transform 渲染
 * - 支持任意来源图片（URL / dataURL / blob URL），不受 CORS 限制
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { IconCrop } from '@/types';
import { Move, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface IconCropDialogProps {
  /** 待裁剪图片的 src（任意 URL，无 CORS 要求） */
  src: string;
  /** 初始裁剪参数（编辑时回显） */
  initialCrop?: IconCrop;
  onConfirm: (crop: IconCrop) => void;
  onCancel: () => void;
}

const MIN_SIZE_PCT = 10; // 最小裁剪框 10%

const IconCropDialog: React.FC<IconCropDialogProps> = ({ src, initialCrop, onConfirm, onCancel }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 裁剪参数（百分比，相对图片实际渲染尺寸）
  const [crop, setCrop] = useState<IconCrop>(
    initialCrop ?? { x: 10, y: 10, size: 80 }
  );

  // 拖动/缩放 ref
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origSize: number } | null>(null);

  // 图片实际渲染尺寸（容器内 object-contain 后的尺寸）
  const [renderedSize, setRenderedSize] = useState<{ w: number; h: number; offX: number; offY: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const computeRenderedSize = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const ratio = img.naturalWidth / img.naturalHeight;
    let w = cw, h = cw / ratio;
    if (h > ch) { h = ch; w = ch * ratio; }
    setRenderedSize({ w: Math.round(w), h: Math.round(h), offX: Math.round((cw - w) / 2), offY: Math.round((ch - h) / 2) });
  }, []);

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    imgRef.current = e.currentTarget;
    computeRenderedSize();
    if (!initialCrop) {
      const imgEl = e.currentTarget;
      const container = containerRef.current;
      if (!container) return;
      const cw = container.clientWidth, ch = container.clientHeight;
      const ratio = imgEl.naturalWidth / imgEl.naturalHeight;
      let w = cw, h = cw / ratio;
      if (h > ch) { h = ch; w = ch * ratio; }
      // 初始裁剪框：居中，取短边 80%
      const shortPct = Math.round(Math.min(w, h) / Math.max(w, h) * 80);
      const sizePct = Math.min(80, shortPct);
      setCrop({ x: Math.round((100 - sizePct) / 2), y: Math.round((100 - sizePct) / 2), size: sizePct });
    }
  }, [initialCrop]);

  useEffect(() => {
    window.addEventListener('resize', computeRenderedSize);
    return () => window.removeEventListener('resize', computeRenderedSize);
  }, [computeRenderedSize]);

  // 阻止容器内滚动穿透
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('touchmove', prevent, { passive: false });
    return () => el.removeEventListener('touchmove', prevent);
  }, []);

  /** 将容器坐标转换为百分比（相对渲染图片） */
  const toPct = useCallback((clientX: number, clientY: number) => {
    if (!renderedSize) return { px: 0, py: 0 };
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left - renderedSize.offX;
    const y = clientY - rect.top - renderedSize.offY;
    return {
      px: (x / renderedSize.w) * 100,
      py: (y / renderedSize.h) * 100,
    };
  }, [renderedSize]);

  // ── 拖动裁剪框 ──────────────────────────────────────────────────────────────
  const onCropPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: crop.x, origY: crop.y };
  }, [crop]);

  const onCropPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !renderedSize) return;
    const dx = ((e.clientX - dragRef.current.startX) / renderedSize.w) * 100;
    const dy = ((e.clientY - dragRef.current.startY) / renderedSize.h) * 100;
    setCrop((prev) => ({
      ...prev,
      x: Math.max(0, Math.min(100 - prev.size, dragRef.current!.origX + dx)),
      y: Math.max(0, Math.min(100 - prev.size, dragRef.current!.origY + dy)),
    }));
  }, [renderedSize]);

  const onCropPointerUp = useCallback(() => { dragRef.current = null; }, []);

  // ── 调整裁剪框大小（右下角 handle） ────────────────────────────────────────
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origSize: crop.size };
  }, [crop]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current || !renderedSize) return;
    const delta = Math.max(
      ((e.clientX - resizeRef.current.startX) / renderedSize.w) * 100,
      ((e.clientY - resizeRef.current.startY) / renderedSize.h) * 100,
    );
    setCrop((prev) => ({
      ...prev,
      size: Math.max(MIN_SIZE_PCT, Math.min(100 - prev.x, 100 - prev.y, resizeRef.current!.origSize + delta)),
    }));
  }, [renderedSize]);

  const onResizePointerUp = useCallback(() => { resizeRef.current = null; }, []);

  // ── 缩放 / 重置 ─────────────────────────────────────────────────────────────
  const handleZoom = useCallback((delta: number) => {
    setCrop((prev) => {
      const newSize = Math.max(MIN_SIZE_PCT, Math.min(100, prev.size + delta));
      const cx = prev.x + prev.size / 2;
      const cy = prev.y + prev.size / 2;
      return {
        x: Math.max(0, Math.min(100 - newSize, cx - newSize / 2)),
        y: Math.max(0, Math.min(100 - newSize, cy - newSize / 2)),
        size: newSize,
      };
    });
  }, []);

  const handleReset = useCallback(() => {
    setCrop({ x: 10, y: 10, size: 80 });
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm({
      x: Math.round(crop.x * 10) / 10,
      y: Math.round(crop.y * 10) / 10,
      size: Math.round(crop.size * 10) / 10,
    });
  }, [crop, onConfirm]);

  // ── 裁剪框在容器内的像素位置（用于渲染） ───────────────────────────────────
  const cropPx = renderedSize ? {
    left: renderedSize.offX + (crop.x / 100) * renderedSize.w,
    top:  renderedSize.offY + (crop.y / 100) * renderedSize.h,
    size: (crop.size / 100) * Math.min(renderedSize.w, renderedSize.h),
  } : null;

  // 预览：用 CSS transform 模拟最终渲染效果
  const previewScale = renderedSize ? (60 / ((crop.size / 100) * Math.min(renderedSize.w, renderedSize.h))) : 1;
  const previewImgStyle: React.CSSProperties = renderedSize ? {
    width: renderedSize.w,
    height: renderedSize.h,
    transform: `scale(${previewScale})`,
    transformOrigin: `${crop.x + crop.size / 2}% ${crop.y + crop.size / 2}%`,
    objectFit: 'contain' as const,
    pointerEvents: 'none' as const,
    flexShrink: 0,
    position: 'absolute' as const,
    left: renderedSize.offX - (renderedSize.w - 60 / previewScale) / 2,
    top: renderedSize.offY - (renderedSize.h - 60 / previewScale) / 2,
  } : {};

  // 不能用 left/top 计算，改用 translate 方案
  const previewStyle: React.CSSProperties = renderedSize ? (() => {
    const scale = 60 / ((crop.size / 100) * Math.min(renderedSize.w, renderedSize.h));
    const cropPxX = renderedSize.offX + (crop.x / 100) * renderedSize.w;
    const cropPxY = renderedSize.offY + (crop.y / 100) * renderedSize.h;
    const cropSizePx = (crop.size / 100) * Math.min(renderedSize.w, renderedSize.h);
    return {
      width: renderedSize.w,
      height: renderedSize.h,
      transform: `scale(${scale})`,
      transformOrigin: `${cropPxX + cropSizePx / 2}px ${cropPxY + cropSizePx / 2}px`,
      position: 'absolute' as const,
      left: -(cropPxX + cropSizePx / 2) * scale + 30,
      top: -(cropPxY + cropSizePx / 2) * scale + 30,
      objectFit: 'contain' as const,
      pointerEvents: 'none' as const,
      flexShrink: 0,
    };
  })() : {};

  void previewImgStyle;

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[90%] max-w-sm rounded-2xl overflow-hidden flex flex-col bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white text-sm font-semibold">裁剪图标</span>
        </div>

        {/* 图片容器：浅色棋盘格背景，方便识别透明区域 */}
        <div
          ref={containerRef}
          className="relative w-full select-none"
          style={{
            aspectRatio: '8 / 5', maxHeight: 320,
            backgroundImage: 'linear-gradient(45deg,#e0e0e0 25%,transparent 25%),linear-gradient(-45deg,#e0e0e0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e0e0e0 75%),linear-gradient(-45deg,transparent 75%,#e0e0e0 75%)',
            backgroundSize: '12px 12px',
            backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
            backgroundColor: '#f5f5f5',
          }}
        >
          {/* 底图 */}
          <img
            ref={(el) => { if (el) imgRef.current = el; }}
            src={src}
            alt="待裁剪图片"
            draggable={false}
            onLoad={handleImgLoad}
            style={{
              position: 'absolute',
              left: renderedSize?.offX ?? 0,
              top: renderedSize?.offY ?? 0,
              width: renderedSize?.w ?? 'auto',
              height: renderedSize?.h ?? 'auto',
              objectFit: 'contain',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />

          {/* 遮罩 + 裁剪框 */}
          {cropPx && (
            <>
              {/* 四块遮罩 */}
              <div className="absolute bg-black/55" style={{ left: 0, top: 0, right: 0, height: cropPx.top }} />
              <div className="absolute bg-black/55" style={{ left: 0, top: cropPx.top + cropPx.size, right: 0, bottom: 0 }} />
              <div className="absolute bg-black/55" style={{ left: 0, top: cropPx.top, width: cropPx.left, height: cropPx.size }} />
              <div className="absolute bg-black/55" style={{ left: cropPx.left + cropPx.size, top: cropPx.top, right: 0, height: cropPx.size }} />

              {/* 裁剪框 */}
              <div
                className="absolute border-2 border-white/80 cursor-move"
                style={{ left: cropPx.left, top: cropPx.top, width: cropPx.size, height: cropPx.size, boxShadow: '0 0 0 1px rgba(0,0,0,0.4)' }}
                onPointerDown={onCropPointerDown}
                onPointerMove={onCropPointerMove}
                onPointerUp={onCropPointerUp}
                onPointerCancel={onCropPointerUp}
              >
                {/* 三等分辅助线 */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundImage: 'linear-gradient(to right,rgba(255,255,255,.15) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.15) 1px,transparent 1px)',
                  backgroundSize: `${cropPx.size / 3}px ${cropPx.size / 3}px`,
                }} />
                {/* 四角标记 */}
                {(['top-0 left-0 border-t-2 border-l-2','top-0 right-0 border-t-2 border-r-2','bottom-0 left-0 border-b-2 border-l-2','bottom-0 right-0 border-b-2 border-r-2'] as const).map((cls) => (
                  <div key={cls} className={`absolute w-3 h-3 ${cls} border-white pointer-events-none`} />
                ))}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Move className="w-4 h-4 text-white/40" />
                </div>
                {/* 右下角 resize handle */}
                <div
                  className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-0.5"
                  style={{ pointerEvents: 'auto' }}
                  onPointerDown={onResizePointerDown}
                  onPointerMove={onResizePointerMove}
                  onPointerUp={onResizePointerUp}
                  onPointerCancel={onResizePointerUp}
                >
                  <div className="w-3 h-3 bg-white/80 rounded-tl-sm" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-white/10">
          <button type="button" onClick={() => handleZoom(-5)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors" title="缩小">
            <ZoomOut className="w-4 h-4 text-white/70" />
          </button>
          <button type="button" onClick={() => handleZoom(5)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors" title="放大">
            <ZoomIn className="w-4 h-4 text-white/70" />
          </button>
          <button type="button" onClick={handleReset} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors" title="重置">
            <RotateCcw className="w-4 h-4 text-white/70" />
          </button>
          <div className="flex-1" />
          <button type="button" onClick={onCancel} className="px-4 py-1.5 rounded-xl text-sm text-white/50 hover:text-white/80 transition-colors">取消</button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-1.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            应用
          </button>
        </div>
      </div>
    </div>
  );
};

export default IconCropDialog;
