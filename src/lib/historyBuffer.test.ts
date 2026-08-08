import { describe, expect, it } from 'vitest';
import { HistoryBuffer } from './historyBuffer';

describe('HistoryBuffer', () => {
  it('supports undo and redo while clearing redo after a new edit', () => {
    const history = new HistoryBuffer<number>(10);
    history.record(1);
    history.record(2);

    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBe(1);
    expect(history.redo(1)).toBe(2);

    history.record(2);
    expect(history.canRedo).toBe(false);
  });

  it('keeps only the configured number of undo states', () => {
    const history = new HistoryBuffer<number>(2);
    history.record(1);
    history.record(2);
    history.record(3);

    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBeNull();
  });
});
