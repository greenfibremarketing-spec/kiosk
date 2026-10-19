const { app, BrowserWindow, session, globalShortcut, Menu, protocol, net, ipcMain, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const log = require("electron-log");
const { fork } = require("child_process");
const nodemailer = require("nodemailer");

const DEV = process.argv.includes("--dev") || process.argv.includes("-d");

// Ensure consistent userData folder between dev and packaged production
app.setName("GreenFibre Kiosk");

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
let voiceServerRestarts = 0;
let lastRestartTs = 0;
let isQuitting = false;
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
      if (!isQuitting) {
        const now = Date.now();
        if (now - lastRestartTs > 60000) {
          voiceServerRestarts = 0; // Reset counter after 1 min of stable run
        }
        lastRestartTs = now;
        voiceServerRestarts++;
        if (voiceServerRestarts > 5) {
          log.error("[Main] Voice server exceeded max restart attempts (5). Ceasing automatic restarts.");
          return;
        }
        const backoffMs = Math.min(2000 * Math.pow(1.5, voiceServerRestarts - 1), 10000);
        log.warn(`[Main] Voice server exited unexpectedly. Auto-restarting in ${Math.round(backoffMs)}ms (attempt ${voiceServerRestarts}/5)...`);
        setTimeout(() => {
          if (!isQuitting && !voiceServerProcess) {
            startVoiceServer(loadedEnv);
          }
        }, backoffMs);
      }
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
  let unresponsiveTimer = null;
  win.webContents.on("unresponsive", () => {
    log.warn("[Main] webContents unresponsive; scheduling recovery in 5s if still hung");
    if (!unresponsiveTimer) {
      unresponsiveTimer = setTimeout(() => {
        unresponsiveTimer = null;
        log.warn("[Main] webContents unresponsive timeout reached, reloading window...");
        win?.reload();
      }, 5000);
    }
  });
  win.webContents.on("responsive", () => {
    log.info("[Main] webContents recovered responsiveness");
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = null;
    }
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

    // ── Pre-launch Lead Submission IPC Handler ──────────────────────────────
    let leadSendInFlight = false;
    const sessionLastLeadSentMap = new Map();
    const sentLeadKeys = new Map();
    const RATE_LIMIT_COOLDOWN_MS = 20000;

    const escapeHtml = (s) =>
      String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const stripHdr = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();

    ipcMain.handle("kiosk:send-prelaunch-lead", async (event, payload) => {
      const frameUrl = event.senderFrame?.url || "";
      const isAllowedDev = !app.isPackaged && (frameUrl.startsWith("http://localhost:3000") || frameUrl.startsWith("app://kiosk"));
      const isAllowedProd = frameUrl.startsWith("app://kiosk");
      if (!isAllowedDev && !isAllowedProd) {
        log.warn(`[Lead] Rejected origin: ${frameUrl}`);
        throw new Error("Unauthorized request origin");
      }

      if (leadSendInFlight) {
        throw new Error("A submission is already in progress. Please wait.");
      }

      const now = Date.now();
      const sessionKey = String(payload?.sessionId || payload?.idempotencyKey || "").trim();
      const lastSessionSuccessTs = sessionKey ? (sessionLastLeadSentMap.get(sessionKey) || 0) : 0;
      const elapsed = now - lastSessionSuccessTs;
      if (sessionKey && lastSessionSuccessTs > 0 && elapsed < RATE_LIMIT_COOLDOWN_MS) {
        const remaining = Math.ceil((RATE_LIMIT_COOLDOWN_MS - elapsed) / 1000);
        throw new Error(`Please wait ${remaining} seconds before submitting again.`);
      }

      const idempotencyKey = String(payload?.idempotencyKey || "").trim();
      if (idempotencyKey && sentLeadKeys.has(idempotencyKey)) {
        const cutoff = now - 600000;
        for (const [k, t] of sentLeadKeys.entries()) {
          if (t < cutoff) sentLeadKeys.delete(k);
        }
        log.info(`[Lead] status=duplicate-ignored kioskId=${payload?.kioskId || "kiosk"}`);
        return { success: true, duplicate: true };
      }

      const customer = payload?.customer || {};
      const fullName = stripHdr(customer.fullName || customer.name || "");
      const phone = String(customer.phone || "").replace(/\D/g, "");
      const email = stripHdr(customer.email || "");
      const address = stripHdr(customer.address || customer.streetAddress || "");
      const city = stripHdr(customer.city || "");
      const state = stripHdr(customer.state || "");
      const pincode = String(customer.pincode || "").replace(/\D/g, "");
      const landmark = stripHdr(customer.landmark || "");

      if (!fullName || phone.length !== 10 || !email.includes("@") || !address || !city || !state || pincode.length !== 6) {
        throw new Error("Invalid customer delivery details.");
      }

      leadSendInFlight = true;
      try {
        const userData = getUserDataPath();
        const configPath = path.join(userData, "prelaunch-config.json");
        const encPath = path.join(userData, "prelaunch-smtp.enc");

        let smtpPass = null;
        let credSource = null;
        if (fs.existsSync(encPath) && safeStorage && safeStorage.isEncryptionAvailable()) {
          try {
            const encryptedBytes = fs.readFileSync(encPath);
            smtpPass = safeStorage.decryptString(encryptedBytes);
            if (smtpPass) {
              const cleaned = smtpPass.replace(/[\s\u0000-\u001F\u007F]/g, "");
              if (cleaned.length > 0) {
                smtpPass = cleaned;
                credSource = "safeStorage";
              } else {
                smtpPass = null;
              }
            }
          } catch (decErr) {
            log.warn("[Lead] safeStorage decrypt error, checking env fallback:", decErr.code || decErr.message);
          }
        }

        if (!smtpPass) {
          const freshEnv = loadEnvVariables();
          const envPass = process.env.SMTP_PASS || freshEnv?.SMTP_PASS || loadedEnv?.SMTP_PASS;
          if (envPass) {
            const cleaned = envPass.replace(/[\s\u0000-\u001F\u007F]/g, "");
            if (cleaned.length > 0) {
              smtpPass = cleaned;
              credSource = "env";
            }
          }
        }

        if (!smtpPass) {
          log.error("[Lead] FAIL-CLOSED: No SMTP credentials configured (safeStorage or env).");
          throw new Error("SMTP credentials are not configured on this kiosk. Please provide your Gmail app password in .env or run set-smtp-config.js.");
        }
        log.info(`[Lead] Using SMTP credentials from source: ${credSource}`);

        let smtpConfig = {
          host: process.env.SMTP_HOST || loadedEnv?.SMTP_HOST || "smtp.gmail.com",
          port: Number(process.env.SMTP_PORT || loadedEnv?.SMTP_PORT) || 465,
          secure: true,
          user: process.env.SMTP_USER || loadedEnv?.SMTP_USER || "greenfibre.marketing@gmail.com",
          to: process.env.SMTP_TO || loadedEnv?.SMTP_TO || "greenfibre.marketing@gmail.com",
        };
        if (fs.existsSync(configPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
            smtpConfig = { ...smtpConfig, ...parsed };
          } catch (_) {}
        }

        const transporter = nodemailer.createTransport({
          host: stripHdr(smtpConfig.host),
          port: Number(smtpConfig.port) || 465,
          secure: Number(smtpConfig.port) === 465 || smtpConfig.secure === true,
          auth: {
            user: stripHdr(smtpConfig.user),
            pass: smtpPass,
          },
          connectionTimeout: 12000,
          greetingTimeout: 10000,
          socketTimeout: 12000,
          tls: {
            rejectUnauthorized: true,
          },
        });

        const isEmailStrict = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
        const replyTo = isEmailStrict ? email : undefined;

        const items = Array.isArray(payload?.items) ? payload.items : [];
        const itemsText = items.map((it, idx) => `  ${idx + 1}. ${it.name || "Product"} (Color: ${it.selectedColor || "N/A"}, Qty: ${it.quantity || 1}, SKU: ${it.sku || it.id || "N/A"})`).join("\n");
        const itemsHtml = items.map((it) => `<li><strong>${escapeHtml(it.name || "Product")}</strong> — Color: ${escapeHtml(it.selectedColor || "N/A")}, Qty: ${Number(it.quantity) || 1}, SKU: ${escapeHtml(it.sku || it.id || "N/A")}</li>`).join("");

        const textBody = `NEW PRE-LAUNCH INTEREST LEAD\n============================\nCustomer Information:\n- Name: ${fullName}\n- Mobile: ${phone}\n- Email: ${email}\n- Address: ${address}\n- City: ${city}, State: ${state} - PIN: ${pincode}\n${landmark ? `- Landmark: ${landmark}\n` : ""}Kiosk ID: ${stripHdr(payload?.kioskId || "kiosk-01")}\nSubmitted At: ${new Date().toISOString()}\n\nSelected Products of Interest:\n${itemsText || "  (None specified)"}\n`;

        const htmlBody = `<h2>New Pre-Launch Interest Lead</h2><p><strong>Customer Information:</strong></p><ul><li><strong>Name:</strong> ${escapeHtml(fullName)}</li><li><strong>Mobile:</strong> ${escapeHtml(phone)}</li><li><strong>Email:</strong> ${escapeHtml(email)}</li><li><strong>Address:</strong> ${escapeHtml(address)}, ${escapeHtml(city)}, ${escapeHtml(state)} - ${escapeHtml(pincode)}</li>${landmark ? `<li><strong>Landmark:</strong> ${escapeHtml(landmark)}</li>` : ""}<li><strong>Kiosk Terminal:</strong> ${escapeHtml(payload?.kioskId || "kiosk-01")}</li><li><strong>Submitted:</strong> ${new Date().toISOString()}</li></ul><p><strong>Products of Interest:</strong></p><ul>${itemsHtml || "<li>None</li>"}</ul>`;

        const mailOptions = {
          from: `"${stripHdr("GreenFibre Kiosk Lead")}" <${stripHdr(smtpConfig.user)}>`,
          to: stripHdr(smtpConfig.to),
          subject: `[Pre-Launch Lead] ${fullName} - Kiosk ${stripHdr(payload?.kioskId || "01")}`,
          text: textBody,
          html: htmlBody,
        };
        if (replyTo) {
          mailOptions.replyTo = replyTo;
        }

        await transporter.sendMail(mailOptions);
        if (sessionKey) {
          sessionLastLeadSentMap.set(sessionKey, Date.now());
        }
        if (idempotencyKey) {
          sentLeadKeys.set(idempotencyKey, Date.now());
        }
        log.info(`[Lead] status=sent kioskId=${payload?.kioskId || "kiosk-01"} ts=${new Date().toISOString()}`);
        return { success: true };
      } catch (sendErr) {
        log.warn(`[Lead] status=failed kioskId=${payload?.kioskId || "kiosk-01"} code=${sendErr.code || "ERR"} ts=${new Date().toISOString()}`);
        throw new Error(sendErr.message || "Failed to send lead email");
      } finally {
        leadSendInFlight = false;
      }
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
    isQuitting = true;
    stopVoiceServer();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    stopVoiceServer();
  });
}
