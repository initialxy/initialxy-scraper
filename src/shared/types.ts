// Shared types for initialxy-scraper

export interface CLIArgs {
  outputDir?: string;
  url?: string;
  filter?: RegExp;
  selector?: string;
  wait?: number;
  scroll?: number;
  closeOnIdle?: number;
  renameSequence?: string;
  verbose?: boolean;
  outputCurl?: boolean;
  flatDir?: boolean;
}

export interface NetworkRequest {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  statusCode?: number;
}

export interface CompletedStatus {
  sourceCount: number;
  completedCount: number;
  allCompleted: boolean;
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
}

export interface SourceUrl {
  url: string;
  timestamp: number;
}

export interface NetworkRequestData {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  statusCode?: number;
}
