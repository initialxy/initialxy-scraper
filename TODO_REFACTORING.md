# Refactoring Plan: Three-Module Architecture

## Overview

This document outlines the steps to refactor the codebase from the current monolithic `ProtocolHandler` design to a clean three-module architecture:

- **main.ts**: Central coordinator with WebContents access only
- **protocol.ts**: Protocol API abstraction (interception only)
- **output_manager.ts**: Output logic (filtering, buffering, file/console output)

---

## Current State Audit

### What Exists

1. **main.ts** (`src/main/main.ts`)
   - Window creation (BaseWindow + dual WebContentsView)
   - ProtocolHandler instantiation and registration
   - IPC handlers for renderer communication
   - AutomationManager initialization
   - Direct WebContents access

2. **protocol.ts** (`src/shared/protocol.ts`)
   - `ProtocolHandler` class with ALL responsibilities:
     - Protocol interception
     - File I/O (output-dir)
     - Console output (output-curl)
     - Filtering (filter + selector)
     - Filename generation
     - UI panel IPC events
     - Source URL tracking

3. **backend_utils.ts** (`src/shared/backend_utils.ts`)
   - `extractSourceUrls()` - DOM parsing with jsdom
   - `isEligible()` - filtering logic
   - `normalizeUrlWithBase()` - URL normalization
   - Filename generation functions

4. **types.ts** (`src/shared/types.ts`)
   - `ProtocolHandlerOptions` - includes all output logic config
   - Network request/response types

5. **automation.ts** (`src/shared/automation.ts`)
   - `AutomationManager` - wait, scroll, close-on-idle logic

### What's Missing

1. **output_manager.ts** - Does not exist yet
2. **types.ts** - Missing `ProtocolCallbacks`, `OutputManagerOptions` interfaces
3. **ProtocolHandler** - Needs to receive callbacks instead of managing output directly

---

## Refactoring Steps

### Phase 1: Create Output Manager Module

#### 1.1 Create `src/shared/output_manager.ts`

```typescript
import type { CLIArgs } from './types.ts';
import {
  extractSourceUrls,
  isEligible,
  generateFilename,
  generateFlatFilename,
  generateSequentialFilename,
} from './backend_utils.ts';
import { generateCurl, generateFFmpegCommand } from './cross_stack_utils.ts';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

interface OutputManagerCallbacks {
  onOutput: (url: string) => void;
}

interface OutputManagerOptions {
  outputDir?: string;
  filter?: RegExp;
  selector?: string;
  renameSequence?: string;
  outputCurl?: boolean;
  flatDir?: boolean;
  callbacks: OutputManagerCallbacks;
}

interface ResponseData {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  response: {
    url: string;
    statusCode: number;
    body: Buffer;
    headers: Record<string, string>;
  };
}

export class OutputManager {
  private outputDir?: string;
  private filter?: RegExp;
  private selector?: string;
  private renameSequence?: string;
  private outputCurl?: boolean;
  private flatDir?: boolean;
  private callbacks: OutputManagerCallbacks;
  private unprocessedResponses: ResponseData[] = [];
  private sequentialCounter = 0;

  constructor(options: OutputManagerOptions) {
    this.outputDir = options.outputDir;
    this.filter = options.filter;
    this.selector = options.selector;
    this.renameSequence = options.renameSequence;
    this.outputCurl = options.outputCurl;
    this.flatDir = options.flatDir;
    this.callbacks = options.callbacks;
  }

  // Called by main.ts when response completes
  responseCompleted(request: Request, response: Response): void {
    const requestData = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    };

    const responseBuffer = Buffer.from(await response.arrayBuffer());
    const responseHeaders = Object.fromEntries(response.headers.entries());

    if (this.selector) {
      // Buffer response, wait for page source
      this.unprocessedResponses.push({ request: requestData, response: { ... } });
      return;
    }

    // No selector: process immediately
    this.processResponse(requestData, { ...responseBuffer, ...responseHeaders });
  }

  // Called by main.ts with page source
  updatePageSource(pageSource: string): void {
    // Parse HTML with jsdom - sourceUrls is local, not state
    const sourceUrls = this.extractSourceUrlsFromSource(pageSource);

    // Filter buffered responses
    for (const { request, response } of this.unprocessedResponses) {
      if (this.isEligible(response.url, sourceUrls)) {
        this.processResponse(request, response);
      }
    }

    // Clear buffer
    this.unprocessedResponses = [];
  }

  private extractSourceUrlsFromSource(pageSource: string): Set<string> {
    const dom = new JSDOM(pageSource);
    const document = dom.window.document;
    const elements = this.selector ? document.querySelectorAll(this.selector) : document.querySelectorAll('*');
    const sourceUrls = new Set<string>();

    elements.forEach((el) => {
      const element = el as HTMLElement & {
        src?: string;
        dataset?: { src?: string };
        srcset?: string;
      };

      if (element.src) {
        sourceUrls.add(element.src);
      } else if (element.dataset?.src) {
        sourceUrls.add(element.dataset.src);
      } else if (element.srcset) {
        element.srcset.split(',').forEach((src) => {
          const parts = src.trim().split(/ /);
          if (parts[0]) sourceUrls.add(parts[0]);
        });
      }
    });

    return sourceUrls;
  }

  private isEligible(url: string, sourceUrls: Set<string>): boolean {
    const filterMatch = !this.filter || this.filter.test(url);
    const selectorMatch = !this.selector || sourceUrls.has(url);
    return filterMatch && selectorMatch;
  }

  private processResponse(request: any, response: any): void {
    if (this.outputCurl) {
      const command = this.generateOutputCommand(request);
      process.stdout.write(`\n${'='.repeat(80)}\n`);
      process.stdout.write(command);
      process.stdout.write(`\n${'='.repeat(80)}\n\n`);
    }

    if (this.outputDir) {
      this.writeToFile(response);
    }

    // Notify main.ts (resets idle timer)
    this.callbacks.onOutput(response.url);
  }

  private generateOutputCommand(request: any): string {
    if (this.isM3u8(request.url)) {
      return generateFFmpegCommand(request.url, request.headers);
    }
    return generateCurl(request.method, request.url, request.headers);
  }

  private isM3u8(url: string): boolean {
    return url.split('?')[0].toLowerCase().endsWith('.m3u8');
  }

  private writeToFile(response: any): void {
    const filename = this.generateFilename(response.url);
    const filepath = path.join(this.outputDir, filename);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, response.body);
    // Exit code 5 on file write failure
  }

  private generateFilename(url: string): string {
    if (this.renameSequence) {
      this.sequentialCounter++;
      return generateSequentialFilename(url, this.sequentialCounter, this.renameSequence);
    }
    return this.flatDir ? generateFlatFilename(url) : generateFilename(url);
  }
}
```

