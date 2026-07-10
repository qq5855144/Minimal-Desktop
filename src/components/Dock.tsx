import React, { useCallback, useRef, useState } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import { getIconLayoutMetrics } from '@/lib/iconLayout';
import type { DesktopItem } from '@/types';
import AppIcon from './AppIcon';
import SkeletonIcon from './SkeletonIcon';

const Dock: React.FC<{
  onDragBegin: (item: DesktopItem, x: number, y: number) => void;
  onLongPress: (item: DesktopItem, x: number, y: number) => void;
  onDeleteItem: (id: string) => void;
  activeSlot: number | null;
  dropActive: boolean;
}> = ({ onDragBegin, onLongPress, onDeleteItem, activeSlot, dropActive }) => {
  const { data, loading } = useDesktop();
  const dockItems = data.dock ?? [];
  const dockIconMetrics = getIconLayoutMetrics('small');
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  const updateHoverState = useCallback((clientX: number) => {
    setHoverX(clientX);
    let nearestIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    slotRefs.current.forEach((el, index) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const distance = Math.abs(clientX - centerX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    setHoveredSlot(nearestIndex);
  }, []);

  const resetHoverState = useCallback(() => {
    setHoverX(null);
    setHoveredSlot(null);
  }, []);

  const getSlotMotionStyle = useCallback((index: number, occupied: boolean): React.CSSProperties => {
    const slotEl = slotRefs.current[index];
    const slotRect = slotEl?.getBoundingClientRect();
    const centerX = slotRect ? slotRect.left + slotRect.width / 2 : null;

    const hoverInfluence = hoverX !== null && centerX !== null
      ? Math.max(0, 1 - Math.abs(hoverX - centerX) / 140)
      : 0;
    const dragDistance = activeSlot !== null ? Math.abs(index - activeSlot) : Number.POSITIVE_INFINITY;
    const snapInfluence = dropActive && activeSlot !== null
      ? index === activeSlot
        ? 1
        : Math.max(0, 1 - dragDistance / 2.4)
      : 0;

    const scale = 1 + hoverInfluence * 0.32 + snapInfluence * (index === activeSlot ? 0.16 : 0.08);
    const translateY = -(hoverInfluence * 16 + snapInfluence * (index === activeSlot ? 12 : 6));
    const translateX = dropActive && activeSlot !== null
      ? index < activeSlot
        ? -Math.max(0, 10 - dragDistance * 4)
        : index > activeSlot
          ? Math.max(0, 10 - dragDistance * 4)
          : 0
      : 0;
    const brightness = 1 + hoverInfluence * 0.18 + snapInfluence * 0.16;
    const saturate = 1 + hoverInfluence * 0.22 + snapInfluence * 0.2;
    const opacity = occupied ? 1 : 0.18 + hoverInfluence * 0.25 + snapInfluence * 0.2;

    return {
      transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
      transformOrigin: 'center bottom',
      zIndex: Math.round(scale * 100),
      opacity,
      filter: `brightness(${brightness}) saturate(${saturate})`,
      transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, filter 180ms ease, box-shadow 180ms ease, background-color 180ms ease',
      willChange: 'transform, opacity, filter',
    };
  }, [activeSlot, dropActive, hoverX]);

  return (
    <div className="flex justify-center px-4 pb-4 md:pb-6">
      <div
        onPointerMove={(e) => updateHoverState(e.clientX)}
        onPointerLeave={resetHoverState}
        className={`glass relative rounded-[28px] px-3 py-2 md:px-4 md:py-3 flex items-end gap-2 md:gap-3 max-w-md w-full justify-center transition-all duration-200 ${
          dropActive ? 'ring-2 ring-white/40 bg-white/15 shadow-2xl' : ''
        }`}
        style={{
          boxShadow: dropActive
            ? '0 28px 60px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255,255,255,0.28)'
            : '0 18px 40px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.18)',
        }}
      >
        <div className="pointer-events-none absolute inset-x-4 top-1 h-8 rounded-full bg-white/15 blur-xl" />
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-6 rounded-full bg-black/10 blur-2xl" />
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonIcon key={`dock-sk-${i}`} size="small" />)
        ) : (
          <>
            {Array.from({ length: 4 }).map((_, i) => {
              const item = dockItems[i];
              if (item) {
                return (
                  <div
                    key={item.id}
                    ref={(el) => {
                      slotRefs.current[i] = el;
                    }}
                    data-cell="1"
                    data-row={-1}
                    data-col={i}
                    data-page={-1}
                    data-itemid={item.id}
                    className={`relative rounded-[22px] ${
                      activeSlot === i || hoveredSlot === i ? 'bg-white/12' : ''
                    }`}
                    style={getSlotMotionStyle(i, true)}
                  >
                    <div
                      className="pointer-events-none absolute inset-0 rounded-[22px]"
                      style={{
                        boxShadow:
                          activeSlot === i || hoveredSlot === i
                            ? '0 18px 32px rgba(8, 15, 35, 0.2), inset 0 1px 0 rgba(255,255,255,0.18)'
                            : '0 10px 22px rgba(8, 15, 35, 0.1)',
                      }}
                    />
                    <AppIcon
                      item={item}
                      size="small"
                      onLongPress={(x, y) => onLongPress(item, x, y)}
                      onDragBegin={(it, x, y) => onDragBegin(it, x, y)}
                      onDeleteInEditMode={(id) => onDeleteItem(id)}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={`dock-empty-${i}`}
                  ref={(el) => {
                    slotRefs.current[i] = el;
                  }}
                  data-cell="1"
                  data-row={-1}
                  data-col={i}
                  data-page={-1}
                  className="relative shrink-0"
                  style={{
                    ...getSlotMotionStyle(i, false),
                    width: dockIconMetrics.iconPx,
                    height: dockIconMetrics.iconPx,
                    borderRadius: dockIconMetrics.iconRadius,
                    background: activeSlot === i || hoveredSlot === i
                      ? 'rgba(255,255,255,0.18)'
                      : 'rgba(255,255,255,0.08)',
                    boxShadow: activeSlot === i
                      ? 'inset 0 1px 0 rgba(255,255,255,0.2), 0 12px 24px rgba(8,15,35,0.18)'
                      : 'inset 0 1px 0 rgba(255,255,255,0.12)',
                  }}
                />
              );
            })}
            {dockItems.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className={`text-xs transition-colors ${dropActive ? 'text-white/90' : 'text-white/50'}`}>
                  长按图标拖到此处添加到 Dock
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Dock;
