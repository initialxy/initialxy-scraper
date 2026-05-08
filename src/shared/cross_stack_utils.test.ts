import { describe, it, expect } from 'vitest';
import { escapeCurl, generateCurl, isM3u8, generateFFmpegCommand } from './cross_stack_utils.ts';

describe('escapeCurl', () => {
  it('should escape double quotes', () => {
    expect(escapeCurl('hello "world"')).toBe('hello \\"world\\"');
  });

  it('should escape backticks', () => {
    expect(escapeCurl('hello `world`')).toBe('hello \\`world\\`');
  });

  it('should escape dollar signs', () => {
    expect(escapeCurl('$HOME/path')).toBe('\\$HOME/path');
  });

  it('should escape all special characters', () => {
    expect(escapeCurl('"`$')).toBe('\\"\\`\\$');
  });

  it('should return unchanged string with no special chars', () => {
    expect(escapeCurl('hello-world_123')).toBe('hello-world_123');
  });

  it('should handle empty string', () => {
    expect(escapeCurl('')).toBe('');
  });
});

describe('generateCurl', () => {
  it('should generate basic curl command', () => {
    const result = generateCurl('GET', 'https://example.com', {});
    expect(result).toContain('curl -X GET');
    expect(result).toContain('"https://example.com"');
  });

  it('should include headers in curl command', () => {
    const result = generateCurl('GET', 'https://example.com', {
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    });
    expect(result).toContain('-H "Authorization: Bearer token"');
    expect(result).toContain('-H "Content-Type: application/json"');
  });

  it('should join multiple headers with continuation', () => {
    const result = generateCurl('GET', 'https://example.com', {
      'X-Header-1': 'value1',
      'X-Header-2': 'value2',
    });
    expect(result).toContain(' \\\n');
  });

  it('should escape special chars in URL', () => {
    const result = generateCurl('GET', 'https://example.com/path?foo="bar"', {});
    expect(result).toContain('\\"');
  });

  it('should escape special chars in headers', () => {
    const result = generateCurl('POST', 'https://example.com', {
      'X-Custom': 'value "with" quotes',
    });
    expect(result).toContain('-H "X-Custom: value \\"with\\" quotes"');
  });

  it('should use POST method', () => {
    const result = generateCurl('POST', 'https://example.com/api', {
      'Content-Type': 'application/json',
    });
    expect(result).toContain('curl -X POST');
  });

  it('should use PUT method', () => {
    const result = generateCurl('PUT', 'https://example.com/api/1', {});
    expect(result).toContain('curl -X PUT');
  });

  it('should use DELETE method', () => {
    const result = generateCurl('DELETE', 'https://example.com/api/1', {});
    expect(result).toContain('curl -X DELETE');
  });
});

describe('isM3u8', () => {
  it('should return true for .m3u8 URL', () => {
    expect(isM3u8('https://example.com/playlist.m3u8')).toBe(true);
  });

  it('should return true for .M3U8 URL (case insensitive)', () => {
    expect(isM3u8('https://example.com/playlist.M3U8')).toBe(true);
  });

  it('should return true for .m3u8 with query params', () => {
    expect(isM3u8('https://example.com/playlist.m3u8?token=abc123')).toBe(true);
  });

  it('should return false for non-m3u8 URL', () => {
    expect(isM3u8('https://example.com/playlist.mp4')).toBe(false);
  });

  it('should return false for .m3u8 in path but not extension', () => {
    expect(isM3u8('https://example.com/m3u8/playlist.mp4')).toBe(false);
  });

  it('should handle uppercase M3U8 with query params', () => {
    expect(isM3u8('https://example.com/stream.M3U8?quality=high')).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(isM3u8('')).toBe(false);
  });

  it('should return false for just extension', () => {
    expect(isM3u8('.m3u8')).toBe(true);
  });
});

describe('generateFFmpegCommand', () => {
  it('should generate basic ffmpeg command', () => {
    const result = generateFFmpegCommand('https://example.com/stream.m3u8', {});
    expect(result).toContain('ffmpeg');
    expect(result).toContain('-allowed_extensions ALL');
    expect(result).toContain("-i 'https://example.com/stream.m3u8'");
    expect(result).toContain('out.mp4');
  });

  it('should include headers in ffmpeg command', () => {
    const result = generateFFmpegCommand('https://example.com/stream.m3u8', {
      Authorization: 'Bearer token',
    });
    expect(result).toContain('-headers "Authorization: Bearer token"');
  });

  it('should include multiple headers', () => {
    const result = generateFFmpegCommand('https://example.com/stream.m3u8', {
      Authorization: 'Bearer token',
      Referer: 'https://example.com',
    });
    expect(result).toContain('-headers "Authorization: Bearer token"');
    expect(result).toContain('-headers "Referer: https://example.com"');
  });

  it('should escape special chars in headers', () => {
    const result = generateFFmpegCommand('https://example.com/stream.m3u8', {
      'X-Custom': 'value "with" quotes',
    });
    expect(result).toContain('-headers "X-Custom: value \\"with\\" quotes"');
  });

  it('should include all required ffmpeg flags', () => {
    const result = generateFFmpegCommand('https://example.com/stream.m3u8', {});
    expect(result).toContain('-protocol_whitelist file,http,https,tcp,tls');
    expect(result).toContain('-extension_picky 0');
    expect(result).toContain('-readrate 4');
    expect(result).toContain('-reconnect 1');
    expect(result).toContain('-reconnect_at_eof 1');
    expect(result).toContain('-reconnect_streamed 1');
    expect(result).toContain('-reconnect_delay_max 2000');
    expect(result).toContain('-timeout 300000000');
    expect(result).toContain('-acodec copy');
    expect(result).toContain('-bsf:a aac_adtstoasc');
    expect(result).toContain('-vcodec copy');
  });

  it('should include URL in input flag', () => {
    const result = generateFFmpegCommand('https://example.com/path/stream.m3u8?token=abc', {});
    expect(result).toContain("-i 'https://example.com/path/stream.m3u8?token=abc'");
  });

  it('should place -i right after -readrate 4', () => {
    const result = generateFFmpegCommand('https://example.com/stream.m3u8', {
      Cookie: 'session=abc123',
    });
    const readrateIdx = result.indexOf('-readrate 4');
    const inputIdx = result.indexOf("-i '");
    const headersIdx = result.indexOf('-headers');
    expect(readrateIdx).toBeGreaterThan(-1);
    expect(inputIdx).toBeGreaterThan(-1);
    expect(headersIdx).toBeGreaterThan(-1);
    expect(result.substring(readrateIdx, inputIdx)).toBe('-readrate 4 ');
    expect(headersIdx).toBeGreaterThan(inputIdx);
  });
});
