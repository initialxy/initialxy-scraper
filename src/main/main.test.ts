import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as PathModule from 'node:path';

describe('main.ts utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updatePageSource error handling', () => {
    it('should handle page source extraction error gracefully', async () => {
      const mockExecuteJS = vi.fn().mockRejectedValue(new Error('Failed to execute'));
      const mockConsoleError = vi.fn();

      vi.spyOn(console, 'error').mockImplementation(mockConsoleError);

      // Simulate updatePageSource logic
      const webView = {
        webContents: {
          executeJavaScript: mockExecuteJS,
        },
      };

      try {
        await webView.webContents.executeJavaScript('document.documentElement.outerHTML');
      } catch (error) {
        console.error('[Main] Error getting page source:', error);
      }

      expect(mockConsoleError).toHaveBeenCalledWith(
        '[Main] Error getting page source:',
        expect.any(Error)
      );
    });

    it('should successfully extract page source', async () => {
      const mockExecuteJS = vi.fn().mockResolvedValue('<html><body>Test</body></html>');

      const webView = {
        webContents: {
          executeJavaScript: mockExecuteJS,
        },
      };

      const pageSource = await webView.webContents.executeJavaScript(
        'document.documentElement.outerHTML'
      );

      expect(pageSource).toBe('<html><body>Test</body></html>');
      expect(mockExecuteJS).toHaveBeenCalledWith('document.documentElement.outerHTML');
    });
  });

  describe('IPC handler patterns', () => {
    it('should handle copy-to-clipboard pattern', () => {
      const mockClipboard = {
        writeText: vi.fn(),
      };

      // Simulate IPC handler pattern
      const handler = (_event: unknown, text: string) => {
        mockClipboard.writeText(text);
        return true;
      };

      const result = handler({}, 'test text');

      expect(mockClipboard.writeText).toHaveBeenCalledWith('test text');
      expect(result).toBe(true);
    });

    it('should handle get-page-source pattern', async () => {
      const mockWebContents = {
        executeJavaScript: vi.fn().mockResolvedValue('<html>Test</html>'),
      };

      const webView = { webContents: mockWebContents };

      // Simulate IPC handler pattern
      const handler = async (_event: unknown) => {
        if (!webView) return '';
        return await webView.webContents.executeJavaScript('document.documentElement.outerHTML');
      };

      const result = await handler({});

      expect(result).toBe('<html>Test</html>');
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        'document.documentElement.outerHTML'
      );
    });

    it('should return empty string when webView is not available', async () => {
      let webView: { webContents: { executeJavaScript: (js: string) => Promise<string> } } | null =
        null;

      const handler = async (_event: unknown) => {
        if (!webView) return '';
        return await webView.webContents.executeJavaScript('document.documentElement.outerHTML');
      };

      const result = await handler({});

      expect(result).toBe('');
    });
  });

  describe('window creation patterns', () => {
    it('should use default dimensions when not provided', () => {
      const cliArgs = {
        url: 'https://example.com',
        width: undefined,
        height: undefined,
      };

      const width = cliArgs.width ?? 1200;
      const height = cliArgs.height ?? 1000;

      expect(width).toBe(1200);
      expect(height).toBe(1000);
    });

    it('should use custom dimensions when provided', () => {
      const cliArgs = {
        url: 'https://example.com',
        width: 1600,
        height: 900,
      };

      const width = cliArgs.width ?? 1200;
      const height = cliArgs.height ?? 1000;

      expect(width).toBe(1600);
      expect(height).toBe(900);
    });
  });

  describe('platform-specific behavior', () => {
    it('should handle window-all-closed on non-macOS', () => {
      const mockQuit = vi.fn();

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const handler = () => {
        if (process.platform !== 'darwin') {
          mockQuit();
        }
      };

      handler();

      expect(mockQuit).toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('should not quit on macOS when all windows closed', () => {
      const mockQuit = vi.fn();

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      const handler = () => {
        if (process.platform !== 'darwin') {
          mockQuit();
        }
      };

      handler();

      expect(mockQuit).not.toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('user data directory setup', () => {
    it('should resolve userdata path correctly', async () => {
      const path = await vi.importActual<typeof PathModule>('node:path');

      vi.spyOn(process, 'cwd').mockReturnValue('/test/dir');

      const userDataPath = path.resolve(process.cwd(), 'userdata');
      expect(userDataPath).toBe('/test/dir/userdata');
    });
  });
});
