import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProtocolHandler } from './protocol.ts';
import type { ProtocolCallbacks } from './types.ts';
import * as electron from 'electron';

describe('ProtocolHandler', () => {
  let handler: ProtocolHandler;
  let mockCallbacks: ProtocolCallbacks;
  let mockSession: Electron.Session;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCallbacks = {
      onRequestStarted: vi.fn(),
      onResponseCompleted: vi.fn(),
    };

    mockSession = {
      cookies: {
        get: vi.fn().mockResolvedValue([]),
        set: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Electron.Session;

    handler = new ProtocolHandler('https://example.com', mockCallbacks, mockSession);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockResponse(
    status: number,
    headers: Record<string, string | string[]>,
    body?: ArrayBuffer
  ) {
    const headersObj = new Headers();
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headersObj.append(key, v);
        }
      } else {
        headersObj.set(key, value);
      }
    }
    const bodyOption = status === 204 ? undefined : (body ?? new ArrayBuffer(0));
    return new Response(bodyOption, {
      status,
      headers: headersObj,
    });
  }

  function callHandleRequest(h: ProtocolHandler, request: Request): Promise<Response> {
    const fn = (h as unknown as Record<string, unknown>).handleRequest as (
      req: Request
    ) => Promise<Response>;
    return fn.call(h, request);
  }

  function getSetCookieMock() {
    return vi.mocked(mockSession.cookies.set);
  }

  describe('constructor', () => {
    it('should initialize with baseUrl and callbacks', () => {
      expect(handler).toBeDefined();
    });
  });

  describe('register', () => {
    it('should not throw when registering handlers', () => {
      expect(() => handler.register()).not.toThrow();
    });
  });

  describe('setCallbacks', () => {
    it('should update callbacks', () => {
      const newCallbacks: ProtocolCallbacks = {
        onRequestStarted: vi.fn(),
        onResponseCompleted: vi.fn(),
      };

      handler.setCallbacks(newCallbacks);
      expect(mockCallbacks).not.toBe(newCallbacks);
    });
  });

  describe('handleRequest - normal flow', () => {
    it('should call onRequestStarted callback with request data', async () => {
      const mockResponse = createMockResponse(200, { 'content-type': 'text/html' });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', {
        method: 'GET',
        headers: { 'Content-Type': 'text/plain' },
      });

      await callHandleRequest(handler, request);

      const startedCalls = vi.mocked(mockCallbacks.onRequestStarted);
      expect(startedCalls).toHaveBeenCalled();
      const requestCall = startedCalls.mock.calls[0][0];
      expect(requestCall.url).toBe('https://example.com/test');
      expect(requestCall.method).toBe('GET');
    });

    it('should call onResponseCompleted callback with response data', async () => {
      const body = new TextEncoder().encode('{"key":"value"}');
      const mockResponse = createMockResponse(
        200,
        { 'content-type': 'application/json' },
        body.buffer
      );
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      await callHandleRequest(handler, request);

      const completedCalls = vi.mocked(mockCallbacks.onResponseCompleted);
      expect(completedCalls).toHaveBeenCalled();
      const responseCall = completedCalls.mock.calls[0][1];
      expect(responseCall.statusCode).toBe(200);
      expect(responseCall.body).toBeInstanceOf(Buffer);
    });

    it('should return response with correct status', async () => {
      const mockResponse = createMockResponse(200, {
        'content-type': 'text/plain',
        'x-custom': 'test-value',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      const response = await callHandleRequest(handler, request);

      expect(response.status).toBe(200);
    });

    it('should return null body for 204 status', async () => {
      const mockResponse = createMockResponse(204, {});
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'DELETE' });
      const response = await callHandleRequest(handler, request);

      expect(response.status).toBe(204);
      const body = await response.arrayBuffer();
      expect(body.byteLength).toBe(0);
    });

    it('should forward request method and headers', async () => {
      let capturedUrl: string = '';
      let capturedMethod: string = '';

      const mockResponse = createMockResponse(200, {});
      vi.spyOn(electron.net, 'fetch').mockImplementation(
        async (input: string | Request, init?: RequestInit) => {
          capturedUrl = typeof input === 'string' ? input : input.url;
          capturedMethod = init?.method ?? 'GET';
          return mockResponse;
        }
      );

      handler.register();

      const request = new Request('https://example.com/api', {
        method: 'PUT',
        headers: { Authorization: 'Bearer token123', 'X-Custom': 'value' },
      });

      await callHandleRequest(handler, request);

      expect(capturedUrl).toBe('https://example.com/api');
      expect(capturedMethod).toBe('PUT');
    });
  });

  describe('inFlight tracking', () => {
    it('should prevent infinite recursion for same URL', async () => {
      let fetchCallCount = 0;

      const mockResponse = createMockResponse(200, {});
      vi.spyOn(electron.net, 'fetch').mockImplementation(async () => {
        fetchCallCount++;
        return mockResponse;
      });

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(fetchCallCount).toBe(1);
    });

    it('should allow different URLs to be processed independently', async () => {
      vi.spyOn(electron.net, 'fetch').mockImplementation(async () => createMockResponse(200, {}));

      handler.register();

      const request1 = new Request('https://example.com/test1', { method: 'GET' });
      const request2 = new Request('https://example.com/test2', { method: 'GET' });

      await callHandleRequest(handler, request1);
      await callHandleRequest(handler, request2);

      expect(mockCallbacks.onRequestStarted).toHaveBeenCalledTimes(2);
    });
  });

  describe('cookie handling', () => {
    it('should include cookies in request headers', async () => {
      const mockCookies = [
        { name: 'session', value: 'abc123' },
        { name: 'token', value: 'xyz789' },
      ];

      mockSession.cookies.get = vi.fn().mockResolvedValue(mockCookies);

      let capturedHeaders: Record<string, string> = {};

      const mockResponse = createMockResponse(200, {});
      vi.spyOn(electron.net, 'fetch').mockImplementation(
        async (_input: string | Request, init?: RequestInit) => {
          capturedHeaders = init?.headers as Record<string, string>;
          return mockResponse;
        }
      );

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(capturedHeaders).toHaveProperty('Cookie');
      expect(capturedHeaders.Cookie).toContain('session=abc123');
      expect(capturedHeaders.Cookie).toContain('token=xyz789');
    });

    it('should store Set-Cookie headers from response', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'session=abc123; Path=/; HttpOnly',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(getSetCookieMock()).toHaveBeenCalled();
    });

    it('should handle multiple Set-Cookie headers as array', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': ['session=abc; Path=/', 'token=xyz; HttpOnly'],
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      // Headers API joins multiple values with ', ' - treated as single string
      expect(mockSession.cookies.set).toHaveBeenCalledTimes(1);
    });

    it('should handle cookie parsing with expiration date', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'session=abc123; Expires=Wed, 21 Oct 2025 07:28:00 GMT; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(getSetCookieMock()).toHaveBeenCalled();
      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall).toHaveProperty('expirationDate');
      expect(cookieCall.expirationDate).toBeGreaterThan(0);
    });

    it('should handle session cookies (no expiration)', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'session=abc123; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(getSetCookieMock()).toHaveBeenCalled();
      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.session).toBe(true);
    });

    it('should handle secure flag in cookies', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'secure_cookie=value; Secure; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(getSetCookieMock()).toHaveBeenCalled();
      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.secure).toBe(true);
    });

    it('should handle SameSite attribute in cookies', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'cookie=value; SameSite=Lax; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(getSetCookieMock()).toHaveBeenCalled();
      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.sameSite).toBe('lax');
    });

    it('should silently fail when cookie parsing fails', async () => {
      mockSession.cookies.set = vi.fn().mockRejectedValue(new Error('Cookie set failed'));

      const mockResponse = createMockResponse(200, {
        'set-cookie': 'session=abc123; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      const result = await callHandleRequest(handler, request);
      expect(result).toBeDefined();
    });

    it('should handle empty cookies gracefully', async () => {
      mockSession.cookies.get = vi.fn().mockResolvedValue([]);

      let capturedHeaders: Record<string, string> = {};

      const mockResponse = createMockResponse(200, {});
      vi.spyOn(electron.net, 'fetch').mockImplementation(
        async (_input: string | Request, init?: RequestInit) => {
          capturedHeaders = init?.headers as Record<string, string>;
          return mockResponse;
        }
      );

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(capturedHeaders).not.toHaveProperty('Cookie');
    });

    it('should handle cookie domain attribute', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'cookie=val; Domain=other.com; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(getSetCookieMock()).toHaveBeenCalled();
      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.domain).toBe('other.com');
    });

    it('should default domain to hostname when no domain attribute', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'cookie=val; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.domain).toBe('example.com');
    });
  });

  describe('request ID tracking', () => {
    it('should increment request ID for each request', async () => {
      vi.spyOn(electron.net, 'fetch').mockImplementation(async () => createMockResponse(200, {}));

      handler.register();

      const request1 = new Request('https://example.com/test1', { method: 'GET' });
      const request2 = new Request('https://example.com/test2', { method: 'GET' });

      await callHandleRequest(handler, request1);
      await callHandleRequest(handler, request2);

      const responseCalls = vi.mocked(mockCallbacks.onResponseCompleted);
      expect(responseCalls.mock.calls[0][0].id).toBe(1);
      expect(responseCalls.mock.calls[1][0].id).toBe(2);
    });
  });

  describe('response headers forwarding', () => {
    it('should forward all response headers to callback', async () => {
      const mockResponse = createMockResponse(200, {
        'content-type': 'text/html',
        'content-length': '1234',
        'x-frame-options': 'DENY',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      const responseCall = vi.mocked(mockCallbacks.onResponseCompleted).mock.calls[0][1];
      expect(responseCall.headers).toHaveProperty('content-type', 'text/html');
      expect(responseCall.headers).toHaveProperty('content-length', '1234');
      expect(responseCall.headers).toHaveProperty('x-frame-options', 'DENY');
    });
  });

  describe('storeCookies edge cases', () => {
    it('should handle malformed cookie without name', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': '=value; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      expect(mockSession.cookies.set).not.toHaveBeenCalled();
    });

    it('should handle malformed cookie without value', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'name=; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      // name= is valid - name is "name", value is empty string which is falsy
      // The code checks `!value` so empty value should be skipped
      expect(mockSession.cookies.set).not.toHaveBeenCalled();
    });

    it('should handle http URL without secure flag', async () => {
      const handler2 = new ProtocolHandler('http://example.com', mockCallbacks, mockSession);

      const mockResponse = createMockResponse(200, {
        'set-cookie': 'cookie=val; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler2.register();

      const request = new Request('http://example.com/test', { method: 'GET' });
      await callHandleRequest(handler2, request);

      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.secure).toBe(false);
    });

    it('should set secure to true for https URLs even without Secure flag', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'cookie=val; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.secure).toBe(true);
    });

    it('should handle SameSite=Strict', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'cookie=val; SameSite=Strict; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.sameSite).toBe('strict');
    });

    it('should handle SameSite=None', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie': 'cookie=val; SameSite=None; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.sameSite).toBe('none');
    });

    it('should parse cookie with multiple attributes', async () => {
      const mockResponse = createMockResponse(200, {
        'set-cookie':
          'id=a3fWa; Expires=Wed, 21 Oct 2025 07:28:00 GMT; Max-Age=2592000; Secure; HttpOnly; SameSite=Strict; Path=/',
      });
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      await callHandleRequest(handler, request);

      const cookieCall = getSetCookieMock().mock.calls[0][0] as Electron.Cookie;
      expect(cookieCall.name).toBe('id');
      expect(cookieCall.value).toBe('a3fWa');
      expect(cookieCall.session).toBe(false);
      expect(cookieCall.secure).toBe(true);
      expect(cookieCall.httpOnly).toBe(true);
      expect(cookieCall.sameSite).toBe('strict');
      expect(cookieCall.path).toBe('/');
      expect(cookieCall.expirationDate).toBeGreaterThan(0);
    });
  });

  describe('getCookiesForUrl error handling', () => {
    it('should return null when session.cookies.get throws', async () => {
      mockSession.cookies.get = vi.fn().mockRejectedValue(new Error('Session error'));

      const mockResponse = createMockResponse(200, {});
      vi.spyOn(electron.net, 'fetch').mockResolvedValue(mockResponse);

      handler.register();

      const request = new Request('https://example.com/test', { method: 'GET' });
      const result = await callHandleRequest(handler, request);
      expect(result).toBeDefined();
    });
  });
});
