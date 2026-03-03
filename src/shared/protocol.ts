import { protocol, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { WebContentsView } from 'electron';
import type { ProtocolHandlerOptions } from './types.ts';
import { generateFilename, generateSequentialFilename, isEligible, generateCurl } from './utils.ts';

export class ProtocolHandler {
  private outputDir?: string;
  private filter?: RegExp;
  private selector?: string;
  private renameSequence?: string;
  private verbose?: boolean;
  private outputCurl?: boolean;
  private uiView?: WebContentsView;
  private webView?: WebContentsView;
  private sourceUrls: Set<string>;
  private completedSourceUrls: Set<string>;
  private processingUrls: Set<string>;
  private requestIdCounter: number;
  private activeRequests: Map<
    string,
    { id: number; url: string; method: string; headers: Record<string, string> }
  >;
  private bypassSession: ReturnType<typeof session.fromPartition>;

  constructor(options: ProtocolHandlerOptions) {
    this.outputDir = options.outputDir;
    this.filter = options.filter;
    this.selector = options.selector;
    this.renameSequence = options.renameSequence;
    this.verbose = options.verbose;
    this.outputCurl = options.outputCurl;
    this.uiView = options.uiView;
    this.webView = options.webView;
    this.sourceUrls = options.sourceUrls;
    this.completedSourceUrls = options.completedSourceUrls;
    this.processingUrls = new Set<string>();
    this.requestIdCounter = 0;
    this.activeRequests = new Map<
      string,
      { id: number; url: string; method: string; headers: Record<string, string> }
    >();
    this.bypassSession = session.fromPartition('persist:bypass');
  }

  register(): void {
    console.debug('[Protocol API] Registering handlers...');

    // Handle HTTPS
    protocol.handle('https', this.handleRequest.bind(this));

    // Handle HTTP
    protocol.handle('http', this.handleRequest.bind(this));

    console.debug('[Protocol API] Handlers registered successfully');
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = request.url;
    const headersObj = Object.fromEntries(request.headers.entries());

    if (this.verbose) {
      console.debug(`[Request] ${request.method} ${url}`);
    }

    // Prevent infinite recursion
    if (this.processingUrls.has(url)) {
      if (this.verbose) {
        console.debug(`[Protocol API] Skipping recursive request: ${url}`);
      }
      // Make a direct fetch without going through protocol handler
      const response = await fetch(url, {
        method: request.method,
        headers: headersObj as Record<string, string>,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return new Response(buffer, {
        status: response.status,
        headers: response.headers,
      });
    }

    this.processingUrls.add(url);

    // Track request for UI panel
    const requestId = ++this.requestIdCounter;
    this.activeRequests.set(url, {
      id: requestId,
      url,
      method: request.method,
      headers: headersObj,
    });

    // Send request start event to UI panel
    this.sendNetworkEvent('start', requestId, url, request.method, headersObj);

    if (this.verbose) {
      console.debug(`[Protocol API] Capturing: ${url}`);
    }

    try {
      // Forward request using bypass session (no protocol handler)
      const response = await this.bypassSession.fetch(url, {
        method: request.method,
        headers: headersObj,
      });

      const buffer = Buffer.from(await response.arrayBuffer());

      // Save file only if outputDir is set
      if (this.outputDir) {
        // Check if URL is eligible for capture
        if (!isEligible(url, this.filter, this.selector, this.sourceUrls)) {
          if (this.verbose) {
            console.debug(`[Protocol API] Not eligible: ${url}`);
          }
          // Still save but don't log
          const filename = generateFilename(url);
          const filepath = path.join(this.outputDir, filename);
          const dirpath = path.dirname(filepath);
          if (!fs.existsSync(dirpath)) {
            fs.mkdirSync(dirpath, { recursive: true });
          }
          fs.writeFileSync(filepath, buffer);
        } else {
          // Save eligible URL
          const filename =
            this.renameSequence && this.selector
              ? generateSequentialFilename(url, this.sourceUrls.size, this.renameSequence)
              : generateFilename(url);
          const filepath = path.join(this.outputDir, filename);
          const dirpath = path.dirname(filepath);
          if (!fs.existsSync(dirpath)) {
            fs.mkdirSync(dirpath, { recursive: true });
          }
          fs.writeFileSync(filepath, buffer);
          if (this.verbose) {
            console.debug(`[Protocol API] Saved: ${filename} (${buffer.length} bytes)`);
          }
        }
      }

      // Print curl command if outputCurl is enabled and URL matches filter (if any)
      if (this.outputCurl) {
        if (!this.filter || this.filter.test(url)) {
          const curl = generateCurl(request.method, url, headersObj);
          console.log(`\n${'='.repeat(80)}`);
          console.log(curl);
          console.log(`${'='.repeat(80)}\n`);
        }
      }

      // Send request complete event to UI panel (always)
      this.sendNetworkEvent(
        'complete',
        requestId,
        url,
        request.method,
        headersObj,
        response.status
      );

      // Track completed source URLs
      if (this.selector && this.sourceUrls.has(url)) {
        this.completedSourceUrls.add(url);
      }

      this.activeRequests.delete(url);

      // Return ORIGINAL response (unchanged)
      return new Response(buffer, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      console.error(`[Protocol API] Error capturing ${url}:`, error);
      // Send error event to UI panel
      this.sendNetworkEvent('complete', requestId, url, request.method, headersObj, 0);
      this.activeRequests.delete(url);
      // Re-throw to let the request fail normally
      throw error;
    } finally {
      this.processingUrls.delete(url);
    }
  }

  private sendNetworkEvent(
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

  private printCurlCommand(method: string, url: string, headers: Record<string, string>): void {
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H "${this.escapeCurl(k)}: ${this.escapeCurl(v)}"`)
      .join(' ');

    console.log(`\n${'='.repeat(80)}`);
    console.log(`curl -X ${method} ${headerArgs} "${this.escapeCurl(url)}"`);
    console.log(`${'='.repeat(80)}\n`);
  }

  private escapeCurl(text: string): string {
    return text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  }

  getActiveRequests(): Map<
    string,
    { id: number; url: string; method: string; headers: Record<string, string> }
  > {
    return this.activeRequests;
  }

  getSourceUrls(): Set<string> {
    return this.sourceUrls;
  }

  getCompletedSourceUrls(): Set<string> {
    return this.completedSourceUrls;
  }
}
