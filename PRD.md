# PRD: initialxy-scraper - Minimal Network Monitoring Browser

## Overview

initialxy-scraper is a minimal Electron-based web browser designed for network monitoring and automated web scraping. Unlike traditional browsers, it strips away all unnecessary features (tabs, settings, bookmarks, extensions) to provide a focused tool for developers and automation scripts.

**Core Philosophy**: Maximum functionality with minimum surface area.

## Architecture

### Two-Panel Layout

1. **Left Panel (Web View)**: Full-height Chromium webview for page rendering
2. **Right Panel (Network Monitor)**: 500px fixed-width panel showing real-time network requests

### No Traditional Browser UI

- No navbar, address bar, or tabs
- No menu bar (autoHideMenuBar enabled)
- No settings menu or preferences
- No bookmarks or history UI
- No extensions system
- Window controls only (minimize, maximize, close)

### Single Tab Only

- One webview per browser instance
- No tab switching or management
- Simplified state management

### User Data Directory

- All user data stored in `./userdata/` directory (relative to executable)
- Includes: cookies, cache, local storage, session data
- No system-wide config files
- Easy to reset by deleting directory

## Critical Requirement: NO DevTools

**ABSOLUTE REQUIREMENT**: This browser must NEVER activate Chromium's developer tools (DevTools).

- **Why**: Many websites detect and block users when DevTools is opened
- **Solution**: Use only standard Electron APIs:
  - `session.webRequest.*` for network interception
  - `protocol.handle()` for response body capture
  - `webContents.executeJavaScript()` for DOM manipulation
  - `clipboard.writeText()` for clipboard operations
- **Forbidden**: Do NOT use `webContents.devToolsWin`, `openDevTools()`, or DevTools Protocol
- **Verification**: Test on anti-debugging sites to ensure no detection triggers

## Features

### 1. Network Monitor Panel

**Layout**:

- Fixed 500px width, 100% height, positioned on right side
- Web view takes remaining width
- Dark theme only (no light mode)

**Network Request List**:

- Displays all network requests chronologically (oldest at top)
- Each row shows: URL, method, status code
- Visual states:
  - **Faded (50% opacity)**: Request in progress
  - **Solid (100% opacity)**: Response complete
- Auto-scroll to bottom on new requests
- Clear on page navigation

**URL Filter**:

- Input field at top of panel
- Real-time filtering (case-insensitive substring match)
- Filters by URL only
- Clear input to show all requests

**Request Row Interaction**:

- Click row to copy command to clipboard
- For `.m3u8` files: Copies ffmpeg command with HLS streaming options
- For other files: Copies cURL command (HTTP method, URL, all request headers)
- Visual feedback: Row flashes green on successful copy

**Copy Page Source Button**:

- Fixed at bottom of panel
- Copies complete HTML source (main frame only) to clipboard
- Visual feedback: Button flashes green on successful copy

### 2. CLI Scraping Mode

Command-line arguments for automated web scraping. Browser remains visible (not headless).

#### Arguments

| Argument            | Shorthand | Type   | Description                                                                                 |
| ------------------- | --------- | ------ | ------------------------------------------------------------------------------------------- |
| `[URL]`             | -         | string | Initial URL to navigate to (required, positional argument)                                  |
| `--output-dir`      | `-o`      | string | Output directory for scraped responses (auto-created)                                       |
| `--output-curl`     | -         | bool   | Output cURL commands to stdout (works with --filter)                                        |
| `--filter`          | `-f`      | string | Regex URL filter (applies to both --output-dir and --output-curl)                           |
| `--selector`        | `-s`      | string | CSS selector to extract src attributes from DOM                                             |
| `--wait`            | `-w`      | number | Wait time in seconds after page load before starting idle timer (if --close-on-idle is set) |
| `--scroll`          | `-r`      | number | Pixels to scroll down every second                                                          |
| `--close-on-idle`   | `-c`      | number | Seconds of idle time before auto-close                                                      |
| `--rename-sequence` | -         | string | Number of digits for padding.                                                               |
| `--verbose`         | `-v`      | bool   | Enable verbose network traffic logging                                                      |

