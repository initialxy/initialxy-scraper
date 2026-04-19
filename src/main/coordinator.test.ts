import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Coordinator } from './coordinator.ts';

const mockProtocolState = vi.hoisted(() => ({
  registerCalls: 0,
  setCallbacksCalls: [] as any[],
  instances: [] as any[],
}));

const mockAutomationState = vi.hoisted(() => ({
  startCalls: 0,
  onOutputEventCalls: 0,
  instances: [] as any[],
}));

const mockOutputManagerState = vi.hoisted(() => ({
  initCalls: [] as any[],
}));

vi.mock('../shared/protocol.ts', () => ({
  ProtocolHandler: class MockProtocolHandler {
    constructor() {
      mockProtocolState.instances.push(this);
    }
    register() {
      mockProtocolState.registerCalls++;
    }
    setCallbacks(cb: any) {
      mockProtocolState.setCallbacksCalls.push(cb);
    }
  },
}));

vi.mock('../shared/automation.ts', () => ({
  AutomationManager: class MockAutomationManager {
    constructor() {
      mockAutomationState.instances.push(this);
    }
    start() {
      mockAutomationState.startCalls++;
    }
    onOutputEvent() {
      mockAutomationState.onOutputEventCalls++;
    }
  },
}));

vi.mock('../shared/output_manager.ts', () => ({
  OutputManager: class MockOutputManager {
    constructor(options: any) {
      mockOutputManagerState.initCalls.push(options);
    }
    responseCompleted() {}
    updatePageSource() {}
    hasPendingSelectorFiles() {
      return false;
    }
  },
}));

const { EXIT_CODES } = await import('../shared/constants.ts');

const MockProtocolHandler = (await import('../shared/protocol.ts')).ProtocolHandler as new (...args: unknown[]) => unknown;
const MockAutomationManager = (await import('../shared/automation.ts')).AutomationManager as new (...args: unknown[]) => unknown;

function createMockWebView() {
  return {
    webContents: {
      getURL: vi.fn(() => 'about:blank') as any,
      executeJavaScript: vi.fn(async () => '<html><body></body></html>') as any,
    },
    webContentsView: {
      send: vi.fn() as any,
    },
  } as unknown as import('../shared/types.ts').WebViewInterface;
}

function createMockProcessExit() {
  const mock = vi.fn<typeof process.exit>();
  mock.mockImplementation((code) => {
    throw new Error(`process.exit called with code ${code}`);
  });
  return mock;
}

let exitCalls: { code: any }[] = [];

