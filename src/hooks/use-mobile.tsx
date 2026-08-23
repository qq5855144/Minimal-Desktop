import { useViewportGeometry } from './use-viewport-geometry';

export function useIsMobile() {
  return !useViewportGeometry().isWide;
}
