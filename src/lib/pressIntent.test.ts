import { describe, expect, it } from 'vitest';
import {
  createIdlePressIntentState,
  type PressIntentState,
  transitionPressIntent,
} from './pressIntent';

const start = (): PressIntentState => transitionPressIntent(
  createIdlePressIntentState(),
  { type: 'start', pointerId: 7, x: 100, y: 200 },
).state;

describe('pressIntent', () => {
  it('长按前的小幅抖动保持等待，不会提前拖拽', () => {
    const result = transitionPressIntent(start(), { type: 'move', pointerId: 7, x: 108, y: 205 });
    expect(result.state.phase).toBe('pressing');
    expect(result.effect).toBe('none');
  });

  it('长按前明显移动会取消手势，让翻页等其他意图接管', () => {
    const result = transitionPressIntent(start(), { type: 'move', pointerId: 7, x: 120, y: 200 });
    expect(result.state.phase).toBe('cancelled');
    expect(result.effect).toBe('cancel-press');
  });

  it('统一长按时机只触发菜单并进入拖拽待命态', () => {
    const moved = transitionPressIntent(start(), { type: 'move', pointerId: 7, x: 106, y: 204 }).state;
    const result = transitionPressIntent(moved, { type: 'activate', pointerId: 7 });
    expect(result.effect).toBe('open-menu');
    expect(result.state).toMatchObject({ phase: 'armed', anchorX: 106, anchorY: 204 });
  });

  it('只有长按后继续移动才开始拖拽', () => {
    const armed = transitionPressIntent(start(), { type: 'activate', pointerId: 7 }).state;
    const jitter = transitionPressIntent(armed, { type: 'move', pointerId: 7, x: 106, y: 205 });
    expect(jitter.state.phase).toBe('armed');
    expect(jitter.effect).toBe('none');

    const drag = transitionPressIntent(jitter.state, { type: 'move', pointerId: 7, x: 112, y: 205 });
    expect(drag.state.phase).toBe('dragging');
    expect(drag.effect).toBe('start-drag');
  });

  it('拖拽启动效果只发出一次', () => {
    const armed = transitionPressIntent(start(), { type: 'activate', pointerId: 7 }).state;
    const first = transitionPressIntent(armed, { type: 'move', pointerId: 7, x: 115, y: 200 });
    const second = transitionPressIntent(first.state, { type: 'move', pointerId: 7, x: 130, y: 200 });
    expect(first.effect).toBe('start-drag');
    expect(second.effect).toBe('none');
  });

  it('忽略第二根手指，主指针抬起后完整复位', () => {
    const ignored = transitionPressIntent(start(), { type: 'move', pointerId: 8, x: 160, y: 200 });
    expect(ignored.state).toEqual(start());

    const finished = transitionPressIntent(ignored.state, { type: 'finish', pointerId: 7 });
    expect(finished.state).toEqual(createIdlePressIntentState());
  });
});
