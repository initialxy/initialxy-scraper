# initialxy-scraper - Technical Context

This document tracks development progress and technical decisions. It is **optimized for LLM context** - concise, relevant, and actionable. Irrelevant history is cleaned up.

**Version**: 2.1.0
**Electron**: 40.6.1
**Node**: 18.x+
**TypeScript**: 5.9.3 (native Node.js support)

---

## Architecture

### Current Implementation: BaseWindow + Dual WebContentsView + Shared Modules

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
        ├─ app.setPath('userData', './userdata/') - User data directory
        ├─ globalShortcut - Alt+Left/Right for back/forward
        ├─ protocol.handle() - Response body capture (when --output)
        ├─ IPC - Main ↔ Renderer communication
        └─ Shared Modules (src/shared/)
            ├─ types.ts - Shared TypeScript interfaces
            ├─ constants.ts - IPC channel constants
            ├─ utils.ts - Utility functions
            ├─ protocol.ts - ProtocolHandler class
            ├─ cli.ts - CLI argument parsing
            ├─ network-monitor.ts - NetworkMonitor class
            └─ automation.ts - AutomationManager class
```

**Why BaseWindow + WebContentsView?**

- Modern Electron 30+ API (replaces deprecated BrowserView)
- Direct Chromium Views API integration
- Proper multi-view support in single window
- Both views fully isolated with separate webContents

**Why Shared Modules?**

- Eliminates code duplication across main process
- Provides type-safe abstractions for common operations
- Enables easier testing and maintenance
- Centralizes protocol handling, CLI parsing, and automation logic

**Key Implementation Details**:

- `setBounds()` called on `show` event (BaseWindow has no `ready-to-show`)
- Left panel resizes dynamically, right panel stays fixed at 500px
- Each WebContentsView has independent session/webContents
- Dark mode via `nativeTheme.themeSource = 'dark'` (not CSS injection)
- User data stored in `./userdata/` directory (relative to executable)
- TypeScript 5.9.3 with `verbatimModuleSyntax: true` (requires `.js` extensions in imports)

---

## Protocol API - Central Abstraction

### Modern API (Electron 25+)

**Use**: `protocol.handle()` - NOT deprecated `registerBufferProtocol()`

**Purpose**: Central interception point for ALL HTTP/HTTPS traffic. Handles:

1. **Response capture** - Save response body to disk (when `--output` flag present)
2. **Network monitoring** - Emit events to UI panel for real-time request tracking
3. **Request forwarding** - Forward requests unchanged to preserve page behavior

**Implementation**: Centralized in `src/shared/protocol.ts` as `ProtocolHandler` class

**Pattern**:

```typescript
import { ProtocolHandler } from './shared/protocol.js';

const handler = new ProtocolHandler({
  outputDir: './scraped',
  filter: /api\.example\.com/,
  selector: 'img[src]',
  sourceUrls: new Set<string>(),
  completedSourceUrls: new Set<string>(),
  uiView,
  webView,
});

handler.register();
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

## CLI Arguments

**Parser**: `commander` package (replaced custom parser for better `--help` and validation)

| Arg                 | Shorthand | Type   | Purpose                                                           |
| ------------------- | --------- | ------ | ----------------------------------------------------------------- |
| `[URL]`             | -         | string | Initial URL to load (required, positional)                        |
| `--output-dir`      | `-o`      | string | Output directory for scraped responses (auto-created)             |
| `--output-curl`     | -         | bool   | Output cURL commands to stdout                                    |
| `--filter`          | `-f`      | string | Regex URL filter (applies to both --output-dir and --output-curl) |
| `--selector`        | `-s`      | string | CSS selector for src attribute extraction                         |
| `--wait`            | `-w`      | number | Wait seconds after page load                                      |
| `--scroll`          | `-r`      | number | Pixels to scroll down every second                                |
| `--close-on-idle`   | `-c`      | number | Seconds of idle time before auto-close                            |
| `--rename-sequence` | -         | string | Sprintf format for sequential naming (e.g., `05d`)                |
| `--verbose`         | `-v`      | bool   | Enable verbose network traffic logging                            |

**Key Behaviors**:

- Protocol API **always registered** for network monitoring (UI panel always works)
- `--output-dir` only triggers file saving (adds overhead)
- `--output-curl` outputs cURL commands to stdout (no file I/O)
- `--filter` applies to both `--output-dir` AND `--output-curl`
- Both `--output-dir` and `--output-curl` can be used together
- `--verbose` enables network traffic logging (off by default to reduce noise)

---

## Testing

```bash
# Basic browser
npm start -- https://google.com

# Save responses to directory
npm start -- --output-dir ./scraped https://example.com

# Output cURL commands to stdout
npm start -- --output-curl https://example.com

# Filter cURL output
npm start -- --output-curl --filter "api\.example\.com" https://example.com

# Both file saving and cURL output
npm start -- --output-dir ./assets --output-curl --filter "\.json$" https://example.com

# Verbose mode
npm start -- --verbose --output-dir ./debug https://example.com
```

---

## Known Decisions

1. **BaseWindow + WebContentsView** - NOT BrowserWindow + webview tag
2. **protocol.handle()** - NOT deprecated registerBufferProtocol()
3. **Two fixed-size views** - 700px web, 500px UI
4. **Dark theme only** - no light mode
5. **GUI browser** - NOT headless
6. **No DevTools** - all via Electron APIs
