import { describe, expect, it } from 'vitest';
import { shouldIgnorePressIntentTarget } from './use-long-press-intent';

function elementStub(
  closestResult: Element | null = null,
  surface = false,
): Element {
  return {
    closest: () => closestResult,
    getAttribute: (name: string) => (
      name === 'data-press-intent-surface' && surface ? 'true' : null
    ),
  } as unknown as Element;
}

describe('shouldIgnorePressIntentTarget', () => {
  it('保留普通交互子元素的点击与输入行为', () => {
    const interactive = elementStub();
    const target = elementStub(interactive);
    expect(shouldIgnorePressIntentTarget(target, elementStub())).toBe(true);
  });

  it('允许显式声明的交互外壳作为长按拖拽面', () => {
    const dragSurface = elementStub(null, true);
    const target = elementStub(dragSurface);
    expect(shouldIgnorePressIntentTarget(target, elementStub())).toBe(false);
  });

  it('事件直接来自当前拖拽元素时不拦截', () => {
    const currentTarget = elementStub();
    const target = elementStub(currentTarget);
    expect(shouldIgnorePressIntentTarget(target, currentTarget)).toBe(false);
  });
});
