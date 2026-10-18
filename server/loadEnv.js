import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  process.env.ENV_FILE,
  path.join(__dirname, ".env"),
  path.join(process.cwd(), "server", ".env"),
  path.join(process.cwd(), ".env"),
].filter(Boolean);

const _serverStartTs = Date.now();
globalThis._serverStartTs = _serverStartTs;
console.log(`[StartupTiming:Server] 01_loadEnv_start at ${new Date().toISOString()}`);

for (const envFile of candidates) {
  if (fs.existsSync(envFile)) {
    try {
      const content = fs.readFileSync(envFile, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const k = trimmed.slice(0, eqIdx).trim();
            const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            if (k && !process.env[k]) {
              process.env[k] = v;
            }
          }
        }
      }
      break;
    } catch (err) {
      console.warn("[VoiceServer] Error reading env file:", envFile, err.message);
    }
  }
}
console.log(`[StartupTiming:Server] 02_loadEnv_end (+${Date.now() - _serverStartTs}ms)`);
