import { MS_IN_S, MILD_DELAY_MS } from './constants.ts';

export class AutomationManager {
  private waitS: number;
  private scrollIntervalS: number;
  private closeOnIdleTimeS: number | null;
  private onScrollRequested: () => Promise<boolean>;
  private onUpdateRequested: () => Promise<void>;
  private onCloseRequested: () => void;

  private idleTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean;

  constructor(options: {
    waitS: number;
    scrollIntervalS: number;
    closeOnIdleTimeS: number | null;
    onScrollRequested: () => Promise<boolean>;
    onUpdateRequested: () => Promise<void>;
    onCloseRequested: () => void;
  }) {
    this.waitS = options.waitS;
    this.scrollIntervalS = options.scrollIntervalS;
    this.closeOnIdleTimeS = options.closeOnIdleTimeS;
    this.onScrollRequested = options.onScrollRequested;
    this.onUpdateRequested = options.onUpdateRequested;
    this.onCloseRequested = options.onCloseRequested;
    this.isRunning = false;
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    setTimeout(async () => {
      await this.onUpdateRequested();
      this.startScroll();
      this.startIdleTimer();
    }, this.waitS * MS_IN_S);
  }

  private startScroll(): void {
    let scrollInterval: NodeJS.Timeout | null = null;

    const scrollLoop = async () => {
      const shouldContinue = await this.onScrollRequested();
      if (!shouldContinue) {
        clearInterval(scrollInterval);
        return;
      }

      setTimeout(async () => {
        await this.onUpdateRequested();
      }, MILD_DELAY_MS);
    };

    if (this.scrollIntervalS > 0) {
      scrollInterval = setInterval(scrollLoop, this.scrollIntervalS * MS_IN_S);
    }
  }

  private startIdleTimer(): void {
    if (!this.closeOnIdleTimeS) return;

    this.idleTimer = setTimeout(this.onCloseRequested, this.closeOnIdleTimeS * MS_IN_S);
  }

  onOutputEvent(): void {
    if (!this.closeOnIdleTimeS) return;

    clearTimeout(this.idleTimer);
    this.startIdleTimer();
  }
}
