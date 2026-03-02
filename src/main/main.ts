import { app, BaseWindow, WebContentsView } from 'electron';
import path from 'node:path';

const urlArg = process.argv.find((arg) => arg.startsWith('http')) ?? undefined;

function createWindow(): void {
  // Create a BaseWindow (not BrowserWindow) for multi-view support
  const win = new BaseWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
  });

  // Left panel: Web browser WebContentsView
  const webView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.contentView.addChildView(webView);

  // Inject dark theme CSS for scrollbars
  const darkThemeCSS = `
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #1a1a1a;
    }
    ::-webkit-scrollbar-thumb {
      background: #4a4a4a;
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #6a6a6a;
    }
    [data-color-scheme="dark"] {
      color-scheme: dark;
    }
    [data-color-scheme="light"] {
      color-scheme: light;
    }
  `;

  const injectDarkTheme = (webContents: Electron.WebContents) => {
    webContents.executeJavaScript(`
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(darkThemeCSS)};
      (document.head || document.documentElement).appendChild(style);
    `);
  };

  webView.webContents.once('did-finish-load', () => {
    injectDarkTheme(webView.webContents);
  });

  // Load URL in the web view
  if (urlArg) {
    webView.webContents.loadURL(urlArg);
  } else {
    webView.webContents.loadURL('about:blank');
  }

  // Right panel: UI panel WebContentsView
  const uiView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.contentView.addChildView(uiView);

  // Load the UI panel HTML
  const uiPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '../renderer/ui-panel.html'
  );
  uiView.webContents.once('did-finish-load', () => {
    injectDarkTheme(uiView.webContents);
  });
  uiView.webContents.loadFile(uiPath);

  // Set bounds after window is shown (BaseWindow doesn't have ready-to-show)
  const setupViewBounds = () => {
    const bounds = win.getBounds();
    webView.setBounds({ x: 0, y: 0, width: 700, height: bounds.height });
    uiView.setBounds({ x: 700, y: 0, width: bounds.width - 700, height: bounds.height });
  };

  // BaseWindow has 'show' event but it's not in the TypeScript types
  win.addListener('show', setupViewBounds);

  // Handle window resize
  win.on('resize', () => {
    const bounds = win.getBounds();
    webView.setBounds({ x: 0, y: 0, width: 700, height: bounds.height });
    uiView.setBounds({ x: 700, y: 0, width: bounds.width - 700, height: bounds.height });
  });
}

app.whenReady().then(() => {
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
