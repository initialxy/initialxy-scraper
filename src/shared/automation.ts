const MS_IN_S = 1000;
const POST_SCROLL_WAIT_MS = 100;

export class AutomationManager {
  private waitS: number;
  private scrollIntervalS: number;
  private closeOnIdleTimeS: number | null;
  private onScrollRequested: () => Promise<void>;
  private onUpdateRequested: () => Promise<void>;
  private onCloseRequested: () => void;

  private idleTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean;

  constructor(options: {
    waitS: number;
    scrollIntervalS: number;
    closeOnIdleTimeS: number | null;
    onScrollRequested: () => Promise<void>;
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
    setInterval(async () => {
      await this.onScrollRequested();
      setTimeout(async () => {
        await this.onUpdateRequested();
      }, POST_SCROLL_WAIT_MS);
    }, this.scrollIntervalS * MS_IN_S);
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
