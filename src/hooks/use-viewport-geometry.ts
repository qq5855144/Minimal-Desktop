import { useEffect, useState } from 'react';
import {
  readViewportGeometry,
  type ViewportGeometry,
} from '@/lib/viewport';

function geometryEquals(a: ViewportGeometry, b: ViewportGeometry): boolean {
  return a.layout.width === b.layout.width
    && a.layout.height === b.layout.height
    && a.visual.left === b.visual.left
    && a.visual.top === b.visual.top
    && a.visual.width === b.visual.width
    && a.visual.height === b.visual.height
    && a.shell.left === b.shell.left
    && a.shell.top === b.shell.top
    && a.shell.width === b.shell.width
    && a.shell.height === b.shell.height;
}

/**
 * 同时监听布局视口与 VisualViewport。事件按动画帧合并，避免地址栏动画、
 * 屏幕旋转或软键盘弹出时连续触发 React 布局。
 */
export function useViewportGeometry(): ViewportGeometry {
  const [geometry, setGeometry] = useState(readViewportGeometry);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = readViewportGeometry();
      setGeometry((current) => geometryEquals(current, next) ? current : next);
    };
    const scheduleUpdate = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(update);
    };
    const visualViewport = window.visualViewport;

    update();
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    window.addEventListener('orientationchange', scheduleUpdate, { passive: true });
    visualViewport?.addEventListener('resize', scheduleUpdate, { passive: true });
    visualViewport?.addEventListener('scroll', scheduleUpdate, { passive: true });

    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      visualViewport?.removeEventListener('resize', scheduleUpdate);
      visualViewport?.removeEventListener('scroll', scheduleUpdate);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return geometry;
}
