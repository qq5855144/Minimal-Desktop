export const PAGE_INDICATOR_IDLE_MS = 2_200;

export function getVisiblePageIndicatorCount(
  normalPageCount: number,
  privacyPageCount: number,
  hasLeadingPrivacyDropPage = false,
  hasTrailingDropPage = false,
): number {
  return Math.max(0, normalPageCount)
    + Math.max(0, privacyPageCount)
    + (hasLeadingPrivacyDropPage ? 1 : 0)
    + (hasTrailingDropPage ? 1 : 0);
}

/** 单页无需页码；拖拽生成的临时页面也计入，以便提供放置反馈。 */
export function shouldRenderPageIndicator(pageCount: number): boolean {
  return pageCount > 1;
}
