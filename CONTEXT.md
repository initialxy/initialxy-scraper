# initialxy-scraper - Technical Context

**Version**: 2.2.0  
**Electron**: 40.6.1  
**Node**: 24.x+  
**TypeScript**: 5.9.3 (native Node.js support)  
**jsdom**: Latest (DOM parsing for source extraction)  
**Vite**: 7.3.1 (frontend build tool)

---

## Architecture

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
        ├─ app.setPath('userData', './userdata/')
        ├─ globalShortcut - Alt+Left/Right (uses navigationHistory)
        ├─ protocol.handle() - Response capture & network monitoring
        ├─ IPC - Main ↔ Renderer communication
        └─ Shared Modules (src/shared/)
            ├─ types.ts - Shared TypeScript interfaces
            ├─ backend_utils.ts - Node.js/Electron utilities (jsdom, path, etc.)
            ├─ cross_stack_utils.ts - Shared functions (generateCurl, escapeCurl)
            ├─ protocol.ts - ProtocolHandler class
            ├─ cli.ts - CLI argument parsing
            └─ automation.ts - AutomationManager class
```

**Frontend Build** (Vite):

```
src/renderer/ui/ui_panel.ts → src/renderer/ui/ui_panel.js (4.66 kB)
```

**Key Implementation Details**:

- `setBounds()` called on `show` event (BaseWindow has no `ready-to-show`)
- Left panel resizes dynamically, right panel stays fixed at 500px
- Each WebContentsView has independent session/webContents
- Dark mode via `nativeTheme.themeSource = 'dark'`
- User data stored in `./userdata/` directory (relative to executable)
- TypeScript 5.9.3 with `verbatimModuleSyntax: true` (requires `.js` extensions in imports)
- **Protocol handler timing**: Load `about:blank` first, register protocol handler, THEN navigate to target URL (ensures initial HTML is captured)
- **NPM scripts**: `npm start` builds and launches Electron (no dev server), `npm run dev` starts Vite dev server, `npm run electron:dev` builds and launches Electron with logging

---

## Protocol API - Central Abstraction

**Use**: `protocol.handle()` - NOT deprecated `registerBufferProtocol()`

**Purpose**: Central interception point for ALL HTTP/HTTPS traffic. Handles:

1. **Response capture** - Save response body to disk (when `--output-dir` flag present)
2. **Network monitoring** - Emit events to UI panel for real-time request tracking
3. **Request forwarding** - Forward requests unchanged to preserve page behavior

**Implementation**: Centralized in `src/shared/protocol.ts` as `ProtocolHandler` class

**Critical Requirements**:

1. Register in `app.whenReady()` - BEFORE any navigation
2. Use **separate session** (`session.fromPartition('persist:bypass')`) for internal fetch to prevent infinite recursion
3. Track in-flight URLs with `Set` to detect recursive calls
4. Return `Response` object with original status/headers
5. Works at session level - independent of window type
6. **Central abstraction** - Single point for both response capture AND network monitoring
7. **isEligible() is single source of truth** for filtering (applies to both `--output-dir` and `--output-curl`)

**Why bypass session?** Using `net.fetch()` or the default session triggers the protocol handler again, causing infinite recursion. A separate partition has no protocol handler registered.

**Filename Generation**:

- Extract pathname from URL
- Preserve directory structure
- Handle collisions with counter suffix (`_1`, `_2`, etc.)
- Auto-create nested directories
- Sequential naming with `--rename-sequence` flag

**Performance**: Adds overhead - only enabled when `--output-dir` flag present.

---

## Network Monitor Panel

**Layout**: Fixed 500px width, 100% height, positioned on right side

**Features**:

- **Real-time filtering**: Filter input applies to new requests as they arrive
- **Row layout**: Method, status code, URL on single line (14px font)
- **RTL ellipsis**: Long URLs truncate from left with `direction: rtl; text-overflow: ellipsis;`
- **Hover tooltip**: Shows full URL + "Click to copy cURL" hint
- **Toast notifications**: Flash feedback on copy actions
- **Dark scrollbar**: Injected CSS for web view scrollbars

**Files**:

- `src/renderer/ui/ui_panel.html` - Panel structure
- `src/renderer/ui/ui_panel.css` - Panel styles (extracted from HTML)
- `src/renderer/ui/ui_panel.ts` - Panel logic (compiled by Vite)
- `src/renderer/ui/ui_panel.js` - Compiled output (auto-generated)
- `src/renderer/preload.js` - Exposes `window.api.generateCurl()` to renderer

---

## CLI Arguments

**Parser**: `commander` package

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
| `--flat-dir`        | -         | bool   | Dump files flat in output-dir without subdirectories              |

**Key Behaviors**:

- Protocol API **always registered** for network monitoring (UI panel always works)
- `--output-dir` only triggers file saving (adds overhead)
- `--output-curl` outputs cURL commands to stdout (no file I/O)
- `--filter` applies to both `--output-dir` AND `--output-curl` (AND logic with `--selector`)
- Both `--output-dir` and `--output-curl` can be used together
- `--verbose` enables network traffic logging (off by default to reduce noise)
- URLs without protocol prefix are automatically prefixed with `https://`
- `--flat-dir` dumps files without preserving directory structure (overwrites on conflict)

