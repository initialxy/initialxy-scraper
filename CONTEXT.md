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

## Protocol API for Response Capture

### Modern API (Electron 25+)

**Use**: `protocol.handle()` - NOT deprecated `registerBufferProtocol()`

**Purpose**: Intercept HTTP/HTTPS requests, capture response body, save to disk, return original response unchanged.

**Pattern**:
```javascript
const { protocol, net } = require("electron");
const fs = require("fs");

app.whenReady().then(() => {
  protocol.handle("https", async (request) => {
    // Forward request and capture response
    const response = await net.fetch(request.url, {
      method: request.method,
      headers: request.headers,
    });
    
    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Save to disk
    const filename = generateFilename(request.url);
    fs.writeFileSync(path.join(outputDir, filename), buffer);
    
    // Return ORIGINAL response (unchanged)
    return new Response(buffer, {
      status: response.status,
      headers: response.headers,
    });
  });
});
```

**Critical Requirements**:
1. Register in `app.whenReady()` - BEFORE any navigation
2. Use `net.fetch()` to forward request - do NOT block/modify
3. Return `Response` object with original status/headers
4. Works at session level - independent of window type

**Why it works**: Protocol handlers intercept at network layer, before request leaves browser. We fetch the actual response, capture it, then return it unchanged to the page.

**Performance**: Adds overhead - only enable when `--output` flag present.

---

## WebRequest API for Network Monitoring

**Purpose**: Track requests/responses for UI display (NO body access)

**Events**:
```javascript
const ses = webView.webContents.session;

ses.webRequest.onBeforeRequest((details) => {
  // Request started: id, url, method, resourceType, requestHeaders
});

ses.webRequest.onCompleted((details) => {
  // Request done: statusCode, responseHeaders, fromCache
});
```

**Limitation**: Cannot access response body - use Protocol API for that.

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
| `network-request-start` | Main → Renderer | Request began |
| `network-request-complete` | Main → Renderer | Response received |
| `copy-to-clipboard` | Renderer → Main | Copy text |
| `get-page-source` | Renderer → Main | Get HTML |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/main/main.js` | BaseWindow + WebContentsView setup, Protocol API, WebRequest |
| `src/renderer/ui-panel.html` | Right panel UI |

---

## CLI Arguments (Future)

| Arg | Purpose |
|-----|---------|
| `--output` / `-o` | Enable Protocol API, save responses to dir |
| `--filter` / `-f` | Regex URL filter for eligible responses |
| `--selector` / `-s` | CSS selector for src attribute extraction |
| `--wait` / `-w` | Wait seconds after page load |
| `[URL]` | Initial URL to load |

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