# initialxy-scraper - Technical Context

## Overview

initialxy-scraper is a minimal Electron-based web browser designed for network monitoring and automated web scraping. It provides a focused two-panel interface: web view on the left, network monitor on the right.

**Version**: 1.0.0 (initial)
**Electron**: 30.0.0+ (recommended)
**Node**: 18.x+ (recommended)

**Key Directories:**

- `src/main/` - Main process (window, IPC, protocol handler)
- `src/renderer/` - Renderer process (network panel UI)
- `dist/` - Bundled output for production
- `userdata/` - User profile data (auto-created)

---

## Architecture

### Process Model

```
Main Process (src/main/main.js)
    │
    ├─ Window Management
    │   └─ Creates single BrowserWindow with WebContents
    │
    ├─ Protocol Handler (when --output present)
    │   └─ protocol.registerBufferProtocol() for response capture
    │
    ├─ WebRequest Listeners
    │   └─ session.webRequest.* for network monitoring
    │
    └─ IPC Bridge ←→ Renderer Process
            │
            └─ Renderer (src/renderer/app.js)
                └─ Network Panel UI
```

### Build System

- **Webpack** or **esbuild** for bundling (recommended)
- **Alternative**: Direct Node.js execution (no bundling required)
- **Development**: `npm run dev` (watch mode)
- **Production**: `npm run build` + `electron-builder`

---

## Web Scraping Capabilities

### 1. Execute JavaScript in Page Context

**API**: `webContents.executeJavaScript(code, useMainWorld)`

**Location**: Main process, called directly on WebContents

**Usage Pattern**:

```javascript
// From main process
webContents
  .executeJavaScript(
    "document.documentElement.outerHTML",
    false // useMainWorld
  )
  .then((result) => {
    // result contains the executed value
  });
```

**Common Use Cases**:

- Extract DOM elements by selector
- Scroll page programmatically
- Get page source HTML
- Modify page state

**Available WebContents Methods**:

- `executeJavaScript(code, useMainWorld)` - Run JS in page context
- `capturePage()` - Screenshot as image
- `getURL()` - Get current URL
- `getTitle()` - Get page title
- `loadURL(url)` - Navigate
- `goBack()`, `goForward()`, `reload()`, `stop()` - Navigation

---

### 2. Network Request Interception

**Location**: `src/main/main.js`

**Available WebRequest Events**:

```javascript
const ses = session.defaultSession;

// Before request is made (can cancel/redirect)
ses.webRequest.onBeforeRequest(details, callback);

// Before headers are sent (can modify request headers)
ses.webRequest.onBeforeSendHeaders(details, callback);

// After response headers received (can modify response headers)
ses.webRequest.onHeadersReceived(details, callback);

// After request completes (access status, timing)
ses.webRequest.onCompleted(details, callback);

// If request was blocked
ses.webRequest.onBlocked(details, callback);
```

**Details Object Contains**:

- `id` - Request ID (unique per request)
- `url` - Request URL
- `method` - HTTP method (GET, POST, etc.)
- `webContentsId` - WebContents identifier
- `resourceType` - `mainFrame`, `subFrame`, `script`, `stylesheet`, `image`, `xhr`, `fetch`, etc.
- `referrer` - Referrer URL
- `requestHeaders` - Request headers (in `onBeforeSendHeaders`, `onHeadersReceived`)
- `responseHeaders` - Response headers (in `onHeadersReceived`, `onCompleted`)
- `statusCode` - HTTP status code (in `onCompleted`)
- `fromCache` - Whether from cache

**For Network Monitor Panel**:

```javascript
// Track request start
ses.webRequest.onBeforeRequest((details) => {
  webContents.send("network-request-start", {
    id: details.id,
    url: details.url,
    method: details.method,
    resourceType: details.resourceType,
    requestHeaders: details.requestHeaders,
  });
});

// Track request completion
ses.webRequest.onCompleted((details) => {
  webContents.send("network-request-complete", {
    id: details.id,
    statusCode: details.statusCode,
    responseHeaders: details.responseHeaders,
  });
});
```

**Limitation**: Response body is NOT accessible via `WebRequest` API. Use Protocol API for body capture.

---

## Security Model

### WebContents Settings

```javascript
{
  nodeIntegration: false,        // No direct Node.js access in pages
  contextIsolation: true,        // Isolated world for preload
  sandbox: true,                 // OS-level sandboxing
  enableRemoteModule: false,     // No Electron remote module
  webviewTag: false,             // Disable nested webviews
}
```

### Implications for Scraping

1. **No direct Node.js access** from web pages
2. **Context isolation enabled** for security
3. **No DevTools needed** - all injection happens via Electron APIs
4. **Standard browser fingerprint** - no obvious automation flags

---

## IPC Communication

### Renderer → Main

```javascript
// Send one-way message
ipc.send("channelName", data);

// Send with response
const result = ipc.sendSync("channelName", data);
```

### Main → Renderer

```javascript
// In main process
webContents.send('channelName', data)

// In renderer
ipc.on('channelName', (event, data) => { ... })
```

### IPC Channels

| Channel                    | Direction       | Purpose                   |
| -------------------------- | --------------- | ------------------------- |
| `network-request-start`    | Main → Renderer | Network request started   |
| `network-request-complete` | Main → Renderer | Network request completed |
| `copy-to-clipboard`        | Renderer → Main | Copy text to clipboard    |
| `get-page-source`          | Renderer → Main | Request page source HTML  |

---

## Key Files

| File                      | Purpose                            |
| ------------------------- | ---------------------------------- |
| `src/main/main.js`        | Entry point, window, IPC, protocol |
| `src/renderer/app.js`     | Network panel UI logic             |
| `src/renderer/index.html` | Panel HTML structure               |
| `src/renderer/style.css`  | Panel styling                      |

---

## Development Workflow

1. **Start dev mode**: `npm run dev`
2. **Production build**: `npm run build`
3. **User data location**: `./userdata/` (relative to executable)
4. **Debug**: Check console in main process or renderer

---

## Protocol API for Response Body Capture

**Location**: Electron's `protocol` module

**Purpose**: Capture actual response payloads (bodies) which WebRequest API cannot provide

**Usage**:

```javascript
const { protocol, session } = require("electron");

// Register buffer protocol handler (only when --output present)
protocol.registerBufferProtocol("https", async (request) => {
  const url = request.url;

  // Fetch the actual response
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());

  // Save to disk for scraping
  fs.writeFileSync(outputPath + "/" + filename, buffer);

  // Return original response to browser (do NOT modify or block)
  return {
    data: buffer,
    mimeType: response.headers.get("content-type"),
    statusCode: response.status,
  };
});
```

**Important Notes**:

- **Side Panel**: Uses WebRequest API only for monitoring (does NOT capture response bodies)
- **CLI Scraping Mode**: Uses Protocol API only when `--output` arg is present
- **Do NOT modify requests**: Always return original response to browser
- **Performance**: Protocol API adds overhead, only enable when needed

---

## Notes

- **No DevTools detection**: All methods use standard Electron APIs, not DevTools protocol
- **Headless not supported**: initialxy-scraper is a GUI browser only
- **Single tab**: One WebContents per browser instance
- **User data**: Stored in `./userdata/` relative to executable
- **Protocol API overhead**: Only enable when CLI scraping args present
