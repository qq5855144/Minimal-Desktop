import { describe, expect, it } from 'vitest';
import {
  resolveDragEdgeTarget,
  resolvePageSwipeTarget,
  resolveSwipeAxis,
  shouldCommitPageSwipe,
} from './pageNavigation';

describe('pageNavigation', () => {
  it('越过死区后锁定主轴，横滑不会被结尾纵向漂移否决', () => {
    expect(resolveSwipeAxis(8, 4)).toBe('pending');
    expect(resolveSwipeAxis(18, 9)).toBe('horizontal');
    expect(resolveSwipeAxis(9, 18)).toBe('vertical');
    expect(shouldCommitPageSwipe({
      dx: -58,
      durationMs: 420,
      viewportWidth: 390,
      axis: 'horizontal',
    })).toBe(true);
  });

  it('短促快速甩动可翻页，短且慢的误触会回弹', () => {
    expect(shouldCommitPageSwipe({
      dx: -30,
      durationMs: 50,
      viewportWidth: 390,
      axis: 'horizontal',
    })).toBe(true);
    expect(shouldCommitPageSwipe({
      dx: -30,
      durationMs: 300,
      viewportWidth: 390,
      axis: 'horizontal',
    })).toBe(false);
    expect(shouldCommitPageSwipe({
      dx: -80,
      durationMs: 200,
      viewportWidth: 390,
      axis: 'vertical',
    })).toBe(false);
  });

  it('按普通页与隐私页边界解析目标，最后一页不由普通滑动创建新页', () => {
    expect(resolvePageSwipeTarget(0, 3, -60)).toBe(1);
    expect(resolvePageSwipeTarget(2, 3, -60)).toBeNull();
    expect(resolvePageSwipeTarget(0, 3, 60)).toBe(-1);
    expect(resolvePageSwipeTarget(-1, 3, -60)).toBe(0);
  });

  it('拖到末页右边缘时复用或创建临时页，并限制隐私页入口', () => {
    expect(resolveDragEdgeTarget({
      currentPage: 2,
      pageCount: 3,
      edge: 'right',
      allowPrivacyPage: false,
      hasTrailingPage: false,
      canCreateTrailingPage: true,
    })).toEqual({ page: 3, createsTrailingPage: true });
    expect(resolveDragEdgeTarget({
      currentPage: 2,
      pageCount: 3,
      edge: 'right',
      allowPrivacyPage: false,
      hasTrailingPage: true,
      canCreateTrailingPage: false,
    })).toEqual({ page: 3, createsTrailingPage: false });
    expect(resolveDragEdgeTarget({
      currentPage: 0,
      pageCount: 3,
      edge: 'left',
      allowPrivacyPage: false,
      hasTrailingPage: false,
      canCreateTrailingPage: false,
    })).toBeNull();
  });
});
