import { protocol, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { WebContentsView } from 'electron';
import type { ProtocolHandlerOptions } from './types.ts';
import {
  generateFilename,
  generateFlatFilename,
  generateSequentialFilename,
  isEligible,
  normalizeUrlWithBase,
} from './backend_utils.ts';
import { generateCurl } from './cross_stack_utils.ts';

const RESPONSE_WITHOUT_BODY = new Set([204, 304]);

export class ProtocolHandler {
  private outputDir?: string;
  private filter?: RegExp;
  private selector?: string;
  private renameSequence?: string;
  private verbose?: boolean;
  private outputCurl?: boolean;
  private flatDir?: boolean;
  private uiView?: WebContentsView;
  private webView?: WebContentsView;
  private sourceUrls: Map<string, number>;
  private completedSourceUrls: Map<string, number>;
  private processingUrls: Set<string>;
  private requestIdCounter: number;
  private sequentialCounter: number;
  private activeRequests: Map<
    string,
    { id: number; url: string; method: string; headers: Record<string, string> }
  >;
  private bypassSession: ReturnType<typeof session.fromPartition>;
  private baseUrl: string;

  constructor(options: ProtocolHandlerOptions) {
    this.outputDir = options.outputDir;
    this.filter = options.filter;
    this.selector = options.selector;
    this.renameSequence = options.renameSequence;
    this.verbose = options.verbose;
    this.outputCurl = options.outputCurl;
    this.flatDir = options.flatDir;
    this.uiView = options.uiView;
    this.webView = options.webView;
    this.sourceUrls = options.sourceUrls;
    this.completedSourceUrls = options.completedSourceUrls;
    this.processingUrls = new Set<string>();
    this.sequentialCounter = 0;
    this.baseUrl = options.webView?.webContents.getURL() || 'about:blank';
    this.activeRequests = new Map<
      string,
      { id: number; url: string; method: string; headers: Record<string, string> }
    >();
    this.bypassSession = session.fromPartition('persist:bypass');
  }

  register(): void {
    if (this.verbose) {
      console.debug('[Protocol API] Registering handlers...');
    }

    // Handle HTTPS
    protocol.handle('https', this.handleRequest.bind(this));

    // Handle HTTP
    protocol.handle('http', this.handleRequest.bind(this));

    if (this.verbose) {
      console.debug('[Protocol API] Handlers registered successfully');
    }
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = request.url;
    const headersObj: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

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

      // Normalize URL for consistent matching
      const normalizedUrl = normalizeUrlWithBase(this.baseUrl, url);

      // Check if URL is eligible using single source of truth
      const eligible = isEligible(normalizedUrl, this.filter, this.selector, this.sourceUrls);

      // Save file only if outputDir is set and URL is eligible
      if (this.outputDir && eligible) {
        const filename = this.generateFilenameForUrl(normalizedUrl);
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

      // Print curl command if outputCurl is enabled and URL is eligible
      if (this.outputCurl && eligible) {
        const curl = generateCurl(request.method, url, headersObj);
        process.stdout.write(`\n${'='.repeat(80)}\n`);
        process.stdout.write(curl);
        process.stdout.write(`\n${'='.repeat(80)}\n\n`);
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
        this.completedSourceUrls.set(url, this.sourceUrls.get(url)!);
      }

      this.activeRequests.delete(url);

      // Return ORIGINAL response (unchanged)
      return new Response(RESPONSE_WITHOUT_BODY.has(response.status) ? null : buffer, {
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

  private generateFilenameForUrl(url: string): string {
    if (this.renameSequence) {
      // If --selector is given, use the index from sourceUrls Map to preserve DOM order
      if (this.selector && this.sourceUrls.has(url)) {
        const index = this.sourceUrls.get(url)! + 1; // +1 to make it 1-based
        return generateSequentialFilename(url, index, this.renameSequence);
      }
      // Otherwise, use an incremental counter
      this.sequentialCounter++;
      return generateSequentialFilename(url, this.sequentialCounter, this.renameSequence);
    }
    return this.flatDir ? generateFlatFilename(url) : generateFilename(url);
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

    process.stdout.write(`\n${'='.repeat(80)}\n`);
    process.stdout.write(`curl -X ${method} ${headerArgs} "${this.escapeCurl(url)}"`);
    process.stdout.write(`\n${'='.repeat(80)}\n\n`);
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

  getSourceUrls(): Map<string, number> {
    return this.sourceUrls;
  }

  getCompletedSourceUrls(): Map<string, number> {
    return this.completedSourceUrls;
  }
}
