import { vi } from 'vitest'

// Mock the electron module for main process tests
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/mock/${name}`),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
    setAppUserModelId: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
    focus: vi.fn(),
    getName: vi.fn(() => 'initialxy-scraper'),
  },
  BrowserWindow: vi.fn(() => ({
    id: 1,
    webContents: {
      id: 1,
      on: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
      executeJavaScript: vi.fn().mockResolvedValue(''),
      session: {
        cookies: {
          get: vi.fn().mockResolvedValue([]),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    },
    on: vi.fn(),
    close: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    setMenu: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
  })),
  ipcMain: {
    handle: vi.fn(),
    handleSync: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  protocol: {
    handle: vi.fn(),
    unregisterSchemeAsCancellable: vi.fn(),
  },
  net: {
    fetch: vi.fn(),
  },
  session: {
    fromPartition: vi.fn(() => ({
      cookies: {
        get: vi.fn().mockResolvedValue([]),
        set: vi.fn().mockResolvedValue(undefined),
      },
    })),
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workAreaSize: { width: 1920, height: 1080 },
    })),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({})),
  },
  Tray: vi.fn(() => ({
    on: vi.fn(),
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
  })),
  Menu: {
    buildFromTemplate: vi.fn(() => ({})),
  },
}))
