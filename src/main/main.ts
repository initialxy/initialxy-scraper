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
import { parseCLIArgs } from '../shared/cli.ts';
import { ProtocolHandler } from '../shared/protocol.ts';
import { OutputManager } from '../shared/output_manager.ts';
import fs from 'node:fs';
import path from 'node:path';
import type { CLIArgs } from '../shared/types.ts';

let webView: WebContentsView | null | undefined = null;
let uiView: WebContentsView | null | undefined = null;
let outputManager: OutputManager | null = null;
let automationManager: AutomationManager | null = null;

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

  // Inject dark scrollbar CSS for web view and handle page load
  webView.webContents.on('did-finish-load', async () => {
    webView?.webContents.executeJavaScript(
      `(function() {
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
      })();`
    );

    // Update page source if selector is specified and wait is not set
    if (cliArgs.selector && !cliArgs.wait) {
      await updatePageSource();
    }
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
    return [];
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

  // Create OutputManager first
  outputManager = new OutputManager({
    outputDir: cliArgs.outputDir,
    filter: cliArgs.filter,
    selector: cliArgs.selector,
    renameSequence: cliArgs.renameSequence,
    outputCurl: cliArgs.outputCurl,
    flatDir: cliArgs.flatDir,
    baseUrl: webView?.webContents.getURL() || 'about:blank',
    onOutput: (_url) => {
      // Reset idle timer when output happens
      automationManager?.onOutputEvent();
    },
  });

  // Create ProtocolHandler with callbacks that forward to OutputManager and UI
  const protocolHandler = new ProtocolHandler(webView?.webContents.getURL() || 'about:blank', {
    onRequestStarted: (request) => {
      // Send IPC to renderer for network panel
      uiView?.webContents.send('network-request-start', request);
    },
    onResponseCompleted: (request, response) => {
      // Send IPC to renderer for network panel
      uiView?.webContents.send('network-request-complete', {
        id: request.id,
        url: request.url,
        statusCode: response.statusCode,
      });
      // Forward to OutputManager
      outputManager?.responseCompleted(request, response);
    },
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
    automationManager = new AutomationManager(webView, cliArgs);
    automationManager.initializeWait();
    automationManager.initializeScroll();
    automationManager.initializeCloseOnIdle();
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

/**
 * Update page source for selector-based extraction
 */
export async function updatePageSource(): Promise<void> {
  if (!webView?.webContents || !outputManager) return;
  try {
    const pageSource = await webView.webContents.executeJavaScript(
      'document.documentElement.outerHTML'
    );
    outputManager.updatePageSource(pageSource);
  } catch (error) {
    console.error('[Main] Error getting page source:', error);
  }
}

/**
 * Scroll page and update page source if selector is active
 */
export async function scrollAndUpdate(): Promise<void> {
  if (!webView?.webContents) return;
  try {
    const scrollAmount = automationManager?.cliArgs?.scroll || 100;
    await webView.webContents.executeJavaScript(`
      window.scrollBy(0, ${scrollAmount});
    `);

    // Update page source if selector is active
    if (automationManager?.cliArgs?.selector) {
      await updatePageSource();
    }
  } catch (error) {
    console.error('[Main] Error scrolling:', error);
  }
}
