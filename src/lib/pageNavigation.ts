export type SwipeAxis = 'pending' | 'horizontal' | 'vertical';

export interface PageSwipeCommitInput {
  dx: number;
  durationMs: number;
  viewportWidth: number;
  axis: SwipeAxis;
}

export interface DragEdgeTargetInput {
  currentPage: number;
  pageCount: number;
  privacyPageCount: number;
  edge: 'left' | 'right';
  allowPrivacyPage: boolean;
  hasLeadingPrivacyPage: boolean;
  canCreateLeadingPrivacyPage: boolean;
  hasTrailingPage: boolean;
  canCreateTrailingPage: boolean;
}

export interface DragEdgeTarget {
  page: number;
  createsTrailingPage: boolean;
  createsLeadingPrivacyPage: boolean;
}

const AXIS_LOCK_DISTANCE_PX = 10;
const MIN_SWIPE_DISTANCE_PX = 44;
const MAX_SWIPE_DISTANCE_PX = 72;
const SWIPE_VIEWPORT_RATIO = 0.14;
const MIN_FLICK_DISTANCE_PX = 24;
const MIN_FLICK_VELOCITY_PX_PER_MS = 0.45;

/** 手势一旦越过死区即锁定主轴，避免结尾轻微纵向偏移推翻已确认的横滑意图。 */
export function resolveSwipeAxis(dx: number, dy: number): SwipeAxis {
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (Math.max(absDx, absDy) <= AXIS_LOCK_DISTANCE_PX) return 'pending';
  return absDx > absDy ? 'horizontal' : 'vertical';
}

/** 慢滑看距离、快速甩动看速度；两种常见移动端翻页手势都能稳定识别。 */
export function shouldCommitPageSwipe(input: PageSwipeCommitInput): boolean {
  if (input.axis !== 'horizontal' || !Number.isFinite(input.dx)) return false;
  const width = Number.isFinite(input.viewportWidth) && input.viewportWidth > 0
    ? input.viewportWidth
    : 360;
  const distanceThreshold = Math.min(
    MAX_SWIPE_DISTANCE_PX,
    Math.max(MIN_SWIPE_DISTANCE_PX, width * SWIPE_VIEWPORT_RATIO),
  );
  const distance = Math.abs(input.dx);
  const duration = Math.max(1, input.durationMs);
  return distance >= distanceThreshold
    || (distance >= MIN_FLICK_DISTANCE_PX
      && distance / duration >= MIN_FLICK_VELOCITY_PX_PER_MS);
}

/** 普通页索引从 0 开始，隐私页为 -1；边界手势只回弹，不隐式创建普通页。 */
export function resolvePageSwipeTarget(
  currentPage: number,
  pageCount: number,
  dx: number,
  privacyPageCount = 1,
): number | null {
  if (
    !Number.isInteger(currentPage)
    || !Number.isInteger(pageCount)
    || pageCount <= 0
    || !Number.isInteger(privacyPageCount)
    || privacyPageCount <= 0
  ) return null;
  if (dx < 0) {
    if (currentPage < -1) return currentPage + 1;
    if (currentPage === -1) return 0;
    return currentPage < pageCount - 1 ? currentPage + 1 : null;
  }
  if (dx > 0) {
    if (currentPage === 0) return -1;
    if (currentPage < 0) return currentPage > -privacyPageCount ? currentPage - 1 : null;
    return currentPage > 0 ? currentPage - 1 : null;
  }
  return null;
}

/**
 * 拖拽边缘目标与 UI 解耦：普通页可双向穿行，只有普通应用可进入隐私页，
 * 最后一页右侧按需复用或创建一个临时落点页。
 */
export function resolveDragEdgeTarget(input: DragEdgeTargetInput): DragEdgeTarget | null {
  if (
    !Number.isInteger(input.currentPage)
    || !Number.isInteger(input.pageCount)
    || input.pageCount <= 0
    || !Number.isInteger(input.privacyPageCount)
    || input.privacyPageCount <= 0
  ) {
    return null;
  }

  if (input.edge === 'left') {
    if (input.currentPage > 0) {
      return { page: input.currentPage - 1, createsTrailingPage: false, createsLeadingPrivacyPage: false };
    }
    if (input.currentPage === 0 && input.allowPrivacyPage) {
      return { page: -1, createsTrailingPage: false, createsLeadingPrivacyPage: false };
    }
    if (input.currentPage < 0) {
      const leftmostPage = -input.privacyPageCount;
      if (input.currentPage > leftmostPage) {
        return { page: input.currentPage - 1, createsTrailingPage: false, createsLeadingPrivacyPage: false };
      }
      if (input.currentPage !== leftmostPage) return null;
      if (input.hasLeadingPrivacyPage) {
        return { page: leftmostPage - 1, createsTrailingPage: false, createsLeadingPrivacyPage: false };
      }
      if (input.canCreateLeadingPrivacyPage) {
        return { page: leftmostPage - 1, createsTrailingPage: false, createsLeadingPrivacyPage: true };
      }
    }
    return null;
  }

  if (input.currentPage < -1) {
    return { page: input.currentPage + 1, createsTrailingPage: false, createsLeadingPrivacyPage: false };
  }
  if (input.currentPage === -1) {
    return { page: 0, createsTrailingPage: false, createsLeadingPrivacyPage: false };
  }
  if (input.currentPage < input.pageCount - 1) {
    return { page: input.currentPage + 1, createsTrailingPage: false, createsLeadingPrivacyPage: false };
  }
  if (input.currentPage !== input.pageCount - 1) return null;
  if (input.hasTrailingPage) {
    return { page: input.pageCount, createsTrailingPage: false, createsLeadingPrivacyPage: false };
  }
  if (input.canCreateTrailingPage) {
    return { page: input.pageCount, createsTrailingPage: true, createsLeadingPrivacyPage: false };
  }
  return null;
}

/** 逻辑页码到横向滑轨索引；临时前置隐私页存在时所有既有页面右移一格。 */
export function getPageTrackIndex(
  page: number,
  privacyPageCount: number,
  hasLeadingPrivacyPage = false,
): number {
  return page + privacyPageCount + (hasLeadingPrivacyPage ? 1 : 0);
}