#### 1.2 Update `src/shared/types.ts`

Add new interfaces:

```typescript
export interface ProtocolCallbacks {
  onRequestStarted: (request: {
    id: number;
    url: string;
    method: string;
    headers: Record<string, string>;
  }) => void;
  onResponseCompleted: (
    request: {
      id: number;
      url: string;
      method: string;
      headers: Record<string, string>;
    },
    response: {
      statusCode: number;
      body: Buffer;
      headers: Record<string, string>;
    }
  ) => void;
}

export interface OutputManagerOptions {
  outputDir?: string;
  filter?: RegExp;
  selector?: string;
  renameSequence?: string;
  outputCurl?: boolean;
  flatDir?: boolean;
  onOutput: (url: string) => void;
}

// Remove ProtocolHandlerOptions (replace with separate types)
```

### Phase 2: Refactor ProtocolHandler

#### 2.1 Update `src/shared/protocol.ts`

Remove all output logic, keep only interception:

```typescript
import { protocol, session } from 'electron';

export class ProtocolHandler {
  private baseUrl: string;
  private callbacks: ProtocolCallbacks;
  private inFlight = new Set<string>();
  private requestIdCounter = 0;
  private bypassSession = session.fromPartition('persist:bypass');

  constructor(baseUrl: string, callbacks: ProtocolCallbacks) {
    this.baseUrl = baseUrl;
    this.callbacks = callbacks;
  }

  register(): void {
    protocol.handle('https', this.handleRequest.bind(this));
    protocol.handle('http', this.handleRequest.bind(this));
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = request.url;

    // Prevent infinite recursion
    if (this.inFlight.has(url)) {
      const response = await fetch(url, {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return new Response(buffer, {
        status: response.status,
        headers: response.headers,
      });
    }

    this.inFlight.add(url);

    try {
      // Forward request using bypass session
      const response = await this.bypassSession.fetch(url, {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
      });

      const buffer = Buffer.from(await response.arrayBuffer());

      // Callback to main.ts (NOT output logic)
      this.callbacks.onRequestStarted({
        id: ++this.requestIdCounter,
        url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
      });

      this.callbacks.onResponseCompleted(
        {
          id: this.requestIdCounter,
          url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
        },
        {
          statusCode: response.status,
          body: buffer,
          headers: Object.fromEntries(response.headers.entries()),
        }
      );

      // Return original response unchanged
      return new Response(buffer, {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      this.inFlight.delete(url);
    }
  }
}
```

