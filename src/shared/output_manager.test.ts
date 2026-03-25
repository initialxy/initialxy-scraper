import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { OutputManager } from './output_manager.ts';

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
  let mockStdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Spy on process.stdout.write to capture output
    mockStdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnOutput = vi.fn<(url: string) => void>();
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

      // First update page source to set up sourceUrls
      const pageSource = '<img src="https://example.com/existing.jpg">';
      manager.updatePageSource(pageSource);

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

  describe('updatePageSource', () => {
    it('should process buffered responses when page source matches selector', () => {
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

      // Update with matching page source
      const pageSource = '<img src="https://example.com/image.jpg">';
      manager.updatePageSource(pageSource);

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

      // Buffer a response for a URL not in page source
      manager.responseCompleted(
        { url: 'https://example.com/not-in-page.jpg', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from('test'), headers: {} }
      );

      const pageSource = '<img src="https://example.com/other.jpg">';
      manager.updatePageSource(pageSource);

      // Should NOT call onOutput since URL doesn't match
      expect(mockOnOutput).not.toHaveBeenCalled();
    });

    it('should handle empty page source', () => {
      manager = new OutputManager({
        baseUrl: 'https://example.com',
        selector: 'img',
        onOutput: mockOnOutput,
      });

      manager.updatePageSource('');
      expect(mockOnOutput).not.toHaveBeenCalled();
    });

    it('should extract from data-src attribute', () => {
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

      const pageSource = '<img data-src="https://example.com/lazy.jpg">';
      manager.updatePageSource(pageSource);

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

      const pageSource = '<img src="https://example.com/test.jpg">';
      manager.updatePageSource(pageSource);

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
});
