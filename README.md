# initialxy-scraper

[![Node.js CI](https://github.com/initialxy/initialxy-scraper/actions/workflows/node.js.yml/badge.svg)](https://github.com/initialxy/initialxy-scraper/actions/workflows/node.js.yml)

A minimal Electron-based web browser specifically designed for web scraping purposes with a focus on automation by a coordination script. The key is to **not** activate Chrome Driver, Developer Tools or remote debugger, which can be detected by modern anti-scraping measures. I recently noticed that even [undetected_chromedriver](https://github.com/ultrafunkamsterdam/undetected-chromedriver) is detected by some sites, because it relies on keeping a remote debugger open. So I tried to find a more fool-proof solution instead of spending more time trying to reverse engineer and defeat these anti-scraping solutions in a cat-and-mouse game. The solution that I've built here is to create a custom web browser using Electron, which in turn uses Chromium. Then use [protocol API](https://www.electronjs.org/docs/latest/api/protocol) to monitor the app's own network traffic without activating any of the developer, debugger or automation features. Therefore from the perspective of the target website, it looks exactly the same as any other Chromium browser. I believe there are other scraping tools using a similar principle, but I did not find one that satisfies the workflow I'm looking for.

Additionally, I wanted to use this exercise to play with a **fully local** vibe coding experience using the recently released [Qwen 3.5](https://huggingface.co/collections/Qwen/qwen35) variants and [opencode](https://opencode.ai/). My [last experiment](https://github.com/initialxy/initialxy-points) did not go as well as I hoped, where I still had to review all the code and manually write all the core logic.

![sample](sample.jpg 'Browser')

**Electron**: 40.6.1 | **Node**: 24.x+ | **TypeScript**: 5.9.3

## Security Warning

**DO NOT use this browser for normal web browsing or personal activities.** This browser is designed exclusively for web scraping and automation purposes, coordinated by external scripts. It lacks essential security features and protections found in regular browsers. Use only for its intended purpose.

## Features

- **No DevTools, Debugger or Automation activation**: Avoid detection by modern anti-scraping solutions
- **Network Monitoring**: See all network requests and copy as cURL or ffmpeg commands to replay them exactly as is.
- **CLI Scraping Automation**: Automated bulk scraping with another script without Chrome Driver or Remote Debugger.
- **Advanced Filters**: Not only can you filter by URL patterns, but also use CSS selector on the page source to find targeted elements and extract their sources while preserving order based on DOM structure.
- **Automatic Scrolling**: Scroll automatically at a customized speed to defeat lazy loading or infinite scrolling elements.
- **Close on idle**: Automatically exit the process after a period of inactivity, which allows coordination script to move on to the next URL in a bulk process without having to inspect browser behavior.

## Installation

```bash
npm install
```

## Usage

### Basic Browser Mode

```bash
npm start -- https://initialxy.com
```

### CLI Scraping Mode

```bash
# Save responses to directory
npm start -- --output-dir ./scraped https://initialxy.com

# Output cURL commands to stdout
npm start -- --output-curl https://initialxy.com

# Filter by URL pattern
npm start -- --filter "\.json$" --output-dir ./data https://initialxy.com

# Both file saving and cURL output
npm start -- --output-dir ./assets --output-curl --filter "\.json$" https://initialxy.com

# Extract from selector with wait
npm start -- --selector "img.lazy" --wait 5 --output-dir ./assets https://initialxy.com

# Scroll for lazy loading
npm start -- --scroll 100 --wait 3 --close-on-idle 10 --output-dir ./all https://initialxy.com

# Sequential naming (preserves DOM order)
npm start -- --selector "img" --rename-sequence 3 --output-dir ./images https://initialxy.com

# Flat output directory
npm start -- --output-dir ./flat --flat-dir https://initialxy.com

# Verbose mode
npm start -- --verbose --output-dir ./debug https://initialxy.com
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
| `--rename-sequence` | -         | string | Number of digits for zero-padding (e.g., `4` for `0001`, `05` for `00001`)                  |
| `--verbose`         | `-v`      | bool   | Enable verbose network traffic logging                                                      |
| `--flat-dir`        | -         | bool   | Flat output directory (no subdirectories)                                                   |
| `--width`           | `-W`      | number | Initial window width in pixels                                                              |
| `--height`          | `-H`      | number | Initial window height in pixels                                                             |

## Exit Codes

| Code | Meaning                        |
| ---- | ------------------------------ |
| 0    | Success                        |
| 1    | Invalid command line arguments |
| 2    | File write failure             |

## Development

```bash
# Format code
npm run format

# Type check
npm run check

# Start development
npm start -- https://initialxy.com

# Build + launch with logging
npm run electron:dev
```

## Vibe Experience

As I mentioned earlier, one of the motivations for why I created this project is to exercise a **fully local** vibe coding experience. We have come a long way since my [last attempt](https://github.com/initialxy/initialxy-points). So I'd like to make a commentary of my experience. First of all, my setup, I have [Qwen 3.5](https://huggingface.co/collections/Qwen/qwen35) running locally on my RX 7900 XTX using [llama.cpp](https://github.com/ggml-org/llama.cpp) and [opencode](https://opencode.ai/) for code generation. I switched between their Qwen3.5-35B-A3B for speed Qwen3.5-27B for quality depending on scenarios. Here are the exact launch commands that were used.

```bash
./llama-server -m /home/initialxy/ML/llm/models/Qwen3.5-35B-A3B-IQ4_XS.gguf -a 'qwen' -c 131072 -ngl all -fa on --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.0 --cache-ram 131072 --ctx-checkpoints 64

./llama-server -m /home/initialxy/ML/llm/models/Qwen3.5-27B-Q4_K_M.gguf -a 'qwen' -c 131072 -ngl all -fa on -ctk q8_0 -ctv q8_0 --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.0 --cache-ram 131072 --ctx-checkpoints 64
```

As of writing, opencode + llama.cpp + Qwen 3.5 really has an issue with aggressive re-processing the full prompt. This is a known issue and I'm following closely to see if there will be a solution.

As for vibe coding experience, I use Claude Code at work, so that's my point of reference. My goal is to see how far I can go without having to look at code at all. I'm happy to report that I was able to get most of the core feature working without even looking at the code, hence delivering a fair vibe coding experience, which I was not able to achieve in my last experiment. It was able to implement, debug and clean up fairly well. However towards the end, I did have to put my engineer hat on and review the code it created, as it was getting very confused by the `--wait`, `--scroll` and `--close-on-idle` features, and really struggled to debug. To be fair to Qwen 3.5, it had limited debug access to the app. As I reviewed its code, I did have to call out that it's kind of a mess. Lots of spaghetti interactions and very poorly modularized separation of concerns, which made the code badly tangled. I had to hold its hands and plan out a refactoring strategy with it. See commit: [da46f66](https://github.com/initialxy/initialxy-scraper/commit/da46f660e3a929a9f32c09b67695121e1d86eee5) to [530062e1](https://github.com/initialxy/initialxy-scraper/commit/53062e10412493eaf464b4b6ec0cf4555ba3d0b8). It was able to perform the refactor on its own. Afterwards, it was able to finish the rest of the feature implementations fairly smoothly. I did another round of [manual review and debugging](https://github.com/initialxy/initialxy-scraper/commit/378ee0ea92d7346d8aa51a78eaaca970388ddc48) to close out some of the gaps.

Overall, I'd say that in terms of lines of code, Qwen 3.5 wrote about 90% this time, and most of them were done without me having to keep an eye on it. While it is not the full vibe coding experience I was hoping for, it came fairly close, and was able to deliver for most parts.

## License

MIT
