# initialxy-scraper - Technical Context

**Version**: 1.0.4
**Electron**: 40.6.1 | **Node**: 24.x+ | **TypeScript**: 5.9.3 | **Vite**: 7.3.1

---

## Architecture Overview

**Five-Module Separation**:

```
coordinator.ts (Coordinator) ──┬→ ProtocolHandler (interception only)
                                │   callbacks → coordinator.ts
                                ├→ OutputManager (filtering, buffering, output)
                                │   onOutput → AutomationManager
                                ├→ CookieStore (persistent cookie storage)
                                │   used by ProtocolHandler for persistence
                                └→ AutomationManager (wait, scroll, close-on-idle)

main.ts ──┬→ Window creation & lifecycle (Electron glue)
          ├→ IPC handlers (renderer ↔ main)
          ├→ CookieStore initialization
          └→ Navigation events → coordinator
```

**Window Structure**:

```
Main Window (1200x1000)              Network Monitor Window (500x600)
┌──────────────────────────┐         ┌────────────────────────┐
│ WebContentsView (full)   │         │ WebContentsView        │
│ - External URLs          │         │ - Network Monitor UI   │
│ - outerWidth ≈ innerWidth│         │                        │
└──────────────────────────┘         └────────────────────────┘
```

**Detection Evasion**: Main window has no child panels, so `outerWidth - innerWidth ≈ 0` (passes anti-detection checks). Monitor window is independent — closing main window also closes monitor.

**Window Lifecycle**: `createWindow()` returns `{ win, monitorWin, webViewInterface }`. Monitor window is created alongside main window and closed when main window closes (`win.on('closed')`).

---

## Module Responsibilities

### coordinator.ts (`src/main/coordinator.ts`)

- **Central coordination**: Creates OutputManager, wires ProtocolHandler callbacks, manages exit logic
- **Constructor params**: `protocolHandler`, `automationManager`, `webView` (injected dependencies)
- **Methods**:
  - `init(cliArgs)` - Creates OutputManager, sets up ProtocolHandler callbacks, registers protocol handler, starts AutomationManager
  - `responseCompleted(request, response)` - Forwards to OutputManager
  - `updatePageSource()` - Executes JS on webContents, passes to OutputManager, handles close-on-selector-complete logic
  - `closeOnIdleTimeout()` - Determines exit code and calls `process.exit()`
  - `closeOnSelectorCheck()` - Checks if all selector files saved, handles scroll-at-bottom check
- **NO direct Electron access** - delegates to injected `webView` and `automationManager`
- **All `process.exit()` calls** happen in Coordinator, never in main.ts

### main.ts (`src/main/main.ts`)

- **Thin Electron glue code** - window creation, lifecycle, IPC, navigation
- Window creation, lifecycle management (BaseWindow, WebContentsView)
- WebContents access (ONLY module with direct access)
- IPC handlers for renderer communication
- Navigation events → coordinator
- Exports: none (coordinator is module-level singleton)

### CookieStore (`src/shared/cookie_store.ts`)

- **Persistent cookie storage** using Node.js built-in `node:sqlite` (DatabaseSync)
- Uses WAL mode for concurrency
- Stores cookies in `userdata/cookies.db`
- **Methods**: `save()`, `saveAll()`, `loadAll()`, `loadByDomain()`, `deleteByDomain()`, `clear()`, `cleanup()`, `close()`
- **Expiry filtering**: `loadAll()` and `loadByDomain()` only return non-expired, non-session cookies
- **Domain normalization**: Strips leading dots from wildcard domains (e.g., `.example.com` → `example.com`)
- **CRITICAL**: `node:sqlite` does not have `db.pragma()` or `db.transaction()` — use `db.exec('PRAGMA ...')` and manual `BEGIN/COMMIT/ROLLBACK`
- **CRITICAL**: `node:sqlite` returns `bigint` for `changes` — must cast to `number`

### ProtocolHandler (`src/shared/protocol.ts`)

- **ONLY** protocol interception via `protocol.handle()`
- Callbacks: `onRequestStarted()`, `onResponseCompleted()`
- Manages cookies: retrieves from session for requests, stores from `Set-Cookie` responses
- Uses `inFlight` Set to prevent infinite recursion
- **NO** filtering, file I/O, or output logic

### OutputManager (`src/shared/output_manager.ts`)

