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
  onDragBegin?: (item: DesktopItem, x: number, y: number, pointerId: number) => void;
  onLongPress?: (item: DesktopItem, x: number, y: number) => void;
}

const WidgetGridCell: React.FC<WidgetGridCellProps> = ({
  item,
  ghost = false,
  iconPx,
  cellHeightPx,
  onDragBegin,
  onLongPress,
}) => {
  const layout = getWidgetLayoutMetrics(item.widgetType, iconPx);
  const resolvedCellHeightPx = Number.isFinite(cellHeightPx)
    ? Math.max(layout.cellMinHeightPx, cellHeightPx ?? layout.cellMinHeightPx)
    : layout.cellMinHeightPx;
  const WidgetComponent = getWidgetComponent(item.widgetType);

  const pressIntent = useLongPressIntent<HTMLDivElement>({
    ignoreInteractiveDescendants: true,
    onLongPress: (x, y) => onLongPress?.(item, x, y),
    onDragStart: (x, y, pointerId) => onDragBegin?.(item, x, y, pointerId),
  });

  if (ghost) {
    return (
      <div
        className="mx-0 rounded-2xl bg-white/10 animate-pulse"
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
      <div className="w-full">
        <WidgetComponent />
      </div>
    </div>
  );
};

export default React.memo(WidgetGridCell);
