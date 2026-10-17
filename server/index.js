import "./loadEnv.js";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import { synth, checkTtsHealth, prewarmTtsCache, DEFAULT_MODEL } from "./tts.js";

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

    const requestedModel = req.query.model || process.env.TTS_MODEL || "aura-2-luna-en";
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

app.get("/health", async (req, res) => {
  const health = await checkTtsHealth();
  res.json({
    status: health.ok ? "ok" : "degraded",
    provider: "deepgram",
    defaultModel: "aura-2-luna-en",
    activeModel: health.model,
    error: health.error || null,
  });
});

// Static lines to pre-warm into the persistent disk cache
// Load shared lines configuration (single source of truth)
let SHARED_LINES = { first_visit: [], name_clauses: [], openers: [], pair_up: [], cart_and_common: [] };
try {
  const sharedPath = new URL("./shared_lines.json", import.meta.url);
  SHARED_LINES = JSON.parse(fs.readFileSync(sharedPath, "utf-8"));
} catch (e) {
  console.warn("[TTS Pre-Warm] Could not load shared_lines.json:", e.message);
}

const STATIC_PREWARM_LINES = [
  ...(SHARED_LINES.first_visit || []),
  ...(SHARED_LINES.name_clauses || []),
  ...(SHARED_LINES.openers || []),
  ...(SHARED_LINES.pair_up || []),
  ...(SHARED_LINES.cart_and_common || []),
];

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Deepgram Aura Voice server running on http://localhost:${PORT}`);
  // Startup self-test
  try {
    const test = await checkTtsHealth();
    if (test.ok) {
      console.log("[TTS] format check OK");
    } else {
      console.error(`[TTS] format check failed: ${test.error}`);
    }
  } catch (err) {
    console.error(`[TTS] format check failed: ${err.message}`);
  }

  // Asynchronously pre-warm static lines & product lines into the persistent disk cache
  setTimeout(async () => {
    try {
      const lines = [...STATIC_PREWARM_LINES];

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
            for (const p of data.products) {
              if (p.name) lines.push(p.name);
              if (p.category) lines.push(`Here is our ${p.category} collection.`);
              if (p.description) {
                // Take first sentence of description
                const firstSent = p.description.split(/[.?!]/)[0]?.trim();
                if (firstSent && firstSent.length < 80) lines.push(firstSent);
              }
            }
          }
        }
      } catch (_) {
        // Backend might be starting up; static lines will still be pre-warmed
      }

      await prewarmTtsCache(lines, DEFAULT_MODEL, SHARED_LINES.first_visit);
    } catch (prewarmErr) {
      console.warn("[TTS Pre-Warm] Warning during cache pre-warming:", prewarmErr.message);
    }
  }, 100);
});
