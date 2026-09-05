import React from 'react';
import { useLongPressIntent } from '@/hooks/use-long-press-intent';
import { getWidgetLayoutMetrics } from '@/lib/widgetLayout';
import type { DesktopItem } from '@/types';
import { getWidgetComponent } from './widgetRenderer';

interface WidgetGridCellProps {
  item: DesktopItem;
  ghost?: boolean;
  iconPx?: number;
  /** 当前网格跨度的完整视觉高度，保证组件与电脑端自适应行轨一致。 */
  cellHeightPx?: number;
  /** 下一行应用向上溢出行轨的高度；组件内容等量上移以保留完整视觉间距。 */
  bottomClearancePx?: number;
  onDragBegin?: (item: DesktopItem, x: number, y: number, pointerId: number) => void;
  onLongPress?: (item: DesktopItem, x: number, y: number) => void;
}

const WidgetGridCell: React.FC<WidgetGridCellProps> = ({
  item,
  ghost = false,
  iconPx,
  cellHeightPx,
  bottomClearancePx = 0,
  onDragBegin,
  onLongPress,
}) => {
  const layout = getWidgetLayoutMetrics(item.widgetType, iconPx);
  const resolvedCellHeightPx = Number.isFinite(cellHeightPx)
    ? Math.max(1, cellHeightPx ?? layout.cellMinHeightPx)
    : layout.cellMinHeightPx;
  const resolvedBottomClearancePx = Number.isFinite(bottomClearancePx)
    ? Math.max(0, bottomClearancePx)
    : 0;
  const WidgetComponent = getWidgetComponent(item.widgetType);

  const pressIntent = useLongPressIntent<HTMLDivElement>({
    ignoreInteractiveDescendants: true,
    onLongPress: (x, y) => onLongPress?.(item, x, y),
    onDragStart: (x, y, pointerId) => onDragBegin?.(item, x, y, pointerId),
  });

  if (ghost) {
    return (
      <div
        className="mx-0 rounded-2xl bg-white/10"
        style={{ height: resolvedCellHeightPx, minHeight: resolvedCellHeightPx }}
      />
    );
  }

  return (
    <div
      className="relative flex w-full touch-none items-center"
      style={{ height: resolvedCellHeightPx, minHeight: resolvedCellHeightPx }}
      onPointerDown={pressIntent.onPointerDown}
      onPointerMove={pressIntent.onPointerMove}
      onPointerUp={pressIntent.onPointerUp}
      onPointerCancel={pressIntent.onPointerCancel}
      onClickCapture={(event) => {
        if (!pressIntent.consumeClick()) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        className="w-full"
        style={{ transform: `translateY(${-resolvedBottomClearancePx}px)` }}
      >
        <WidgetComponent />
      </div>
    </div>
  );
};

export default React.memo(WidgetGridCell);
