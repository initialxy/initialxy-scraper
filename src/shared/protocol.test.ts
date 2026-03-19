import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProtocolHandler } from './protocol.ts';
import type { ProtocolCallbacks } from './types.ts';

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with baseUrl and callbacks', () => {
      handler = new ProtocolHandler('https://example.com', mockCallbacks, mockSession);
      expect(handler).toBeDefined();
    });
  });

  describe('register', () => {
    it('should not throw when registering handlers', () => {
      handler = new ProtocolHandler('https://example.com', mockCallbacks, mockSession);

      // register should not throw
      expect(() => handler.register()).not.toThrow();
    });
  });
});
