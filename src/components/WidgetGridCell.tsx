import React, { useRef, useCallback } from 'react';
import type { DesktopItem } from '@/types';
import CombinedWidget from './CombinedWidget';
import ClockWidget from './ClockWidget';
import SearchBar from './SearchBar';

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

  const skeletonH = item.widgetType === 'combined' ? 'h-[180px]' : item.widgetType === 'clock' ? 'h-[96px]' : 'h-[56px]';

  if (ghost) {
    return (
      <div className={`rounded-2xl bg-white/10 animate-pulse mx-0 ${skeletonH}`} />
    );
  }

  return (
    <div
      className="relative touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {item.widgetType === 'combined' ? <CombinedWidget /> : item.widgetType === 'clock' ? <ClockWidget /> : <SearchBar />}
    </div>
  );
};

export default WidgetGridCell;
