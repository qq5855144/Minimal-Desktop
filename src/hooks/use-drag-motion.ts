import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type Point = { x: number; y: number };
type Snapshot = { positions: Map<string, Point>; sourceId: string; release: Point };

/** 仅在松手前后测量一次：布局立即提交，视觉层用 FLIP 平滑归位。 */
export function useDragMotion(container: RefObject<HTMLElement>) {
  const pending = useRef<Snapshot | null>(null);
  const animations = useRef(new Set<Animation>());
  const reducedMotion = useRef(false);

  const cancelMotion = useCallback(() => {
    pending.current = null;
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotion.current = preference.matches;
      if (preference.matches) cancelMotion();
    };
    update();
    preference.addEventListener('change', update);
    return () => {
      preference.removeEventListener('change', update);
      cancelMotion();
    };
  }, [cancelMotion]);

  const captureDrop = useCallback((sourceId: string, release: Point) => {
    cancelMotion();
    const root = container.current;
    if (!root || reducedMotion.current) return;
    const bounds = root.getBoundingClientRect();
    const positions = new Map<string, Point>();
    for (const cell of root.querySelectorAll<HTMLElement>('[data-cell][data-itemid]')) {
      const rect = cell.getBoundingClientRect();
      if (rect.right <= bounds.left || rect.left >= bounds.right
        || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
      positions.set(cell.dataset.itemid!, {
        x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      });
    }
    pending.current = { positions, sourceId, release };
  }, [cancelMotion, container]);

  // 无依赖数组：消费本次拖拽提交后的第一个 render，取消/原位放回也能归位。
  useLayoutEffect(() => {
    const snapshot = pending.current;
    pending.current = null;
    const root = container.current;
    if (!snapshot || !root || reducedMotion.current) return;
    const bounds = root.getBoundingClientRect();
    const moves: { cell: HTMLElement; dx: number; dy: number }[] = [];
    for (const cell of root.querySelectorAll<HTMLElement>('[data-cell][data-itemid]')) {
      if (typeof cell.animate !== 'function') continue;
      const id = cell.dataset.itemid!;
      const before = id === snapshot.sourceId ? snapshot.release : snapshot.positions.get(id);
      if (!before) continue;
      const after = cell.getBoundingClientRect();
      if (after.right <= bounds.left || after.left >= bounds.right
        || after.bottom <= bounds.top || after.top >= bounds.bottom) continue;
      const dx = before.x - after.left - after.width / 2;
      const dy = before.y - after.top - after.height / 2;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      // 跨页或远距离取消不让图标横穿整屏，改为短距离淡入归位。
      const distance = Math.hypot(dx, dy);
      const limit = Math.min(240, bounds.width * 0.6);
      const ratio = distance > limit ? Math.min(12 / distance, 1) : 1;
      moves.push({ cell, dx: dx * ratio, dy: dy * ratio });
    }
    // 先批量读几何，再启动动画，避免交替读写触发重复布局。
    for (const { cell, dx, dy } of moves) {
      const animation = cell.animate([
        { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.88, zIndex: 20 },
        { transform: 'translate(0, 0)', opacity: 1, zIndex: 20 },
      ], { duration: 200, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      animations.current.add(animation);
      const forget = () => animations.current.delete(animation);
      animation.onfinish = forget;
      animation.oncancel = forget;
    }
  });

  return { captureDrop, cancelMotion };
}
