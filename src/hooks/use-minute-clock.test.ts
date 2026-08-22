import { describe, expect, it } from 'vitest';
import { millisecondsUntilNextMinute } from './use-minute-clock';

describe('millisecondsUntilNextMinute', () => {
  it('按分钟边界调度并保留防止定时器提前触发的余量', () => {
    expect(millisecondsUntilNextMinute(0)).toBe(60_020);
    expect(millisecondsUntilNextMinute(59_999)).toBe(21);
    expect(millisecondsUntilNextMinute(60_000)).toBe(60_020);
  });

  it('负时间戳也返回有效正延迟', () => {
    expect(millisecondsUntilNextMinute(-1)).toBe(21);
  });
});
