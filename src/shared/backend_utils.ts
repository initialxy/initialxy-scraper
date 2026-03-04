import path from 'node:path';

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

    const width = parseInt(renameSequence, 10);
    const formattedNum = counter.toString().padStart(width, '0');
    return `${formattedNum}${ext}`;
  } catch {
    return `response_${Date.now()}.dat`;
  }
}

/**
 * Normalize URL using base URL
 */
export function normalizeUrlWithBase(base: string, url: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}
