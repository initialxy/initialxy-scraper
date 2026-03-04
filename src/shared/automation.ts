import type { WebContentsView } from 'electron';
import type { CLIArgs } from './types.ts';

export class AutomationManager {
  private webView: WebContentsView | null | undefined;
  public cliArgs: CLIArgs;
  private scrollInterval: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivityTime: number;

  constructor(webView: WebContentsView | null | undefined, cliArgs: CLIArgs) {
    this.webView = webView;
    this.cliArgs = cliArgs;
    this.lastActivityTime = Date.now();
  }

  /**
   * Initialize wait functionality
   */
  initializeWait(): void {
    if (!this.cliArgs.wait) return;

    console.debug(`[Automation] Waiting ${this.cliArgs.wait} seconds...`);
    setTimeout(async () => {
      console.debug('[Automation] Wait period complete');
      // Import here to avoid circular dependency
      const { updatePageSource } = await import('../main/main.ts');
      await updatePageSource();
    }, this.cliArgs.wait * 1000);
  }

  /**
   * Initialize scroll functionality
   */
  initializeScroll(): void {
    if (!this.cliArgs.scroll) return;

    console.debug(`[Automation] Scrolling ${this.cliArgs.scroll}px per second...`);

    // Start scrolling after --wait period
    const delay = this.cliArgs.wait ? this.cliArgs.wait * 1000 : 0;
    setTimeout(() => {
      this.startScrolling();
    }, delay);
  }

  /**
   * Initialize close-on-idle functionality
   */
  initializeCloseOnIdle(): void {
    if (!this.cliArgs.closeOnIdle) return;

    // Start idle timer after --wait period
    const delay = this.cliArgs.wait ? this.cliArgs.wait * 1000 : 0;
    setTimeout(() => {
      this.startIdleTimer();
    }, delay);
  }

  /**
   * Start scrolling the page
   */
  private startScrolling(): void {
    // Import here to avoid circular dependency
    import('../main/main.ts').then(({ scrollAndUpdate }) => {
      this.scrollInterval = setInterval(async () => {
        await scrollAndUpdate();

        // Check if at bottom of page
        try {
          const atBottom = await this.webView!.webContents.executeJavaScript(
            'document.documentElement.scrollHeight <= (window.pageYOffset + window.innerHeight + 1)'
          );
          if (atBottom) {
            console.debug('[Automation] Reached bottom of page, stopping scroll');
            if (this.scrollInterval) {
              clearInterval(this.scrollInterval);
              this.scrollInterval = null;
            }
          }
        } catch (error) {
          console.error('[Automation] Error checking scroll position:', error);
        }
      }, 1000);
    });
  }

  /**
   * Start idle timer for close-on-idle
   */
  private startIdleTimer(): void {
    const checkIdle = (): void => {
      const idleTime = (Date.now() - this.lastActivityTime) / 1000;

      if (idleTime >= this.cliArgs.closeOnIdle!) {
        console.debug(`[Automation] Idle for ${Math.floor(idleTime)} seconds, closing...`);
        setTimeout(() => process.exit(0), 100);
        return;
      }

      this.idleTimer = setTimeout(checkIdle, 1000);
    };

    this.idleTimer = setTimeout(checkIdle, 1000);
  }

  /**
   * Reset idle timer on output event
   */
  onOutputEvent(): void {
    this.lastActivityTime = Date.now();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.startIdleTimer();
  }

  /**
   * Clean up all automation timers
   */
  cleanup(): void {
    if (this.scrollInterval) {
      clearInterval(this.scrollInterval);
      this.scrollInterval = null;
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
