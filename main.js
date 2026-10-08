const { app, BrowserWindow, session, globalShortcut, Menu, protocol, net, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const log = require("electron-log");

const DEV = process.argv.includes("--dev"); // windowed + DevTools for development
const DIST_PATH = path.join(__dirname, "out");
const CONFIG_PATH = path.join(__dirname, "config.json");

// Configure electron-log
log.transports.file.level = "info";
log.info("Starting GreenFibre Kiosk process... DEV:", DEV);

// Register custom scheme as privileged before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-gesture-requirement-for-media-playback");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("enable-speech-dispatcher");
app.commandLine.appendSwitch("log-level", "3");
app.commandLine.appendSwitch("silent-debugger-extension-api");

let win;
let kioskCurrentState = "IDLE";

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (e) {
    log.error("Failed to load config.json:", e);
  }
  return {
    enterCm: 180,
    exitCm: 230,
    enterDwellMs: 300,
    exitGraceMs: 5000,
    focalPx: 580,
    fps: 6,
    cameraLabel: "",
    touchKeepEngagedMs: 30000
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
    log.info("Config saved successfully:", cfg);
    return true;
  } catch (e) {
    log.error("Failed to save config.json:", e);
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    kiosk: !DEV,
    fullscreen: !DEV,
    frame: DEV,
    autoHideMenuBar: true,
    backgroundColor: "#F7F3EA",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  // Load via secure app:// protocol
  win.loadURL("app://kiosk/index.html");

  // Block navigation away and new windows
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Block reload, close, zoom, and DevTools shortcuts (not in dev mode)
  if (!DEV) {
    win.webContents.on("before-input-event", (event, input) => {
      const ctrl = input.control || input.meta;
      const blocked =
        input.key === "F5" ||
        input.key === "F11" ||
        input.key === "F12" ||
        (ctrl && ["r", "w", "+", "-", "=", "0", "p", "s"].includes(input.key.toLowerCase())) ||
        (ctrl && input.shift && ["i", "r"].includes(input.key.toLowerCase())) ||
        (input.alt && input.key === "F4") ||
        (input.alt && ["ArrowLeft", "ArrowRight"].includes(input.key));
      if (blocked) event.preventDefault();
    });
  }

  // Self-recovery (expanded in Step 8)
  win.webContents.on("render-process-gone", (e, details) => {
    log.warn("Render process gone, reloading...", details);
    win.reload();
  });
  win.on("unresponsive", () => {
    log.warn("Window unresponsive, reloading...");
    win.reload();
  });
}

// Nightly 4 AM refresh if IDLE
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 4 && now.getMinutes() === 0 && now.getSeconds() < 10) {
    if (kioskCurrentState === "IDLE" && win) {
      log.info("Performing scheduled 4 AM idle reload...");
      win.reload();
    }
  }
}, 10000);

// Only one copy of the kiosk may run
if (!app.requestSingleInstanceLock()) {
  log.warn("Another instance is already running. Quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    // Auto-start on Windows login in production
    if (!DEV && app.setLoginItemSettings) {
      app.setLoginItemSettings({ openAtLogin: true });
    }

    // Register protocol.handle to serve local out/ files (including WASM & fonts)
    protocol.handle("app", (request) => {
      try {
        const parsedUrl = new URL(request.url);
        let relativePath = decodeURIComponent(parsedUrl.pathname);
        if (relativePath === "/" || relativePath === "" || relativePath === "\\") {
          relativePath = "/index.html";
        }
        let filePath = path.join(DIST_PATH, relativePath);
        if (!path.extname(filePath)) {
          filePath = path.join(filePath, "index.html");
        }
        return net.fetch(pathToFileURL(filePath).toString());
      } catch (err) {
        return new Response("Not Found", { status: 404 });
      }
    });

const speechService = require("./speechService");

    // Handle Config IPCs
    ipcMain.handle("get-config", () => loadConfig());
    ipcMain.handle("save-config", (e, cfg) => saveConfig(cfg));
    ipcMain.on("presence-state", (e, state) => {
      kioskCurrentState = state;
      if (state === "ENGAGED") {
        speechService.start({
          onHypothesis: (text) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send("stt-hypothesis", text);
            }
          },
          onFinal: (text) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send("stt-final", text);
            }
          }
        });
      } else {
        speechService.stop();
      }
    });

    ipcMain.on("stt-mute", (e, muted) => {
      speechService.setMuted(muted);
    });

    // Allow camera and microphone for face presence & speech recognition
    const ses = session.defaultSession;
    const allowedPermissions = [
      "media",
      "microphone",
      "camera",
      "audioCapture",
      "speechRecognition",
    ];
    ses.setPermissionRequestHandler((wc, permission, callback) => {
      callback(allowedPermissions.includes(permission));
    });
    ses.setPermissionCheckHandler((wc, permission) => {
      return allowedPermissions.includes(permission);
    });

    createWindow();

    win.webContents.on("console-message", (event, level, message) => {
      log.info(`[Renderer] ${message}`);
    });

    // Staff-only exit
    globalShortcut.register("CommandOrControl+Shift+Alt+Q", () => {
      log.info("Staff exit shortcut triggered.");
      speechService.stop();
      app.quit();
    });
  });

  app.on("will-quit", () => {
    speechService.stop();
    globalShortcut.unregisterAll();
  });
  app.on("window-all-closed", () => {
    speechService.stop();
    app.quit();
  });
}