#### Eligibility Logic

A network response is eligible for dumping when:

1. **No filters**: All responses eligible
2. **`--filter` only**: Response URL matches regex
3. **`--selector` only**: Response URL matches source attribute of selected DOM element
4. **Both `--filter` and `--selector`**: Response must match BOTH (AND logic)

#### Source Attribute Extraction

When `--selector` specified, extract URLs using priority:

1. `src` attribute
2. `data-src` attribute

**URL Normalization**: Convert to absolute paths before matching.

#### Execution Flow

1. Parse CLI arguments
2. Instantiate OutputManager with CLI args
3. Register Protocol API handler (protocol.ts) - callbacks to main.ts
4. Navigate to `--url`
5. Wait for page load complete
6. If `--wait > 0`: Wait specified seconds (allows dynamic JS elements to load)
7. Queue page source update to end of event loop: `setTimeout(() => main.updatePageSource(), 0)`
8. If `--selector`: OutputManager buffers responses in unprocessedResponses
   - main.ts calls outputManager.updatePageSource(pageSource)
   - OutputManager extracts source URLs from DOM, normalizes, filters unprocessedResponses
   - OutputManager processes buffered responses immediately
9. If `--scroll`: After `--wait` period, scroll webview every second
   - After each scroll, queue page source update: `setTimeout(() => main.updatePageSource(), 100)`
10. If `--close-on-idle`: Start idle timer after `--wait` period
    - Timer resets on navigation events OR onOutput callbacks
    - If `--selector` also specified: Close when all source URLs completed (tracked via onOutput callbacks)
11. Output responses:
    - Without `--selector`: Output immediately when response completes (filtered by --filter if present)
    - With `--selector`: Output after page source is delivered and filtered

#### Close Behavior

**Without `--close-on-idle`**: Browser stays open for manual inspection regardless of `--wait`

**With `--close-on-idle`**: Idle timer starts after page load + `--wait` period (if specified), then closes when network is idle for the specified duration

**Close triggers** (evaluated in order after idle timer starts):

1. If `--selector`: Close when all source URLs have completed
2. Else: Close when idle timer expires

Timer is independent of `--scroll` and does NOT reset on new discoveries.

#### Exit Codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Success                                                |
| 1    | Invalid command line arguments                         |
| 2    | Output directory not writable                          |
| 3    | Expected selector response failed (404, blocked, etc.) |
| 4    | URL navigation failed                                  |
| 5    | File write failure                                     |

#### Examples

```bash
# Basic browser mode
initialxy-scraper https://example.com

# Dump all responses to directory
initialxy-scraper --output-dir ./downloads https://example.com

# Filter by extension and save
initialxy-scraper --filter "\.jpg$|\.png$" --output-dir ./images https://example.com

# Output cURL commands to stdout
initialxy-scraper --output-curl https://example.com

# Filter cURL output by URL pattern
initialxy-scraper --output-curl --filter "api\.example\.com" https://example.com

# Both file saving and cURL output together
initialxy-scraper --output-dir ./assets --output-curl --filter "\.json$" https://example.com

# Extract from selector with wait
initialxy-scraper --selector "img.lazy" --wait 5 --output-dir ./assets https://example.com

# Scroll for lazy loading
initialxy-scraper --scroll 100 --wait 3 --close-on-idle 10 --output-dir ./all https://example.com

# Sequential naming (preserves DOM order)
initialxy-scraper --selector "img" --rename-sequence 05d --output-dir ./images https://example.com
# Output: 00001.jpg, 00002.png, 00003.gif

# Verbose mode for debugging
initialxy-scraper --verbose --output-dir ./debug https://example.com
```

### 3. Keyboard Navigation

**Only supported hotkeys**:

