import path from 'node:path';

/**
 * Generate filename from URL
 */
export function normalizeFilename(url: string): string {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || '/index';
  const cleanedPathName = pathname.split('/').filter(Boolean).join('/') || 'index';
  const ext = path.extname(cleanedPathName) || '.html';
  const nameWithoutExt = cleanedPathName.replace(ext, '');

  return `${nameWithoutExt}${ext}`;
}

/**
 * Generate flat filename from URL (no directory structure)
 */
export function normalizeFlatFilename(url: string): string {
  return path.basename(normalizeFilename(url));
}

/**
 * Generate sequential filename for --rename-sequence
 */
export function generateSequentialFilename(
  url: string,
  counter: number,
  renameSequence: string
): string {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || '/index';
  const baseName = path.basename(pathname);
  const ext = path.extname(baseName) || '.html';

  const width = parseInt(renameSequence, 10);
  const formattedNum = counter.toString().padStart(width, '0');
  return `${formattedNum}${ext}`;
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
