import "./loadEnv.js";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
let ttsModulePromise = null;
function getTtsModule() {
  if (!ttsModulePromise) {
    ttsModulePromise = import("./tts.js");
  }
  return ttsModulePromise;
}

const app = express();
app.use(cors());

app.get("/api/tts", async (req, res) => {
  const reqId = crypto.randomBytes(4).toString("hex");
  const reqTs = new Date().toISOString();
  const abortController = new AbortController();

  req.on("close", () => {
    if (!res.writableEnded) {
      console.log(`[VoiceServer] Client disconnected req:${reqId}, aborting upstream Deepgram request`);
      abortController.abort();
    }
  });

  try {
    const text = (req.query.text || "").trim();
    if (!text) {
      return res.status(400).send("Text is required");
    }

    const { synth, DEFAULT_MODEL } = await getTtsModule();
    const requestedModel = req.query.model || process.env.TTS_MODEL || DEFAULT_MODEL || "aura-2-luna-en";
    console.log(`[VoiceServer] req:${reqId} ts=${reqTs} model=${requestedModel} text="${text.slice(0, 80)}"`);

    const { file, model } = await synth(text, requestedModel, abortController.signal);

    if (abortController.signal.aborted) {
      return;
    }

    console.log(`[VoiceServer] req:${reqId} OK model=${model} text="${text.slice(0, 40)}"`);
    res.set("Content-Type", "audio/mpeg");
    res.set("dg-model-name", model);
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(file);
  } catch (e) {
    if (abortController.signal.aborted || e?.name === "AbortError") {
      console.log(`[VoiceServer] req:${reqId} aborted cleanly (client disconnect)`);
      return;
    }
    const statusCode = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    console.warn(`[VoiceServer] req:${reqId} ERROR status=${statusCode} msg="${e.message}" body="${e.body || ""}"`);
    if (!res.headersSent) {
      res.status(statusCode).json({ error: e.message, status: statusCode, body: e.body || "" });
    }
  }
});

let lastHealth = { ok: true, model: "aura-2-luna-en" };

app.get("/health", (req, res) => {
  res.json({
    status: lastHealth.ok ? "ok" : "degraded",
    provider: "deepgram",
    defaultModel: "aura-2-luna-en",
    activeModel: lastHealth.model,
    error: lastHealth.error || null,
  });
});

console.log(`[StartupTiming:Server] 04_before_listen (+${Date.now() - (globalThis._serverStartTs || Date.now())}ms)`);
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[StartupTiming:Server] 05_listen_ready (+${Date.now() - (globalThis._serverStartTs || Date.now())}ms) on http://localhost:${PORT}`);
  console.log(`Deepgram Aura Voice server running on http://localhost:${PORT}`);

  // In the background: load heavy modules, run health check, capped cache prune, and prewarm
  setTimeout(async () => {
    try {
      const { checkTtsHealth, prewarmTtsCache, pruneCacheIfNeeded, DEFAULT_MODEL, CACHE_DIR } = await getTtsModule();
      const { getAllStaticLines } = await import("../src/lib/staticSpeechLines.mjs");
      const { getAllProductSpeechLines, buildProductSpeech, normalizeForSpeech, normalizeProductForPricing } = await import("../src/lib/productSpeech.mjs");

      // Health self-test
      const test = await checkTtsHealth();
      lastHealth = test;
      console.log(`[StartupTiming:Server] 06_health_check_done (+${Date.now() - (globalThis._serverStartTs || Date.now())}ms) ok=${test.ok}`);
      if (test.ok) {
        console.log("[TTS] format check OK");
      } else {
        console.error(`[TTS] format check failed: ${test.error}`);
      }

      // Cap cache size
      if (typeof pruneCacheIfNeeded === "function") {
        pruneCacheIfNeeded(600);
      }

      // Prewarm static lines & product lines into the persistent disk cache
      const staticLines = getAllStaticLines();
      const lines = [...staticLines];
      let catalogProducts = null;

      // Try fetching verified product lines from backend (production or configured URL)
      const backendUrl =
        process.env.BACKEND_URL ||
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        process.env.NEXT_PUBLIC_PROD_BACKEND_URL ||
        "https://kioskai.greenfibre.org";
      try {
        const prodRes = await fetch(`${backendUrl}/products`, { signal: AbortSignal.timeout(3000) });
        if (prodRes.ok) {
          const data = await prodRes.json();
          if (Array.isArray(data?.products)) {
            catalogProducts = data.products;
          }
        }
      } catch (_) {
        // Backend might be starting up; will try local fallback
      }

      if (!catalogProducts) {
        const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        const candidate = path.join(appRoot, "src", "data", "fallbackProducts.json");
        if (fs.existsSync(candidate)) {
          try {
            const fileData = JSON.parse(fs.readFileSync(candidate, "utf8"));
            const prods = Array.isArray(fileData) ? fileData : fileData?.products;
            if (Array.isArray(prods) && prods.length > 0) {
              catalogProducts = prods;
            }
          } catch (_) {}
        }
      }

      if (catalogProducts) {
        catalogProducts = catalogProducts.map(normalizeProductForPricing);
        lines.push(...getAllProductSpeechLines(catalogProducts));
      }

      await prewarmTtsCache(lines, DEFAULT_MODEL, staticLines.slice(0, 15));

      // Dev dry-run check: verify 0 cache misses for all catalog product chunks
      if (catalogProducts) {
        let misses = 0;
        let total = 0;
        for (const p of catalogProducts) {
          for (let v = 0; v < 3; v++) {
            const speech = buildProductSpeech(p, { variantIndex: v, hasPairUp: false });
            for (const ch of speech.chunks) {
              total++;
              const norm = normalizeForSpeech(ch);
              const key = crypto.createHash("md5").update(`v2:${DEFAULT_MODEL}:${norm}`).digest("hex") + ".mp3";
              const legacyKey = crypto.createHash("md5").update(`${DEFAULT_MODEL}:${norm}`).digest("hex") + ".mp3";
              const filePath = path.join(CACHE_DIR, key);
              const legacyPath = path.join(CACHE_DIR, legacyKey);
              if (!fs.existsSync(filePath) && !fs.existsSync(legacyPath)) {
                misses++;
                console.warn(`[TTS Dry-Run] Cache miss on chunk: "${norm}"`);
              }
            }
          }
        }
        if (misses === 0) {
          console.log(`[TTS Dry-Run] Verified ${total} product chunks: 0 cache misses!`);
        } else {
          console.warn(`[TTS Dry-Run] Found ${misses} / ${total} cache misses!`);
        }
      }
    } catch (prewarmErr) {
      console.warn("[TTS Pre-Warm] Warning during cache pre-warming:", prewarmErr.message);
    }
  }, 50);
});