### Phase 3: Refactor main.ts

#### 3.1 Update `src/main/main.ts`

```typescript
import {
  app,
  BaseWindow,
  WebContentsView,
  nativeTheme,
  ipcMain,
  clipboard,
  globalShortcut,
} from 'electron';
import { AutomationManager } from '../shared/automation.ts';
import { parseCLIArgs } from '../shared/cli.ts';
import { ProtocolHandler } from '../shared/protocol.ts';
import { OutputManager } from '../shared/output_manager.ts';
import fs from 'node:fs';
import path from 'node:path';
import type { CLIArgs } from '../shared/types.ts';

let webView: WebContentsView | null | undefined = null;
let uiView: WebContentsView | null | undefined = null;
let outputManager: OutputManager | null = null;

function createWindow(cliArgs: CLIArgs): {
  win: BaseWindow;
  protocolHandler?: ProtocolHandler;
  cliArgs?: CLIArgs;
} {
  // ... (window creation code remains the same) ...

  // Create OutputManager FIRST
  outputManager = new OutputManager({
    outputDir: cliArgs.outputDir,
    filter: cliArgs.filter,
    selector: cliArgs.selector,
    renameSequence: cliArgs.renameSequence,
    outputCurl: cliArgs.outputCurl,
    flatDir: cliArgs.flatDir,
    onOutput: (url) => {
      // Reset idle timer when output happens
      // (AutomationManager should handle this via callback)
    },
  });

  // Create ProtocolHandler with callbacks that forward to OutputManager
  const protocolHandler = new ProtocolHandler(webView!.webContents.getURL(), {
    onRequestStarted: (request) => {
      // Send IPC to renderer
      uiView!.webContents.send('network-request-start', request);
    },
    onResponseCompleted: (request, response) => {
      // Send IPC to renderer
      uiView!.webContents.send('network-request-complete', {
        id: request.id,
        url: request.url,
        statusCode: response.statusCode,
      });
      // Forward to OutputManager
      // Note: We need to reconstruct full request/response objects
      const fullRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
      });
      const fullResponse = new Response(response.body, {
        status: response.statusCode,
        headers: response.headers,
      });
      outputManager!.responseCompleted(fullRequest, fullResponse);
    },
  });

  protocolHandler.register();

  return { win, protocolHandler, cliArgs };
}

app.whenReady().then(async () => {
  // ... (user data setup code remains the same) ...

  const cliArgs = parseCLIArgs();
  const { win, cliArgs: returnedCliArgs } = createWindow(cliArgs);

  // Navigate to target URL
  if (returnedCliArgs?.url && webView?.webContents) {
    setTimeout(() => {
      webView.webContents.loadURL(returnedCliArgs.url);
    }, 100);
  }

  // Initialize automation manager
  if (webView?.webContents) {
    const automation = new AutomationManager(webView, cliArgs);
    automation.initializeWait();
    automation.initializeScroll();
    automation.initializeCloseOnIdle();
  }

  win.show();

  // ... (activate handler remains the same) ...
});

// Add function to update page source (called from scroll or wait)
export async function updatePageSource(): Promise<void> {
  if (!webView?.webContents || !outputManager) return;
  try {
    const pageSource = await webView.webContents.executeJavaScript(
      'document.documentElement.outerHTML'
    );
    outputManager.updatePageSource(pageSource);
  } catch (error) {
    console.error('[Main] Error getting page source:', error);
  }
}
```

### Phase 4: Refactor AutomationManager

#### 4.1 Update `src/shared/automation.ts`

The automation manager should:

- NOT be concerned with selector logic
- Reset idle timer on `onOutput` callbacks from OutputManager
- Handle wait, scroll, close-on-idle purely as timing logic

