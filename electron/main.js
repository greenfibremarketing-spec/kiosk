const { app, BrowserWindow, session, globalShortcut, Menu, protocol, net, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const log = require("electron-log");
const { fork } = require("child_process");

const DEV = process.argv.includes("--dev") || process.argv.includes("-d");

// Configure logging
log.transports.file.level = "info";
log.info(`[Main] Starting GreenFibre Kiosk process (DEV: ${DEV})...`);

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

// Autoplay & media command line switches
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-gesture-requirement-for-media-playback");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("enable-speech-dispatcher");
app.commandLine.appendSwitch("log-level", "3");

let win = null;
let voiceServerProcess = null;
let kioskCurrentState = "IDLE";

// Helper paths
function getDistPath() {
  const candidates = [
    path.join(app.getAppPath(), "out"),
    path.join(__dirname, "..", "out"),
    path.join(__dirname, "out")
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return path.join(app.getAppPath(), "out");
}

function getUserDataPath() {
  try {
    return app.getPath("userData");
  } catch (_) {
    return path.join(process.env.APPDATA || process.cwd(), "GreenFibre Kiosk");
  }
}

function getWritableConfigPath() {
  const userDataDir = getUserDataPath();
  const userConfig = path.join(userDataDir, "config.json");
  if (!fs.existsSync(userConfig)) {
    const bundledConfigCandidates = [
      path.join(app.getAppPath(), "config.json"),
      path.join(__dirname, "..", "config.json")
    ];
    for (const b of bundledConfigCandidates) {
      if (fs.existsSync(b)) {
        try {
          fs.mkdirSync(userDataDir, { recursive: true });
          fs.copyFileSync(b, userConfig);
          break;
        } catch (_) {}
      }
    }
  }
  return userConfig;
}

function getWritableEnvPath() {
  const userDataDir = getUserDataPath();
  const userEnv = path.join(userDataDir, ".env");
  if (!fs.existsSync(userEnv)) {
    const candidates = [
      path.join(app.getAppPath(), "server", ".env"),
      path.join(app.getAppPath(), ".env"),
      path.join(__dirname, "..", "server", ".env"),
      path.join(__dirname, "..", ".env"),
      path.join(process.resourcesPath || "", "app.asar.unpacked", "server", ".env")
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        try {
          fs.mkdirSync(userDataDir, { recursive: true });
          fs.copyFileSync(c, userEnv);
          log.info(`[Main] Copied initial .env to writable userData: ${userEnv}`);
          break;
        } catch (e) {
          log.warn("[Main] Failed to copy .env to userData:", e);
        }
      }
    }
  }
  return userEnv;
}

function getWritableCacheDir() {
  const cacheDir = path.join(getUserDataPath(), "cache", "tts");
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (err) {
    log.warn("[Main] Failed to create TTS cache dir:", err);
  }
  return cacheDir;
}

function loadEnvVariables() {
  const writableEnv = getWritableEnvPath();
  const envCandidates = [
    writableEnv,
    path.join(app.getAppPath(), "server", ".env"),
    path.join(app.getAppPath(), ".env"),
    path.join(__dirname, "..", "server", ".env"),
    path.join(__dirname, "..", ".env")
  ];

  const loaded = {};
  for (const envFile of envCandidates) {
    if (fs.existsSync(envFile)) {
      try {
        const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx !== -1) {
              const k = trimmed.slice(0, eqIdx).trim();
              const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
              if (k && !process.env[k]) {
                process.env[k] = v;
              }
              if (k && !loaded[k]) {
                loaded[k] = v;
              }
            }
          }
        }
      } catch (err) {
        log.warn("[Main] Error reading env file:", envFile, err);
      }
    }
  }
  return loaded;
}

function loadConfig() {
  const configPath = getWritableConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (e) {
    log.error("[Main] Failed to load config:", e);
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
  const configPath = getWritableConfigPath();
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
    log.info("[Main] Config saved successfully:", cfg);
    return true;
  } catch (e) {
    log.error("[Main] Failed to save config:", e);
    return false;
  }
}

