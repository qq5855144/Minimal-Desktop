export const PRESS_INTENT_DEFAULTS = Object.freeze({
  longPressMs: 500,
  preActivationSlopPx: 14,
  dragStartDistancePx: 10,
});

export type PressIntentPhase = 'idle' | 'pressing' | 'armed' | 'dragging' | 'cancelled';

export interface PressIntentState {
  phase: PressIntentPhase;
  pointerId: number | null;
  startX: number;
  startY: number;
  anchorX: number;
  anchorY: number;
  lastX: number;
  lastY: number;
}

export interface PressIntentThresholds {
  preActivationSlopPx: number;
  dragStartDistancePx: number;
}

export type PressIntentEvent =
  | { type: 'start'; pointerId: number; x: number; y: number }
  | { type: 'move'; pointerId: number; x: number; y: number }
  | { type: 'activate'; pointerId: number }
  | { type: 'finish'; pointerId: number }
  | { type: 'reset' };

export type PressIntentEffect = 'none' | 'cancel-press' | 'open-menu' | 'start-drag';

export interface PressIntentTransition {
  state: PressIntentState;
  effect: PressIntentEffect;
}

export function createIdlePressIntentState(): PressIntentState {
  return {
    phase: 'idle',
    pointerId: null,
    startX: 0,
    startY: 0,
    anchorX: 0,
    anchorY: 0,
    lastX: 0,
    lastY: 0,
  };
}

function exceedsDistance(
  x: number,
  y: number,
  originX: number,
  originY: number,
  threshold: number,
): boolean {
  const dx = x - originX;
  const dy = y - originY;
  return dx * dx + dy * dy > threshold * threshold;
}

/**
 * 长按手势的纯状态机。
 *
 * pressing 阶段只负责判断“点击/翻页”是否已经偏离；到达统一长按时机后进入
 * armed，并以当时的手指位置作为拖拽锚点。这样按住时的轻微抖动不会让拖拽
 * 在菜单出现的同一帧误启动，只有长按后继续移动才会表达拖拽意图。
 */
export function transitionPressIntent(
  state: PressIntentState,
  event: PressIntentEvent,
  thresholds: PressIntentThresholds = PRESS_INTENT_DEFAULTS,
): PressIntentTransition {
  if (event.type === 'reset') {
    return { state: createIdlePressIntentState(), effect: 'none' };
  }

  if (event.type === 'start') {
    return {
      state: {
        phase: 'pressing',
        pointerId: event.pointerId,
        startX: event.x,
        startY: event.y,
        anchorX: event.x,
        anchorY: event.y,
        lastX: event.x,
        lastY: event.y,
      },
      effect: 'none',
    };
  }

  if (state.pointerId !== event.pointerId) {
    return { state, effect: 'none' };
  }

  if (event.type === 'finish') {
    return { state: createIdlePressIntentState(), effect: 'none' };
  }

  if (event.type === 'activate') {
    if (state.phase !== 'pressing') return { state, effect: 'none' };
    return {
      state: {
        ...state,
        phase: 'armed',
        anchorX: state.lastX,
        anchorY: state.lastY,
      },
      effect: 'open-menu',
    };
  }

  const moved = { ...state, lastX: event.x, lastY: event.y };
  if (
    state.phase === 'pressing'
    && exceedsDistance(
      event.x,
      event.y,
      state.startX,
      state.startY,
      thresholds.preActivationSlopPx,
    )
  ) {
    return { state: { ...moved, phase: 'cancelled' }, effect: 'cancel-press' };
  }

  if (
    state.phase === 'armed'
    && exceedsDistance(
      event.x,
      event.y,
      state.anchorX,
      state.anchorY,
      thresholds.dragStartDistancePx,
    )
  ) {
    return { state: { ...moved, phase: 'dragging' }, effect: 'start-drag' };
  }

  return { state: moved, effect: 'none' };
}
