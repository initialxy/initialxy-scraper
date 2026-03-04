import {
  app,
  BaseWindow,
  WebContentsView,
  nativeTheme,
  ipcMain,
  clipboard,
  globalShortcut,
} from 'electron';
import { AutomationManager } from '../shared/automation.ts';
import { extractSourceUrls, normalizeUrl } from '../shared/backend_utils.ts';
import { parseCLIArgs } from '../shared/cli.ts';
import { ProtocolHandler } from '../shared/protocol.ts';
import fs from 'node:fs';
import path from 'node:path';
import type { CLIArgs } from '../shared/types.ts';

let webView: WebContentsView | null | undefined = null;
let uiView: WebContentsView | null | undefined = null;

function createWindow(cliArgs: CLIArgs): {
  win: BaseWindow;
  protocolHandler?: ProtocolHandler;
  cliArgs?: CLIArgs;
} {
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
  webView.setVisible(true);

  // Load about:blank initially - will navigate to target URL after protocol handler is registered
  webView!.webContents.loadURL('about:blank');

  // Inject dark scrollbar CSS for web view
  webView.webContents.on('did-finish-load', () => {
    webView?.webContents.executeJavaScript(`
      (function() {
        const style = document.createElement('style');
        style.textContent = \`
          ::-webkit-scrollbar {
            width: 12px;
          }
          ::-webkit-scrollbar-track {
            background: #1a1a1a;
          }
          ::-webkit-scrollbar-thumb {
            background: #444;
            border-radius: 6px;
            border: 3px solid #1a1a1a;
          }
          ::-webkit-scrollbar-thumb:hover {
            background: #555;
          }
        \`;
        document.head.appendChild(style);
      })();
    `);
  });

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
  uiView.setVisible(true);

  // Load the UI panel HTML
  const uiPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '../renderer/ui/ui_panel.html'
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
    if (webView?.webContents.navigationHistory.canGoBack()) {
      webView.webContents.navigationHistory.goBack();
    }
  });
  globalShortcut.register('Alt+Right', () => {
    if (webView?.webContents.navigationHistory.canGoForward()) {
      webView.webContents.navigationHistory.goForward();
    }
  });

  // Handle automation commands from UI panel
  ipcMain.handle('apply-selector', async () => {
    if (!webView?.webContents || !cliArgs.selector) return [];
    const urls = await extractSourceUrls(webView!.webContents, cliArgs.selector);
    // Normalize URLs and store with their index to preserve DOM order
    const normalizedUrls: string[] = [];
    urls.forEach((url: string, index: number) => {
      const normalizedUrl = normalizeUrl(webView!.webContents.getURL(), url);
      normalizedUrls.push(normalizedUrl);
      // Store in sourceUrls Map with index
      sourceUrls.set(normalizedUrl, index);
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

  // Always create ProtocolHandler for network monitoring
  // File saving only happens when outputDir is set
  const sourceUrls = new Map<string, number>();
  const completedSourceUrls = new Map<string, number>();

  const protocolHandler = new ProtocolHandler({
    outputDir: cliArgs.outputDir,
    filter: cliArgs.filter,
    selector: cliArgs.selector,
    renameSequence: cliArgs.renameSequence,
    verbose: cliArgs.verbose,
    outputCurl: cliArgs.outputCurl,
    uiView,
    webView,
    sourceUrls,
    completedSourceUrls,
  });

  protocolHandler.register();

  return { win, protocolHandler, cliArgs };
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

  // Sanitize this app's own name from user agent.
  app.userAgentFallback = app.userAgentFallback.replace(app.getName(), '');

  const { win, cliArgs: returnedCliArgs } = createWindow(cliArgs);

  // Navigate to target URL after protocol handler is registered and make sure
  // Network Monitor is initialized by giving it a small delay.
  if (returnedCliArgs?.url && webView?.webContents) {
    setTimeout(() => {
      webView.webContents.loadURL(returnedCliArgs.url);
    }, 100);
  }

  // Initialize automation manager after window is created
  if (webView?.webContents) {
    const automation = new AutomationManager(webView, cliArgs);
    automation.initializeWait();
    automation.initializeScroll();
    automation.initializeCloseOnIdle();
  }

  // Show the window
  win.show();

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
