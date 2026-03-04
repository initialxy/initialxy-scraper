// General purpose constants
export const MS_IN_S = 1000;
export const MILD_DELAY_MS = 100;

// IPC Channel constants
export const IPC_CHANNELS = {
  // Network monitoring
  networkRequestStart: 'network-request-start',
  networkRequestComplete: 'network-request-complete',
  // Clipboard
  copyToClipboard: 'copy-to-clipboard',
  // Page source
  getPageSource: 'get-page-source',
} as const;

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// HTTP responses without body
export const RESPONSE_WITHOUT_BODY = new Set([204, 304]);
