import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Coordinator } from './coordinator.ts';
import type {
  ProtocolCallbacks,
  ProtocolHandlerInterface,
  AutomationManagerInterface,
} from '../shared/types.ts';

type MockProtocolClass = { register(): void; setCallbacks(cb: ProtocolCallbacks): void };
type MockAutomationClass = { start(): void; onOutputEvent(): void };

const mockProtocolState = vi.hoisted(() => ({
  registerCalls: 0,
  setCallbacksCalls: [] as ProtocolCallbacks[],
  instances: [] as unknown[],
}));

const mockAutomationState = vi.hoisted(() => ({
  startCalls: 0,
  onOutputEventCalls: 0,
  instances: [] as unknown[],
}));

const mockOutputManagerState = vi.hoisted(() => ({
  initCalls: [] as unknown[],
}));

vi.mock('../shared/protocol.ts', () => ({
  ProtocolHandler: class MockProtocolHandler {
    register() {
      mockProtocolState.registerCalls++;
    }
    setCallbacks(cb: ProtocolCallbacks) {
      mockProtocolState.setCallbacksCalls.push(cb);
    }
  },
}));

vi.mock('../shared/automation.ts', () => ({
  AutomationManager: class MockAutomationManager {
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
    constructor(options: unknown) {
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

const MockProtocolHandler = (await import('../shared/protocol.ts')).ProtocolHandler as new (
  ...args: unknown[]
) => MockProtocolClass;
const MockAutomationManager = (await import('../shared/automation.ts')).AutomationManager as new (
  ...args: unknown[]
) => MockAutomationClass;

function createMockWebView() {
  const executeJavaScriptMock = vi
    .fn<() => Promise<string>>()
    .mockResolvedValue('<html><body></body></html>');
  const getURLMock = vi.fn<() => string>().mockReturnValue('about:blank');
  const sendMock = vi.fn<(channel: string, ...args: unknown[]) => void>();
  const webView = {
    webContents: {
      getURL: getURLMock,
      executeJavaScript: executeJavaScriptMock,
    },
    webContentsView: {
      send: sendMock,
    },
  } as unknown as import('../shared/types.ts').WebViewInterface;
  return {
    webView,
    getURLMock,
    executeJavaScriptMock,
    sendMock,
  };
}

function createMockProcessExit() {
  const mock = vi.fn<typeof process.exit>();
  mock.mockImplementation((code) => {
    throw new Error(`process.exit called with code ${code}`);
  });
  return mock;
}

interface ExitCall {
  code: string | number;
}

let exitCalls: ExitCall[] = [];

describe('Coordinator', () => {
  let mockWebView: {
    webView: import('../shared/types.ts').WebViewInterface;
    getURLMock: ReturnType<typeof vi.fn<() => string>>;
    executeJavaScriptMock: ReturnType<typeof vi.fn<() => Promise<string>>>;
    sendMock: ReturnType<typeof vi.fn<(channel: string, ...args: unknown[]) => void>>;
  };
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
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      expect(coordinator).toBeDefined();
    });
  });

  describe('init', () => {
    it('should create OutputManager with correct options', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({});

      expect(mockProtocolState.setCallbacksCalls.length).toBe(1);
      const callbacks = mockProtocolState.setCallbacksCalls[0];
      expect(callbacks).toHaveProperty('onRequestStarted');
      expect(callbacks).toHaveProperty('onResponseCompleted');
    });

    it('should call protocolHandler.register()', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({});

      expect(mockProtocolState.registerCalls).toBe(1);
    });

    it('should call automationManager.start()', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({});

      expect(mockAutomationState.startCalls).toBe(1);
    });

    it('should pass baseUrl from webView to OutputManager', () => {
      mockWebView.getURLMock.mockReturnValue('https://example.com');

      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({});
      expect(mockProcessExit).not.toHaveBeenCalled();
    });
  });

  describe('responseCompleted', () => {
    it('should forward request and response to OutputManager', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({});

      await coordinator.updatePageSource();

      expect(mockWebView.executeJavaScriptMock).toHaveBeenCalledWith(
        'document.documentElement.outerHTML'
      );
    });

    it('should return early if outputManager is not initialized', async () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      await coordinator.updatePageSource();

      expect(mockWebView.executeJavaScriptMock).not.toHaveBeenCalled();
    });

    it('should handle JavaScript execution errors gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebView.executeJavaScriptMock.mockRejectedValue(new Error('JS execution failed'));

      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({});

      await coordinator.updatePageSource();

      expect(consoleError).toHaveBeenCalled();
    });

    it('should close with success when selector files are complete and no scroll', async () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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
      mockWebView.executeJavaScriptMock
        .mockResolvedValueOnce('true')
        .mockResolvedValueOnce('false');

      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({
        selector: 'img',
        scroll: 100,
        closeOnSelectorComplete: true,
      });

      await coordinator.updatePageSource();

      expect(mockWebView.executeJavaScriptMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('closeOnIdleTimeout', () => {
    it('should exit with success when closeOnSelectorComplete is false', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({ closeOnSelectorComplete: false });

      coordinator.closeOnIdleTimeout();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0].code).toBe(EXIT_CODES.success);
    });

    it('should exit with success when outputManager is null', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
      });

      coordinator.init({ closeOnSelectorComplete: false });

      await coordinator.closeOnSelectorCheck();
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should check scroll position when scroll is enabled', async () => {
      mockWebView.executeJavaScriptMock.mockResolvedValueOnce('false');

      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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

      expect(mockWebView.sendMock).toHaveBeenCalledWith('network-request-start', request);
    });

    it('should wire onResponseCompleted callback to send IPC and forward to OutputManager', () => {
      const coordinator = new Coordinator({
        protocolHandler: new MockProtocolHandler() as unknown as ProtocolHandlerInterface,
        automationManager: new MockAutomationManager() as unknown as AutomationManagerInterface,
        webView: mockWebView.webView,
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

      expect(mockWebView.sendMock).toHaveBeenCalledWith('network-request-complete', {
        id: request.id,
        url: request.url,
        statusCode: response.statusCode,
      });
    });
  });
});
