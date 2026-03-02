import type { WebContentsView } from 'electron';
import type { NetworkRequest } from './types.ts';

export class NetworkMonitor {
  private uiView: WebContentsView | null | undefined;
  private requestIdCounter: number;
  private activeRequests: Map<string, NetworkRequest>;

  constructor(uiView: WebContentsView | null | undefined) {
    this.uiView = uiView;
    this.requestIdCounter = 0;
    this.activeRequests = new Map<
      string,
      {
        id: number;
        url: string;
        method: string;
        headers: Record<string, string>;
      }
    >();
  }

  sendNetworkEvent(
    eventType: 'start' | 'complete',
    requestId: number,
    url: string,
    method: string,
    headers: Record<string, string>,
    statusCode?: number
  ): void {
    if (!this.uiView) return;

    const data = {
      id: requestId,
      url,
      method,
      headers,
      statusCode,
    };

    this.uiView.webContents.send(`network-request-${eventType}`, data);
  }

  getActiveRequests(): Map<string, NetworkRequest> {
    return this.activeRequests;
  }

  trackRequest(
    requestId: number,
    url: string,
    method: string,
    headers: Record<string, string>
  ): void {
    this.activeRequests.set(url, {
      id: requestId,
      url,
      method,
      headers,
    });
  }

  removeRequest(url: string): void {
    this.activeRequests.delete(url);
  }

  getRequestIdCounter(): number {
    return this.requestIdCounter;
  }

  incrementRequestIdCounter(): number {
    return ++this.requestIdCounter;
  }
}
