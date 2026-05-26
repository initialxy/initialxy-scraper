import {
  app,
  BaseWindow,
  WebContentsView,
  nativeTheme,
  ipcMain,
  clipboard,
  session,
} from 'electron';
import { AutomationManager } from '../shared/automation.ts';
import { ProtocolHandler } from '../shared/protocol.ts';
import { CookieStore } from '../shared/cookie_store.ts';
import { Coordinator } from './coordinator.ts';
import { parseCLIArgs } from '../shared/cli.ts';
import { NAVIGATION_DELAY_MS } from '../shared/constants.ts';
import fs from 'node:fs';
import path from 'node:path';
import type { CLIArgs, WebViewInterface } from '../shared/types.ts';

let webView: WebContentsView | null = null;
let coordinator: Coordinator | null = null;
let monitorWin: BaseWindow | null = null;

function createWindow(cliArgs: CLIArgs): {
  win: BaseWindow;
  monitorWin: BaseWindow;
  webViewInterface: WebViewInterface;
} {
  // Main window - full size, no side panel
  const win = new BaseWindow({
    width: cliArgs.width ?? 1200,
    height: cliArgs.height ?? 1000,
    autoHideMenuBar: true,
  });

  webView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.contentView.addChildView(webView);
  webView.setVisible(true);

  // Set webView to full window size on show/focus/resize
  const updateBounds = () => {
    const [w, h] = win.getContentSize();
    webView?.setBounds({ x: 0, y: 0, width: w, height: h });
  };
  win.on('show', updateBounds);
  win.on('focus', updateBounds);
  win.on('resize', updateBounds);

  webView!.webContents.loadURL('about:blank');

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

    if (cliArgs.selector && !cliArgs.wait) {
      await coordinator?.updatePageSource();
    }
  });

  // Monitor window - separate window for Network Monitor UI
  monitorWin = new BaseWindow({
    width: 500,
    height: 600,
    autoHideMenuBar: true,
  });

  const monitorView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(path.dirname(new URL(import.meta.url).pathname), '../renderer/preload.js'),
    },
  });

  monitorWin.contentView.addChildView(monitorView);
  monitorView.setVisible(true);

  // Set monitorView to full window size
  const updateMonitorBounds = () => {
    const [w, h] = monitorWin.getContentSize();
    monitorView.setBounds({ x: 0, y: 0, width: w, height: h });
  };
  monitorWin.on('show', updateMonitorBounds);
  monitorWin.on('focus', updateMonitorBounds);
  monitorWin.on('resize', updateMonitorBounds);
  // WM may resize window after show(); retry once to catch forced size
  setTimeout(updateMonitorBounds, 300);

  const uiPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '../renderer/ui/ui_panel.html'
  );
  monitorView.webContents.loadFile(uiPath);

  // Close monitor when main window closes
  win.on('closed', () => {
    if (monitorWin && !monitorWin.isDestroyed()) {
      monitorWin.close();
    }
  });

  ipcMain.handle('copy-to-clipboard', (_event, text) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('get-page-source', async (_event) => {
    if (!webView) return '';
    return await webView.webContents.executeJavaScript('document.documentElement.outerHTML');
  });

  const webViewInterface: WebViewInterface = {
    webContents: webView.webContents,
    webContentsView:
      monitorView.webContents as unknown as import('../shared/types.ts').UiPanelInterface,
  };

  return { win, monitorWin, webViewInterface };
}

app.whenReady().then(async () => {
  const userDataPath = path.resolve(process.cwd(), 'userdata');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  app.setPath('userData', userDataPath);
  console.debug(`[App] User data directory: ${userDataPath}`);

  nativeTheme.themeSource = 'dark';

  const cliArgs = parseCLIArgs();

  app.userAgentFallback = app.userAgentFallback
    .replace(app.getName(), '')
    .replace(/ Electron\/[\d.]+/, '');

  if (cliArgs.closeOnSelectorComplete && !cliArgs.selector) {
    console.error('[App] --close-on-selector-complete requires --selector');
    process.exit(1);
  }

  const { win, monitorWin: createdMonitorWin, webViewInterface } = createWindow(cliArgs);
  monitorWin = createdMonitorWin;

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
    {
      onRequestStarted: () => {},
      onResponseCompleted: () => {},
    },
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

  if (cliArgs.url && webView?.webContents) {
    setTimeout(() => {
      webView.webContents.loadURL(cliArgs.url);
    }, NAVIGATION_DELAY_MS);
  }

  win.show();
  monitorWin?.show();

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
