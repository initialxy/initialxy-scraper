// Shared types for initialxy-scraper
import type { WebContentsView } from 'electron';

export interface CLIArgs {
  outputDir?: string;
  url?: string;
  filter?: RegExp;
  selector?: string;
  wait?: number;
  scroll?: number;
  closeOnIdle?: number;
  renameSequence?: string;
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

export interface ProtocolHandlerOptions {
  outputDir: string;
  filter?: RegExp;
  selector?: string;
  renameSequence?: string;
  uiView?: WebContentsView | null | undefined;
  webView?: WebContentsView | null | undefined;
  sourceUrls: Set<string>;
  completedSourceUrls: Set<string>;
}

export interface SourceUrl {
  url: string;
  timestamp: number;
}
