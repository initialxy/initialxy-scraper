import type { WebContentsView } from 'electron';
import type { CLIArgs } from './types.ts';

export class AutomationManager {
  private webView: WebContentsView | null | undefined;
  private cliArgs: CLIArgs;
  private scrollInterval: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(webView: WebContentsView | null | undefined, cliArgs: CLIArgs) {
    this.webView = webView;
    this.cliArgs = cliArgs;
  }

  /**
   * Initialize wait functionality
   */
  initializeWait(): void {
    if (!this.cliArgs.wait) return;

    console.debug(`[Automation] Waiting ${this.cliArgs.wait} seconds...`);
    setTimeout(() => {
      console.debug('[Automation] Wait period complete');
    }, this.cliArgs.wait * 1000);
  }

  /**
   * Initialize scroll functionality
   */
  initializeScroll(): void {
    if (!this.cliArgs.scroll) return;

    console.debug(`[Automation] Scrolling ${this.cliArgs.scroll}px per second...`);

    this.scrollInterval = setInterval(async () => {
      // Re-apply selector after each scroll
      if (this.cliArgs.selector && this.webView?.webContents) {
        try {
          await this.webView.webContents.executeJavaScript(`
            (function() {
              const elements = document.querySelectorAll('${this.cliArgs.selector}');
              elements.forEach(el => {
                if (el.src) {
                  if (window.__sourceUrls) window.__sourceUrls.add(el.src);
                } else if (el.dataset && el.dataset.src) {
                  if (window.__sourceUrls) window.__sourceUrls.add(el.dataset.src);
                } else if (el.srcset) {
                  el.srcset.split(',').forEach(src => {
                    const parts = src.trim().split(/ /);
                    if (parts[0] && window.__sourceUrls) window.__sourceUrls.add(parts[0]);
                  });
                }
              });
            })()
          `);
        } catch (error) {
          console.error('[Automation] Error re-applying selector:', error);
        }
      }

      // Check if at bottom of page
      try {
        const atBottom = await this.webView!.webContents.executeJavaScript(
          'document.documentElement.scrollHeight <= (window.pageYOffset + window.innerHeight + 1)'
        );
        if (atBottom) {
          console.debug('[Automation] Reached bottom of page, stopping scroll');
          if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
          }
        }
      } catch (error) {
        console.error('[Automation] Error checking scroll position:', error);
      }
    }, 1000);
  }

  /**
   * Initialize close-on-idle functionality
   */
  initializeCloseOnIdle(): void {
    if (!this.cliArgs.closeOnIdle) return;

    let lastActivityTime = Date.now();

    const resetIdleTimer = (): void => {
      lastActivityTime = Date.now();
    };

    // Listen for activity
    this.webView?.webContents.on('did-navigate', resetIdleTimer);
    this.webView?.webContents.on('did-navigate-in-page', resetIdleTimer);

    const checkIdle = async (): Promise<void> => {
      const idleTime = (Date.now() - lastActivityTime) / 1000;

      if (idleTime >= this.cliArgs.closeOnIdle!) {
        console.debug(`[Automation] Idle for ${Math.floor(idleTime)} seconds, closing...`);
        setTimeout(() => process.exit(0), 100);
        return;
      }

      // If selector specified, check if all source URLs completed
      if (this.cliArgs.selector) {
        const sourceUrls = this.webView?.webContents
          ? await this.webView.webContents.executeJavaScript('window.__sourceUrls || new Set()')
          : new Set<string>();

        const completedSourceUrls = this.webView?.webContents
          ? await this.webView.webContents.executeJavaScript(
              'window.__completedSourceUrls || new Set()'
            )
          : new Set<string>();

        const allCompleted = Array.from(sourceUrls).every((url) => completedSourceUrls.has(url));

        if (allCompleted && sourceUrls.size > 0) {
          console.debug('[Automation] All source URLs completed, starting idle timer...');
          lastActivityTime = Date.now();
        }
      }

      this.idleTimer = setTimeout(checkIdle, 1000);
    };

    this.idleTimer = setTimeout(checkIdle, 1000);
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