- Filtering, buffering, file/console output
- `responseCompleted()` - processes immediately if URL matches current `sourceUrls`, otherwise buffers
- `updatePageSource()` - updates `sourceUrls` from page source, processes buffered responses
- Callback: `onOutput(url)` to reset idle timer
- Callback: `onAllSelectorFilesSaved()` when all selector-matched files are saved
- `hasPendingSelectorFiles()` - returns true if there are expected selector files that haven't been saved yet
- Tracks saved URLs in `savedUrls` Set to detect completion
- **NO** WebContents access

### AutomationManager (`src/shared/automation.ts`)

- **Single responsibility**: Timer abstractions only
- **Constructor params**: `waitS`, `scrollIntervalS`, `closeOnIdleTimeS`, `onScrollRequested`, `onUpdateRequested`, `onCloseRequested`
- **Methods**: `start()` - initializes all timers, `onOutputEvent()` - resets idle timer
- **NO access** to `webView` or `cliArgs` - delegates via callbacks
- **onScrollRequested**: Returns `Promise<void>` - triggers scroll continuously

---

## Testing Setup

**Test Framework**: Vitest 4.1.0

**Configuration** (`vitest.config.ts`):
- **Globals**: `true` (no import needed for test functions)
- **Environment**: `node`
- **Include**: `src/**/*.test.ts`
- **Setup file**: `test/setup/main.ts`
- **Fake timers**: Enabled by default (fakes `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`)
- **Aliases**: `@main`, `@shared`, `@renderer`

**Test Coverage** (`src/**/*.test.ts`):

| Test File | Tests | Key Coverage |
|-----------|-------|--------------|
| `src/main/coordinator.test.ts` | 20 | Constructor, init (OutputManager creation, callback wiring, register, start), responseCompleted, updatePageSource (JS execution, error handling, selector completion, scroll position), closeOnIdleTimeout, closeOnSelectorCheck, callback wiring |
| `src/shared/protocol.test.ts` | 31 | Constructor, register, setCallbacks, handleRequest (normal flow, method/headers forwarding, 204 null body), inFlight tracking, cookie handling (get/set, expiration, secure, httponly, samesite, domain, malformed), request ID tracking, response headers forwarding, storeCookies edge cases, getCookiesForUrl error handling |
| `src/shared/cookie_store.test.ts` | 15 | Constructor, save/load (single + batch), replace by key, expire session cookies, expire past-expiration, domain filtering, deleteByDomain, clear, sameSite handling, cleanup (session + expired), directory creation |
| `src/shared/output_manager.test.ts` | 20 | Constructor, responseCompleted (immediate processing + buffering), updatePageSource, filtering, file writing, curl/ffmpeg command generation, onAllSelectorFilesSaved callback |
| `src/shared/automation.test.ts` | 12 | Constructor, start, scroll logic, idle timer, onOutputEvent |
| `src/shared/backend_utils.test.ts` | 17 | normalizeFilename (pathname extraction, root default, no extension, query params, directory structure), normalizeFlatFilename (basename only), generateSequentialFilename (zero-padding, widths, extension preservation), normalizeUrlWithBase (relative resolution, absolute override, error fallback) |
| `src/shared/cross_stack_utils.test.ts` | 28 | escapeCurl (quotes, backticks, dollar signs, special chars, empty), generateCurl (basic, headers, continuation, escaping, methods), isM3u8 (extension, case-insensitive, query params, edge cases), generateFFmpegCommand (basic, headers, flags, escaping, URL input) |

**Test Setup** (`test/setup/main.ts`):
- Mocks entire Electron API for main process tests
- Key mocks: `app`, `BrowserWindow`, `ipcMain`, `protocol`, `session`, `screen`

**Test Commands**:
```bash
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:ui           # Test UI
npm run test:coverage     # Coverage report
```

---

## Key Files

