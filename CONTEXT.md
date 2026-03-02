# initialxy-scraper - Technical Context

This document tracks development progress and technical decisions. It is **optimized for LLM context** - concise, relevant, and actionable. Irrelevant history is cleaned up.

**Version**: 1.0.0
**Electron**: 40.6.1
**Node**: 18.x+
**TypeScript**: 5.9.3 (native Node.js support)

---

## Architecture

### Current Implementation: BaseWindow + Dual WebContentsView

```
BaseWindow (1200x800, autoHideMenuBar: true)
    │
    ├─ contentView (View container)
    │   │
    │   ├─ WebContentsView (left, dynamic width) - Web browser
    │   │   └─ webContents - loads external URLs
    │   │
    │   └─ WebContentsView (right, 500px fixed) - UI panel
    │       └─ webContents - loads local HTML
    │
    └─ Main Process
        ├─ nativeTheme.themeSource = 'dark'
        ├─ session.webRequest.* - Network monitoring
        ├─ protocol.handle() - Response body capture (when --output)
        └─ IPC - Main ↔ Renderer communication
```

**Why BaseWindow + WebContentsView?**

- Modern Electron 30+ API (replaces deprecated BrowserView)
- Direct Chromium Views API integration
- Proper multi-view support in single window
- Both views fully isolated with separate webContents

**Key Implementation Details**:

- `setBounds()` called on `show` event (BaseWindow has no `ready-to-show`)
- Left panel resizes dynamically, right panel stays fixed at 500px
- Each WebContentsView has independent session/webContents
- Dark mode via `nativeTheme.themeSource = 'dark'` (not CSS injection)

---

## Protocol API - Central Abstraction

### Modern API (Electron 25+)

**Use**: `protocol.handle()` - NOT deprecated `registerBufferProtocol()`

**Purpose**: Central interception point for ALL HTTP/HTTPS traffic. Handles:

1. **Response capture** - Save response body to disk (when `--output` flag present)
2. **Network monitoring** - Emit events to UI panel for real-time request tracking
3. **Request forwarding** - Forward requests unchanged to preserve page behavior

**Pattern**:

```typescript
import { protocol, session } from 'electron';
import fs from 'node:fs';

// Create bypass session to prevent infinite recursion
const bypassSession = session.fromPartition('persist:bypass');
const processingUrls = new Set<string>();
const activeRequests = new Map<
  string,
  { id: number; url: string; method: string; headers: Record<string, string> }
>();
let requestIdCounter = 0;

// Send network events to UI panel
function sendNetworkEvent(
  eventType: 'start' | 'complete',
  requestId: number,
  url: string,
  method: string,
  headers: Record<string, string>,
  statusCode?: number
) {
  if (!uiView) return;
  uiView.webContents.send(`network-request-${eventType}`, {
    id: requestId,
    url,
    method,
    headers,
    statusCode,
  });
}

app.whenReady().then(() => {
  protocol.handle('https', async (request) => {
    const url = request.url;
    const headersObj = Object.fromEntries(request.headers.entries());

    // Prevent infinite recursion
    if (processingUrls.has(url)) {
      const response = await fetch(url, { method: request.method, headers: headersObj });
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: response.headers,
      });
    }

    processingUrls.add(url);

    // Track request for UI panel
    const requestId = ++requestIdCounter;
    activeRequests.set(url, { id: requestId, url, method: request.method, headers: headersObj });

    // Send request start event to UI panel
    sendNetworkEvent('start', requestId, url, request.method, headersObj);

    try {
      // Forward request using bypass session (no protocol handler)
      const response = await bypassSession.fetch(url, {
        method: request.method,
        headers: headersObj,
      });

      const buffer = Buffer.from(await response.arrayBuffer());

      // Save to disk (if output directory specified)
      if (outputDir) {
        const filename = generateFilename(url);
        const filepath = path.join(outputDir, filename);
        const dirpath = path.dirname(filepath);
        if (!fs.existsSync(dirpath)) {
          fs.mkdirSync(dirpath, { recursive: true });
        }
        fs.writeFileSync(filepath, buffer);
      }

      // Send request complete event to UI panel
      sendNetworkEvent('complete', requestId, url, request.method, headersObj, response.status);
      activeRequests.delete(url);

      // Return ORIGINAL response (unchanged)
      return new Response(buffer, {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      processingUrls.delete(url);
    }
  });
});
```

