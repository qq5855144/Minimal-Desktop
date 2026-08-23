import { describe, expect, it } from 'vitest';
import { clampFloatingPosition, resolveViewportGeometry } from './viewport';

describe('viewport', () => {
  it('普通手机和桌面视口保持原始布局尺寸', () => {
    const mobile = resolveViewportGeometry({
      layoutWidth: 390,
      layoutHeight: 844,
      visualWidth: 390,
      visualHeight: 844,
      visualScale: 1,
    });
    const desktop = resolveViewportGeometry({
      layoutWidth: 1440,
      layoutHeight: 900,
      visualWidth: 1440,
      visualHeight: 900,
      visualScale: 1,
    });

    expect(mobile.shell).toMatchObject({ width: 390, height: 844 });
    expect(mobile.isWide).toBe(false);
    expect(desktop.shell).toMatchObject({ width: 1440, height: 900 });
    expect(desktop.isWide).toBe(true);
  });

  it('手机电脑模式的窄可视区覆盖伪装的 980px 布局视口', () => {
    const geometry = resolveViewportGeometry({
      layoutWidth: 980,
      layoutHeight: 1740,
      visualWidth: 390,
      visualHeight: 780,
      visualOffsetLeft: 8,
      visualOffsetTop: 24,
      visualScale: 1,
    });

    expect(geometry.layout).toMatchObject({ width: 980, height: 1740 });
    expect(geometry.visual).toMatchObject({ left: 8, top: 24, width: 390, height: 780 });
    expect(geometry.shell).toMatchObject({ left: 8, top: 24, width: 390, height: 780 });
    expect(geometry.isWidthConstrained).toBe(true);
    expect(geometry.isHeightConstrained).toBe(true);
    expect(geometry.isWide).toBe(false);
  });

  it('浏览器正确缩放完整电脑视口时保留桌面布局', () => {
    const geometry = resolveViewportGeometry({
      layoutWidth: 980,
      layoutHeight: 1740,
      visualWidth: 980,
      visualHeight: 1740,
      visualScale: 0.4,
    });

    expect(geometry.shell).toMatchObject({ width: 980, height: 1740 });
    expect(geometry.isWide).toBe(true);
  });

  it('用户主动双指放大时只限制浮层边界，不重新排版桌面', () => {
    const geometry = resolveViewportGeometry({
      layoutWidth: 390,
      layoutHeight: 844,
      visualWidth: 195,
      visualHeight: 422,
      visualOffsetLeft: 80,
      visualOffsetTop: 100,
      visualScale: 2,
    });

    expect(geometry.shell).toMatchObject({ left: 0, top: 0, width: 390, height: 844 });
    expect(geometry.visual).toMatchObject({ left: 80, top: 100, width: 195, height: 422 });
  });

  it('浮层在可视区两侧均保留安全间距', () => {
    expect(clampFloatingPosition(-100, 160, 20, 390)).toBe(28);
    expect(clampFloatingPosition(500, 160, 20, 390)).toBe(242);
  });
});
