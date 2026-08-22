import { useCallback, useEffect, useRef } from 'react';
import {
  createIdlePressIntentState,
  PRESS_INTENT_DEFAULTS,
  transitionPressIntent,
} from '@/lib/pressIntent';

const INTERACTIVE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  '[role="button"]',
  '[contenteditable="true"]',
  '[data-press-intent-ignore="true"]',
].join(',');

interface LongPressIntentOptions {
  enabled?: boolean;
  longPressMs?: number;
  preActivationSlopPx?: number;
  dragStartDistancePx?: number;
  ignoreInteractiveDescendants?: boolean;
  onLongPress?: (x: number, y: number, pointerId: number) => void;
  onDragStart?: (x: number, y: number, pointerId: number) => void;
}

function releasePointerCapture(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // 元素可能已在页面切换期间卸载；浏览器会自行释放捕获。
  }
}

/**
 * 把“长按菜单”和“长按后拖拽”收敛到同一个意图识别器。
 * 长按前的明显移动会放弃本手势，长按时打开菜单，之后继续移动才进入拖拽。
 */
export function useLongPressIntent<T extends HTMLElement>(options: LongPressIntentOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stateRef = useRef(createIdlePressIntentState());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const onPointerDown = useCallback((event: React.PointerEvent<T>) => {
    const current = optionsRef.current;
    if (current.enabled === false || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    if (current.ignoreInteractiveDescendants) {
      const target = event.target as Element;
      const interactive = target.closest(INTERACTIVE_SELECTOR);
      if (interactive && interactive !== event.currentTarget) return;
    }

    event.preventDefault();
    clearTimer();
    suppressClickRef.current = false;
    stateRef.current = transitionPressIntent(
      createIdlePressIntentState(),
      { type: 'start', pointerId: event.pointerId, x: event.clientX, y: event.clientY },
    ).state;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture 在极旧 WebView 中可能不可用；document 级拖拽仍可工作。
    }

    const pointerId = event.pointerId;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const result = transitionPressIntent(
        stateRef.current,
        { type: 'activate', pointerId },
        {
          preActivationSlopPx: current.preActivationSlopPx ?? PRESS_INTENT_DEFAULTS.preActivationSlopPx,
          dragStartDistancePx: current.dragStartDistancePx ?? PRESS_INTENT_DEFAULTS.dragStartDistancePx,
        },
      );
      stateRef.current = result.state;
      if (result.effect !== 'open-menu') return;
      suppressClickRef.current = true;
      optionsRef.current.onLongPress?.(result.state.lastX, result.state.lastY, pointerId);
    }, current.longPressMs ?? PRESS_INTENT_DEFAULTS.longPressMs);
  }, [clearTimer]);

  const onPointerMove = useCallback((event: React.PointerEvent<T>) => {
    const currentState = stateRef.current;
    if (currentState.pointerId !== event.pointerId) return;
    const current = optionsRef.current;
    const result = transitionPressIntent(
      currentState,
      { type: 'move', pointerId: event.pointerId, x: event.clientX, y: event.clientY },
      {
        preActivationSlopPx: current.preActivationSlopPx ?? PRESS_INTENT_DEFAULTS.preActivationSlopPx,
        dragStartDistancePx: current.dragStartDistancePx ?? PRESS_INTENT_DEFAULTS.dragStartDistancePx,
      },
    );
    stateRef.current = result.state;

    if (result.effect === 'cancel-press') {
      clearTimer();
      suppressClickRef.current = true;
      releasePointerCapture(event.currentTarget, event.pointerId);
      return;
    }

    if (result.effect === 'start-drag') {
      clearTimer();
      suppressClickRef.current = true;
      releasePointerCapture(event.currentTarget, event.pointerId);
      optionsRef.current.onDragStart?.(event.clientX, event.clientY, event.pointerId);
    }
  }, [clearTimer]);

  const finishPointer = useCallback((event: React.PointerEvent<T>) => {
    const state = stateRef.current;
    if (state.pointerId !== event.pointerId) return;
    if (state.phase !== 'pressing') suppressClickRef.current = true;
    clearTimer();
    stateRef.current = transitionPressIntent(
      state,
      { type: 'finish', pointerId: event.pointerId },
    ).state;
    releasePointerCapture(event.currentTarget, event.pointerId);
  }, [clearTimer]);

  const consumeClick = useCallback((): boolean => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    consumeClick,
  };
}
