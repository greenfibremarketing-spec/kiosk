import express from "express";
import cors from "cors";
import crypto from "crypto";
import { synth, checkTtsHealth } from "./tts.js";

const app = express();
app.use(cors());

app.get("/api/tts", async (req, res) => {
  const reqId = crypto.randomBytes(4).toString("hex");
  const reqTs = new Date().toISOString();
  try {
    const text = (req.query.text || "").trim();
    if (!text) {
      return res.status(400).send("Text is required");
    }

    const requestedModel = req.query.model || process.env.TTS_MODEL || "aura-2-luna-en";
    console.log(`[VoiceServer] req:${reqId} ts=${reqTs} model=${requestedModel} text="${text.slice(0, 80)}"`);

    const { file, model } = await synth(text, requestedModel);

    console.log(`[VoiceServer] req:${reqId} OK model=${model} text="${text.slice(0, 40)}"`);
    res.set("Content-Type", "audio/mpeg");
    res.set("dg-model-name", model);
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(file);
  } catch (e) {
    const statusCode = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    console.warn(`[VoiceServer] req:${reqId} ERROR status=${statusCode} msg="${e.message}" body="${e.body || ""}"`);
    res.status(statusCode).json({ error: e.message, status: statusCode, body: e.body || "" });
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Deepgram Aura Voice server running on http://localhost:${PORT}`);
  // Startup self-test
  try {
    const test = await checkTtsHealth();
    if (test.ok) {
      console.log(`[TTS Startup] Verified Deepgram model: ${test.model} (200 OK)`);
    } else {
      console.warn(`[TTS Startup Warning] Health test failed: ${test.error}`);
    }
  } catch (err) {
    console.warn("[TTS Startup Warning] Health test exception:", err.message);
  }
});
