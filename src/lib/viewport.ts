const VIEWPORT_EPSILON_PX = 1;
const USER_ZOOM_EPSILON = 0.01;

export interface ViewportMeasurement {
  layoutWidth: number;
  layoutHeight: number;
  visualWidth?: number;
  visualHeight?: number;
  visualOffsetLeft?: number;
  visualOffsetTop?: number;
  visualScale?: number;
}

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface ViewportGeometry {
  /** CSS 布局视口。手机“电脑模式”通常会把它强制为约 980px。 */
  layout: ViewportRect;
  /** 用户当前真正能看到的区域，用于弹层与菜单边界。 */
  visual: ViewportRect;
  /** 桌面壳应使用的区域；不会在用户主动双指缩放时触发重新排版。 */
  shell: ViewportRect;
  isWidthConstrained: boolean;
  isHeightConstrained: boolean;
  isWide: boolean;
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback;
}

function nonNegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function rect(left: number, top: number, width: number, height: number): ViewportRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

/**
 * 将布局视口与 VisualViewport 归一为同一套坐标。
 *
 * 部分手机浏览器开启“电脑模式”后仍保留窄的可视视口，却把 CSS 布局视口
 * 扩大到约 980px。此时按布局视口排版会把桌面和 fixed 弹层推到屏幕之外。
 * 用户主动双指放大时 visualViewport.scale > 1，此时保持原布局，避免缩放途中重排。
 */
export function resolveViewportGeometry(
  measurement: ViewportMeasurement,
  wideBreakpointPx = 768,
): ViewportGeometry {
  const layoutWidth = positive(measurement.layoutWidth, 1);
  const layoutHeight = positive(measurement.layoutHeight, 1);
  const visualWidth = Math.min(
    layoutWidth,
    positive(measurement.visualWidth, layoutWidth),
  );
  const visualHeight = Math.min(
    layoutHeight,
    positive(measurement.visualHeight, layoutHeight),
  );
  const visualLeft = Math.min(
    Math.max(0, layoutWidth - visualWidth),
    nonNegative(measurement.visualOffsetLeft),
  );
  const visualTop = Math.min(
    Math.max(0, layoutHeight - visualHeight),
    nonNegative(measurement.visualOffsetTop),
  );
  const scale = positive(measurement.visualScale, 1);
  const userZoomed = scale > 1 + USER_ZOOM_EPSILON;
  const isWidthConstrained = !userZoomed
    && visualWidth < layoutWidth - VIEWPORT_EPSILON_PX;
  const isHeightConstrained = !userZoomed
    && visualHeight < layoutHeight - VIEWPORT_EPSILON_PX;
  const shellWidth = isWidthConstrained ? visualWidth : layoutWidth;
  const shellHeight = isHeightConstrained ? visualHeight : layoutHeight;
  const shellLeft = isWidthConstrained ? visualLeft : 0;
  const shellTop = isHeightConstrained ? visualTop : 0;

  return {
    layout: rect(0, 0, layoutWidth, layoutHeight),
    visual: rect(visualLeft, visualTop, visualWidth, visualHeight),
    shell: rect(shellLeft, shellTop, shellWidth, shellHeight),
    isWidthConstrained,
    isHeightConstrained,
    isWide: shellWidth >= wideBreakpointPx,
  };
}

export function readViewportGeometry(): ViewportGeometry {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return resolveViewportGeometry({ layoutWidth: 1024, layoutHeight: 768 });
  }
  const root = document.documentElement;
  const visualViewport = window.visualViewport;
  return resolveViewportGeometry({
    layoutWidth: root.clientWidth || window.innerWidth,
    layoutHeight: root.clientHeight || window.innerHeight,
    visualWidth: visualViewport?.width,
    visualHeight: visualViewport?.height,
    visualOffsetLeft: visualViewport?.offsetLeft,
    visualOffsetTop: visualViewport?.offsetTop,
    visualScale: visualViewport?.scale,
  });
}

/** 将 fixed 浮层的起点限制在指定可视轴内。 */
export function clampFloatingPosition(
  desired: number,
  elementSize: number,
  viewportStart: number,
  viewportSize: number,
  margin = 8,
): number {
  const minimum = viewportStart + margin;
  const maximum = viewportStart + viewportSize - elementSize - margin;
  if (!Number.isFinite(maximum) || maximum <= minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, desired));
}
