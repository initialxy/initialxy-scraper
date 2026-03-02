import {
  app,
  BaseWindow,
  WebContentsView,
  nativeTheme,
  protocol,
  session,
  ipcMain,
  clipboard,
  globalShortcut,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Parse CLI arguments
function parseCLIArgs(): {
  outputDir?: string;
  url?: string;
  filter?: RegExp;
  selector?: string;
  wait?: number;
  scroll?: number;
  closeOnIdle?: number;
  renameSequence?: string;
} {
  const args: ReturnType<typeof parseCLIArgs> = {};

  // --output / -o
  const outputMatch =
    process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-o' || arg.startsWith('-o='))?.split('=')[1];
  if (outputMatch) {
    args.outputDir = path.resolve(process.cwd(), outputMatch);
  }

  // --url / -u
  const urlMatch =
    process.argv.find((arg) => arg.startsWith('--url='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-u' || arg.startsWith('-u='))?.split('=')[1];
  if (urlMatch) {
    args.url = urlMatch;
  }

  // --filter / -f
  const filterMatch =
    process.argv.find((arg) => arg.startsWith('--filter='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-f' || arg.startsWith('-f='))?.split('=')[1];
  if (filterMatch) {
    args.filter = new RegExp(filterMatch);
  }

  // --selector / -s
  const selectorMatch =
    process.argv.find((arg) => arg.startsWith('--selector='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-s' || arg.startsWith('-s='))?.split('=')[1];
  if (selectorMatch) {
    args.selector = selectorMatch;
  }

  // --wait / -w
  const waitMatch =
    process.argv.find((arg) => arg.startsWith('--wait='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-w' || arg.startsWith('-w='))?.split('=')[1];
  if (waitMatch) {
    args.wait = parseFloat(waitMatch);
  }

  // --scroll / -r
  const scrollMatch =
    process.argv.find((arg) => arg.startsWith('--scroll='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-r' || arg.startsWith('-r='))?.split('=')[1];
  if (scrollMatch) {
    args.scroll = parseFloat(scrollMatch);
  }

  // --close-on-idle / -c
  const closeOnIdleMatch =
    process.argv.find((arg) => arg.startsWith('--close-on-idle='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-c' || arg.startsWith('-c='))?.split('=')[1];
  if (closeOnIdleMatch) {
    args.closeOnIdle = parseFloat(closeOnIdleMatch);
  }

  // --rename-sequence
  const renameSequenceMatch = process.argv
    .find((arg) => arg.startsWith('--rename-sequence='))
    ?.split('=')[1];
  if (renameSequenceMatch) {
    args.renameSequence = renameSequenceMatch;
  }

  return args;
}

const cliArgs = parseCLIArgs();

// Create output directory if specified
if (cliArgs.outputDir) {
  if (!fs.existsSync(cliArgs.outputDir)) {
    fs.mkdirSync(cliArgs.outputDir, { recursive: true });
  }
  console.log(`[Protocol API] Output directory: ${cliArgs.outputDir}`);
}

// Track URLs being processed to prevent infinite recursion
const processingUrls = new Set<string>();

// Track filename collisions
const filenameCounter = new Map<string, number>();

// Track network requests for UI panel
const activeRequests = new Map<
  string,
  {
    id: number;
    url: string;
    method: string;
    headers: Record<string, string>;
  }
>();

// Track source URLs from selector
const sourceUrls = new Set<string>();

// Track completed source URLs
const completedSourceUrls = new Set<string>();

let requestIdCounter = 0;

// Send network events to UI panel
function sendNetworkEvent(
  eventType: 'start' | 'complete',
  requestId: number,
  url: string,
  method: string,
  headers: Record<string, string>,
  statusCode?: number
) {
  if (!uiView) return;

  const data = {
    id: requestId,
    url,
    method,
    headers,
    statusCode,
  };

  uiView.webContents.send(`network-request-${eventType}`, data);
}

// Generate filename from URL
function generateFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname || '/index';
    const baseName = pathname.split('/').filter(Boolean).join('/') || 'index';
    const ext = path.extname(baseName) || '.html';
    const nameWithoutExt = baseName.replace(ext, '');

    // Handle collisions by adding counter
    const currentCount = filenameCounter.get(nameWithoutExt) || 0;
    filenameCounter.set(nameWithoutExt, currentCount + 1);

    if (currentCount === 0) {
      return `${nameWithoutExt}${ext}`;
    }
    return `${nameWithoutExt}_${currentCount}${ext}`;
  } catch {
    return `response_${Date.now()}.dat`;
  }
}

// Generate sequential filename
function generateSequentialFilename(url: string, counter: number): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname || '/index';
    const baseName = path.basename(pathname);
    const ext = path.extname(baseName) || '.html';

    const formattedNum = counter.toString().padStart(parseInt(cliArgs.renameSequence!), '0');
    return `${formattedNum}${ext}`;
  } catch {
    return `response_${Date.now()}.dat`;
  }
}

// Normalize URL to absolute path
function normalizeUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

// Extract source URLs from DOM
async function extractSourceUrls(webContents: WebContentsView['webContents']): Promise<string[]> {
  if (!cliArgs.selector) return [];

  try {
    const urls = await webContents.executeJavaScript(`
      (function() {
        const elements = document.querySelectorAll('${cliArgs.selector}');
        const results = [];
        
        elements.forEach(el => {
          // Priority 1: src attribute
          if (el.src) {
            results.push(el.src);
          }
          // Priority 2: data-src attribute
          else if (el.dataset && el.dataset.src) {
            results.push(el.dataset.src);
          }
          // Priority 3: srcset attribute (parse all URLs)
          else if (el.srcset) {
            const srcsetUrls = el.srcset.split(',').map(src => {
              const parts = src.trim().split(/ /);
              return parts[0];
            });
            results.push(...srcsetUrls);
          }
        });
        
        return results;
      })()
    `);
    return Array.isArray(urls) ? urls : [];
  } catch (error) {
    console.error('[Protocol API] Error extracting source URLs:', error);
    return [];
  }
}

// Check if URL is eligible for capture
function isEligible(url: string): boolean {
  // If no filters, all URLs are eligible
  if (!cliArgs.filter && !cliArgs.selector) {
    return true;
  }

  // If only filter specified
  if (cliArgs.filter && !cliArgs.selector) {
    return cliArgs.filter.test(url);
  }

  // If only selector specified
  if (!cliArgs.filter && cliArgs.selector) {
    return sourceUrls.has(url);
  }

  // If both filter and selector specified (AND logic)
  if (cliArgs.filter && cliArgs.selector) {
    return cliArgs.filter.test(url) && sourceUrls.has(url);
  }

  return false;
}

let webView: WebContentsView | null | undefined = null;
let uiView: WebContentsView | null | undefined = null;

function createWindow(): void {
  // Create a BaseWindow (not BrowserWindow) for multi-view support
  const win = new BaseWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
  });

  // Left panel: Web browser WebContentsView
  webView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.contentView.addChildView(webView);

  // Load URL in the web view
  if (cliArgs.url) {
    webView!.webContents.loadURL(cliArgs.url);
  } else {
    webView!.webContents.loadURL('about:blank');
  }

  // Right panel: UI panel WebContentsView
  uiView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(path.dirname(new URL(import.meta.url).pathname), '../renderer/preload.js'),
    },
  });

  win.contentView.addChildView(uiView);

  // Load the UI panel HTML
  const uiPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '../renderer/ui-panel.html'
  );
  uiView.webContents.loadFile(uiPath);

  // Right panel fixed width
  const RIGHT_PANEL_WIDTH = 500;

  // Set bounds after window is shown (BaseWindow doesn't have ready-to-show)
  const setupViewBounds = () => {
    if (!webView || !uiView) return;
    const bounds = win.getBounds();
    webView.setBounds({
      x: 0,
      y: 0,
      width: bounds.width - RIGHT_PANEL_WIDTH,
      height: bounds.height,
    });
    uiView.setBounds({
      x: bounds.width - RIGHT_PANEL_WIDTH,
      y: 0,
      width: RIGHT_PANEL_WIDTH,
      height: bounds.height,
    });
  };

  // BaseWindow has 'show' event but it's not in the TypeScript types
  win.addListener('show', setupViewBounds);

  // Handle window resize - left panel resizes, right panel stays fixed
  win.on('resize', setupViewBounds);

  // Setup IPC handlers for UI panel
  ipcMain.handle('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('get-page-source', async (_event) => {
    if (!webView) return '';
    return await webView.webContents.executeJavaScript('document.documentElement.outerHTML');
  });

  // Keyboard navigation - Alt+Left/Right for back/forward
  globalShortcut.register('Alt+Left', () => {
    if (webView && webView.webContents.canGoBack()) {
      webView.webContents.goBack();
    }
  });
  globalShortcut.register('Alt+Right', () => {
    if (webView && webView.webContents.canGoForward()) {
      webView.webContents.goForward();
    }
  });

  // Handle automation commands from UI panel
  ipcMain.handle('apply-selector', async () => {
    if (!webView?.webContents) return [];
    const urls = await extractSourceUrls(webView!.webContents);
    // Normalize URLs
    const normalizedUrls = urls.map((url: string) =>
      normalizeUrl(webView!.webContents.getURL(), url)
    );
    // Add to source URLs set
    normalizedUrls.forEach((url: string) => sourceUrls.add(url));
    return normalizedUrls;
  });

  ipcMain.handle('scroll-page', async () => {
    if (!webView) return false;
    try {
      const scrolled = await webView.webContents.executeJavaScript(`
        (function() {
          const scrolled = window.scrollBy(0, ${cliArgs.scroll || 1});
          return document.documentElement.scrollHeight > (window.pageYOffset + window.innerHeight + 1);
        })()
      `);
      return !scrolled; // Return true if at bottom
    } catch {
      return false;
    }
  });

  ipcMain.handle('check-source-completed', () => {
    return Array.from(sourceUrls).every((url) => completedSourceUrls.has(url));
  });

  ipcMain.handle('mark-source-completed', (_event, url) => {
    completedSourceUrls.add(url);
  });

  ipcMain.handle('get-completed-status', () => {
    return {
      sourceCount: sourceUrls.size,
      completedCount: completedSourceUrls.size,
      allCompleted: sourceUrls.size > 0 && sourceUrls.size === completedSourceUrls.size,
    };
  });
}

app.whenReady().then(async () => {
  // Set user data directory to ./userdata/
  const userDataPath = path.resolve(process.cwd(), 'userdata');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  app.setPath('userData', userDataPath);
  console.log(`[App] User data directory: ${userDataPath}`);

  // Force dark mode theme
  nativeTheme.themeSource = 'dark';

  // Register Protocol API handler if output directory specified
  if (cliArgs.outputDir) {
    console.log('[Protocol API] Registering handlers...');

    // Create a separate session for internal fetches (no protocol handler)
    const bypassSession = session.fromPartition('persist:bypass');

    // Handle HTTPS
    protocol.handle('https', async (request) => {
      const url = request.url;
      const headersObj = Object.fromEntries(request.headers.entries());

      // Log request URL
      console.log(`[Request] ${request.method} ${url}`);

      // Prevent infinite recursion
      if (processingUrls.has(url)) {
        console.log(`[Protocol API] Skipping recursive request: ${url}`);
        // Make a direct fetch without going through protocol handler
        const response = await fetch(url, {
          method: request.method,
          headers: headersObj as Record<string, string>,
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        return new Response(buffer, {
          status: response.status,
          headers: response.headers,
        });
      }

      processingUrls.add(url);

      // Track request for UI panel
      const requestId = ++requestIdCounter;
      activeRequests.set(url, {
        id: requestId,
        url,
        method: request.method,
        headers: headersObj,
      });

      // Send request start event to UI panel
      sendNetworkEvent('start', requestId, url, request.method, headersObj);

      console.log(`[Protocol API] Capturing: ${url}`);

      try {
        // Forward request using bypass session (no protocol handler)
        const headersObj = Object.fromEntries(request.headers.entries());
        const response = await bypassSession.fetch(url, {
          method: request.method,
          headers: headersObj,
        });

        const buffer = Buffer.from(await response.arrayBuffer());

        // Check if URL is eligible for capture
        if (!isEligible(url)) {
          console.log(`[Protocol API] Not eligible: ${url}`);
          // Still save but don't log
          const filename = generateFilename(url);
          const filepath = path.join(cliArgs.outputDir!, filename);
          const dirpath = path.dirname(filepath);
          if (!fs.existsSync(dirpath)) {
            fs.mkdirSync(dirpath, { recursive: true });
          }
          fs.writeFileSync(filepath, buffer);
        } else {
          // Save eligible URL
          const filename =
            cliArgs.renameSequence && cliArgs.selector
              ? generateSequentialFilename(url, sourceUrls.size)
              : generateFilename(url);
          const filepath = path.join(cliArgs.outputDir!, filename);
          const dirpath = path.dirname(filepath);
          if (!fs.existsSync(dirpath)) {
            fs.mkdirSync(dirpath, { recursive: true });
          }
          fs.writeFileSync(filepath, buffer);
          console.log(`[Protocol API] Saved: ${filename} (${buffer.length} bytes)`);
        }

        // Send request complete event to UI panel
        sendNetworkEvent('complete', requestId, url, request.method, headersObj, response.status);

        // Track completed source URLs
        if (cliArgs.selector && sourceUrls.has(url)) {
          completedSourceUrls.add(url);
        }

        activeRequests.delete(url);

        // Return ORIGINAL response (unchanged)
        return new Response(buffer, {
          status: response.status,
          headers: response.headers,
        });
      } catch (error) {
        console.error(`[Protocol API] Error capturing ${url}:`, error);
        // Send error event to UI panel
        sendNetworkEvent('complete', requestId, url, request.method, headersObj, 0);
        activeRequests.delete(url);
        // Re-throw to let the request fail normally
        throw error;
      } finally {
        processingUrls.delete(url);
      }
    });

    // Handle HTTP
    protocol.handle('http', async (request) => {
      const url = request.url;
      const headersObj = Object.fromEntries(request.headers.entries());

      // Log request URL
      console.log(`[Request] ${request.method} ${url}`);

      // Prevent infinite recursion
      if (processingUrls.has(url)) {
        console.log(`[Protocol API] Skipping recursive request: ${url}`);
        const response = await fetch(url, {
          method: request.method,
          headers: headersObj as Record<string, string>,
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        return new Response(buffer, {
          status: response.status,
          headers: response.headers,
        });
      }

      processingUrls.add(url);

      // Track request for UI panel
      const requestId = ++requestIdCounter;
      activeRequests.set(url, {
        id: requestId,
        url,
        method: request.method,
        headers: headersObj,
      });

      // Send request start event to UI panel
      sendNetworkEvent('start', requestId, url, request.method, headersObj);

      console.log(`[Protocol API] Capturing: ${url}`);

      try {
        // Forward request using bypass session (no protocol handler)
        const headersObj = Object.fromEntries(request.headers.entries());
        const response = await bypassSession.fetch(url, {
          method: request.method,
          headers: headersObj,
        });

        const buffer = Buffer.from(await response.arrayBuffer());

        // Check if URL is eligible for capture
        if (!isEligible(url)) {
          console.log(`[Protocol API] Not eligible: ${url}`);
          // Still save but don't log
          const filename = generateFilename(url);
          const filepath = path.join(cliArgs.outputDir!, filename);
          const dirpath = path.dirname(filepath);
          if (!fs.existsSync(dirpath)) {
            fs.mkdirSync(dirpath, { recursive: true });
          }
          fs.writeFileSync(filepath, buffer);
        } else {
          // Save eligible URL
          const filename =
            cliArgs.renameSequence && cliArgs.selector
              ? generateSequentialFilename(url, sourceUrls.size)
              : generateFilename(url);
          const filepath = path.join(cliArgs.outputDir!, filename);
          const dirpath = path.dirname(filepath);
          if (!fs.existsSync(dirpath)) {
            fs.mkdirSync(dirpath, { recursive: true });
          }
          fs.writeFileSync(filepath, buffer);
          console.log(`[Protocol API] Saved: ${filename} (${buffer.length} bytes)`);
        }

        // Send request complete event to UI panel
        sendNetworkEvent('complete', requestId, url, request.method, headersObj, response.status);

        // Track completed source URLs
        if (cliArgs.selector && sourceUrls.has(url)) {
          completedSourceUrls.add(url);
        }

        activeRequests.delete(url);

        // Return ORIGINAL response (unchanged)
        return new Response(buffer, {
          status: response.status,
          headers: response.headers,
        });
      } catch (error) {
        console.error(`[Protocol API] Error capturing ${url}:`, error);
        // Send error event to UI panel
        sendNetworkEvent('complete', requestId, url, request.method, headersObj, 0);
        activeRequests.delete(url);
        // Re-throw to let the request fail normally
        throw error;
      } finally {
        processingUrls.delete(url);
      }
    });

    console.log('[Protocol API] Handlers registered successfully');
  }

  createWindow();

  // Wait for window to be ready
  app.on('ready', async () => {
    if (!webView?.webContents) return;

    // Handle --wait functionality
    if (cliArgs.wait) {
      console.log(`[Automation] Waiting ${cliArgs.wait} seconds...`);
      setTimeout(() => {
        console.log('[Automation] Wait period complete');
      }, cliArgs.wait * 1000);
    }

    // Handle --scroll functionality
    let scrollInterval: NodeJS.Timeout | null = null;
    if (cliArgs.scroll) {
      console.log(`[Automation] Scrolling ${cliArgs.scroll}px per second...`);
      scrollInterval = setInterval(async () => {
        // Re-apply selector after each scroll
        if (cliArgs.selector) {
          try {
            await webView!.webContents.executeJavaScript(`
              (function() {
                const elements = document.querySelectorAll('${cliArgs.selector}');
                elements.forEach(el => {
                  if (el.src) sourceUrls.add(el.src);
                  else if (el.dataset && el.dataset.src) sourceUrls.add(el.dataset.src);
                  else if (el.srcset) {
                    el.srcset.split(',').forEach(src => {
                      const parts = src.trim().split(/ /);
                      if (parts[0]) sourceUrls.add(parts[0]);
                    });
                  }
                });
              })()
            `);
          } catch (error) {
            console.error('[Automation] Error re-applying selector:', error);
          }
        }

        // Check if at bottom of page
        try {
          const atBottom = await webView!.webContents.executeJavaScript(
            'document.documentElement.scrollHeight <= (window.pageYOffset + window.innerHeight + 1)'
          );
          if (atBottom) {
            console.log('[Automation] Reached bottom of page, stopping scroll');
            if (scrollInterval) {
              clearInterval(scrollInterval);
            }
          }
        } catch (error) {
          console.error('[Automation] Error checking scroll position:', error);
        }
      }, 1000);
    }

    // Handle --close-on-idle functionality
    if (cliArgs.closeOnIdle) {
      let lastActivityTime = Date.now();

      const resetIdleTimer = () => {
        lastActivityTime = Date.now();
      };

      // Listen for activity
      webView.webContents.on('did-navigate', resetIdleTimer);
      webView.webContents.on('did-navigate-in-page', resetIdleTimer);

      const checkIdle = async () => {
        const idleTime = (Date.now() - lastActivityTime) / 1000;

        if (idleTime >= cliArgs.closeOnIdle!) {
          console.log(`[Automation] Idle for ${Math.floor(idleTime)} seconds, closing...`);
          setTimeout(() => app.quit(), 100);
          return;
        }

        // If selector specified, check if all source URLs completed
        if (cliArgs.selector && sourceUrls.size > 0) {
          const allCompleted = Array.from(sourceUrls).every((url) => completedSourceUrls.has(url));
          if (allCompleted) {
            console.log('[Automation] All source URLs completed, starting idle timer...');
            lastActivityTime = Date.now();
          }
        }

        setTimeout(checkIdle, 1000);
      };

      setTimeout(checkIdle, 1000);
    }
  });

  app.on('activate', () => {
    if (BaseWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
