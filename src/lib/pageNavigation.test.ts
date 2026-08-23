import { describe, expect, it } from 'vitest';
import {
  getPageTrackIndex,
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
    expect(resolvePageSwipeTarget(-1, 3, 60, 3)).toBe(-2);
    expect(resolvePageSwipeTarget(-3, 3, 60, 3)).toBeNull();
    expect(getPageTrackIndex(-3, 3)).toBe(0);
    expect(getPageTrackIndex(0, 3)).toBe(3);
  });

  it('拖到末页右边缘时复用或创建临时页，并限制隐私页入口', () => {
    expect(resolveDragEdgeTarget({
      currentPage: 2,
      pageCount: 3,
      privacyPageCount: 1,
      edge: 'right',
      allowPrivacyPage: false,
      hasLeadingPrivacyPage: false,
      canCreateLeadingPrivacyPage: false,
      hasTrailingPage: false,
      canCreateTrailingPage: true,
    })).toEqual({ page: 3, createsTrailingPage: true, createsLeadingPrivacyPage: false });
    expect(resolveDragEdgeTarget({
      currentPage: 2,
      pageCount: 3,
      privacyPageCount: 1,
      edge: 'right',
      allowPrivacyPage: false,
      hasLeadingPrivacyPage: false,
      canCreateLeadingPrivacyPage: false,
      hasTrailingPage: true,
      canCreateTrailingPage: false,
    })).toEqual({ page: 3, createsTrailingPage: false, createsLeadingPrivacyPage: false });
    expect(resolveDragEdgeTarget({
      currentPage: 0,
      pageCount: 3,
      privacyPageCount: 1,
      edge: 'left',
      allowPrivacyPage: false,
      hasLeadingPrivacyPage: false,
      canCreateLeadingPrivacyPage: false,
      hasTrailingPage: false,
      canCreateTrailingPage: false,
    })).toBeNull();
  });

  it('隐私页向左递减并可在最左边缘按需创建临时负页', () => {
    expect(resolveDragEdgeTarget({
      currentPage: -1,
      pageCount: 2,
      privacyPageCount: 2,
      edge: 'left',
      allowPrivacyPage: true,
      hasLeadingPrivacyPage: false,
      canCreateLeadingPrivacyPage: true,
      hasTrailingPage: false,
      canCreateTrailingPage: false,
    })).toEqual({ page: -2, createsTrailingPage: false, createsLeadingPrivacyPage: false });
    expect(resolveDragEdgeTarget({
      currentPage: -2,
      pageCount: 2,
      privacyPageCount: 2,
      edge: 'left',
      allowPrivacyPage: true,
      hasLeadingPrivacyPage: false,
      canCreateLeadingPrivacyPage: true,
      hasTrailingPage: false,
      canCreateTrailingPage: false,
    })).toEqual({ page: -3, createsTrailingPage: false, createsLeadingPrivacyPage: true });
    expect(getPageTrackIndex(-3, 2, true)).toBe(0);
  });
});
