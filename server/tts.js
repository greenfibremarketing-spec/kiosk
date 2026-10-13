import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

export const DEFAULT_MODEL = process.env.TTS_MODEL || "aura-2-luna-en";
export const FALLBACK_MODEL = "aura-luna-en";

// Persistent disk cache location in project .cache/tts, falling back to os.tmpdir
let resolvedCacheDir = process.env.TTS_CACHE_DIR || path.join(process.cwd(), ".cache", "tts");
try {
  fs.mkdirSync(resolvedCacheDir, { recursive: true });
} catch (_) {
  resolvedCacheDir = path.join(os.tmpdir(), "greenie-tts");
  fs.mkdirSync(resolvedCacheDir, { recursive: true });
}
export const CACHE_DIR = resolvedCacheDir;

function getApiKey() {
  return (
    process.env.DEEPGRAM_API_KEY ||
    process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ||
    "8ede28576db8d02d8ab30f8ec9a0c5ac2be3986f"
  );
}

/**
 * Synthesizes speech using Deepgram Aura TTS with retry backoff, disk caching,
 * and client disconnect cancellation via AbortSignal.
 *
 * @param {string} text - The text to speak
 * @param {string} [requestedModel] - Aura voice model name
 * @param {AbortSignal} [signal] - Optional abort signal to cancel upstream Deepgram request
 * @returns {Promise<{ file: string, model: string }>}
 */
export async function synth(text, requestedModel, signal = null) {
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
    if (signal?.aborted) {
      const abortErr = new Error("Upstream TTS aborted: client disconnected");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    try {
      const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(attemptModel)}&encoding=mp3`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: clean }),
        signal: signal || undefined,
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
      if (err.name === "AbortError" || signal?.aborted) {
        throw err;
      }
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

/**
 * Pre-warms the persistent disk cache at startup with static lines.
 * Concurrently processes items with a maximum concurrency limit.
 *
 * @param {string[]} lines
 * @param {string} [model]
 */
export async function prewarmTtsCache(lines, model = DEFAULT_MODEL) {
  if (!Array.isArray(lines) || lines.length === 0) return { total: 0, warmed: 0, cached: 0 };

  const unique = Array.from(new Set(lines.map((l) => String(l || "").trim()).filter(Boolean)));
  console.log(`[TTS Pre-Warm] Pre-warming ${unique.length} static lines into persistent cache...`);

  let cachedCount = 0;
  let warmedCount = 0;
  let errorCount = 0;
  const toSynth = [];

  for (const line of unique) {
    const cacheKey = crypto.createHash("md5").update(`${model}:${line}`).digest("hex") + ".mp3";
    const file = path.join(CACHE_DIR, cacheKey);
    if (fs.existsSync(file) && fs.statSync(file).size > 100) {
      cachedCount++;
    } else {
      toSynth.push(line);
    }
  }

  // Synthesize missing lines with controlled concurrency (2 at a time)
  const CONCURRENCY = 2;
  for (let i = 0; i < toSynth.length; i += CONCURRENCY) {
    const batch = toSynth.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (text) => {
        try {
          await synth(text, model);
          warmedCount++;
        } catch (e) {
          errorCount++;
          console.warn(`[TTS Pre-Warm] Notice: could not pre-warm line "${text.slice(0, 30)}":`, e.message);
        }
      })
    );
  }

  console.log(
    `[TTS Pre-Warm] Cache ready: ${cachedCount} already cached, ${warmedCount} freshly synthesized, ${errorCount} errors.`
  );
  return { total: unique.length, cached: cachedCount, warmed: warmedCount, errors: errorCount };
}
