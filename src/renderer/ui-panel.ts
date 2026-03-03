import { generateCurl } from '../shared/utils.js';
import type { NetworkRequestData } from '../shared/types.js';

interface Api {
  onNetworkRequestStart: (callback: (data: NetworkRequestData) => void) => void;
  onNetworkRequestComplete: (callback: (data: NetworkRequestData) => void) => void;
  copyToClipboard: (text: string) => Promise<void>;
  getPageSource: () => Promise<string>;
  applySelector: () => Promise<void>;
  scrollPage: () => Promise<void>;
  checkSourceCompleted: () => Promise<boolean>;
  markSourceCompleted: (url: string) => Promise<void>;
  getCompletedStatus: () => Promise<{ allCompleted: boolean; count: number }>;
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
  private requests: Map<number, { row: HTMLElement; data: NetworkRequestData }>;

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
    // Click on request row to copy cURL
    this.requestList.addEventListener('click', async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const row = target.closest('.request-row') as HTMLElement | null;
      if (!row) return;

      const id = parseInt(row.dataset.id, 10);
      const req = this.requests.get(id);
      if (!req) return;

      const curl = generateCurl(req.data.method, req.data.url, req.data.headers);
      await window.api.copyToClipboard(curl);

      this.showToast('cURL copied to clipboard');
      row.classList.add('copied');
      setTimeout(() => row.classList.remove('copied'), 300);
    });

    // Tooltip on hover
    this.requestList.addEventListener('mouseenter', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const row = target.closest('.request-row') as HTMLElement | null;
      if (!row) return;

      const tooltip = row.querySelector('.tooltip') as HTMLElement | null;
      if (!tooltip) return;

      const url = row.dataset.url;
      tooltip.textContent = `${url}\nClick to copy cURL`;
      tooltip.style.display = 'block';
    });

    this.requestList.addEventListener('mouseleave', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const row = target.closest('.request-row') as HTMLElement | null;
      if (!row) return;

      const tooltip = row.querySelector('.tooltip') as HTMLElement | null;
      if (tooltip) {
        tooltip.style.display = 'none';
      }
    });

    this.requestList.addEventListener('mousemove', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const row = target.closest('.request-row') as HTMLElement | null;
      if (!row) return;

      const tooltip = row.querySelector('.tooltip') as HTMLElement | null;
      if (!tooltip) return;

      const rect = row.getBoundingClientRect();
      tooltip.style.top = `${rect.bottom + 5}px`;
      tooltip.style.left = `${rect.left}px`;
      tooltip.style.width = `${rect.width}px`;
    });

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
    window.api.onNetworkRequestStart((data: NetworkRequestData) => {
      const row = document.createElement('div');
      row.className = 'request-row';
      row.dataset.id = data.id.toString();
      row.dataset.url = data.url;
      row.innerHTML = `
        <div class="content">
          <span class="method">${data.method}</span>
          <span class="status"></span>
          <span class="url">${data.url}</span>
        </div>
        <div class="tooltip"></div>
      `;
      this.requestList.appendChild(row);
      this.requests.set(data.id, { row, data });

      // Apply current filter to new request
      const filter = this.filterInput.value.toLowerCase();
      if (filter && !data.url.toLowerCase().includes(filter)) {
        row.style.display = 'none';
      }

      this.requestList.scrollTop = this.requestList.scrollHeight;
    });

    // Listen for network request complete
    window.api.onNetworkRequestComplete((data: NetworkRequestData) => {
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