**Source Extraction Priority**:

1. `src` attribute
2. `data-src` attribute
3. `srcset` attribute (parse ALL URLs, preserve order)

**Eligibility Logic**:

- **No filters**: All responses eligible
- **`--filter` only**: Response URL matches regex
- **`--selector` only**: Response URL matches source attribute of selected DOM elements
- **Both `--filter` and `--selector`**: Response must match BOTH (AND logic)

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

**User Agent**: Stripped of Electron/min branding, replaced Chrome version with placeholder (e.g., `144.0.0.0`)

---

## IPC Communication

**Channels**:

| Channel                    | Direction       | Purpose                                    |
| -------------------------- | --------------- | ------------------------------------------ |
| `network-request-start`    | Main → Renderer | Request started (id, url, method, headers) |
| `network-request-complete` | Main → Renderer | Response complete (id, statusCode)         |
| `copy-to-clipboard`        | Renderer → Main | Copy text to clipboard                     |
| `get-page-source`          | Renderer → Main | Get page HTML source                       |

**Preload Script**: `src/renderer/preload.js` exposes `window.api` with safe IPC methods including `generateCurl()` for cURL generation.

**FFmpeg Support**: `.m3u8` files trigger ffmpeg command generation instead of cURL, with HLS streaming options and header support.

---

## Key Files

| File                              | Purpose                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/main/main.ts`                | BaseWindow + WebContentsView setup, Protocol API, navigationHistory                                  |
| `src/renderer/ui/ui_panel.html`   | Right panel UI structure                                                                             |
| `src/renderer/ui/ui_panel.css`    | Right panel styles                                                                                   |
| `src/renderer/ui/ui_panel.ts`     | Right panel logic (compiled by Vite)                                                                 |
| `src/renderer/ui/ui_panel.js`     | Compiled output (auto-generated)                                                                     |
| `src/renderer/index.html`         | Legacy browser view (not used in current impl)                                                       |
| `src/renderer/index.css`          | Legacy browser styles                                                                                |
| `src/renderer/preload.js`         | Preload script for IPC + generateCurl()                                                              |
| `src/shared/protocol.ts`          | ProtocolHandler class with isEligible()                                                              |
| `src/shared/backend_utils.ts`     | Node.js utilities (extractSourceUrls, isEligible, etc. with jsdom)                                   |
| `src/shared/cross_stack_utils.ts` | Shared functions (generateCurl, generateFFmpegCommand, escapeCurl, isM3u8) for both backend/renderer |
| `src/shared/cli.ts`               | CLI argument parsing                                                                                 |
| `src/shared/automation.ts`        | AutomationManager class                                                                              |

---

## Testing

```bash
# Basic browser (auto-builds UI)
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

# Start Vite dev server (for frontend development)
npm run dev

# Build and launch Electron with logging
npm run electron:dev
```

---

## Known Decisions

1. **BaseWindow + WebContentsView** - NOT BrowserWindow + webview tag
2. **protocol.handle()** - NOT deprecated registerBufferProtocol()
3. **navigationHistory API** - NOT deprecated goBack()/goForward() (Electron 40+)
4. **Two fixed-size views** - Dynamic web, 500px UI
5. **Dark theme only** - no light mode
6. **GUI browser** - NOT headless
7. **No DevTools** - all via Electron APIs
8. **jsdom for DOM parsing** - NOT inline JavaScript injection in extractSourceUrls()
9. **isEligible() as single source of truth** - Unified filtering for --output-dir and --output-curl
10. **Vite build for ui_panel** - TypeScript compiled to ui_panel.js in src/renderer/ui/, referenced in ui_panel.html
11. **cross_stack_utils.ts** - Shared functions (generateCurl, escapeCurl) for both backend/renderer
12. **backend_utils.ts** - Node.js-specific utilities (jsdom, path, etc.)
13. **underscore naming** - All files use underscore instead of kebab-case (ui_panel, not ui-panel)
14. **RESPONSE_WITHOUT_BODY Set** - Clean handling of 204/304 status codes
15. **Version from package.json** - cli.ts reads version dynamically
16. **URL auto-prefix** - URLs without http/https are prefixed with https://
17. **--flat-dir flag** - Optional flat file output without directory structure
18. **Protocol handler timing** - Load about:blank first, register protocol handler, then navigate to target URL (ensures initial HTML captured)
19. **NPM scripts** - `npm start` builds + launches Electron, `npm run dev` starts Vite dev server, `npm run electron:dev` builds + launches Electron with logging
20. **ui directory** - ui_panel.\* files moved to src/renderer/ui/ to avoid ignoring preload.js in .gitignore
21. **FFmpeg for .m3u8** - Automatic detection and ffmpeg command generation for HLS playlist files
