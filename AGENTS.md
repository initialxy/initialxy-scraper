# initialxy-scraper - Technical Context

**Version**: 2.2.0  
**Electron**: 40.6.1 | **Node**: 24.x+ | **TypeScript**: 5.9.3 | **Vite**: 7.3.1

---

## Architecture Overview

**Three-Module Separation**:

```
main.ts (Coordinator) ──┬→ ProtocolHandler (interception only)
                        │   callbacks → main.ts
                        ├→ OutputManager (filtering, buffering, output)
                        │   onOutput → AutomationManager
                        └→ AutomationManager (wait, scroll, close-on-idle)
```

**Window Structure**:

```
BaseWindow (1200x800)
├─ WebContentsView (left, dynamic) - External URLs
└─ WebContentsView (right, 500px) - Network Monitor UI
```

---

## Module Responsibilities

### main.ts (`src/main/main.ts`)

- Window creation, lifecycle management
- WebContents access (ONLY module with direct access)
- IPC handlers for renderer communication
- Exports: `updatePageSource()`, `scrollAndUpdate()`

### ProtocolHandler (`src/shared/protocol.ts`)

- **ONLY** protocol interception via `protocol.handle()`
- Callbacks: `onRequestStarted()`, `onResponseCompleted()`
- Uses bypass session (`persist:bypass`) to prevent infinite recursion
- **NO** filtering, file I/O, or output logic

### OutputManager (`src/shared/output_manager.ts`)

- Filtering, buffering, file/console output
- `responseCompleted()` - buffers when `--selector` active
- `updatePageSource()` - processes buffered responses
- Callback: `onOutput(url)` to reset idle timer
- **NO** WebContents access

### AutomationManager (`src/shared/automation.ts`)

- `--wait`: delays page source update
- `--scroll`: scrolls every second after wait
- `--close-on-idle`: closes after idle period
- `onOutputEvent()`: resets idle timer

---

## Key Files

| File                              | Purpose                                 |
| --------------------------------- | --------------------------------------- |
| `src/main/main.ts`                | Central coordinator                     |
| `src/shared/protocol.ts`          | Protocol interception only              |
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
2. **Bypass Session**: `session.fromPartition('persist:bypass')` prevents infinite recursion
3. **Selector Buffering**: OutputManager buffers responses until `updatePageSource()` called
4. **Page Source Updates**: Triggered by `--wait` completion, `--scroll` intervals, or `did-finish-load` (when `--selector` set without `--wait`)
5. **Exit Code 5**: File write failure
6. **RESPONSE_WITHOUT_BODY**: Set([204, 304]) for clean status code handling

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
| `--rename-sequence` | -         | string | Sprintf format (e.g., `05d`)    |
| `--verbose`         | `-v`      | bool   | Enable verbose logging          |
| `--flat-dir`        | -         | bool   | Flat output directory           |

**Eligibility Logic**: `--filter` AND `--selector` (both must match if specified)

**Source Extraction Priority**: `src` → `data-src` → `srcset` (parse all URLs)

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
```

---

## TypeScript Notes

- `verbatimModuleSyntax: true` - requires `.ts` extensions in imports
- Native Node.js TypeScript support (no transpilation needed)
- Vite compiles `ui_panel.ts` → `ui_panel.js` for renderer

---

## Common Patterns

**ProtocolHandler instantiation**:

```typescript
const handler = new ProtocolHandler(baseUrl, {
  onRequestStarted: (req) => {
    /* send IPC */
  },
  onResponseCompleted: (req, res) => {
    /* forward to OutputManager */
  },
});
```

**OutputManager instantiation**:

```typescript
const manager = new OutputManager({
  outputDir,
  filter,
  selector,
  renameSequence,
  outputCurl,
  flatDir,
  baseUrl,
  onOutput: (url) => automationManager?.onOutputEvent(),
});
```

**Page source update**:

```typescript
export async function updatePageSource(): Promise<void> {
  if (!webView?.webContents || !outputManager) return;
  const source = await webView.webContents.executeJavaScript('document.documentElement.outerHTML');
  outputManager.updatePageSource(source);
}
```