| Hotkey              | Action           |
| ------------------- | ---------------- |
| `Alt + Left Arrow`  | Navigate back    |
| `Alt + Right Arrow` | Navigate forward |

All other keyboard shortcuts disabled.

### 4. User Data Management

**Directory Structure**:

```
./userdata/
├── Default/
│   ├── Cookies
│   ├── Local Storage/
│   ├── GPUCache/
│   ├── Code Cache/
│   └── ...
└── ...
```

**Management**:

- Auto-created on first run
- Delete entire directory to reset browser state
- No backup or migration needed
- Isolated per installation

## Technical Implementation

### Process Architecture

```
Main Process (main.ts) - Central Coordinator
│
├── Window Creation
│   └── Single BaseWindow (no frame)
│       └── Dual WebContentsView
│           ├── Left: Dynamic webview (external URLs)
│           └── Right: Fixed 500px panel (local HTML)
│
├── Protocol Handler (protocol.ts)
│   └── protocol.handle() - Request start/complete callbacks to main.ts
│
├── Output Manager (output_manager.ts)
│   ├── Filters responses based on --filter, --selector, --output-dir, --output-curl
│   ├── Buffers responses when --selector is active
│   ├── Processes page source via main.ts.updatePageSource()
│   └── Outputs to file/console via callbacks to main.ts
│
├── Automation Logic
│   ├── --wait: Delay before page source update
│   ├── --scroll: Scroll webview every second after --wait
│   └── --close-on-idle: Timer resets on output events
│
└── IPC Handlers
    └── network-request-start/complete → Renderer
        └── copy-to-clipboard, get-page-source ← Renderer
```

### Module Responsibilities

**main.ts** (Central Coordinator):

- Window creation and lifecycle management
- WebContents access (only module with direct access)
- Register protocol handler from protocol.ts
- Receive request/response callbacks from protocol.ts
- Send IPC events to renderer
- Coordinate automation (--wait, --scroll, --close-on-idle)
- Pass responses to output_manager.ts
- Call output_manager.updatePageSource() when needed
- Receive onOutput callbacks from output_manager.ts

**protocol.ts** (Protocol API Abstraction):

- ONLY handles protocol.handle() registration
- Forwards ALL requests unchanged (no modification)
- Callbacks to main.ts: onRequestStarted(request), onResponseCompleted(request, response)
- Uses separate session partition to avoid infinite recursion
- NO output logic, NO filtering, NO file I/O

**output_manager.ts** (Output Logic Abstraction):

- Receives CLI args: filter, selector, outputDir, outputCurl, renameSequence, flatDir
- Maintains unprocessedResponses buffer when --selector is active
- Receives page source via updatePageSource(pageSource) from main.ts
- Extracts source URLs from DOM using selector (src, data-src priority)
- Normalizes URLs to absolute paths
- Filters responses based on eligibility logic (filter + selector AND logic)
- Outputs to file (output-dir) or console (output-curl)
- Calls main.ts.onOutput(url) when response is output
- Handles sequential renaming with collision detection

### Protocol API (protocol.ts)

**Modern API (Electron 25+)**: Use `protocol.handle()` - NOT deprecated `registerBufferProtocol()`

**Responsibilities**:

- ONLY intercept and forward requests
- Callback to main.ts: `onRequestStarted(request)` with id, url, method, headers
- Callback to main.ts: `onResponseCompleted(request, response)` with id, url, statusCode, headers, body
- NO file I/O, NO filtering, NO output logic

**Implementation Pattern**:

