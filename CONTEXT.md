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
    └─ Main Process (main.ts - Central Coordinator)
        ├─ nativeTheme.themeSource = 'dark'
        ├─ app.setPath('userData', './userdata/')
        ├─ globalShortcut - Alt+Left/Right (uses navigationHistory)
        ├─ Protocol Handler (protocol.ts)
        │   └─ protocol.handle() - Callbacks to main.ts only
        ├─ Output Manager (output_manager.ts)
        │   ├─ Filters, buffers, outputs responses
        │   └─ Callbacks to main.ts for onOutput events
        ├─ Automation Logic
        │   ├─ --wait: Delay before page source update
        │   ├─ --scroll: Scroll webview every second
        │   └─ --close-on-idle: Timer resets on output events
        └─ Shared Modules (src/shared/)
            ├─ types.ts - Shared TypeScript interfaces
            ├─ backend_utils.ts - Node.js/Electron utilities (jsdom, path, etc.)
            ├─ cross_stack_utils.ts - Shared functions (generateCurl, escapeCurl)
            ├─ cli.ts - CLI argument parsing
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

## Protocol API (protocol.ts) - Protocol Interception Only

**Use**: `protocol.handle()` - NOT deprecated `registerBufferProtocol()`

**Purpose**: Protocol handler abstraction in `src/shared/protocol.ts` as `ProtocolHandler` class. **ONLY** handles protocol interception, NO output logic.

**Responsibilities**:

1. Register `protocol.handle()` for https protocol
2. Forward ALL requests unchanged using bypass session
3. Callback to main.ts: `onRequestStarted(request)` with id, url, method, headers
4. Callback to main.ts: `onResponseCompleted(request, response)` with id, url, statusCode, headers, body
5. Return `Response` object with original status/headers to preserve page behavior

**Critical Requirements**:

1. Register in `app.whenReady()` - BEFORE any navigation
2. Use **separate session** (`session.fromPartition('persist:bypass')`) for internal fetch to prevent infinite recursion
3. Track in-flight URLs with `Set` to detect recursive calls
4. Works at session level - independent of window type
5. **NO filtering, NO file I/O, NO output logic** - just callbacks to main.ts
6. Receive `baseUrl` in constructor for URL normalization (NOT webContents access)

**Why bypass session?** Using `net.fetch()` or the default session triggers the protocol handler again, causing infinite recursion. A separate partition has no protocol handler registered.

**Performance**: Adds overhead - only enabled when `--output-dir` or `--output-curl` flag present.

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

| Arg                 | Shorthand | Type   | Purpose                                                                             |
| ------------------- | --------- | ------ | ----------------------------------------------------------------------------------- |
| `[URL]`             | -         | string | Initial URL to load (required, positional)                                          |
| `--output-dir`      | `-o`      | string | Output directory for scraped responses (auto-created)                               |
| `--output-curl`     | -         | bool   | Output cURL commands to stdout                                                      |
| `--filter`          | `-f`      | string | Regex URL filter (applies to both --output-dir and --output-curl)                   |
| `--selector`        | `-s`      | string | CSS selector for src attribute extraction                                           |
| `--wait`            | `-w`      | number | Wait seconds after page load before starting idle timer (if --close-on-idle is set) |
| `--scroll`          | `-r`      | number | Pixels to scroll down every second                                                  |
| `--close-on-idle`   | `-c`      | number | Seconds of idle time before auto-close                                              |
| `--rename-sequence` | -         | string | Sprintf format for sequential naming (e.g., `05d`)                                  |
| `--verbose`         | `-v`      | bool   | Enable verbose network traffic logging                                              |
| `--flat-dir`        | -         | bool   | Dump files flat in output-dir without subdirectories                                |

**Key Behaviors**:

- `--wait` defaults to 0 (but still queues page source update to event loop)
- Protocol API **always registered** for network monitoring (UI panel always works)
- `--output-dir` only triggers file saving (adds overhead)
- `--output-curl` outputs cURL commands to stdout (no file I/O)
- `--filter` applies to both `--output-dir` AND `--output-curl` (AND logic with `--selector`)
- Both `--output-dir` and `--output-curl` can be used together
- `--verbose` enables network traffic logging (off by default to reduce noise)
- URLs without protocol prefix are automatically prefixed with `https://`
- `--flat-dir` dumps files without preserving directory structure (overwrites on conflict)
- **Without --selector**: Responses output immediately when complete (filtered by --filter if present)
- **With --selector**: Responses buffered until main.ts calls updatePageSource(), then filtered and output

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
| `src/main/main.ts`                | Main coordinator - window creation, protocol registration, automation, IPC                           |
| `src/shared/protocol.ts`          | ProtocolHandler class - protocol interception only, callbacks to main.ts                             |
| `src/shared/output_manager.ts`    | OutputManager class - filtering, buffering, file/console output, callbacks to main.ts                |
| `src/shared/backend_utils.ts`     | Node.js utilities (extractSourceUrls, isEligible, etc. with jsdom)                                   |
| `src/shared/cross_stack_utils.ts` | Shared functions (generateCurl, generateFFmpegCommand, escapeCurl, isM3u8) for both backend/renderer |
| `src/shared/cli.ts`               | CLI argument parsing                                                                                 |
| `src/shared/types.ts`             | Shared TypeScript interfaces (ProtocolCallbacks, OutputManagerOptions, etc.)                         |

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
9. **Three-module separation**: main.ts (coordinator), protocol.ts (interception), output_manager.ts (output logic)
10. **Push/pull communication**: ProtocolHandler → main.ts (push), OutputManager.updatePageSource() (pull)
11. **Vite build for ui_panel** - TypeScript compiled to ui_panel.js in src/renderer/ui/, referenced in ui_panel.html
12. **cross_stack_utils.ts** - Shared functions (generateCurl, escapeCurl) for both backend/renderer
13. **backend_utils.ts** - Node.js-specific utilities (jsdom, path, etc.)
14. **underscore naming** - All files use underscore instead of kebab-case (ui_panel, not ui-panel)
15. **RESPONSE_WITHOUT_BODY Set** - Clean handling of 204/304 status codes
16. **Version from package.json** - cli.ts reads version dynamically
17. **URL auto-prefix** - URLs without http/https are prefixed with https://
18. **--flat-dir flag** - Optional flat file output without directory structure
19. **Protocol handler timing** - Load about:blank first, register protocol handler, then navigate to target URL (ensures initial HTML captured)
20. **NPM scripts** - `npm start` builds + launches Electron, `npm run dev` starts Vite dev server, `npm run electron:dev` builds + launches Electron with logging
21. **ui directory** - ui_panel.\* files moved to src/renderer/ui/ to avoid ignoring preload.js in .gitignore
22. **FFmpeg for .m3u8** - Automatic detection and ffmpeg command generation for HLS playlist files
23. **--wait defaults to 0** - Still queues page source update to event loop for consistent behavior
24. **output_manager.ts buffers when --selector active** - Prevents premature output before DOM is parsed
25. **updatePageSource returns void** - OutputManager handles page source internally, main.ts doesn't need results
26. **Exit code 5** - File write failure
