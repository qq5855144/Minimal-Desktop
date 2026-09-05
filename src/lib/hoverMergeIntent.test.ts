import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverMergeIntent } from './hoverMergeIntent';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('hover merge intent', () => {
  it('only previews after dwell; commits intent once on release over the same target', () => {
    const preview = vi.fn();
    const intent = new HoverMergeIntent(800, preview);
    intent.hover('folder');
    vi.advanceTimersByTime(799);
    expect(preview).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(preview).toHaveBeenLastCalledWith('folder');
    vi.advanceTimersByTime(5000);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(intent.release('folder')).toBe('folder');
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(intent.release('folder')).toBeNull();
  });

  it('moving outside cancels preview and requires a fresh dwell when returning', () => {
    const preview = vi.fn();
    const intent = new HoverMergeIntent(800, preview);
    intent.hover('folder');
    vi.advanceTimersByTime(800);
    intent.hover(null);
    expect(preview).toHaveBeenLastCalledWith(null);
    intent.hover('folder');
    expect(intent.release('folder')).toBeNull();
    vi.advanceTimersByTime(800);
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('switching targets restarts the timer; rapid release keeps ordinary drop behavior', () => {
    const preview = vi.fn();
    const intent = new HoverMergeIntent(800, preview);
    intent.hover('app');
    vi.advanceTimersByTime(600);
    intent.hover('folder');
    vi.advanceTimersByTime(300);
    expect(preview).not.toHaveBeenCalled();
    expect(intent.release('folder')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(preview).not.toHaveBeenCalled();
  });

  it('release elsewhere and pointer cancellation cannot consume a ready target', () => {
    const intent = new HoverMergeIntent(800, vi.fn());
    intent.hover('folder');
    vi.advanceTimersByTime(800);
    expect(intent.release('other')).toBeNull();
    intent.hover('folder');
    vi.advanceTimersByTime(800);
    intent.cancel();
    expect(intent.release('folder')).toBeNull();
  });

  it('movement inside the same target keeps the dwell timer running', () => {
    const intent = new HoverMergeIntent(800, vi.fn());
    intent.hover('folder');
    vi.advanceTimersByTime(500);
    intent.hover('folder');
    vi.advanceTimersByTime(300);
    expect(intent.release('folder')).toBe('folder');
  });
});
