import { OutputManager } from '../shared/output_manager.ts';
import { EXIT_CODES } from '../shared/constants.ts';
import type {
  CLIArgs,
  WebViewInterface,
  ProtocolHandlerInterface,
  AutomationManagerInterface,
} from '../shared/types.ts';

export class Coordinator {
  private protocolHandler: ProtocolHandlerInterface;
  private automationManager: AutomationManagerInterface;
  private webView: WebViewInterface;
  private outputManager: OutputManager | null = null;
  private cliArgs: CLIArgs;

  constructor(options: {
    protocolHandler: ProtocolHandlerInterface;
    automationManager: AutomationManagerInterface;
    webView: WebViewInterface;
  }) {
    this.protocolHandler = options.protocolHandler;
    this.automationManager = options.automationManager;
    this.webView = options.webView;
    this.cliArgs = {
      closeOnSelectorComplete: false,
      scroll: undefined,
    };
  }

  init(cliArgs: CLIArgs): void {
    this.cliArgs = cliArgs;

    this.outputManager = new OutputManager({
      outputDir: cliArgs.outputDir,
      filter: cliArgs.filter,
      selector: cliArgs.selector,
      renameSequence: cliArgs.renameSequence,
      outputCurl: cliArgs.outputCurl,
      flatDir: cliArgs.flatDir,
      baseUrl: this.webView.webContents.getURL() || 'about:blank',
      onOutput: () => {
        this.automationManager.onOutputEvent();
      },
      onAllSelectorFilesSaved: () => {
        if (cliArgs.closeOnSelectorComplete && !cliArgs.scroll) {
          process.exit(EXIT_CODES.success);
        }
      },
    });

    this.protocolHandler.setCallbacks({
      onRequestStarted: (request) => {
        this.webView.webContentsView.send('network-request-start', request);
      },
      onResponseCompleted: (request, response) => {
        this.webView.webContentsView.send('network-request-complete', {
          id: request.id,
          url: request.url,
          statusCode: response.statusCode,
        });
        this.outputManager?.responseCompleted(request, response);
      },
    });

    this.protocolHandler.register();

    this.automationManager.start();
  }

  responseCompleted(
    request: {
      id: number;
      url: string;
      method: string;
      headers: Record<string, string>;
    },
    response: {
      statusCode: number;
      body: Buffer;
      headers: Record<string, string>;
    }
  ): void {
    this.outputManager?.responseCompleted(request, response);
  }

  async updatePageSource(): Promise<void> {
    if (!this.outputManager) return;

    try {
      const pageSource = await this.webView.webContents.executeJavaScript(
        'document.documentElement.outerHTML'
      );
      this.outputManager.updatePageSource(pageSource);
    } catch (error) {
      console.error('[Main] Error getting page source:', error);
    }

    if (this.cliArgs.closeOnSelectorComplete && !this.outputManager.hasPendingSelectorFiles()) {
      if (this.cliArgs.scroll) {
        const isAtBottom = await this.webView.webContents.executeJavaScript(
          'window.innerHeight + window.scrollY >= document.documentElement.scrollHeight'
        );
        if (!isAtBottom) {
          return;
        }
      }
      process.exit(EXIT_CODES.success);
    }
  }

  closeOnIdleTimeout(): void {
    const exitCode =
      !this.cliArgs.closeOnSelectorComplete || !this.outputManager?.hasPendingSelectorFiles()
        ? EXIT_CODES.success
        : EXIT_CODES.closeOnIdleTimeout;
    process.exit(exitCode);
  }

  async closeOnSelectorCheck(): Promise<void> {
    if (this.cliArgs.closeOnSelectorComplete && !this.outputManager?.hasPendingSelectorFiles()) {
      if (this.cliArgs.scroll) {
        const isAtBottom = await this.webView.webContents.executeJavaScript(
          'window.innerHeight + window.scrollY >= document.documentElement.scrollHeight'
        );
        if (!isAtBottom) {
          return;
        }
      }
      process.exit(EXIT_CODES.success);
    }
  }
}