| File                              | Purpose                                 |
| --------------------------------- | --------------------------------------- |
| `src/main/coordinator.ts`         | Central coordinator                     |
| `src/main/main.ts`                | Electron glue code (window, IPC, lifecycle) |
| `src/shared/protocol.ts`          | Protocol interception only              |
| `src/shared/cookie_store.ts`      | Persistent cookie storage (SQLite)      |
| `src/shared/output_manager.ts`    | Filtering, buffering, output            |
| `src/shared/automation.ts`        | Timing automation                       |
| `src/shared/backend_utils.ts`     | Node.js utilities (jsdom, path)         |
| `src/shared/cross_stack_utils.ts` | Shared functions (generateCurl, isM3u8) |
| `src/shared/cli.ts`               | CLI argument parsing                    |
| `src/shared/types.ts`             | TypeScript interfaces                   |
| `src/renderer/ui/ui_panel.*`      | Network Monitor UI (Vite-compiled)      |

---

## Critical Implementation Details

1. **Protocol Handler Timing**: Load `about:blank` → register handler → navigate to URL
2. **Cookie Management**: ProtocolHandler retrieves cookies from webContents session for requests and stores cookies from `Set-Cookie` responses. Cookies are persisted to SQLite (`userdata/cookies.db`) via CookieStore for durability across restarts.
3. **Infinite Recursion Prevention**: `inFlight` Set tracks URLs currently being processed; `net.fetch()` bypasses custom protocol handlers
4. **Selector Buffering**: OutputManager buffers responses until `updatePageSource()` called
5. **Page Source Updates**: Triggered by `--wait` completion, `--scroll` intervals, or `did-finish-load` (when `--selector` set without `--wait`)
6. **Exit codes defined in constants.ts**
7. **RESPONSE_WITHOUT_BODY**: Set([204, 304]) for clean status code handling
8. **Source Extraction**: Only `src` and `data-src` attributes are checked (not `srcset`)
9. **Cookie Persistence**: `node:sqlite` (built-in) used instead of `better-sqlite3` — no native compilation needed. `loadPersistedCookies()` called after ProtocolHandler creation to load cookies from SQLite into Electron session.
10. **Wildcard Domain Handling**: Cookie domains with leading dots (e.g., `.example.com`) must be stripped before constructing URLs for `session.cookies.set()` / `session.cookies.get()`.
11. **Clear Cookies Flag**: `--clear-cookies` calls `cookieStore.clear()` before `loadPersistedCookies()`, wiping the SQLite database.

---

## CLI Arguments

| Arg                 | Shorthand | Type   | Purpose                         |
| ------------------- | --------- | ------ | ------------------------------- |
| `[URL]`             | -         | string | Initial URL (required)          |
| `--output-dir`      | `-o`      | string | Output directory                |
| `--output-curl`     | -         | bool   | Output cURL to stdout           |
| `--filter`          | `-f`      | string | Regex URL filter                |
| `--selector`        | `-s`      | string | CSS selector for src extraction |
| `--wait`            | `-w`      | number | Wait seconds before idle timer  |
| `--scroll`          | `-r`      | number | Pixels to scroll per second     |
| `--close-on-idle`   | `-c`      | number | Seconds idle before close       |
| `--close-on-selector-complete` | - | bool | Close with exit code 0 when all selector files are saved |
| `--rename-sequence` | -         | string | Sprintf format (e.g., `05d`)    |
| `--verbose`         | `-v`      | bool   | Enable verbose logging          |
| `--flat-dir`        | -         | bool   | Flat output directory           |
| `--width`           | `-W`      | number | Initial window width            |
| `--height`           | `-H`      | number | Initial window height           |
| `--clear-cookies`   | -         | bool   | Clear all persisted cookies from SQLite database |

**Eligibility Logic**: `--filter` AND `--selector` (both must match if specified)

**Source Extraction Priority**: `src` → `data-src`

---

## IPC Channels

| Channel                    | Direction       | Purpose           |
| -------------------------- | --------------- | ----------------- |
| `network-request-start`    | Main → Renderer | Request started   |
| `network-request-complete` | Main → Renderer | Response complete |
| `copy-to-clipboard`        | Renderer → Main | Copy text         |
| `get-page-source`          | Renderer → Main | Get HTML source   |

---

## Security

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- No DevTools (anti-detection)
- User Agent: Electron branding stripped
- User data: `./userdata/` (relative to executable)

---

## Testing Commands

```bash
# Basic browser
npm start -- https://example.com

# Save responses
npm start -- --output-dir ./scraped https://example.com

# Output cURL
npm start -- --output-curl https://example.com

# With selector
npm start -- --selector "img" --output-dir ./images https://example.com

# Scroll + wait + close-on-idle
npm start -- --scroll 100 --wait 3 --close-on-idle 10 --output-dir ./all https://example.com

# Build + launch with logging
npm run electron:dev

# Run tests
npm run test
npm run test:watch
npm run test:coverage
```

