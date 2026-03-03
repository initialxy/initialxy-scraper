# initialxy-scraper (Work In Progress)

A minimal Electron-based web browser designed for network monitoring and automated web scraping. Strips away all unnecessary features to provide a focused tool for developers and automation scripts.

**Core Philosophy**: Maximum functionality with minimum surface area.

## Features

- **Two-Panel Layout**: Web view on the left, network monitor panel on the right (500px fixed)
- **Real-time Network Monitoring**: See all network requests as they happen
- **CLI Scraping Mode**: Automated web scraping with response capture
- **cURL Generation**: Click any request to copy as cURL command
- **No DevTools**: Uses only Electron APIs to avoid detection by anti-debugging sites
- **Dark Theme**: Minimal aesthetic, no light mode

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

# Verbose mode
npm start -- --verbose --output-dir ./debug https://example.com
```

### CLI Arguments

| Argument            | Shorthand | Type   | Description                                                       |
| ------------------- | --------- | ------ | ----------------------------------------------------------------- |
| `[URL]`             | -         | string | Initial URL to navigate to (required, positional)                 |
| `--output-dir`      | `-o`      | string | Output directory for scraped responses (auto-created)             |
| `--output-curl`     | -         | bool   | Output cURL commands to stdout                                    |
| `--filter`          | `-f`      | string | Regex URL filter (applies to both --output-dir and --output-curl) |
| `--selector`        | `-s`      | string | CSS selector to extract src attributes from DOM                   |
| `--wait`            | `-w`      | number | Wait time in seconds after page load                              |
| `--scroll`          | `-r`      | number | Pixels to scroll down every second                                |
| `--close-on-idle`   | `-c`      | number | Seconds of idle time before auto-close                            |
| `--rename-sequence` | -         | string | Sprintf format for sequential naming (e.g., `05d`)                |
| `--verbose`         | `-v`      | bool   | Enable verbose network traffic logging                            |

### Keyboard Navigation

| Hotkey              | Action           |
| ------------------- | ---------------- |
| `Alt + Left Arrow`  | Navigate back    |
| `Alt + Right Arrow` | Navigate forward |

## Development

```bash
# Format code
npm run format

# Type check
npm run check

# Start development
npm start -- https://example.com
```

## Architecture

- **Electron 40.6.1** with **TypeScript 5.9.3**
- **BaseWindow + Dual WebContentsView** (modern Electron 30+ API)
- **Protocol API** (`protocol.handle()`) for network interception
- **Shared Modules** in `src/shared/` for type-safe abstractions

## Security

- No DevTools activated (avoids anti-debugging detection)
- Node.js integration disabled in renderer
- Context isolation enabled
- OS sandboxing enabled

## License

MIT
