import { protocol, session } from 'electron';
import type { ProtocolCallbacks } from './types.ts';

const RESPONSE_WITHOUT_BODY = new Set([204, 304]);

export class ProtocolHandler {
  private baseUrl: string;
  private callbacks: ProtocolCallbacks;
  private inFlight = new Set<string>();
  private requestIdCounter = 0;
  private bypassSession = session.fromPartition('persist:bypass');

  constructor(baseUrl: string, callbacks: ProtocolCallbacks) {
    this.baseUrl = baseUrl;
    this.callbacks = callbacks;
  }

  register(): void {
    protocol.handle('https', this.handleRequest.bind(this));
    protocol.handle('http', this.handleRequest.bind(this));
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = request.url;
    const headersObj: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    // Prevent infinite recursion
    if (this.inFlight.has(url)) {
      const response = await fetch(url, {
        method: request.method,
        headers: headersObj,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return new Response(RESPONSE_WITHOUT_BODY.has(response.status) ? null : buffer, {
        status: response.status,
        headers: response.headers,
      });
    }

    this.inFlight.add(url);

    try {
      // Forward request using bypass session (no protocol handler)
      const response = await this.bypassSession.fetch(url, {
        method: request.method,
        headers: headersObj,
      });

      const buffer = Buffer.from(await response.arrayBuffer());

      // Callback: request started
      this.callbacks.onRequestStarted({
        id: ++this.requestIdCounter,
        url,
        method: request.method,
        headers: headersObj,
      });

      // Callback: response completed
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      this.callbacks.onResponseCompleted(
        {
          id: this.requestIdCounter,
          url,
          method: request.method,
          headers: headersObj,
        },
        {
          statusCode: response.status,
          body: buffer,
          headers: responseHeaders,
        }
      );

      // Return original response unchanged
      return new Response(RESPONSE_WITHOUT_BODY.has(response.status) ? null : buffer, {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      this.inFlight.delete(url);
    }
  }
}
