# initialxy-scraper

A minimal Electron-based web browser designed for network monitoring and automated web scraping. Strips away all unnecessary features to provide a focused tool for developers and automation scripts.

**Version**: 2.2.0  
**Electron**: 40.6.1 | **Node**: 24.x+ | **TypeScript**: 5.9.3

**Core Philosophy**: Maximum functionality with minimum surface area.

## Features

- **Two-Panel Layout**: Web view on the left, network monitor panel on the right (500px fixed)
- **Real-time Network Monitoring**: See all network requests as they happen
- **CLI Scraping Mode**: Automated web scraping with response capture
- **cURL Generation**: Click any request to copy as cURL command
- **FFmpeg Generation**: Click `.m3u8` files to copy ffmpeg HLS streaming command
- **No DevTools**: Uses only Electron APIs to avoid detection by anti-debugging sites
- **Dark Theme**: Minimal aesthetic, no light mode
- **Sequential Naming**: Optional numbered output with `--rename-sequence`

## Installation

```bash
npm install
```

## Usage

### Basic Browser Mode

```bash
npm start -- https://example.com
```

### CLI Scraping Mode

```bash
# Save responses to directory
npm start -- --output-dir ./scraped https://example.com

# Output cURL commands to stdout
npm start -- --output-curl https://example.com

# Filter by URL pattern
npm start -- --filter "\.json$" --output-dir ./data https://example.com

# Both file saving and cURL output
npm start -- --output-dir ./assets --output-curl --filter "\.json$" https://example.com

# Extract from selector with wait
npm start -- --selector "img.lazy" --wait 5 --output-dir ./assets https://example.com

# Scroll for lazy loading
npm start -- --scroll 100 --wait 3 --close-on-idle 10 --output-dir ./all https://example.com

# Sequential naming (preserves DOM order)
npm start -- --selector "img" --rename-sequence 05d --output-dir ./images https://example.com

# Flat output directory
npm start -- --output-dir ./flat --flat-dir https://example.com

# Verbose mode
npm start -- --verbose --output-dir ./debug https://example.com
```

### CLI Arguments

| Argument            | Shorthand | Type   | Description                                                                                 |
| ------------------- | --------- | ------ | ------------------------------------------------------------------------------------------- |
| `[URL]`             | -         | string | Initial URL to navigate to (required, positional)                                           |
| `--output-dir`      | `-o`      | string | Output directory for scraped responses (auto-created)                                       |
| `--output-curl`     | -         | bool   | Output cURL commands to stdout                                                              |
| `--filter`          | `-f`      | string | Regex URL filter (applies to both --output-dir and --output-curl)                           |
| `--selector`        | `-s`      | string | CSS selector to extract src attributes from DOM                                             |
| `--wait`            | `-w`      | number | Wait time in seconds after page load before starting idle timer (if --close-on-idle is set) |
| `--scroll`          | `-r`      | number | Pixels to scroll down every second                                                          |
| `--close-on-idle`   | `-c`      | number | Seconds of idle time before auto-close                                                      |
| `--rename-sequence` | -         | string | Zero-padding digit count for sequential naming (e.g., `4` for `0001`, `05` for `00001`)     |
| `--verbose`         | `-v`      | bool   | Enable verbose network traffic logging                                                      |
| `--flat-dir`        | -         | bool   | Flat output directory (no subdirectories)                                                   |


## Exit Codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Success                                                |
| 1    | Invalid command line arguments                         |
| 2    | Output directory not writable                          |
| 3    | Expected selector response failed (404, blocked, etc.) |
| 4    | URL navigation failed                                  |
| 5    | File write failure                                     |

## Development

```bash
# Format code
npm run format

# Type check
npm run check

# Start development
npm start -- https://example.com

# Build + launch with logging
npm run electron:dev
```

## Architecture

### Three-Module Separation

```
main.ts (Coordinator) ──┬→ ProtocolHandler (interception only)
                        │   callbacks → main.ts
                        ├→ OutputManager (filtering, buffering, output)
                        │   onOutput → AutomationManager
                        └→ AutomationManager (wait, scroll, close-on-idle)
```

### Window Structure

```
BaseWindow (1200x800)
├─ WebContentsView (left, dynamic) - External URLs
└─ WebContentsView (right, 500px) - Network Monitor UI
```

### Module Responsibilities

- **main.ts** (`src/main/main.ts`): Central coordinator with WebContents access
- **ProtocolHandler** (`src/shared/protocol.ts`): Protocol interception only
- **OutputManager** (`src/shared/output_manager.ts`): Filtering, buffering, output
- **AutomationManager** (`src/shared/automation.ts`): Timer abstractions
- **backend_utils.ts**: Node.js utilities (jsdom, path)
- **cross_stack_utils.ts**: Shared functions (generateCurl, isM3u8)
- **cli.ts**: CLI argument parsing
- **types.ts**: TypeScript interfaces
- **ui_panel.\***: Network Monitor UI (Vite-compiled)

### Key Implementation Details

1. **Protocol Handler Timing**: Load `about:blank` → register handler → navigate to URL
2. **Bypass Session**: `session.fromPartition('persist:bypass')` prevents infinite recursion
3. **Selector Buffering**: OutputManager buffers responses until `updatePageSource()` called
4. **Page Source Updates**: Triggered by `--wait` completion, `--scroll` intervals, or `did-finish-load`
5. **Exit Code 5**: File write failure

## License

MIT
