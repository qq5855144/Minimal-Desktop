import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AutoSyncRunOutcome,
  AutoSyncScheduler,
  type AutoSyncTaskContext,
  getAutoSyncDelayMs,
  normalizeAutoSyncDelaySeconds,
} from './autoSyncScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('automatic sync scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes persisted intervals and defaults legacy configs to 15 seconds', () => {
    expect(normalizeAutoSyncDelaySeconds(undefined)).toBe(15);
    expect(normalizeAutoSyncDelaySeconds(30)).toBe(30);
    expect(normalizeAutoSyncDelaySeconds(10)).toBe(15);
    expect(getAutoSyncDelayMs(60)).toBe(60_000);
  });

  it('coalesces a burst of changes into one trailing-edge upload', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async (): Promise<AutoSyncRunOutcome> => 'complete');
    const scheduler = new AutoSyncScheduler({ getDelayMs: () => 15_000, run });

    scheduler.request();
    await vi.advanceTimersByTimeAsync(10_000);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledOnce();
    scheduler.dispose();
  });

  it('never overlaps uploads and marks a snapshot stale when a newer change arrives', async () => {
    vi.useFakeTimers();
    const first = deferred<AutoSyncRunOutcome>();
    let firstContext: AutoSyncTaskContext | undefined;
    const run = vi.fn()
      .mockImplementationOnce((context: AutoSyncTaskContext) => {
        firstContext = context;
        return first.promise;
      })
      .mockResolvedValueOnce('complete');
    const scheduler = new AutoSyncScheduler({ getDelayMs: () => 100, run });

    scheduler.request();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledOnce();

    scheduler.request();
    expect(firstContext?.isSuperseded()).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledOnce();

    first.resolve('complete');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(99);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('drops queued changes when the active run reports a conflict pause', async () => {
    vi.useFakeTimers();
    const first = deferred<AutoSyncRunOutcome>();
    const run = vi.fn(() => first.promise);
    const scheduler = new AutoSyncScheduler({ getDelayMs: () => 100, run });

    scheduler.request();
    await vi.advanceTimersByTimeAsync(100);
    scheduler.request();
    first.resolve('paused');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(run).toHaveBeenCalledOnce();
    scheduler.dispose();
  });
});