describe('Coordinator', () => {
  let mockWebView: ReturnType<typeof createMockWebView>;
  let mockProcessExit: ReturnType<typeof createMockProcessExit>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockProtocolState.registerCalls = 0;
    mockProtocolState.setCallbacksCalls = [];
    mockProtocolState.instances = [];
    mockAutomationState.startCalls = 0;
    mockAutomationState.onOutputEventCalls = 0;
    mockAutomationState.instances = [];

    // Capture ALL process.exit calls
    exitCalls = [];
    const mockExit = createMockProcessExit();
    // Don't throw - just record via exitCalls
    (mockExit.mockImplementation as (fn: (code: string | number) => void) => void)((code) => {
      exitCalls.push({ code });
    });
    process.exit = mockExit as never;

    mockProcessExit = mockExit;
    mockWebView = createMockWebView();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.exit = globalThis.process.exit;
  });

  describe('constructor', () => {
    it('should initialize with injected dependencies', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      expect(coordinator).toBeDefined();
    });
  });

  describe('init', () => {
    it('should create OutputManager with correct options', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({
        outputDir: './output',
        selector: 'img',
        filter: /test/,
        renameSequence: '05d',
        outputCurl: true,
        flatDir: true,
      });

      expect(mockOutputManagerState.initCalls.length).toBe(1);
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should call protocolHandler.setCallbacks with correct callbacks', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});

      expect(mockProtocolState.setCallbacksCalls.length).toBe(1);
      const callbacks = mockProtocolState.setCallbacksCalls[0];
      expect(callbacks).toHaveProperty('onRequestStarted');
      expect(callbacks).toHaveProperty('onResponseCompleted');
    });

    it('should call protocolHandler.register()', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});

      expect(mockProtocolState.registerCalls).toBe(1);
    });

    it('should call automationManager.start()', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});

      expect(mockAutomationState.startCalls).toBe(1);
    });

    it('should pass baseUrl from webView to OutputManager', () => {
      (mockWebView.webContents.getURL as any).mockReturnValue('https://example.com');

      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});
      expect(mockProcessExit).not.toHaveBeenCalled();
    });
  });

  describe('responseCompleted', () => {
    it('should forward request and response to OutputManager', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});

      const request = {
        id: 1,
        url: 'https://example.com/test.js',
        method: 'GET',
        headers: {},
      };
      const response = {
        statusCode: 200,
        body: Buffer.from('test'),
        headers: {},
      };

      coordinator.responseCompleted(request, response);
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should handle null outputManager gracefully', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.responseCompleted(
        { id: 1, url: 'test', method: 'GET', headers: {} },
        { statusCode: 200, body: Buffer.from(''), headers: {} }
      );
    });
  });

  describe('updatePageSource', () => {
    it('should execute JavaScript and pass result to OutputManager', async () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});

      await coordinator.updatePageSource();

      expect(mockWebView.webContents.executeJavaScript).toHaveBeenCalledWith(
        'document.documentElement.outerHTML'
      );
    });

    it('should return early if outputManager is not initialized', async () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      await coordinator.updatePageSource();

      expect(mockWebView.webContents.executeJavaScript).not.toHaveBeenCalled();
    });

    it('should handle JavaScript execution errors gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      (mockWebView.webContents.executeJavaScript as any).mockRejectedValue(new Error('JS execution failed'));

      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});

      await coordinator.updatePageSource();

      expect(consoleError).toHaveBeenCalled();
    });

    it('should close with success when selector files are complete and no scroll', async () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({
        selector: 'img',
        closeOnSelectorComplete: true,
      });

      await coordinator.updatePageSource();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0].code).toBe(EXIT_CODES.success);
    });

    it('should check scroll position when scroll is enabled', async () => {
      (mockWebView.webContents.executeJavaScript as any)
        .mockResolvedValueOnce('<html><body></body></html>')
        .mockResolvedValueOnce(false as unknown as string);

      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({
        selector: 'img',
        scroll: 100,
        closeOnSelectorComplete: true,
      });

      await coordinator.updatePageSource();

      expect(mockWebView.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
    });
  });

  describe('closeOnIdleTimeout', () => {
    it('should exit with success when closeOnSelectorComplete is false', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({ closeOnSelectorComplete: false });

      coordinator.closeOnIdleTimeout();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0].code).toBe(EXIT_CODES.success);
    });

    it('should exit with success when outputManager is null', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({ closeOnSelectorComplete: true });

      coordinator.closeOnIdleTimeout();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0].code).toBe(EXIT_CODES.success);
    });
  });

  describe('closeOnSelectorCheck', () => {
    it('should exit with success when all selector files are saved', async () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({
        selector: 'img',
        closeOnSelectorComplete: true,
      });

      await coordinator.closeOnSelectorCheck();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0].code).toBe(EXIT_CODES.success);
    });

    it('should not exit when closeOnSelectorComplete is false', async () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({ closeOnSelectorComplete: false });

      await coordinator.closeOnSelectorCheck();
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should check scroll position when scroll is enabled', async () => {
      (mockWebView.webContents.executeJavaScript as any).mockResolvedValueOnce(false as unknown as string);

      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({
        selector: 'img',
        scroll: 100,
        closeOnSelectorComplete: true,
      });

      await coordinator.closeOnSelectorCheck();
    });
  });

  describe('callback wiring', () => {
    it('should wire onRequestStarted callback to send IPC', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});

      const callbacks = mockProtocolState.setCallbacksCalls[0];
      const request = {
        id: 1,
        url: 'https://example.com/test.js',
        method: 'GET',
        headers: {},
      };

      callbacks.onRequestStarted(request);

      expect(mockWebView.webContentsView.send).toHaveBeenCalledWith(
        'network-request-start',
        request
      );
    });

    it('should wire onResponseCompleted callback to send IPC and forward to OutputManager', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as any,
        automationManager: new MockAutomationManager() as any,
        webView: mockWebView,
      });

      coordinator.init({});

      const callbacks = mockProtocolState.setCallbacksCalls[0];
      const request = {
        id: 1,
        url: 'https://example.com/test.js',
        method: 'GET',
        headers: {},
      };
      const response = {
        statusCode: 200,
        body: Buffer.from('test'),
        headers: {},
      };

      callbacks.onResponseCompleted(request, response);

      expect(mockWebView.webContentsView.send).toHaveBeenCalledWith('network-request-complete', {
        id: request.id,
        url: request.url,
        statusCode: response.statusCode,
      });
    });
  });
});
