const { app, BaseWindow, WebContentsView } = require("electron");
const path = require("path");

const urlArg = process.argv.find((arg) => arg.startsWith("http"));

function createWindow() {
  // Create a BaseWindow (not BrowserWindow) for multi-view support
  const win = new BaseWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
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
  
  // Load URL in the web view
  if (urlArg) {
    webView.webContents.loadURL(urlArg);
  } else {
    webView.webContents.loadURL("about:blank");
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
  const uiPath = path.join(__dirname, "../renderer/ui-panel.html");
  uiView.webContents.loadFile(uiPath);

  // Set bounds after window is ready
  win.once("ready-to-show", () => {
    const bounds = win.getBounds();
    webView.setBounds({ x: 0, y: 0, width: 700, height: bounds.height });
    uiView.setBounds({ x: 700, y: 0, width: bounds.width - 700, height: bounds.height });
  });

  // Handle window resize
  win.on("resize", () => {
    const bounds = win.getBounds();
    webView.setBounds({ x: 0, y: 0, width: 700, height: bounds.height });
    uiView.setBounds({ x: 700, y: 0, width: bounds.width - 700, height: bounds.height });
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BaseWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});