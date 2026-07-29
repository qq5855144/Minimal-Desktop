/**
 * 图标裁剪弹窗
 * - 展示原图，用户可拖动/缩放一个正方形裁剪框
 * - 点击"确定"后用 canvas 输出裁剪区域的 dataURL
 * - 纯前端，无 CORS 限制（仅支持 data: / blob: / 同源 URL）
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Move, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface Rect { x: number; y: number; size: number; }

interface IconCropDialogProps {
  /** 待裁剪图片的 src（data URL 或 blob URL） */
  src: string;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}

const MIN_SIZE = 40;
const OUTPUT_SIZE = 256; // 输出 256×256 dataURL

const IconCropDialog: React.FC<IconCropDialogProps> = ({ src, onConfirm, onCancel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 图片在容器内的渲染尺寸
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // 裁剪框（相对容器坐标，单位 px）
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, size: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);

  // 拖拽裁剪框
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  // 调整裁剪框大小（右下角 handle）
  const resizeRef = useRef<{ startX: number; startY: number; origSize: number; origX: number; origY: number } | null>(null);

  /** 图片加载完成后初始化裁剪框（居中，取短边 80%） */
  const initCrop = useCallback((w: number, h: number) => {
    const size = Math.round(Math.min(w, h) * 0.8);
    setCrop({ x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size });
  }, []);

  /** 图片 onLoad：计算在容器内的渲染尺寸 */
  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    imgRef.current = img;
    const container = containerRef.current;
    if (!container) return;
    const maxW = container.clientWidth;
    const maxH = container.clientHeight;
    const ratio = img.naturalWidth / img.naturalHeight;
    let w = maxW, h = maxW / ratio;
    if (h > maxH) { h = maxH; w = maxH * ratio; }
    setImgSize({ w: Math.round(w), h: Math.round(h) });
    setImgLoaded(true);
    initCrop(Math.round(w), Math.round(h));
  }, [initCrop]);

  /** 重置裁剪框 */
  const handleReset = useCallback(() => {
    if (imgSize.w && imgSize.h) initCrop(imgSize.w, imgSize.h);
  }, [imgSize, initCrop]);

  /** 缩放裁剪框 */
  const handleZoom = useCallback((delta: number) => {
    setCrop((prev) => {
      const newSize = Math.max(MIN_SIZE, Math.min(Math.min(imgSize.w, imgSize.h), prev.size + delta));
      const cx = prev.x + prev.size / 2;
      const cy = prev.y + prev.size / 2;
      const nx = Math.max(0, Math.min(imgSize.w - newSize, cx - newSize / 2));
      const ny = Math.max(0, Math.min(imgSize.h - newSize, cy - newSize / 2));
      return { x: Math.round(nx), y: Math.round(ny), size: Math.round(newSize) };
    });
  }, [imgSize]);

  // ── 拖拽裁剪框移动 ──────────────────────────────────────────────────────────

  const onCropPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: crop.x, origY: crop.y };
  }, [crop]);

  const onCropPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setCrop((prev) => ({
      ...prev,
      x: Math.max(0, Math.min(imgSize.w - prev.size, dragRef.current!.origX + dx)),
      y: Math.max(0, Math.min(imgSize.h - prev.size, dragRef.current!.origY + dy)),
    }));
  }, [imgSize]);

  const onCropPointerUp = useCallback(() => { dragRef.current = null; }, []);

  // ── 拖拽右下角调整大小 ──────────────────────────────────────────────────────

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origSize: crop.size, origX: crop.x, origY: crop.y };
  }, [crop]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const delta = Math.max(e.clientX - resizeRef.current.startX, e.clientY - resizeRef.current.startY);
    const newSize = Math.max(MIN_SIZE, Math.min(
      Math.min(imgSize.w - resizeRef.current.origX, imgSize.h - resizeRef.current.origY),
      resizeRef.current.origSize + delta,
    ));
    setCrop((prev) => ({ ...prev, size: Math.round(newSize) }));
  }, [imgSize]);

  const onResizePointerUp = useCallback(() => { resizeRef.current = null; }, []);

  // ── 确认裁剪：用 canvas 绘制 ────────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    const img = imgRef.current;
    if (!img || !imgSize.w) return;
    const canvas = canvasRef.current!;
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d')!;
    // 将裁剪框坐标映射回原始图片坐标
    const scaleX = img.naturalWidth / imgSize.w;
    const scaleY = img.naturalHeight / imgSize.h;
    const sx = crop.x * scaleX;
    const sy = crop.y * scaleY;
    const sw = crop.size * scaleX;
    const sh = crop.size * scaleY;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    onConfirm(canvas.toDataURL('image/png'));
  }, [crop, imgSize, onConfirm]);

  // 阻止容器内滚动穿透
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('touchmove', prevent, { passive: false });
    return () => el.removeEventListener('touchmove', prevent);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[90vw] max-w-sm rounded-2xl overflow-hidden flex flex-col bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white text-sm font-semibold">裁剪图标</span>
          <span className="text-white/40 text-xs">拖动方框选择区域</span>
        </div>

        {/* 图片容器 */}
        <div
          ref={containerRef}
          className="relative w-full bg-black flex items-center justify-center select-none"
          style={{ height: '56vw', maxHeight: 320 }}
        >
          {src && (
            <>
              {/* 底图 */}
              <img
                src={src}
                alt="待裁剪图片"
                draggable={false}
                onLoad={handleImgLoad}
                style={{
                  display: imgLoaded ? 'block' : 'none',
                  width: imgSize.w || undefined,
                  height: imgSize.h || undefined,
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />

              {/* 遮罩 + 裁剪框 */}
              {imgLoaded && crop.size > 0 && (
                <div
                  className="absolute"
                  style={{
                    left: (containerRef.current!.clientWidth - imgSize.w) / 2,
                    top: (containerRef.current!.clientHeight - imgSize.h) / 2,
                    width: imgSize.w,
                    height: imgSize.h,
                    pointerEvents: 'none',
                  }}
                >
                  {/* 四块遮罩 */}
                  {/* 上 */}
                  <div className="absolute bg-black/50" style={{ left: 0, top: 0, right: 0, height: crop.y }} />
                  {/* 下 */}
                  <div className="absolute bg-black/50" style={{ left: 0, top: crop.y + crop.size, right: 0, bottom: 0 }} />
                  {/* 左 */}
                  <div className="absolute bg-black/50" style={{ left: 0, top: crop.y, width: crop.x, height: crop.size }} />
                  {/* 右 */}
                  <div className="absolute bg-black/50" style={{ left: crop.x + crop.size, top: crop.y, right: 0, height: crop.size }} />

                  {/* 裁剪框本体（可拖动） */}
                  <div
                    className="absolute border-2 border-white/80 cursor-move"
                    style={{
                      left: crop.x, top: crop.y,
                      width: crop.size, height: crop.size,
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
                      pointerEvents: 'auto',
                    }}
                    onPointerDown={onCropPointerDown}
                    onPointerMove={onCropPointerMove}
                    onPointerUp={onCropPointerUp}
                    onPointerCancel={onCropPointerUp}
                  >
                    {/* 三等分辅助线 */}
                    <div className="absolute inset-0 pointer-events-none" style={{
                      backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.15) 1px, transparent 1px)',
                      backgroundSize: `${crop.size / 3}px ${crop.size / 3}px`,
                    }} />
                    {/* 四角标记 */}
                    {[['top-0 left-0','border-t-2 border-l-2'],['top-0 right-0','border-t-2 border-r-2'],['bottom-0 left-0','border-b-2 border-l-2'],['bottom-0 right-0','border-b-2 border-r-2']].map(([pos, border]) => (
                      <div key={pos} className={`absolute ${pos} w-3 h-3 ${border} border-white pointer-events-none`} />
                    ))}
                    {/* 中心图标 */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Move className="w-4 h-4 text-white/50" />
                    </div>
                    {/* 右下角 resize handle */}
                    <div
                      className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end"
                      style={{ pointerEvents: 'auto' }}
                      onPointerDown={onResizePointerDown}
                      onPointerMove={onResizePointerMove}
                      onPointerUp={onResizePointerUp}
                      onPointerCancel={onResizePointerUp}
                    >
                      <div className="w-3 h-3 bg-white/80 rounded-tl-sm" />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-white/10">
          <button
            type="button"
            onClick={() => handleZoom(-20)}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            title="缩小裁剪框"
          >
            <ZoomOut className="w-4 h-4 text-white/70" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(20)}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            title="放大裁剪框"
          >
            <ZoomIn className="w-4 h-4 text-white/70" />
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            title="重置"
          >
            <RotateCcw className="w-4 h-4 text-white/70" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 rounded-xl text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!imgLoaded || crop.size === 0}
            className="px-4 py-1.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            使用此区域
          </button>
        </div>
      </div>

      {/* 离屏 canvas，仅用于输出 */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default IconCropDialog;
