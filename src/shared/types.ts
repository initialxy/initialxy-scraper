// Shared types for initialxy-scraper

export interface CLIArgs {
  outputDir?: string;
  url?: string;
  filter?: RegExp;
  selector?: string;
  wait?: number;
  scroll?: number;
  closeOnIdle?: number;
  closeOnSelectorComplete?: boolean;
  renameSequence?: string;
  verbose?: boolean;
  outputCurl?: boolean;
  flatDir?: boolean;
  width?: number;
  height?: number;
}

export interface NetworkRequest {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  statusCode?: number;
}

export interface ProtocolCallbacks {
  onRequestStarted: (request: {
    id: number;
    url: string;
    method: string;
    headers: Record<string, string>;
  }) => void;
  onResponseCompleted: (
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
  ) => void;
}

export interface OutputManagerOptions {
  outputDir?: string;
  filter?: RegExp;
  selector?: string;
  renameSequence?: string;
  outputCurl?: boolean;
  flatDir?: boolean;
  onOutput: (url: string) => void;
  onAllSelectorFilesSaved?: () => void;
}

export interface UiPanelInterface {
  send(channel: string, ...args: unknown[]): void;
}

export interface WebViewInterface {
  webContents: Electron.WebContents;
  webContentsView: UiPanelInterface;
}

export interface ProtocolHandlerInterface {
  register(): void;
  setCallbacks(callbacks: ProtocolCallbacks): void;
}

export interface AutomationManagerInterface {
  start(): void;
  onOutputEvent(): void;
}