```typescript
// protocol.ts
export class ProtocolHandler {
  private callbacks: ProtocolCallbacks;
  private inFlight = new Set<string>();

  constructor(baseUrl: string, callbacks: ProtocolCallbacks) {
    this.baseUrl = baseUrl;
    this.callbacks = callbacks;
  }

  register(session: Session): void {
    session.protocol.handle('https', async (request) => {
      // Track in-flight request
      this.inFlight.add(request.url);

      // Callback: request started
      this.callbacks.onRequestStarted({
        id: request.id,
        url: request.url,
        method: request.method,
        headers: request.headers,
      });

      try {
        // Forward request using bypass session to avoid recursion
        const response = await net.fetch(request.url, {
          method: request.method,
          headers: request.headers,
        });

        // Callback: response complete
        this.callbacks.onResponseCompleted({
          id: request.url,
          url: request.url,
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: Buffer.from(await response.arrayBuffer()),
        });

        // Return original response unchanged
        return new Response(response.body, {
          status: response.status,
          headers: response.headers,
        });
      } finally {
        this.inFlight.delete(request.url);
      }
    });
  }
}
```

**Critical Requirements**:

- Register in `app.whenReady()` - BEFORE any navigation
- Use bypass session (`session.fromPartition('persist:bypass')`) for internal fetch
- Track in-flight URLs with `Set` to detect recursive calls
- Return `Response` object with original status/headers
- Works at session level - independent of window type
- **NO output logic** - just callbacks to main.ts

**Why bypass session?**: Using `net.fetch()` or the default session triggers the protocol handler again, causing infinite recursion.

### Output Manager (output_manager.ts)

**Responsibilities**:

- Filter responses based on `--filter` regex and `--selector` DOM matching
- Buffer responses when `--selector` is active (wait for page source)
- Extract source URLs from HTML using jsdom (src, data-src priority)
- Normalize URLs to absolute paths
- Output to file (output-dir) or console (output-curl)
- Callback to main.ts: `onOutput(url)` when response is output (resets idle timer)

**Eligibility Logic**:

1. **No filters**: All responses eligible
2. **`--filter` only**: Response URL matches regex
3. **`--selector` only**: Response URL matches source attribute of selected DOM element
4. **Both `--filter` and `--selector`**: Response must match BOTH (AND logic)

**Source Attribute Extraction** (jsdom parsing):

1. `src` attribute
2. `data-src` attribute

**Response Processing Flow**:

```typescript
// When response completes
outputManager.responseCompleted(request, response) {
  if (this.selector) {
    // Buffer response, wait for page source
    this.unprocessedResponses.push({ request, response });
    return;
  }

  // No selector: process immediately
  this.processResponse(request, response);
}

// When main.ts calls updatePageSource
outputManager.updatePageSource(pageSource): void {
  // Parse HTML with jsdom - sourceUrls is local, not state
  const sourceUrls = extractSourceUrls(pageSource, this.selector);

  // Filter buffered responses
  for (const { request, response } of this.unprocessedResponses) {
    if (this.isEligible(response.url, sourceUrls)) {
      this.processResponse(request, response);
    }
  }

  // Clear buffer
  this.unprocessedResponses = [];
}

// Output to file or console
outputManager.processResponse(request, response) {
  if (this.outputCurl) {
    console.log(generateCurl(request.method, request.url, request.headers));
  }

  if (this.outputDir) {
    const filename = this.generateFilename(response.url);
    const filepath = path.join(this.outputDir, filename);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, response.body);
    // Exit code 5 on file write failure
  }

  // Notify main.ts (resets idle timer)
  this.callbacks.onOutput(response.url);
}
```

**API**:

```typescript
class OutputManager {
  constructor(options: {
    outputDir?: string;
    filter?: RegExp;
    selector?: string;
    renameSequence?: string;
    outputCurl?: boolean;
    flatDir?: boolean;
    onOutput: (url: string) => void;
  });

  responseCompleted(request: Request, response: Response): void;
  updatePageSource(pageSource: string): void;
}
```

### IPC Channels

| Channel                    | Direction       | Purpose                             |
| -------------------------- | --------------- | ----------------------------------- |
| `network-request-start`    | Main → Renderer | Request started (id, url, method)   |
| `network-request-complete` | Main → Renderer | Response complete (id, url, status) |
| `copy-to-clipboard`        | Renderer → Main | Copy text to clipboard              |
| `get-page-source`          | Renderer → Main | Get HTML source from main frame     |

