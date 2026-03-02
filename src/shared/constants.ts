// IPC Channel constants

export const IPC_CHANNELS = {
  // Network monitoring
  networkRequestStart: 'network-request-start',
  networkRequestComplete: 'network-request-complete',
  // Clipboard
  copyToClipboard: 'copy-to-clipboard',
  // Page source
  getPageSource: 'get-page-source',
  // Automation
  applySelector: 'apply-selector',
  scrollPage: 'scroll-page',
  checkSourceCompleted: 'check-source-completed',
  markSourceCompleted: 'mark-source-completed',
  getCompletedStatus: 'get-completed-status',
} as const;

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
