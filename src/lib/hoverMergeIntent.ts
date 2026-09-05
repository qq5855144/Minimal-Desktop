/** 悬停只准备合并；只有在同一目标上松手才能消费这次意图。 */
export class HoverMergeIntent {
  private target: string | null = null;
  private ready = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private delay: number, private onPreview: (id: string | null) => void) {}

  hover(target: string | null): void {
    if (target === this.target) return;
    this.cancel();
    if (!target) return;
    this.target = target;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.target !== target) return;
      this.ready = true;
      this.onPreview(target);
    }, this.delay);
  }

  release(target: string | null): string | null {
    const result = this.ready && target === this.target ? target : null;
    this.cancel();
    return result;
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.target = null;
    if (this.ready) this.onPreview(null);
    this.ready = false;
  }
}
