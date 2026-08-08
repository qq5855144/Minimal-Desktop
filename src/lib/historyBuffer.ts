export class HistoryBuffer<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(private readonly limit = 50) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  record(snapshot: T): void {
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future.length = 0;
  }

  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
