import {
  app,
  BaseWindow,
  WebContentsView,
  nativeTheme,
  protocol,
  session,
  net,
  ipcMain,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Parse CLI arguments
const outputArg = process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1];
const urlArg = process.argv.find((arg) => arg.startsWith('http')) ?? undefined;

// Create output directory if specified
let outputDir: string | undefined;
if (outputArg) {
  outputDir = path.resolve(process.cwd(), outputArg);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  console.log(`[Protocol API] Output directory: ${outputDir}`);
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

let webView: WebContentsView | null = null;
let uiView: WebContentsView | null = null;

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
  if (urlArg) {
    webView!.webContents.loadURL(urlArg);
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
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('get-page-source', async (event) => {
    if (!webView) return '';
    return await webView.webContents.executeJavaScript('document.documentElement.outerHTML');
  });
}

app.whenReady().then(async () => {
  // Force dark mode theme
  nativeTheme.themeSource = 'dark';

  // Register Protocol API handler if output directory specified
  if (outputDir) {
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

        // Save to disk
        const filename = generateFilename(url);
        const filepath = path.join(outputDir, filename);
        const dirpath = path.dirname(filepath);
        if (!fs.existsSync(dirpath)) {
          fs.mkdirSync(dirpath, { recursive: true });
        }
        fs.writeFileSync(filepath, buffer);
        console.log(`[Protocol API] Saved: ${filename} (${buffer.length} bytes)`);

        // Send request complete event to UI panel
        sendNetworkEvent('complete', requestId, url, request.method, headersObj, response.status);
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

        // Save to disk
        const filename = generateFilename(url);
        const filepath = path.join(outputDir, filename);
        const dirpath = path.dirname(filepath);
        if (!fs.existsSync(dirpath)) {
          fs.mkdirSync(dirpath, { recursive: true });
        }
        fs.writeFileSync(filepath, buffer);
        console.log(`[Protocol API] Saved: ${filename} (${buffer.length} bytes)`);

        // Send request complete event to UI panel
        sendNetworkEvent('complete', requestId, url, request.method, headersObj, response.status);
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
