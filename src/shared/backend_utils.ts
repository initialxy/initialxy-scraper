import path from 'node:path';
import type { WebContents } from 'electron';
import { JSDOM } from 'jsdom';

// Track filename collisions
const filenameCounter = new Map<string, number>();

/**
 * Generate filename from URL
 */
export function generateFilename(url: string, counter?: number): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname || '/index';
    const baseName = pathname.split('/').filter(Boolean).join('/') || 'index';
    const ext = path.extname(baseName) || '.html';
    const nameWithoutExt = baseName.replace(ext, '');

    // Handle collisions by adding counter
    const currentCount = counter ?? (filenameCounter.get(nameWithoutExt) || 0);
    if (counter === undefined) {
      filenameCounter.set(nameWithoutExt, currentCount + 1);
    }

    if (currentCount === 0) {
      return `${nameWithoutExt}${ext}`;
    }
    return `${nameWithoutExt}_${currentCount}${ext}`;
  } catch {
    return `response_${Date.now()}.dat`;
  }
}

/**
 * Generate flat filename from URL (no directory structure)
 */
export function generateFlatFilename(url: string, counter?: number): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname || '/index';
    const baseName = path.basename(pathname) || 'index';
    const ext = path.extname(baseName) || '.html';
    const nameWithoutExt = baseName.replace(ext, '');

    // Handle collisions by adding counter
    const currentCount = counter ?? (filenameCounter.get(nameWithoutExt) || 0);
    if (counter === undefined) {
      filenameCounter.set(nameWithoutExt, currentCount + 1);
    }

    if (currentCount === 0) {
      return `${nameWithoutExt}${ext}`;
    }
    return `${nameWithoutExt}_${currentCount}${ext}`;
  } catch {
    return `response_${Date.now()}.dat`;
  }
}

/**
 * Generate sequential filename for --rename-sequence
 */
export function generateSequentialFilename(
  url: string,
  counter: number,
  renameSequence: string
): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname || '/index';
    const baseName = path.basename(pathname);
    const ext = path.extname(baseName) || '.html';

    const formattedNum = counter.toString().padStart(parseInt(renameSequence, 10), '0');
    return `${formattedNum}${ext}`;
  } catch {
    return `response_${Date.now()}.dat`;
  }
}

/**
 * Normalize URL to absolute path
 */
export function normalizeUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

/**
 * Extract source URLs from DOM using selector
 */
export async function extractSourceUrls(
  webContents: WebContents,
  selector: string
): Promise<string[]> {
  try {
    const pageSource = await webContents.executeJavaScript('document.documentElement.outerHTML');

    const dom = new JSDOM(pageSource);
    const document = dom.window.document;
    const elements = document.querySelectorAll(selector);
    const results: string[] = [];

    elements.forEach((el) => {
      const element = el as HTMLElement & {
        src?: string;
        dataset?: { src?: string };
        srcset?: string;
      };

      // Priority 1: src attribute
      if (element.src) {
        results.push(element.src);
      }
      // Priority 2: data-src attribute
      else if (element.dataset?.src) {
        results.push(element.dataset.src);
      }
      // Priority 3: srcset attribute (parse all URLs)
      else if (element.srcset) {
        const srcsetUrls = element.srcset.split(',').map((src) => {
          const parts = src.trim().split(/ /);
          return parts[0];
        });
        results.push(...srcsetUrls);
      }
    });

    return results;
  } catch (error) {
    console.error('[Utils] Error extracting source URLs:', error);
    return [];
  }
}

/**
 * Check if URL is eligible for capture based on CLI args
 */
export function isEligible(
  url: string,
  filter?: RegExp,
  selector?: string,
  sourceUrls?: Set<string>
): boolean {
  // If no filters, all URLs are eligible
  if (!filter && !selector) {
    return true;
  }

  // If only filter specified
  if (filter && !selector) {
    return filter.test(url);
  }

  // If only selector specified
  if (!filter && selector) {
    return sourceUrls?.has(url) ?? false;
  }

  // If both filter and selector specified (AND logic)
  if (filter && selector) {
    return (filter.test(url) && sourceUrls?.has(url)) ?? false;
  }

  return false;
}

/**
 * Escape text for HTML display
 */
export function escapeHtml(text: string): string {
  // Simple HTML escape for Node.js environment
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wait for a specified number of seconds
 */
export function wait(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Parse delay value from CLI argument
 */
export function parseDelay(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? undefined : parsed;
}
