import { describe, it, expect } from 'vitest';
import {
  normalizeFilename,
  normalizeFlatFilename,
  generateSequentialFilename,
  normalizeUrlWithBase,
} from './backend_utils.ts';

describe('normalizeFilename', () => {
  it('should extract pathname from URL', () => {
    expect(normalizeFilename('https://example.com/path/to/file.html')).toBe('path/to/file.html');
  });

  it('should default to index for root path', () => {
    expect(normalizeFilename('https://example.com/')).toBe('index.html');
  });

  it('should handle URLs without extension', () => {
    expect(normalizeFilename('https://example.com/path/to/page')).toBe('path/to/page.html');
  });

  it('should handle query parameters in URL', () => {
    expect(normalizeFilename('https://example.com/path/file.html?foo=bar')).toBe('path/file.html');
  });

  it('should handle empty pathname after filter', () => {
    expect(normalizeFilename('https://example.com///')).toBe('index.html');
  });

  it('should preserve directory structure', () => {
    expect(normalizeFilename('https://example.com/a/b/c/d.css')).toBe('a/b/c/d.css');
  });

  it('should handle single segment path', () => {
    expect(normalizeFilename('https://example.com/file.js')).toBe('file.js');
  });
});

describe('normalizeFlatFilename', () => {
  it('should return only basename without directory', () => {
    expect(normalizeFlatFilename('https://example.com/path/to/file.html')).toBe('file.html');
  });

  it('should return index.html for root URL', () => {
    expect(normalizeFlatFilename('https://example.com/')).toBe('index.html');
  });

  it('should strip directory from nested paths', () => {
    expect(normalizeFlatFilename('https://example.com/a/b/c/style.css')).toBe('style.css');
  });
});

describe('generateSequentialFilename', () => {
  it('should generate zero-padded filename', () => {
    expect(generateSequentialFilename('https://example.com/file.html', 1, '03d')).toBe('001.html');
  });

  it('should handle different widths', () => {
    expect(generateSequentialFilename('https://example.com/file.html', 5, '05d')).toBe(
      '00005.html'
    );
  });

  it('should handle wide numbers exceeding width', () => {
    expect(generateSequentialFilename('https://example.com/file.html', 12345, '03d')).toBe(
      '12345.html'
    );
  });

  it('should preserve file extension', () => {
    expect(generateSequentialFilename('https://example.com/path/data.json', 10, '02d')).toBe(
      '10.json'
    );
  });

  it('should default to .html extension for URLs without extension', () => {
    expect(generateSequentialFilename('https://example.com/path/page', 1, '03d')).toBe('001.html');
  });

  it('should handle zero counter', () => {
    expect(generateSequentialFilename('https://example.com/file.html', 0, '04d')).toBe('0000.html');
  });

  it('should handle width of 1', () => {
    expect(generateSequentialFilename('https://example.com/file.html', 42, '1d')).toBe('42.html');
  });
});

describe('normalizeUrlWithBase', () => {
  it('should resolve relative URL against base', () => {
    expect(normalizeUrlWithBase('https://example.com/', '/path/to/page')).toBe(
      'https://example.com/path/to/page'
    );
  });

  it('should resolve relative URL without leading slash', () => {
    expect(normalizeUrlWithBase('https://example.com/base/', 'page')).toBe(
      'https://example.com/base/page'
    );
  });

  it('should return original URL if resolution fails', () => {
    expect(normalizeUrlWithBase('not a valid url', '/path')).toBe('/path');
  });

  it('should handle absolute URL overrides base', () => {
    expect(normalizeUrlWithBase('https://example.com/', 'https://other.com/path')).toBe(
      'https://other.com/path'
    );
  });

  it('should handle URL with query parameters', () => {
    expect(normalizeUrlWithBase('https://example.com/', '/page?foo=bar')).toBe(
      'https://example.com/page?foo=bar'
    );
  });
});
