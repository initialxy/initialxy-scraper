import type { OutputManagerOptions } from './types.ts';
import {
  generateFilename,
  generateFlatFilename,
  generateSequentialFilename,
  normalizeUrlWithBase,
} from './backend_utils.ts';
import { generateCurl, generateFFmpegCommand, isM3u8 } from './cross_stack_utils.ts';
import { RESPONSE_WITHOUT_BODY } from './constants.ts';
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
  private unprocessedResponses: ResponseData[] = [];
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

    if (this.selector) {
      this.unprocessedResponses.push(responseData);
      return;
    }

    this.processResponse(responseData);
  }

  updatePageSource(pageSource: string): void {
    const sourceUrls = this.extractSourceUrlsFromSource(pageSource);

    for (const responseData of this.unprocessedResponses) {
      const normalizedUrl = normalizeUrlWithBase(this.baseUrl, responseData.request.url);
      if (this.isEligible(normalizedUrl, sourceUrls)) {
        this.processResponse(responseData);
      }
    }

    this.unprocessedResponses = [];
  }

  private extractSourceUrlsFromSource(pageSource: string): Set<string> {
    const dom = new JSDOM(pageSource);
    const document = dom.window.document;
    const elements = this.selector
      ? document.querySelectorAll(this.selector)
      : document.querySelectorAll('*');
    const sourceUrls = new Set<string>();

    elements.forEach((el) => {
      const element = el as HTMLElement & {
        src?: string;
        dataset?: { src?: string };
        srcset?: string;
      };

      if (element.src) {
        const normalizedUrl = normalizeUrlWithBase(this.baseUrl, element.src);
        sourceUrls.add(normalizedUrl);
      } else if (element.dataset?.src) {
        const normalizedUrl = normalizeUrlWithBase(this.baseUrl, element.dataset.src);
        sourceUrls.add(normalizedUrl);
      } else if (element.srcset) {
        element.srcset.split(',').forEach((src) => {
          const parts = src.trim().split(/ /);
          if (parts[0]) {
            const normalizedUrl = normalizeUrlWithBase(this.baseUrl, parts[0]);
            sourceUrls.add(normalizedUrl);
          }
        });
      }
    });

    return sourceUrls;
  }

  private isEligible(url: string, sourceUrls: Set<string>): boolean {
    const filterMatch = !this.filter || this.filter.test(url);
    const selectorMatch = !this.selector || sourceUrls.has(url);
    return filterMatch && selectorMatch;
  }

  private processResponse(responseData: ResponseData): void {
    const { request, response } = responseData;
    const normalizedUrl = normalizeUrlWithBase(this.baseUrl, request.url);

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

      const filename = this.generateFilenameForUrl(normalizedUrl);
      const filepath = path.join(this.outputDir!, filename);
      const dirpath = path.dirname(filepath);

      if (!fs.existsSync(dirpath)) {
        fs.mkdirSync(dirpath, { recursive: true });
      }

      fs.writeFileSync(filepath, response.body);
    } catch (error) {
      console.error(`[OutputManager] Error writing file:`, error);
      process.exit(5);
    }
  }

  private generateFilenameForUrl(url: string): string {
    if (this.renameSequence) {
      this.sequentialCounter++;
      return generateSequentialFilename(url, this.sequentialCounter, this.renameSequence);
    }
    return this.flatDir ? generateFlatFilename(url) : generateFilename(url);
  }
}
