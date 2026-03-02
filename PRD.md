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

- Click row to copy cURL command to clipboard
- cURL includes: HTTP method, URL, all request headers
- Visual feedback: Row flashes green on successful copy

**Copy Page Source Button**:

- Fixed at bottom of panel
- Copies complete HTML source (main frame only) to clipboard
- Visual feedback: Button flashes green on successful copy

### 2. CLI Scraping Mode

Command-line arguments for automated web scraping. Browser remains visible (not headless).

#### Arguments

| Argument            | Shorthand | Type   | Description                                           |
| ------------------- | --------- | ------ | ----------------------------------------------------- |
| `--output`          | `-o`      | string | Output directory for scraped responses (auto-created) |
| `--filter`          | `-f`      | string | Regex URL filter for eligible responses               |
| `--selector`        | `-s`      | string | CSS selector to extract src attributes from DOM       |
| `--wait`            | `-w`      | number | Wait time in seconds after page load                  |
| `--scroll`          | `-r`      | number | Pixels to scroll down every second                    |
| `--close-on-idle`   | `-c`      | number | Seconds of idle time before auto-close                |
| `--rename-sequence` | -         | string | Sprintf format for sequential naming (e.g., `05d`)    |
| `--url`             | `-u`      | string | Initial URL to navigate to (required for CLI mode)    |

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
3. `srcset` attribute (parse ALL URLs, preserve order)

**URL Normalization**: Convert to absolute paths before matching.

#### Execution Flow

1. Parse CLI arguments
2. If `--output` present, register Protocol API handler
3. Navigate to `--url`
4. Wait for page load complete
5. If `--wait`: Buffer responses during wait period
6. If `--selector`: Apply selector, extract source URLs
7. If `--scroll`: Scroll down 1px/second until bottom
   - Re-apply `--selector` after each scroll (via `setTimeout`)
8. Dump eligible responses to output directory
9. Close based on `--close-on-idle` logic

#### Close Behavior

**Without `--close-on-idle`**: Browser stays open for manual inspection

**With `--close-on-idle`** (evaluated in order):

1. If `--selector`: Close when all source URLs have completed
2. Else if `--wait`: Close when wait period ends
3. Else: Close when page load finishes

Timer is independent of `--scroll` and does NOT reset on new discoveries.

#### Exit Codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Success                                                |
| 1    | Invalid command line arguments                         |
| 2    | Output directory not writable                          |
| 3    | Expected selector response failed (404, blocked, etc.) |
| 4    | URL navigation failed                                  |

#### Examples

```bash
# Dump all responses
initialxy-scraper --output ./downloads --url https://example.com

# Filter by extension
initialxy-scraper --filter "\.jpg$|\.png$" --output ./images --url https://example.com

# Extract from selector with wait
initialxy-scraper --selector "img.lazy" --wait 5 --output ./assets --url https://example.com

# Scroll for lazy loading
initialxy-scraper --scroll 100 --wait 3 --close-on-idle 10 --output ./all --url https://example.com

# Sequential naming (preserves DOM order)
initialxy-scraper --selector "img" --rename-sequence 05d --output ./images --url https://example.com
# Output: 00001.jpg, 00002.png, 00003.gif
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
Main Process (main.js)
│
├── Window Creation
│   └── Single BrowserWindow (no frame)
│       ├── WebContents (left panel)
│       └── Network Panel DIV (right panel, rendered in browser)
│
├── Protocol Handler (when --output present)
│   └── protocol.handle()
│
├── WebRequest Listeners
│   └── session.webRequest.onBeforeRequest/onCompleted
│
└── IPC Handlers
    └── copy-to-clipboard, get-page-source
```

### Protocol API for Response Capture

**Modern API (Electron 25+)**: Use `protocol.handle()` - NOT deprecated `registerBufferProtocol()`

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
- Register in `app.whenReady()` - BEFORE any navigation
- Use `net.fetch()` to forward request - do NOT block/modify
- Return `Response` object with original status/headers
- Works at session level - independent of window type

**Why it works**: Protocol handlers intercept at network layer, before request leaves browser. We fetch the actual response, capture it, then return it unchanged to the page.

**Performance**: Adds overhead - only enable when `--output` flag present.

### IPC Channels

| Channel                    | Direction       | Purpose           |
| -------------------------- | --------------- | ----------------- |
| `network-request-start`    | Main → Renderer | Request started   |
| `network-request-complete` | Main → Renderer | Response complete |
| `copy-to-clipboard`        | Renderer → Main | Copy text         |
| `get-page-source`          | Renderer → Main | Get HTML source   |

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

### Network Monitor Panel

- [ ] Panel displays all network requests chronologically
- [ ] Visual distinction: faded (pending) vs solid (complete)
- [ ] URL filter works in real-time
- [ ] Click row copies valid cURL to clipboard with flash feedback
- [ ] "Copy Page Source" button works with flash feedback
- [ ] Panel auto-clears on page navigation
- [ ] Dark theme matches minimal aesthetic
- [ ] Panel is 500px wide, reduces webview width accordingly

### CLI Scraping Mode

- [ ] Browser remains visible during scraping (not headless)
- [ ] All CLI arguments work as specified
- [ ] Output directory auto-created
- [ ] Protocol API captures and saves responses correctly
- [ ] Protocol API does NOT modify or block requests
- [ ] Filter and selector eligibility logic works
- [ ] Source extraction uses correct priority (src, data-src, srcset)
- [ ] srcset parsing extracts ALL URLs in order
- [ ] URL normalization converts to absolute paths
- [ ] Selector re-applies after each scroll (via setTimeout)
- [ ] Scroll stops at page bottom
- [ ] Wait, scroll, and close-on-idle automation works
- [ ] `--close-on-idle` independent of `--scroll`, no reset on discoveries
- [ ] Sequential renaming preserves DOM order when selector given
- [ ] Correct exit codes returned

### Security & Detection

- [ ] No DevTools activated (verify with `window.chrome` check)
- [ ] No DevTools Protocol usage
- [ ] Anti-debugging sites do not detect browser
- [ ] Standard browser fingerprint (no obvious automation flags)
