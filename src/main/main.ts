import {
  app,
  BaseWindow,
  WebContentsView,
  nativeTheme,
  ipcMain,
  clipboard,
  globalShortcut,
} from 'electron';
import type { WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { parseCLIArgs } from '../shared/cli.ts';
import { AutomationManager } from '../shared/automation.ts';
import { extractSourceUrls, normalizeUrl } from '../shared/utils.ts';
import type { CLIArgs } from '../shared/types.ts';

let webView: WebContentsView | null | undefined = null;
let uiView: WebContentsView | null | undefined = null;

function createWindow(cliArgs: CLIArgs): void {
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
    const urls = await extractSourceUrls(webView!.webContents, cliArgs.selector!);
    // Normalize URLs
    const normalizedUrls = urls.map((url: string) =>
      normalizeUrl(webView!.webContents.getURL(), url)
    );
    // Add to source URLs set
    normalizedUrls.forEach((url: string) => {
      if ((webView!.webContents as WebContents & { __sourceUrls?: Set<string> }).__sourceUrls) {
        (webView!.webContents as WebContents & { __sourceUrls?: Set<string> }).__sourceUrls.add(
          url
        );
      }
    });
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
    // This would check actual tracking
    return true;
  });

  ipcMain.handle('mark-source-completed', (_event, _url) => {
    // This would mark actual completion
  });

  ipcMain.handle('get-completed-status', () => {
    return {
      sourceCount: 0,
      completedCount: 0,
      allCompleted: true,
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
  console.debug(`[App] User data directory: ${userDataPath}`);

  // Force dark mode theme
  nativeTheme.themeSource = 'dark';

  const cliArgs = parseCLIArgs();
  createWindow(cliArgs);

  // Wait for window to be ready
  app.on('ready', async () => {
    if (!webView?.webContents) return;

    // Initialize automation manager
    const automation = new AutomationManager(webView, cliArgs);
    automation.initializeWait();
    automation.initializeScroll();
    automation.initializeCloseOnIdle();
  });

  app.on('activate', () => {
    if (BaseWindow.getAllWindows().length === 0) {
      createWindow(cliArgs);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
