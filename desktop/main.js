// MineLife desktop shell: one window running the game, with fullscreen on F11 and no browser chrome.
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

// WebGL on older or blocklisted GPUs, and keep the game running at full speed when unfocused.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "MineLife",
    backgroundColor: "#0b0805",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "app", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11" || (input.key === "Enter" && input.alt)) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === "F12" && !app.isPackaged) {
      win.webContents.toggleDevTools();
    }
  });
  // Any link out of the game opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
