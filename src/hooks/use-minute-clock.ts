import { useSyncExternalStore } from 'react';

const MINUTE_MS = 60_000;
const TIMER_EARLY_FIRE_GUARD_MS = 20;

let snapshot = new Date();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export function millisecondsUntilNextMinute(timestamp: number): number {
  const elapsed = ((timestamp % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  return MINUTE_MS - elapsed + TIMER_EARLY_FIRE_GUARD_MS;
}

function clearMinuteTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function updateSnapshot(): void {
  snapshot = new Date();
  listeners.forEach((listener) => listener());
}

function scheduleNextMinute(): void {
  clearMinuteTimer();
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  timer = setTimeout(() => {
    updateSnapshot();
    scheduleNextMinute();
  }, millisecondsUntilNextMinute(Date.now()));
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    clearMinuteTimer();
    return;
  }
  updateSnapshot();
  scheduleNextMinute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    snapshot = new Date();
    scheduleNextMinute();
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearMinuteTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}

function getSnapshot(): Date {
  return snapshot;
}

/** 所有时钟组件共享一个分钟级定时器；后台标签页不唤醒。 */
export function useMinuteClock(): Date {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