```typescript
export class AutomationManager {
  private webView: WebContentsView | null | undefined;
  private cliArgs: CLIArgs;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivityTime: number;

  constructor(
    webView: WebContentsView | null | undefined,
    cliArgs: CLIArgs,
    private onOutput?: () => void // Callback to reset idle timer
  ) {
    this.webView = webView;
    this.cliArgs = cliArgs;
    this.lastActivityTime = Date.now();
  }

  initializeWait(): void {
    if (!this.cliArgs.wait) return;

    setTimeout(() => {
      console.debug('[Automation] Wait period complete');
      // Queue page source update
      // (main.ts should call this)
    }, this.cliArgs.wait * 1000);
  }

  initializeScroll(): void {
    if (!this.cliArgs.scroll) return;

    // Start scrolling after --wait period
    const delay = this.cliArgs.wait ? this.cliArgs.wait * 1000 : 0;
    setTimeout(() => {
      this.startScrolling();
    }, delay);
  }

  initializeCloseOnIdle(): void {
    if (!this.cliArgs.closeOnIdle) return;

    // Start idle timer after --wait period
    const delay = this.cliArgs.wait ? this.cliArgs.wait * 1000 : 0;
    setTimeout(() => {
      this.startIdleTimer();
    }, delay);
  }

  private startIdleTimer(): void {
    const checkIdle = (): void => {
      const idleTime = (Date.now() - this.lastActivityTime) / 1000;

      if (idleTime >= this.cliArgs.closeOnIdle!) {
        console.debug(`[Automation] Idle for ${Math.floor(idleTime)} seconds, closing...`);
        setTimeout(() => process.exit(0), 100);
        return;
      }

      this.idleTimer = setTimeout(checkIdle, 1000);
    };

    this.idleTimer = setTimeout(checkIdle, 1000);
  }

  onOutputEvent(): void {
    // Reset idle timer when output happens
    this.lastActivityTime = Date.now();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // Restart timer
    this.startIdleTimer();
  }
}
```

### Phase 5: Wiring Everything Together

#### 5.1 Update main.ts to wire OutputManager with AutomationManager

```typescript
// In createWindow():
outputManager = new OutputManager({
  // ... options ...
  onOutput: (url) => {
    // Reset idle timer via AutomationManager
    if (automation) {
      automation.onOutputEvent();
    }
  },
});
```

#### 5.2 Add updatePageSource to main.ts

```typescript
// Export for use by automation
export async function updatePageSource(): Promise<void> {
  if (!webView?.webContents || !outputManager) return;
  try {
    const pageSource = await webView.webContents.executeJavaScript(
      'document.documentElement.outerHTML'
    );
    outputManager.updatePageSource(pageSource);
  } catch (error) {
    console.error('[Main] Error getting page source:', error);
  }
}
```

#### 5.3 Call updatePageSource from AutomationManager

```typescript
// In automation.ts
async queuePageSourceUpdate(): Promise<void> {
  // Import here to avoid circular dependency
  const { updatePageSource } = await import('../main/main.ts');
  await updatePageSource();
}
```

---

## File Changes Summary

| File                           | Changes                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `src/shared/types.ts`          | Add `ProtocolCallbacks`, `OutputManagerOptions`; Remove `ProtocolHandlerOptions` |
| `src/shared/output_manager.ts` | **NEW FILE** - Output logic abstraction                                          |
| `src/shared/protocol.ts`       | Remove output logic, keep only interception with callbacks                       |
| `src/main/main.ts`             | Create OutputManager, wire callbacks, add `updatePageSource()`                   |
| `src/shared/automation.ts`     | Remove selector logic, add `onOutputEvent()` callback                            |

---

## Testing Checklist

After refactoring:

- [ ] Basic browser mode works
- [ ] Network panel shows requests
- [ ] `--output-dir` saves files correctly
- [ ] `--output-curl` prints to stdout
- [ ] `--filter` filters correctly
- [ ] `--selector` buffers and processes correctly
- [ ] `--wait` delays page source update
- [ ] `--scroll` scrolls every second
- [ ] `--close-on-idle` closes after idle
- [ ] Exit code 5 on file write failure
- [ ] No circular dependencies
- [ ] TypeScript compiles without errors

---

## Migration Order

1. **types.ts** - Add new interfaces first
2. **output_manager.ts** - Create new module
3. **protocol.ts** - Refactor to use callbacks
4. **automation.ts** - Simplify, remove selector logic
5. **main.ts** - Wire everything together
6. **Test** - Verify all functionality

---

## Notes

- **No circular dependencies**: main.ts → output_manager.ts, protocol.ts → main.ts (callbacks)
- **OutputManager is stateless about sourceUrls**: Re-computed on each `updatePageSource()` call
- **updatePageSource returns void**: main.ts doesn't need results
- **Exit code 5**: File write failures
- **baseUrl in ProtocolHandler**: Passed as string, not WebContents
