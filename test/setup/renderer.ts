import { vi } from 'vitest'

// Mock ipcRenderer for renderer process tests
vi.mock('electron', () => ({
  ipcRenderer: {
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn(),
    receive: vi.fn(),
  },
}))

// Setup testing-library cleanup
import { cleanup } from '@testing-library/dom'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
