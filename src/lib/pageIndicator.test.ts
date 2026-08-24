import { describe, expect, it } from 'vitest';
import {
  getVisiblePageIndicatorCount,
  PAGE_INDICATOR_IDLE_MS,
  shouldRenderPageIndicator,
} from './pageIndicator';

describe('pageIndicator', () => {
  it('单页默认隐藏，多页显示', () => {
    expect(shouldRenderPageIndicator(getVisiblePageIndicatorCount(1, 0))).toBe(false);
    expect(shouldRenderPageIndicator(getVisiblePageIndicatorCount(2, 0))).toBe(true);
    expect(shouldRenderPageIndicator(getVisiblePageIndicatorCount(1, 1))).toBe(true);
  });

  it('把拖拽创建的临时普通页和隐私页计入指示器', () => {
    expect(getVisiblePageIndicatorCount(1, 0, false, true)).toBe(2);
    expect(getVisiblePageIndicatorCount(1, 0, true, false)).toBe(2);
  });

  it('使用足够读取当前页反馈的空闲隐藏延迟', () => {
    expect(PAGE_INDICATOR_IDLE_MS).toBe(2_200);
  });
});
