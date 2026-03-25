import type { OutputManagerOptions } from './types.ts';
import {
  normalizeFilename,
  normalizeFlatFilename,
  generateSequentialFilename,
  normalizeUrlWithBase,
} from './backend_utils.ts';
import { generateCurl, generateFFmpegCommand, isM3u8 } from './cross_stack_utils.ts';
import { RESPONSE_WITHOUT_BODY, EXIT_CODES } from './constants.ts';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

interface ResponseData {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  response: {
    statusCode: number;
    body: Buffer;
    headers: Record<string, string>;
  };
}

export class OutputManager {
  private outputDir?: string;
  private filter?: RegExp;
  private selector?: string;
  private renameSequence?: string;
  private outputCurl?: boolean;
  private flatDir?: boolean;
  private onOutput: (url: string) => void;
  private onAllSelectorFilesSaved?: () => void;
  private unprocessedResponses: ResponseData[] = [];
  private sourceUrls: Map<string, number> = new Map<string, number>();
  private savedUrls: Set<string> = new Set<string>();
  private sequentialCounter = 0;
  private baseUrl: string;

  constructor(options: OutputManagerOptions & { baseUrl: string }) {
    this.outputDir = options.outputDir;
    this.filter = options.filter;
    this.selector = options.selector;
    this.renameSequence = options.renameSequence;
    this.outputCurl = options.outputCurl;
    this.flatDir = options.flatDir;
    this.onOutput = options.onOutput;
    this.onAllSelectorFilesSaved = options.onAllSelectorFilesSaved;
    this.baseUrl = options.baseUrl;
  }

  responseCompleted(
    request: {
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
    const responseData: ResponseData = { request, response };

    if (!this.processResponse(responseData) && this.selector) {
      this.unprocessedResponses.push(responseData);
    }
  }

  updatePageSource(pageSource: string): void {
    this.sourceUrls = this.extractSourceUrlsFromSource(pageSource);

    if (this.unprocessedResponses.length === 0) {
      return;
    }

    this.unprocessedResponses.forEach((responseData) => {
      this.processResponse(responseData);
    });

    this.unprocessedResponses = [];
  }

  private extractSourceUrlsFromSource(pageSource: string): Map<string, number> {
    if (!this.selector) {
      return new Map<string, number>();
    }

    const dom = new JSDOM(pageSource);
    const document = dom.window.document;
    const elements = document.querySelectorAll(this.selector);
    const sourceUrls = new Map<string, number>();

    elements.forEach((el, i) => {
      const element = el as HTMLElement & {
        src?: string;
        dataset?: { src?: string };
      };

      if (element.src) {
        const normalizedUrl = normalizeUrlWithBase(this.baseUrl, element.src);
        sourceUrls.set(normalizedUrl, i);
      } else if (element.dataset?.src) {
        const normalizedUrl = normalizeUrlWithBase(this.baseUrl, element.dataset.src);
        sourceUrls.set(normalizedUrl, i);
      }
    });

    return sourceUrls;
  }

  private isEligible(url: string, sourceUrls: Map<string, number>): boolean {
    const filterMatch = !this.filter || this.filter.test(url);
    const selectorMatch = !this.selector || sourceUrls.has(url);
    return filterMatch && selectorMatch;
  }

  private processResponse(responseData: ResponseData): boolean {
    const normalizedUrl = normalizeUrlWithBase(this.baseUrl, responseData.request.url);
    if (!this.isEligible(normalizedUrl, this.sourceUrls)) {
      return false;
    }

    const { request, response } = responseData;

    if (this.outputCurl) {
      const command = this.generateOutputCommand(request);
      process.stdout.write(`\n${'='.repeat(80)}\n`);
      process.stdout.write(command);
      process.stdout.write(`\n${'='.repeat(80)}\n\n`);
    }

    if (this.outputDir) {
      this.writeToFile(response, normalizedUrl);
    }

    this.onOutput(request.url);
    return true;
  }

  private generateOutputCommand(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
  }): string {
    if (isM3u8(request.url)) {
      return generateFFmpegCommand(request.url, request.headers);
    }
    return generateCurl(request.method, request.url, request.headers);
  }

  private writeToFile(
    response: {
      statusCode: number;
      body: Buffer;
      headers: Record<string, string>;
    },
    normalizedUrl: string
  ): void {
    try {
      if (RESPONSE_WITHOUT_BODY.has(response.statusCode)) {
        return;
      }

      const sequence = this.sourceUrls.get(normalizedUrl) ?? this.sequentialCounter;
      this.sequentialCounter++;

      const filename = this.generateFilenameForUrl(normalizedUrl, sequence);
      const filepath = path.join(this.outputDir!, filename);
      const dirpath = path.dirname(filepath);

      if (!fs.existsSync(dirpath)) {
        fs.mkdirSync(dirpath, { recursive: true });
      }

      fs.writeFileSync(filepath, response.body);
      this.savedUrls.add(normalizedUrl);
      this.checkAllFilesSaved();
    } catch (error) {
      console.error(`[OutputManager] Error writing file:`, error);
      process.exit(EXIT_CODES.fileWriteFailure);
    }
  }

  private generateFilenameForUrl(url: string, sequence: number): string {
    if (this.renameSequence) {
      return generateSequentialFilename(url, sequence, this.renameSequence);
    }
    return this.flatDir ? normalizeFlatFilename(url) : normalizeFilename(url);
  }

  private checkAllFilesSaved(): void {
    if (!this.selector || this.sourceUrls.size === 0) {
      return;
    }

    if (!this.hasPendingSelectorFiles() && this.onAllSelectorFilesSaved) {
      this.onAllSelectorFilesSaved();
    }
  }

  /**
   * Check if there are still expected pending files that haven't been received yet.
   * Returns true if there are source URLs that haven't been saved yet.
   */
  hasPendingSelectorFiles(): boolean {
    if (!this.selector || this.sourceUrls.size === 0) {
      return false;
    }

    return [...this.sourceUrls.keys()].some((url) => !this.savedUrls.has(url));
  }
}