### cURL Generation

Format:

```bash
curl -X <METHOD> "<URL>" \
  -H "Header1: value1" \
  -H "Header2: value2"
```

- Include HTTP method (`-X`)
- Include all request headers (`-H`)
- Properly escape special characters
- Request body NOT required

### FFmpeg Generation (for .m3u8 files)

Format:

```bash
ffmpeg -allowed_extensions ALL -protocol_whitelist file,http,https,tcp,tls -extension_picky 0 -readrate 4 -i "<URL>" -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 2000 -timeout 300000000 -headers 'User-Agent: <user-agent>' -acodec copy -bsf:a aac_adtstoasc -vcodec copy out.mp4
```

- Includes all HTTP headers except User-Agent (which is separate)
- HLS streaming optimized with reconnect logic
- Read rate limiting for smooth streaming
- Copies audio and video codecs without re-encoding
- Detects `.m3u8` extension automatically

## Out of Scope

- Multi-tab support
- Settings UI or preferences
- Bookmarks or history
- Extensions system
- Download manager UI
- Printer or print preview
- Reader mode
- Dark/Light theme toggle
- Panel resize or reposition
- Request/response body viewer in UI
- HAR export
- Performance metrics display

## Future Enhancements (Optional)

- Config file for default settings
- Multiple profile support
- Panel width customization
- Request details sidebar
- Response body preview (limited)
- Filter by resource type
- Export network log as JSON
- Custom user agent setting
- Proxy configuration

## Success Criteria

### Core Browser

- [ ] Browser launches with two-panel layout (web view left, network panel right)
- [ ] No navbar, address bar, or traditional browser UI
- [ ] Single webview, no tabs
- [ ] User data stored in `./userdata/` directory
- [ ] Alt+Left/Right arrow keys work for back/forward navigation
- [ ] Window is focusable and resizable

### Module Architecture

- [ ] **main.ts**: Central coordinator with WebContents access only
- [ ] **protocol.ts**: Protocol API abstraction with callbacks to main.ts
- [ ] **output_manager.ts**: Output logic with callbacks to main.ts
- [ ] No circular dependencies between modules
- [ ] Clear separation: protocol.ts has NO output logic, output_manager.ts has NO WebContents access

### Network Monitor Panel

- [ ] Panel displays all network requests chronologically
- [ ] Visual distinction: faded (pending) vs solid (complete)
- [ ] URL filter works in real-time
- [ ] Click row copies valid cURL to clipboard with flash feedback
- [ ] Click row copies ffmpeg command for .m3u8 files with flash feedback
- [ ] "Copy Page Source" button works with flash feedback
- [ ] Panel auto-clears on page navigation
- [ ] Dark theme matches minimal aesthetic
- [ ] Panel is 500px wide, reduces webview width accordingly

### CLI Scraping Mode

- [ ] Browser remains visible during scraping (not headless)
- [ ] All CLI arguments work as specified
- [ ] Output directory auto-created
- [ ] Protocol handler forwards requests unchanged
- [ ] OutputManager buffers responses when --selector is active
- [ ] OutputManager processes buffered responses after updatePageSource()
- [ ] Filter and selector eligibility logic works
- [ ] Source extraction uses correct priority (src, data-src)
- [ ] URL normalization converts to absolute paths
- [ ] Selector re-applies after each scroll (via setTimeout in main.ts)
- [ ] Scroll stops at page bottom (auto-detects and cancels interval)
- [ ] --wait defaults to 0, but still queues page source update
- [ ] Wait, scroll, and close-on-idle automation works
- [ ] --close-on-idle resets on onOutput callbacks
- [ ] Sequential renaming preserves DOM order when selector given
- [ ] Correct exit codes returned

### Security & Detection

- [ ] No DevTools activated (verify with `window.chrome` check)
- [ ] No DevTools Protocol usage
- [ ] Anti-debugging sites do not detect browser
- [ ] Standard browser fingerprint (no obvious automation flags)
