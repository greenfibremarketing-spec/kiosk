// scripts/set-smtp-config.js
// One-time setup script to encrypt SMTP credentials via Electron safeStorage.
// EXCLUDED from production builds. Contains NO secrets.

const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

// Ensure identical userData resolution between dev and packaged runtime
app.setName("GreenFibre Kiosk");

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  console.log("[SMTP Setup] UserData directory:", userData);

  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    console.error("[SMTP Setup] FAIL-CLOSED: Electron safeStorage encryption is NOT available on this machine.");
    app.exit(1);
    return;
  }

  let pass = process.env.KIOSK_SMTP_PASS_INPUT;
  if (!pass || pass.trim().length === 0) {
    const envPath = path.join(__dirname, "..", ".env");
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*SMTP_PASS\s*=\s*(.*)$/);
        if (m) {
          pass = m[1].trim().replace(/^["']|["']$/g, "");
          break;
        }
      }
    }
  }

  if (!pass || pass.trim().length === 0) {
    console.error("[SMTP Setup] FAIL-CLOSED: No password provided in KIOSK_SMTP_PASS_INPUT or .env (SMTP_PASS).");
    app.exit(1);
    return;
  }

  const cleanedPass = String(pass || "").replace(/[\s\u0000-\u001F\u007F]/g, "");
  if (!/^[a-z]{16}$/.test(cleanedPass)) {
    console.error(`[SMTP Setup] FAIL-CLOSED: Password validation failed (cleaned length: ${cleanedPass.length}, reason: not 16 letters a-z).`);
    app.exit(1);
    return;
  }

  try {
    const encrypted = safeStorage.encryptString(cleanedPass);
    const verifyDec = safeStorage.decryptString(encrypted);
    if (verifyDec !== cleanedPass) {
      throw new Error("Self-test decryption verification failed.");
    }
    const targetFile = path.join(userData, "prelaunch-smtp.enc");
    const tempFile = path.join(userData, `prelaunch-smtp.enc.tmp-${Date.now()}`);
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(tempFile, encrypted);
    fs.renameSync(tempFile, targetFile);
    console.log("[SMTP Setup] SUCCESS: Encrypted credentials verified and written securely to disk.");

    // Write default non-secret SMTP configuration if not present
    const configPath = path.join(userData, "prelaunch-config.json");
    if (!fs.existsSync(configPath)) {
      const initialConfig = {
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        user: "greenfibre.marketing@gmail.com",
        to: "greenfibre.marketing@gmail.com"
      };
      fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf8");
      console.log("[SMTP Setup] Non-secret configuration written to:", configPath);
    }
  } catch (err) {
    console.error("[SMTP Setup] ERROR during encryption:", err.message);
    app.exit(1);
    return;
  }

  app.exit(0);
});