**Critical Requirements**:

1. Register in `app.whenReady()` - BEFORE any navigation
2. Use **separate session** (`session.fromPartition()`) for internal fetch to prevent infinite recursion
3. Track in-flight URLs with `Set` to detect recursive calls
4. Return `Response` object with original status/headers
5. Works at session level - independent of window type
6. **Central abstraction** - Single point for both response capture AND network monitoring

**Why bypass session?** Using `net.fetch()` or the default session triggers the protocol handler again, causing infinite recursion. A separate partition has no protocol handler registered.

**Filename Generation**:

- Extract pathname from URL
- Preserve directory structure
- Handle collisions with counter suffix (`_1`, `_2`, etc.)
- Auto-create nested directories

**Performance**: Adds overhead - only enable when `--output` flag present.

**Tested**: Successfully captured 24 files (2.4MB) from https://initialxy.com including HTML, CSS, images, and fonts.

---

## WebRequest API - Deprecated

**Status**: No longer used for network monitoring. Protocol API is the central abstraction.

**Previous Purpose**: Track requests/responses for UI display (NO body access)

**Replacement**: Use Protocol API which provides both request monitoring AND response capture in a single implementation.

---

## WebContents.executeJavaScript()

**Purpose**: Run JS in page context for DOM manipulation

**Usage**:

```javascript
webView.webContents.executeJavaScript("document.querySelector('.selector').innerText");
```

**Use Cases**: Extract content by selector, scroll page, get page source

---

## Security Model

**WebPreferences** (for both WebContentsView instances):

```javascript
{
  nodeIntegration: false,  // No Node.js in renderer
  contextIsolation: true,  // Isolated world
  sandbox: true,           // OS sandboxing
}
```

**Implications**:

- No DevTools needed - all via Electron APIs
- Standard browser fingerprint (no automation flags)
- Secure by default

---

## IPC Communication

**Channels**:
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `network-request-start` | Main → Renderer | Request started (id, url, method, headers) |
| `network-request-complete` | Main → Renderer | Response complete (id, statusCode) |
| `copy-to-clipboard` | Renderer → Main | Copy text to clipboard |
| `get-page-source` | Renderer → Main | Get page HTML source |

**Preload Script**: `src/renderer/preload.js` exposes `window.api` with safe IPC methods.

---

## Key Files

| File                         | Purpose                                          |
| ---------------------------- | ------------------------------------------------ |
| `src/main/main.ts`           | BaseWindow + WebContentsView setup, Protocol API |
| `src/renderer/ui-panel.html` | Right panel UI with network monitor              |
| `src/renderer/preload.js`    | Preload script for IPC communication             |

---

## CLI Arguments (Future)

| Arg                 | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `--output` / `-o`   | Enable Protocol API, save responses to dir |
| `--filter` / `-f`   | Regex URL filter for eligible responses    |
| `--selector` / `-s` | CSS selector for src attribute extraction  |
| `--wait` / `-w`     | Wait seconds after page load               |
| `[URL]`             | Initial URL to load                        |

---

## Testing

```bash
# Basic browser
npm start -- https://google.com

# With scraping (future)
npm start -- --output ./scraped https://example.com
```

---

## Known Decisions

1. **BaseWindow + WebContentsView** - NOT BrowserWindow + webview tag
2. **protocol.handle()** - NOT deprecated registerBufferProtocol()
3. **Two fixed-size views** - 700px web, 500px UI
4. **Dark theme only** - no light mode
5. **GUI browser** - NOT headless
6. **No DevTools** - all via Electron APIs
