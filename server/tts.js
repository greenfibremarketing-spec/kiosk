import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const DEFAULT_MODEL = process.env.TTS_MODEL || "aura-2-luna-en";
const FALLBACK_MODEL = "aura-luna-en";
const CACHE_DIR = path.join(os.tmpdir(), "greenie-tts");
fs.mkdirSync(CACHE_DIR, { recursive: true });

function getApiKey() {
  return (
    process.env.DEEPGRAM_API_KEY ||
    process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ||
    "8ede28576db8d02d8ab30f8ec9a0c5ac2be3986f"
  );
}

/**
 * Synthesizes speech using Deepgram Aura TTS with retry backoff and disk caching.
 * @param {string} text - The text to speak
 * @param {string} [requestedModel] - Aura voice model name
 * @returns {Promise<{ file: string, model: string }>}
 */
export async function synth(text, requestedModel) {
  const clean = String(text || "").trim().slice(0, 1000);
  if (!clean) {
    throw new Error("Text is required for TTS synthesis");
  }

  const model = (requestedModel && typeof requestedModel === "string" && requestedModel.trim())
    ? requestedModel.trim()
    : DEFAULT_MODEL;

  const cacheKey = crypto.createHash("md5").update(`${model}:${clean}`).digest("hex") + ".mp3";
  const file = path.join(CACHE_DIR, cacheKey);

  if (fs.existsSync(file)) {
    const stats = fs.statSync(file);
    if (stats.size > 100) {
      return { file, model };
    }
    // Remove corrupt/empty cache file
    try { fs.unlinkSync(file); } catch (_) {}
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Deepgram API key not configured for TTS");
  }

  let lastError = null;
  let attemptModel = model;

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(attemptModel)}&encoding=mp3`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: clean }),
      });

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length < 100) {
          throw new Error("TTS response audio buffer too small");
        }

        fs.writeFileSync(file, buffer);
        const resolvedModel = res.headers.get("dg-model-name") || attemptModel;
        return { file, model: resolvedModel };
      }

      const status = res.status;
      const errText = await res.text().catch(() => "");
      lastError = new Error(`Deepgram TTS failed (${status}): ${errText}`);
      lastError.status = status;
      lastError.body = errText;

      // If requested model is not found, try fallback model
      if ((status === 400 || status === 404) && attemptModel !== FALLBACK_MODEL) {
        console.warn(`[TTS] Model ${attemptModel} returned ${status}, falling back to ${FALLBACK_MODEL}`);
        attemptModel = FALLBACK_MODEL;
        continue;
      }

      // Retry on 429 or 5xx with backoff
      if (status === 429 || (status >= 500 && status < 600)) {
        await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(2, attempt)));
        continue;
      }

      throw lastError;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error("Failed to synthesize speech after retries");
}

/**
 * Startup self-test to verify Deepgram TTS credentials and model access.
 */
export async function checkTtsHealth() {
  try {
    const { file, model } = await synth("Hi", DEFAULT_MODEL);
    const valid = fs.existsSync(file) && fs.statSync(file).size > 100;
    return { ok: valid, model };
  } catch (err) {
    return { ok: false, model: DEFAULT_MODEL, error: err.message };
  }
}
