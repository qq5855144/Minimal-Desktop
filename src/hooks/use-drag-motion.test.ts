import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useDragMotion } from './use-drag-motion';

const lifecycle = vi.hoisted(() => ({
  layout: (() => {}) as () => void,
  effect: (() => {}) as () => void | (() => void),
}));
vi.mock('react', () => ({
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (callback: unknown) => callback,
  useLayoutEffect: (callback: () => void) => { lifecycle.layout = callback; },
  useEffect: (callback: () => void | (() => void)) => { lifecycle.effect = callback; },
}));

const rect = (left: number, top = 0, width = 60, height = 60) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});
const cell = (id: string, left: number) => ({
  dataset: { itemid: id },
  getBoundingClientRect: vi.fn(() => rect(left)),
  animate: vi.fn(() => ({ cancel: vi.fn(), onfinish: null, oncancel: null })),
});
let cleanup: (() => void) | void;
let preference: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('window', { matchMedia: () => preference });
});
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });
const setup = () => {
  const source = cell('source', 0);
  const target = cell('target', 80);
  const still = cell('still', 160);
  const root = {
    getBoundingClientRect: () => rect(0, 0, 400, 400),
    querySelectorAll: () => [source, target, still],
  };
  const motion = useDragMotion({ current: root } as unknown as RefObject<HTMLElement>);
  cleanup = lifecycle.effect();
  return { ...motion, source, target, still };
};

describe('drag motion lifecycle', () => {
  it('animates swapped items once and leaves stationary items alone', () => {
    const { captureDrop, source, target, still } = setup();
    captureDrop('source', { x: 105, y: 30 });
    source.getBoundingClientRect.mockReturnValue(rect(80));
    target.getBoundingClientRect.mockReturnValue(rect(0));
    lifecycle.layout();
    expect(source.animate).toHaveBeenCalledTimes(1);
    expect(target.animate).toHaveBeenCalledTimes(1);
    expect(still.animate).not.toHaveBeenCalled();
    expect(target.animate.mock.calls[0][0][0].transform).toBe('translate(80px, 0px)');
    lifecycle.layout();
    expect(target.animate).toHaveBeenCalledTimes(1);
  });

  it('returns a cancelled drop without changing the grid and cleans up before the next drag', () => {
    const { captureDrop, cancelMotion, source, target } = setup();
    captureDrop('source', { x: 100, y: 30 });
    lifecycle.layout();
    expect(source.animate).toHaveBeenCalledTimes(1);
    expect(target.animate).not.toHaveBeenCalled();
    const animation = source.animate.mock.results[0].value;
    cancelMotion();
    expect(animation.cancel).toHaveBeenCalledOnce();
    lifecycle.layout();
    expect(source.animate).toHaveBeenCalledTimes(1);
  });

  it('honors reduced motion and cancels active animations when the preference changes', () => {
    const { captureDrop, source } = setup();
    captureDrop('source', { x: 100, y: 30 });
    lifecycle.layout();
    const animation = source.animate.mock.results[0].value;
    preference.matches = true;
    preference.addEventListener.mock.calls[0][1]();
    expect(animation.cancel).toHaveBeenCalledOnce();
    captureDrop('source', { x: 100, y: 30 });
    lifecycle.layout();
    expect(source.animate).toHaveBeenCalledTimes(1);
  });

  it('bounds long return journeys to a subtle movement', () => {
    const { captureDrop, source } = setup();
    captureDrop('source', { x: 1000, y: 30 });
    lifecycle.layout();
    expect(source.animate.mock.calls[0][0][0].transform).toBe('translate(12px, 0px)');
  });
});
