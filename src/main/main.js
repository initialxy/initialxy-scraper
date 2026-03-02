const { app, BrowserWindow } = require("electron");
const path = require("path");

const urlArg = process.argv.find((arg) => arg.startsWith("http"));

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
    },
  });

  const rendererPath = path.join(__dirname, "../renderer/index.html");
  win.loadFile(rendererPath);

  win.webContents.on("did-finish-load", () => {
    if (urlArg) {
      win.webContents.executeJavaScript(
        `document.getElementById('webview').setAttribute('src', '${urlArg}')`
      );
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});