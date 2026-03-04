import { generateCurl, generateFFmpegCommand, isM3u8 } from '../../shared/cross_stack_utils.ts';
import type { NetworkRequest } from '../../shared/types.ts';

interface Api {
  onNetworkRequestStart: (callback: (data: NetworkRequest) => void) => void;
  onNetworkRequestComplete: (callback: (data: NetworkRequest) => void) => void;
  copyToClipboard: (text: string) => Promise<void>;
  getPageSource: () => Promise<string>;
}

declare global {
  interface Window {
    api: Api;
  }
}

class NetworkMonitor {
  private requestList: HTMLElement;
  private filterInput: HTMLInputElement;
  private copySourceBtn: HTMLButtonElement;
  private toast: HTMLElement;
  private requests: Map<number, { row: HTMLElement; data: NetworkRequest }>;

  constructor() {
    this.requestList = document.querySelector('.request-list')!;
    this.filterInput = document.querySelector('.filter-input')!;
    this.copySourceBtn = document.querySelector('.copy-source-btn')!;
    this.toast = document.querySelector('.toast')!;
    this.requests = new Map();

    this.initializeEventListeners();
    this.setupIPCListeners();
  }

  private initializeEventListeners(): void {
    // Filter input
    this.filterInput.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const filter = target.value.toLowerCase();
      this.requests.forEach((req) => {
        const matches = req.data.url.toLowerCase().includes(filter);
        req.row.style.display = matches ? 'block' : 'none';
      });
    });

    // Copy page source button
    this.copySourceBtn.addEventListener('click', async () => {
      const source = await window.api.getPageSource();
      await window.api.copyToClipboard(source);

      this.showToast('Page source copied to clipboard');
      this.copySourceBtn.classList.add('copied');
      setTimeout(() => this.copySourceBtn.classList.remove('copied'), 300);
    });
  }

  private setupIPCListeners(): void {
    // Listen for network request start
    window.api.onNetworkRequestStart((data: NetworkRequest) => {
      const row = document.createElement('div');
      row.className = 'request-row';
      row.dataset.id = data.id.toString();
      row.dataset.url = data.url;
      const isM3u8File = isM3u8(data.url);
      const copyText = isM3u8File ? 'Click to copy ffmpeg' : 'Click to copy cURL';

      row.innerHTML = `
        <div class="content">
          <span class="method">${data.method}</span>
          <span class="status"></span>
          <span class="url">${data.url}</span>
        </div>
        <div class="tooltip">${data.url}<br/><span class="hint">${copyText}</span></div>
      `;
      this.requests.set(data.id, { row, data });

      row.addEventListener('click', async () => {
        const text = isM3u8(data.url)
          ? generateFFmpegCommand(data.url, data.headers)
          : generateCurl(data.method, data.url, data.headers);
        const isM3u8File = isM3u8(data.url);

        await window.api.copyToClipboard(text);

        this.showToast(
          isM3u8File ? 'ffmpeg command copied to clipboard' : 'cURL copied to clipboard'
        );
        row.classList.add('copied');
        setTimeout(() => row.classList.remove('copied'), 300);
      });

      this.requestList.appendChild(row);

      // Apply current filter to new request
      const filter = this.filterInput.value.toLowerCase();
      if (filter && !data.url.toLowerCase().includes(filter)) {
        row.style.display = 'none';
      }

      this.requestList.scrollTop = this.requestList.scrollHeight;
    });

    // Listen for network request complete
    window.api.onNetworkRequestComplete((data: NetworkRequest) => {
      const req = this.requests.get(data.id);
      if (req) {
        req.row.classList.add('complete');
        const statusEl = req.row.querySelector('.status');
        if (statusEl) {
          statusEl.textContent = `${data.statusCode}`;
        }
      }
    });
  }

  private showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    setTimeout(() => this.toast.classList.remove('show'), 2000);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new NetworkMonitor();
});