function findServerScript() {
  const candidates = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", "server", "index.js"),
    path.join(app.getAppPath(), "server", "index.js"),
    path.join(__dirname, "..", "server", "index.js"),
    path.join(__dirname, "server", "index.js")
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function startVoiceServer(loadedEnv) {
  const serverScript = findServerScript();
  if (!serverScript) {
    log.warn("[Main] Voice server script not found in search paths");
    return;
  }

  const writableCache = getWritableCacheDir();
  const writableEnv = getWritableEnvPath();

  try {
    const childEnv = {
      ...process.env,
      ...loadedEnv,
      PORT: "4000",
      TTS_CACHE_DIR: writableCache,
      ENV_FILE: writableEnv,
      DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || loadedEnv.DEEPGRAM_API_KEY || ""
    };

    voiceServerProcess = fork(serverScript, [], {
      silent: true,
      env: childEnv
    });

    voiceServerProcess.stdout?.on("data", (data) => {
      log.info(`[VoiceServer] ${data.toString().trim()}`);
    });
    voiceServerProcess.stderr?.on("data", (data) => {
      log.warn(`[VoiceServer Error] ${data.toString().trim()}`);
    });
    voiceServerProcess.on("exit", (code, signal) => {
      log.info(`[VoiceServer] Exited (code=${code}, signal=${signal})`);
      voiceServerProcess = null;
    });

    log.info(`[Main] Spawned TTS server on port 4000 (script: ${serverScript})`);
    log.info(`[Main] TTS Cache location: ${writableCache}`);
  } catch (err) {
    log.error("[Main] Failed to spawn voice server:", err);
  }
}

function stopVoiceServer() {
  if (voiceServerProcess) {
    try {
      voiceServerProcess.kill();
    } catch (_) {}
    voiceServerProcess = null;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 1920,
    kiosk: !DEV,
    fullscreen: !DEV,
    frame: DEV,
    autoHideMenuBar: true,
    backgroundColor: "#F7F3EA",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      autoplayPolicy: "no-user-gesture-required",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  // Load app via registered privileged protocol
  win.loadURL("app://kiosk/index.html");

  // Prevent navigation outside kiosk
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Block keyboard shortcuts that disrupt kiosk
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

  // Self recovery on crash
  win.webContents.on("render-process-gone", (e, details) => {
    log.error("[Main] [DIAGNOSTIC] webContents render-process-gone:", details);
    log.warn("[Main] Render process gone, reloading...", details);
    win?.reload();
  });
  win.webContents.on("unresponsive", () => {
    log.warn("[Main] [DIAGNOSTIC] webContents unresponsive");
  });
  win.webContents.on("responsive", () => {
    log.info("[Main] [DIAGNOSTIC] webContents responsive");
  });
  win.on("unresponsive", () => {
    log.warn("[Main] [DIAGNOSTIC] Window unresponsive event, reloading...");
    win?.reload();
  });
  win.on("responsive", () => {
    log.info("[Main] [DIAGNOSTIC] Window responsive event");
  });

  win.on("closed", () => {
    win = null;
  });
}

// Diagnostic: App-level process lifecycle & GPU crash monitoring (Requirement 6)
app.on("render-process-gone", (event, webContents, details) => {
  log.error("[Main] [DIAGNOSTIC] app render-process-gone:", details);
});

app.on("child-process-gone", (event, details) => {
  log.warn("[Main] [DIAGNOSTIC] app child-process-gone:", details);
  if (details && details.type === "GPU") {
    log.error("[Main] [DIAGNOSTIC] GPU process crash reason:", details.reason, "exitCode:", details.exitCode);
  }
});

app.on("gpu-process-crashed", (event, killed) => {
  log.error("[Main] [DIAGNOSTIC] GPU process crashed (gpu-process-crashed), killed:", killed);
});

// Single instance lock
if (!app.requestSingleInstanceLock()) {
  log.warn("[Main] Another kiosk instance is already running. Quitting.");
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

    // Register protocol to serve exported out/ directory
    protocol.handle("app", (request) => {
      try {
        const parsedUrl = new URL(request.url);
        let relativePath = decodeURIComponent(parsedUrl.pathname);
        if (relativePath === "/" || relativePath === "" || relativePath === "\\") {
          relativePath = "/index.html";
        }
        const distPath = getDistPath();
        let filePath = path.join(distPath, relativePath);
        if (!path.extname(filePath)) {
          filePath = path.join(filePath, "index.html");
        }
        return net.fetch(pathToFileURL(filePath).toString());
      } catch (err) {
        log.warn("[Main] Protocol handle error:", err);
        return new Response("Not Found", { status: 404 });
      }
    });

    // Load environment variables & start TTS server
    const loadedEnv = loadEnvVariables();
    startVoiceServer(loadedEnv);

    // IPC Handlers
    ipcMain.handle("speech:key", () => {
      return (
        process.env.DEEPGRAM_API_KEY ||
        loadedEnv.DEEPGRAM_API_KEY ||
        ""
      );
    });

    ipcMain.handle("get-config", () => loadConfig());
    ipcMain.handle("save-config", (e, cfg) => saveConfig(cfg));
    ipcMain.on("presence-state", (e, state) => {
      kioskCurrentState = state;
    });

    // Auto-grant camera and microphone permissions for presence and STT
    const ses = session.defaultSession;
    const allowedPermissions = [
      "media",
      "microphone",
      "camera",
      "audioCapture",
      "speechRecognition"
    ];
    ses.setPermissionRequestHandler((wc, permission, callback) => {
      callback(allowedPermissions.includes(permission));
    });
    ses.setPermissionCheckHandler((wc, permission) => {
      return allowedPermissions.includes(permission);
    });

    createWindow();

    // Staff emergency exit shortcut: Ctrl+Shift+Alt+Q
    globalShortcut.register("CommandOrControl+Shift+Alt+Q", () => {
      log.info("[Main] Staff exit shortcut triggered.");
      stopVoiceServer();
      app.quit();
    });
  });

  // Quit app when all windows are closed
  app.on("window-all-closed", () => {
    log.info("[Main] All windows closed, quitting app...");
    stopVoiceServer();
    app.quit();
  });

  app.on("before-quit", () => {
    stopVoiceServer();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    stopVoiceServer();
  });
}
