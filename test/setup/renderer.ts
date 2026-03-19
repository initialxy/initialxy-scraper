import { vi } from 'vitest';

// Mock ipcRenderer for renderer process tests
vi.mock('electron', () => ({
  ipcRenderer: {
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn(),
    receive: vi.fn(),
  },
}));

// Vitest handles cleanup automatically between tests
