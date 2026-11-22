import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { OutputManager } from './output_manager.ts';
import fs from 'node:fs';

// Mock fs and path modules to prevent actual file system operations
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  default: {
    join: vi.fn((...paths: string[]) => paths.join('/')),
    dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/') || '/'),
    basename: vi.fn((p: string) => p.split('/').pop() || ''),
    extname: vi.fn((p: string) => (p.split('.').pop() ? '.' + p.split('.').pop() : '')),
  },
  join: vi.fn((...paths: string[]) => paths.join('/')),
  dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/') || '/'),
  basename: vi.fn((p: string) => p.split('/').pop() || ''),
  extname: vi.fn((p: string) => (p.split('.').pop() ? '.' + p.split('.').pop() : '')),
}));

describe('OutputManager', () => {
  let manager: OutputManager;
  let mockOnOutput: ReturnType<typeof vi.fn<(url: string) => void>>;
  let mockOnAllSelectorFilesSaved: ReturnType<typeof vi.fn<() => void>>;
  let mockStdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Spy on process.stdout.write to capture output
    mockStdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnOutput = vi.fn<(url: string) => void>();
    mockOnAllSelectorFilesSaved = vi.fn<() => void>();
  });

  afterAll(() => {
    // Restore the original implementation after all tests in this suite
    mockStdoutWrite.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with options', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputDir: './output',
        onOutput: mockOnOutput,
      });
      expect(manager).toBeDefined();
    });

    it('should initialize with filter and selector', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        filter: /\.jpg$/,
        selector: 'img',
        onOutput: mockOnOutput,
      });
      expect(manager).toBeDefined();
    });
  });

  describe('responseCompleted', () => {
    it('should process response immediately when no selector', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      const mockRequest = {
        url: 'https://example.com/test.jpg',
        method: 'GET',
        headers: { 'User-Agent': 'Test' },
      };
      const mockResponse = {
        statusCode: 200,
        body: Buffer.from('test content'),
        headers: { 'Content-Type': 'image/jpeg' },
      };

      manager.responseCompleted(mockRequest, mockResponse);

      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/test.jpg');
      // Verify curl command was output to stdout
      expect(mockStdoutWrite).toHaveBeenCalled();
      const output = mockStdoutWrite.mock.calls.map((call) => call[0]).join('');
      expect(output).toContain('curl');
      expect(output).toContain('https://example.com/test.jpg');
    });

    it('should process response immediately when selector matches current sourceUrls', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      // First update source URLs to set up sourceUrls
      manager.updateSourceUrls(['https://example.com/existing.jpg']);

      // Now a response comes in that matches the current sourceUrls
      manager.responseCompleted(
        { url: 'https://example.com/existing.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      // Should be processed immediately (not buffered)
      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/existing.jpg');
      expect(mockStdoutWrite).toHaveBeenCalled();
    });

    it('should buffer response when selector is set', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        onOutput: mockOnOutput,
      });

      const mockRequest = {
        url: 'https://example.com/test.jpg',
        method: 'GET',
        headers: {},
      };
      const mockResponse = {
        statusCode: 200,
        body: Buffer.from('test'),
        headers: {},
      };

      manager.responseCompleted(mockRequest, mockResponse);

      // Should NOT call onOutput yet
      expect(mockOnOutput).not.toHaveBeenCalled();
    });
  });

  describe('updateSourceUrls', () => {
    it('should process buffered responses when URL list matches selector', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      // Buffer a response
      manager.responseCompleted(
        { url: 'https://example.com/image.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      // Update with matching URL list
      manager.updateSourceUrls(['https://example.com/image.jpg']);

      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/image.jpg');
      // Verify curl command was output
      expect(mockStdoutWrite).toHaveBeenCalled();
      const output = mockStdoutWrite.mock.calls.map((call) => call[0]).join('');
      expect(output).toContain('curl');
    });

    it('should not process non-matching URLs', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      // Buffer a response for a URL not in the URL list
      manager.responseCompleted(
        { url: 'https://example.com/not-in-list.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      manager.updateSourceUrls(['https://example.com/other.jpg']);

      // Should NOT call onOutput since URL doesn't match
      expect(mockOnOutput).not.toHaveBeenCalled();
    });

    it('should handle empty URL list', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        onOutput: mockOnOutput,
      });

      manager.updateSourceUrls([]);
      expect(mockOnOutput).not.toHaveBeenCalled();
    });

    it('should normalize relative URLs against the base URL', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/lazy.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      // e.g. data-src="lazy.jpg" from the page, relative to the document
      manager.updateSourceUrls(['lazy.jpg']);

      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/lazy.jpg');
      // Verify curl command was output
      expect(mockStdoutWrite).toHaveBeenCalled();
      const output = mockStdoutWrite.mock.calls.map((call) => call[0]).join('');
      expect(output).toContain('curl');
    });
  });

  describe('filter', () => {
    it('should filter URLs by regex', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        filter: /\.jpg$/,
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/test.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/test.jpg');
      expect(mockStdoutWrite).toHaveBeenCalled();
      const output = mockStdoutWrite.mock.calls.map((call) => call[0]).join('');
      expect(output).toContain('curl');
    });

    it('should exclude non-matching URLs', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        filter: /\.jpg$/,
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/test.png', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      expect(mockOnOutput).not.toHaveBeenCalled();
      expect(mockStdoutWrite).not.toHaveBeenCalled();
    });

    it('should combine filter and selector', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        filter: /\.jpg$/,
        selector: 'img',
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/test.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      manager.updateSourceUrls(['https://example.com/test.jpg']);

      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/test.jpg');
      expect(mockStdoutWrite).toHaveBeenCalled();
      const output = mockStdoutWrite.mock.calls.map((call) => call[0]).join('');
      expect(output).toContain('curl');
    });
  });

  describe('writeToFile', () => {
    it('should write file to output directory', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputDir: './output',
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/test.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test content'), headers: {} }
      );

      // onOutput should be called which indicates processing happened
      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/test.jpg');
    });

    it('should skip writing for status codes without body', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputDir: './output',
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/test', method: 'GET', headers: {} },
        { statusCode: 204, body: Buffer.from(''), headers: {} }
      );

      // onOutput should still be called even for 204
      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/test');
    });
  });

  describe('generateOutputCommand', () => {
    it('should generate curl command', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/test', method: 'GET', headers: { 'User-Agent': 'Test' } },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      expect(mockOnOutput).toHaveBeenCalled();
      expect(mockStdoutWrite).toHaveBeenCalled();
      const output = mockStdoutWrite.mock.calls.map((call) => call[0]).join('');
      expect(output).toContain('curl');
      expect(output).toContain('https://example.com/test');
    });

    it('should generate ffmpeg command for m3u8 URLs', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputCurl: true,
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/stream.m3u8', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      expect(mockOnOutput).toHaveBeenCalled();
      expect(mockStdoutWrite).toHaveBeenCalled();
      const output = mockStdoutWrite.mock.calls.map((call) => call[0]).join('');
      expect(output).toContain('ffmpeg');
      expect(output).toContain('https://example.com/stream.m3u8');
    });
  });

  describe('onAllSelectorFilesSaved', () => {
    it('should call callback when all selector files are saved', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputDir: './output',
        onOutput: mockOnOutput,
        onAllSelectorFilesSaved: mockOnAllSelectorFilesSaved,
      });

      // Update source URLs with 2 images
      manager.updateSourceUrls(['https://example.com/img1.jpg', 'https://example.com/img2.jpg']);

      // Save first image
      manager.responseCompleted(
        { url: 'https://example.com/img1.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test1'), headers: {} }
      );

      // Callback should NOT be called yet
      expect(mockOnAllSelectorFilesSaved).not.toHaveBeenCalled();

      // Save second image
      manager.responseCompleted(
        { url: 'https://example.com/img2.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test2'), headers: {} }
      );

      // Callback should now be called
      expect(mockOnAllSelectorFilesSaved).toHaveBeenCalled();
    });

    it('should not call callback if selector is not set', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputDir: './output',
        onOutput: mockOnOutput,
        onAllSelectorFilesSaved: mockOnAllSelectorFilesSaved,
      });

      manager.responseCompleted(
        { url: 'https://example.com/test.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      // Callback should never be called without selector
      expect(mockOnAllSelectorFilesSaved).not.toHaveBeenCalled();
    });

    it('should not call callback when no files match selector', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputDir: './output',
        onOutput: mockOnOutput,
        onAllSelectorFilesSaved: mockOnAllSelectorFilesSaved,
      });

      // Update with an empty URL list (no matching images)
      manager.updateSourceUrls([]);

      // Callback should not be called (sourceUrls is empty)
      expect(mockOnAllSelectorFilesSaved).not.toHaveBeenCalled();
    });

    it('should not call callback if onAllSelectorFilesSaved is not provided', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputDir: './output',
        onOutput: mockOnOutput,
        // No onAllSelectorFilesSaved callback
      });

      manager.updateSourceUrls(['https://example.com/img.jpg']);

      manager.responseCompleted(
        { url: 'https://example.com/img.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      // Should not throw or call undefined callback
      expect(mockOnOutput).toHaveBeenCalledWith('https://example.com/img.jpg');
    });
  });

  describe('hasPendingSelectorFiles', () => {
    it('should return true when there are unsaved selector files', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputDir: './output',
        onOutput: mockOnOutput,
      });

      // Update source URLs with 2 images
      manager.updateSourceUrls(['https://example.com/img1.jpg', 'https://example.com/img2.jpg']);

      // Both files are pending (not yet saved)
      expect(manager.hasPendingSelectorFiles()).toBe(true);

      // Save one file
      manager.responseCompleted(
        { url: 'https://example.com/img1.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test1'), headers: {} }
      );

      // Still has pending files
      expect(manager.hasPendingSelectorFiles()).toBe(true);

      // Save second file
      manager.responseCompleted(
        { url: 'https://example.com/img2.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test2'), headers: {} }
      );

      // No pending files now
      expect(manager.hasPendingSelectorFiles()).toBe(false);
    });

    it('should return false when selector is not set', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputDir: './output',
        onOutput: mockOnOutput,
      });

      expect(manager.hasPendingSelectorFiles()).toBe(false);
    });

    it('should return false when no source URLs exist', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputDir: './output',
        onOutput: mockOnOutput,
      });

      // No source URL update yet
      expect(manager.hasPendingSelectorFiles()).toBe(false);

      // Empty URL list
      manager.updateSourceUrls([]);
      expect(manager.hasPendingSelectorFiles()).toBe(false);
    });

    it('should return false when all files are already saved initially', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputDir: './output',
        onOutput: mockOnOutput,
      });

      // Update source URLs
      manager.updateSourceUrls(['https://example.com/img.jpg']);

      // Immediately save the file
      manager.responseCompleted(
        { url: 'https://example.com/img.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      expect(manager.hasPendingSelectorFiles()).toBe(false);
    });

    it('should return false when no selector is configured', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        outputDir: './output',
        onOutput: mockOnOutput,
      });

      manager.responseCompleted(
        { url: 'https://example.com/test.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      expect(manager.hasPendingSelectorFiles()).toBe(false);
    });
  });

  describe('stable sequence numbering (virtualized scroll)', () => {
    const writes = () =>
      vi
        .mocked(fs.writeFileSync)
        .mock.calls.map(([filepath, body]) => [filepath as string, (body as Buffer).toString()]);

    const respond = (m: OutputManager, url: string, body: string) =>
      m.responseCompleted(
        { url, method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from(body), headers: {} }
      );

    it('should keep stable sequences across extractions and not overwrite saved files', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: '.reader__page',
        outputDir: './output',
        renameSequence: '03d',
        onOutput: mockOnOutput,
      });

      // Initial window: cover, page1, page2
      manager.updateSourceUrls([
        'https://cdn.example/cover.jpg',
        'https://cdn.example/page1.jpg',
        'https://cdn.example/page2.jpg',
      ]);
      respond(manager, 'https://cdn.example/cover.jpg', 'cover');
      respond(manager, 'https://cdn.example/page1.jpg', 'page1');
      respond(manager, 'https://cdn.example/page2.jpg', 'page2');

      expect(writes()).toEqual([
        ['./output/000.jpg', 'cover'],
        ['./output/001.jpg', 'page1'],
        ['./output/002.jpg', 'page2'],
      ]);

      // After scrolling: page1/page2 removed from the DOM, new pages appended
      manager.updateSourceUrls([
        'https://cdn.example/cover.jpg',
        'https://cdn.example/page3.jpg',
        'https://cdn.example/page4.jpg',
      ]);
      respond(manager, 'https://cdn.example/page3.jpg', 'page3');
      respond(manager, 'https://cdn.example/page4.jpg', 'page4');

      // New pages get the next sequence numbers; already-saved files are
      // never overwritten
      expect(writes()).toEqual([
        ['./output/000.jpg', 'cover'],
        ['./output/001.jpg', 'page1'],
        ['./output/002.jpg', 'page2'],
        ['./output/003.jpg', 'page3'],
        ['./output/004.jpg', 'page4'],
      ]);
    });

    it('should still process responses for URLs that scrolled out of the DOM', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputDir: './output',
        renameSequence: '03d',
        onOutput: mockOnOutput,
      });

      manager.updateSourceUrls(['https://cdn.example/page1.jpg']);
      // page1 evicted from the DOM before its response arrives
      manager.updateSourceUrls(['https://cdn.example/page2.jpg']);

      respond(manager, 'https://cdn.example/page1.jpg', 'page1');
      respond(manager, 'https://cdn.example/page2.jpg', 'page2');

      expect(writes()).toEqual([
        ['./output/000.jpg', 'page1'],
        ['./output/001.jpg', 'page2'],
      ]);
    });

    it('should keep pending state cumulative across extractions', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        outputDir: './output',
        onOutput: mockOnOutput,
        onAllSelectorFilesSaved: mockOnAllSelectorFilesSaved,
      });

      manager.updateSourceUrls(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
      respond(manager, 'https://cdn.example/a.jpg', 'a');
      // b still pending
      expect(manager.hasPendingSelectorFiles()).toBe(true);

      // a/b evicted from the DOM, c added; b's response then arrives
      manager.updateSourceUrls(['https://cdn.example/c.jpg']);
      respond(manager, 'https://cdn.example/b.jpg', 'b');
      expect(manager.hasPendingSelectorFiles()).toBe(true); // c still pending
      expect(mockOnAllSelectorFilesSaved).not.toHaveBeenCalled();

      respond(manager, 'https://cdn.example/c.jpg', 'c');
      expect(manager.hasPendingSelectorFiles()).toBe(false);
      expect(mockOnAllSelectorFilesSaved).toHaveBeenCalled();
    });
  });
});
