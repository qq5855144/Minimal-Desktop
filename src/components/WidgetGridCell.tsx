import React, { useRef, useCallback } from 'react';
import type { DesktopItem } from '@/types';
import { getWidgetLayoutMetrics } from '@/lib/widgetLayout';
import { getWidgetComponent } from './widgetRenderer';

interface WidgetGridCellProps {
  item: DesktopItem;
  ghost?: boolean;
  onDragBegin?: (item: DesktopItem, x: number, y: number) => void;
  onLongPress?: (x: number, y: number) => void;
}

const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD = 8;

const WidgetGridCell: React.FC<WidgetGridCellProps> = ({
  item,
  ghost = false,
  onDragBegin,
  onLongPress,
}) => {
  const longTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const dragStartedRef = useRef(false);
  const longFiredRef = useRef(false);
  const layout = getWidgetLayoutMetrics(item.widgetType);
  const WidgetComponent = getWidgetComponent(item.widgetType);

  const cancelLong = useCallback(() => {
    if (longTimerRef.current) {
      clearTimeout(longTimerRef.current);
      longTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 只响应主指针，不拦截子元素的点击（SearchBar input 等）
    e.currentTarget.setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    dragStartedRef.current = false;
    longFiredRef.current = false;
    cancelLong();
    longTimerRef.current = setTimeout(() => {
      longFiredRef.current = true;
      onLongPress?.(startXRef.current, startYRef.current);
    }, LONG_PRESS_MS);
  }, [cancelLong, onLongPress]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartedRef.current) return;
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragStartedRef.current = true;
      cancelLong();
      onDragBegin?.(item, e.clientX, e.clientY);
    }
  }, [item, onDragBegin, cancelLong]);

  const handlePointerUp = useCallback(() => {
    dragStartedRef.current = false;
    cancelLong();
  }, [cancelLong]);

  if (ghost) {
    return (
      <div
        className="mx-0 rounded-2xl bg-white/10 animate-pulse"
        style={{ minHeight: layout.cellMinHeightPx }}
      />
    );
  }

  return (
    <div
      className="relative flex w-full touch-none items-center"
      style={{ minHeight: layout.cellMinHeightPx }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="w-full">
        <WidgetComponent />
      </div>
    </div>
  );
};

export default WidgetGridCell;