---

## TypeScript Notes

- `verbatimModuleSyntax: true` - requires `.ts` extensions in imports
- Native Node.js TypeScript support (no transpilation needed)
- Vite compiles `ui_panel.ts` → `ui_panel.js` for renderer

---

## Common Patterns

**Full app initialization** (in main.ts):

```typescript
const { win, monitorWin, webViewInterface } = createWindow(cliArgs);

const automationManager = new AutomationManager({
  waitS: cliArgs.wait || 0,
  scrollIntervalS: cliArgs.scroll ? 1 : 0,
  closeOnIdleTimeS: cliArgs.closeOnIdle || null,
  onScrollRequested: async () => {
    await webView?.webContents.executeJavaScript(`window.scrollBy(0, ${cliArgs.scroll});`);
  },
  onUpdateRequested: async () => {
    await coordinator?.updatePageSource();
  },
  onCloseRequested: () => {
    coordinator?.closeOnIdleTimeout();
  },
});

const cookieStore = new CookieStore(path.join(userDataPath, 'cookies.db'));

if (cliArgs.clearCookies) {
  cookieStore.clear();
  console.log('[App] Cookies cleared');
}

const protocolHandler = new ProtocolHandler(
  webViewInterface.webContents.getURL() || 'about:blank',
  { onRequestStarted: () => {}, onResponseCompleted: () => {} },
  webViewInterface.webContents.session || session.defaultSession,
  cookieStore
);

protocolHandler.loadPersistedCookies();

coordinator = new Coordinator({
  protocolHandler,
  automationManager,
  webView: webViewInterface,
});

coordinator.init(cliArgs);

win.show();
monitorWin?.show();
```

**ProtocolHandler instantiation** (standalone):

```typescript
const handler = new ProtocolHandler(baseUrl, callbacks, session);
handler.register();
```

**ProtocolHandler instantiation** (with cookie persistence):

```typescript
const cookieStore = new CookieStore(path.join(userDataPath, 'cookies.db'));
const handler = new ProtocolHandler(baseUrl, callbacks, session, cookieStore);
handler.register();
handler.loadPersistedCookies();
```

**CookieStore instantiation**:

```typescript
const cookieStore = new CookieStore(path.join(userDataPath, 'cookies.db'));
// Optionally clear all cookies
if (cliArgs.clearCookies) {
  cookieStore.clear();
}
// Load cookies into Electron session
protocolHandler.loadPersistedCookies();
```

**OutputManager instantiation** (inside Coordinator.init):

```typescript
const manager = new OutputManager({
  outputDir,
  filter,
  selector,
  renameSequence,
  outputCurl,
  flatDir,
  baseUrl,
  onOutput: () => automationManager?.onOutputEvent(),
  onAllSelectorFilesSaved: () => {
    if (cliArgs.closeOnSelectorComplete && !cliArgs.scroll) {
      process.exit(EXIT_CODES.success);
    }
  },
});
```

**Page source update** (inside Coordinator):

```typescript
export async function updatePageSource(): Promise<void> {
  if (!outputManager) return;
  const source = await webView.webContents.executeJavaScript('document.documentElement.outerHTML');
  outputManager.updatePageSource(source);
}
```

**AutomationManager instantiation**:

```typescript
const automationManager = new AutomationManager({
  waitS: cliArgs.wait || 0,
  scrollIntervalS: 1,
  closeOnIdleTimeS: cliArgs.closeOnIdle || null,
  onScrollRequested: async () => {
    await webView?.webContents.executeJavaScript(
      `window.scrollBy(0, ${cliArgs.scroll});`
    );
  },
  onUpdateRequested: async () => {
    await updatePageSource();
  },
  onCloseRequested: () => {
    // When --close-on-selector-complete is set, check hasPendingSelectorFiles()
    // to determine exit code. Otherwise always use closeOnIdleTimeout.
    if (cliArgs.closeOnSelectorComplete && outputManager && !outputManager.hasPendingSelectorFiles()) {
      process.exit(EXIT_CODES.success);
    } else {
      process.exit(EXIT_CODES.closeOnIdleTimeout);
    }
  },
});
automationManager.start();
```
