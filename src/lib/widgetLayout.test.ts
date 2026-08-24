import { describe, expect, it } from 'vitest';
import { getIconLayoutMetrics } from './iconLayout';
import { getWidgetGridRowGapPx } from './widgetConfig';
import {
  getWidgetBottomClearancePx,
  getWidgetLayoutMetrics,
  resolveGridRowAtY,
} from './widgetLayout';

describe('widgetLayout', () => {
  it('所有组件严格按声明的 rowSpan 和当前图标行高计算占用高度', () => {
    const iconPx = 64;
    const rowHeight = getIconLayoutMetrics('normal', iconPx).cellMinHeightPx;
    const gap = getWidgetGridRowGapPx();

    expect(getWidgetLayoutMetrics('search', iconPx)).toMatchObject({
      rowSpan: 1,
      cellMinHeightPx: rowHeight,
    });
    expect(getWidgetLayoutMetrics('clock', iconPx)).toMatchObject({
      rowSpan: 2,
      cellMinHeightPx: rowHeight * 2 + gap,
    });
    expect(getWidgetLayoutMetrics('combined', iconPx)).toMatchObject({
      rowSpan: 3,
      cellMinHeightPx: rowHeight * 3 + gap * 2,
    });
  });

  it('按真实等高网格定位单行和多行组件的目标行', () => {
    const top = 100;
    const rowHeight = 68;
    const gap = 12;

    expect(resolveGridRowAtY(100, top, rowHeight, gap, 8)).toBe(0);
    expect(resolveGridRowAtY(168, top, rowHeight, gap, 8)).toBe(0);
    expect(resolveGridRowAtY(175, top, rowHeight, gap, 8)).toBe(1);
    expect(resolveGridRowAtY(180, top, rowHeight, gap, 8)).toBe(1);
    expect(resolveGridRowAtY(340, top, rowHeight, gap, 8)).toBe(3);
  });

  it('电脑端组件高度使用自适应行轨和间隔，而不是退回普通图标高度', () => {
    expect(getWidgetLayoutMetrics('search', 46, true, 90, 16).cellMinHeightPx).toBe(90);
    expect(getWidgetLayoutMetrics('clock', 46, true, 90, 16).cellMinHeightPx).toBe(196);
    expect(getWidgetLayoutMetrics('combined', 46, true, 90, 16).cellMinHeightPx).toBe(302);
  });

  it('5 列紧凑布局为组件避让下一行应用的名称溢出区', () => {
    expect(getWidgetBottomClearancePx(66.8, 52.8, true)).toBeCloseTo(14, 8);
    expect(getWidgetBottomClearancePx(66.8, 52.8, false)).toBe(0);
    expect(getWidgetBottomClearancePx(52.8, 52.8, true)).toBe(0);
  });

  it('拒绝网格外或无效几何数据', () => {
    expect(resolveGridRowAtY(99, 100, 68, 12, 8)).toBeNull();
    expect(resolveGridRowAtY(100, 100, 0, 12, 8)).toBeNull();
    expect(resolveGridRowAtY(100, 100, 68, 12, 0)).toBeNull();
  });
});
