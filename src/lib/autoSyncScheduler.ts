import type { AutoSyncDelaySeconds } from '@/types';

export const DEFAULT_AUTO_SYNC_DELAY_SECONDS: AutoSyncDelaySeconds = 15;
export const AUTO_SYNC_DELAY_OPTIONS = [5, 15, 30, 60] as const satisfies readonly AutoSyncDelaySeconds[];

export function normalizeAutoSyncDelaySeconds(value: unknown): AutoSyncDelaySeconds {
  return AUTO_SYNC_DELAY_OPTIONS.includes(value as AutoSyncDelaySeconds)
    ? value as AutoSyncDelaySeconds
    : DEFAULT_AUTO_SYNC_DELAY_SECONDS;
}

export function getAutoSyncDelayMs(value: unknown): number {
  return normalizeAutoSyncDelaySeconds(value) * 1000;
}

export type AutoSyncRunOutcome = 'complete' | 'paused';

export interface AutoSyncTaskContext {
  /** 生成快照期间若又有本地改动，应丢弃旧快照并等待最新任务。 */
  isSuperseded: () => boolean;
}

interface AutoSyncSchedulerOptions {
  getDelayMs: () => number;
  run: (context: AutoSyncTaskContext) => Promise<AutoSyncRunOutcome>;
  onError?: (error: unknown) => void;
}

/**
 * 自动同步的 trailing-edge 调度器。
 *
 * - 连续改动只保留静默期结束后的最新快照；
 * - 任意时刻最多执行一个任务；
 * - 上传期间出现的新改动会在当前任务结束后重新等待并合并；
 * - 冲突或配置不可用时暂停，不做无限重试。
 */
export class AutoSyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private dirty = false;
  private running = false;
  private disposed = false;

  constructor(private readonly options: AutoSyncSchedulerOptions) {}

  request(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.dirty = true;
    if (this.running) return;
    this.schedule();
  }

  /** 配置中的等待时间变化时，仅重排已有任务，不凭空创建上传。 */
  reschedule(): void {
    if (this.disposed || this.running || !this.dirty) return;
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.dirty = false;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    const configuredDelay = this.options.getDelayMs();
    const delay = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : 0;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.disposed || this.running || !this.dirty) return;

    const generation = this.generation;
    this.dirty = false;
    this.running = true;
    let outcome: AutoSyncRunOutcome = 'complete';

    try {
      outcome = await this.options.run({
        isSuperseded: () => this.disposed || this.generation !== generation,
      });
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.running = false;
      if (this.disposed) return;
      if (outcome === 'paused') {
        this.dirty = false;
        this.clearTimer();
        return;
      }
      if (this.dirty) this.schedule();
    }
  }
}
