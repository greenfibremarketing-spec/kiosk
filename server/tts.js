import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { Agent, setGlobalDispatcher } from "undici";
import { normalizeForSpeech } from "../src/lib/productSpeech.mjs";

// Reuse one keep-alive connection dispatcher for Deepgram upstream requests
const ttsDispatcher = new Agent({
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 60000,
  connections: 32,
  pipelining: 1,
});
setGlobalDispatcher(ttsDispatcher);

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
console.log(`[StartupTiming:Server] 03_tts_cache_dir_ready (+${Date.now() - (globalThis._serverStartTs || Date.now())}ms) cacheDir="${resolvedCacheDir}"`);

function getApiKey() {
  return (
    process.env.DEEPGRAM_API_KEY ||
    process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ||
    "8ede28576db8d02d8ab30f8ec9a0c5ac2be3986f"
  );
}

const CACHE_VERSION = "v2";

let activeLiveRequests = 0;
export function trackLiveRequestStart() {
  activeLiveRequests++;
}
export function trackLiveRequestEnd() {
  activeLiveRequests = Math.max(0, activeLiveRequests - 1);
}
export function isLiveRequestActive() {
  return activeLiveRequests > 0;
}

/**
 * Synthesizes speech using Deepgram Aura TTS with retry backoff, disk caching,
 * and client disconnect cancellation via AbortSignal.
 *
 * @param {string} text - The text to speak
 * @param {string} [requestedModel] - Aura voice model name
 * @param {AbortSignal} [signal] - Optional abort signal to cancel upstream Deepgram request
 * @param {boolean} [isLive=true] - Whether this is a real-time playback request
 * @returns {Promise<{ file: string, model: string }>}
 */
export async function synth(text, requestedModel, signal = null, isLive = true) {
  const raw = String(text || "").trim().slice(0, 1000);
  if (!raw) {
    throw new Error("Text is required for TTS synthesis");
  }
  const clean = normalizeForSpeech(raw);
  if (!clean) {
    throw new Error("Text is required for TTS synthesis");
  }

  const model = (requestedModel && typeof requestedModel === "string" && requestedModel.trim())
    ? requestedModel.trim()
    : DEFAULT_MODEL;

  const cacheKey = crypto.createHash("md5").update(`${CACHE_VERSION}:${model}:${clean}`).digest("hex") + ".mp3";
  let file = path.join(CACHE_DIR, cacheKey);

  if (fs.existsSync(file)) {
    const stats = fs.statSync(file);
    if (stats.size > 100) {
      console.log(`[TTS] synth_ms=0 chars=${clean.length} (cached)`);
      return { file, model };
    }
    // Remove corrupt/empty cache file
    try { fs.unlinkSync(file); } catch (_) {}
  }

  // Check legacy v1 cache key without CACHE_VERSION prefix
  const legacyKey = crypto.createHash("md5").update(`${model}:${clean}`).digest("hex") + ".mp3";
  const legacyFile = path.join(CACHE_DIR, legacyKey);
  if (fs.existsSync(legacyFile)) {
    const stats = fs.statSync(legacyFile);
    if (stats.size > 100) {
      console.log(`[TTS] synth_ms=0 chars=${clean.length} (cached legacy)`);
      return { file: legacyFile, model };
    }
    try { fs.unlinkSync(legacyFile); } catch (_) {}
  }


  console.log(`[TTS] cache MISS text="${clean}"`);

  if (isLive) {
    trackLiveRequestStart();
  }

  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("Deepgram API key not configured for TTS");
    }

    const t0 = performance.now();
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
          const synthMs = Math.round(performance.now() - t0);
          console.log(`[TTS] synth_ms=${synthMs} chars=${clean.length}`);
          if (resolvedModel !== model) {
            console.warn(`[TTS Voice Fallback] Active voice switched: using fallback "${resolvedModel}" instead of requested "${model}" (reason: ${lastError?.message || "model unavailable"})`);
          }
          return { file, model: resolvedModel };
        }

      const status = res.status;
      const errText = await res.text().catch(() => "");
      lastError = new Error(`Deepgram TTS failed (${status}): ${errText}`);
      lastError.status = status;
      lastError.body = errText;

      // The fallback to aura-luna-en must only happen for a model error, not for a format error
      const isFormatError = status === 400 && /bit_rate|encoding|sample_rate|container|format|parameter/i.test(errText);
      const isModelError = !isFormatError && (
        status === 404 ||
        (status === 400 && /model/i.test(errText))
      );

      if (isModelError && attemptModel !== FALLBACK_MODEL) {
        console.warn(`[TTS] Model ${attemptModel} returned ${status} (model error), falling back to ${FALLBACK_MODEL}`);
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
} finally {
  if (isLive) {
    trackLiveRequestEnd();
  }
}
}

/**
 * Startup self-test to verify Deepgram TTS credentials and model access.
 */
export async function checkTtsHealth() {
  try {
    const { file, model } = await synth("Format check test", DEFAULT_MODEL);
    const valid = fs.existsSync(file) && fs.statSync(file).size > 100;
    if (!valid) {
      return { ok: false, model: DEFAULT_MODEL, error: "Synthesized audio buffer too small or file missing" };
    }
    return { ok: true, model };
  } catch (err) {
    return { ok: false, model: DEFAULT_MODEL, error: err.message };
  }
}

/**
 * Pre-warms the persistent disk cache at startup with static lines.
 * Pre-warms first-visit lines first, then remaining lines in background with concurrency 2.
 * Pauses background pre-warming while any live playback request is being served.
 *
 * @param {string[]} lines
 * @param {string} [model]
 * @param {string[]} [firstVisitLines]
 */
export async function prewarmTtsCache(lines, model = DEFAULT_MODEL, firstVisitLines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return { total: 0, warmed: 0, cached: 0 };

  const firstVisitSet = new Set((firstVisitLines || []).map((l) => normalizeForSpeech(String(l || "").trim())).filter(Boolean));
  const uniqueAll = Array.from(new Set(lines.map((l) => normalizeForSpeech(String(l || "").trim())).filter(Boolean)));

  // Separate into first-visit priority lines and background lines
  const tier1 = uniqueAll.filter((l) => firstVisitSet.has(l));
  const tier2 = uniqueAll.filter((l) => !firstVisitSet.has(l));
  const ordered = [...tier1, ...tier2];

  console.log(`[TTS Pre-Warm] Pre-warming ${ordered.length} lines (${tier1.length} first-visit priority)...`);

  let cachedCount = 0;
  let warmedCount = 0;
  let errorCount = 0;
  const toSynth = [];

  for (const line of ordered) {
    const cacheKey = crypto.createHash("md5").update(`${CACHE_VERSION}:${model}:${line}`).digest("hex") + ".mp3";
    const file = path.join(CACHE_DIR, cacheKey);
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      if (stats.size > 100) {
        cachedCount++;
        continue;
      }
      try { fs.unlinkSync(file); } catch (_) {}
    }

    const legacyKey = crypto.createHash("md5").update(`${model}:${line}`).digest("hex") + ".mp3";
    const legacyFile = path.join(CACHE_DIR, legacyKey);
    if (fs.existsSync(legacyFile)) {
      const stats = fs.statSync(legacyFile);
      if (stats.size > 100) {
        cachedCount++;
        continue;
      }
      try { fs.unlinkSync(legacyFile); } catch (_) {}
    }

    toSynth.push(line);
  }


  // Synthesize missing lines with controlled concurrency (2 at a time), pausing for live requests
  const CONCURRENCY = 2;
  for (let i = 0; i < toSynth.length; i += CONCURRENCY) {
    // Pause background pre-warming while any live playback request is in progress
    while (activeLiveRequests > 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const batch = toSynth.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (text) => {
        try {
          const res = await synth(text, model, null, false);
          if (res && res.file && fs.existsSync(res.file) && fs.statSync(res.file).size > 100) {
            warmedCount++;
          } else {
            errorCount++;
          }
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
  return { total: ordered.length, cached: cachedCount, warmed: warmedCount, errors: errorCount };
}

/**
 * Caps the cache directory to prevent unbounded disk growth.
 * Keeps up to maxFiles most recently modified files.
 */
export function pruneCacheIfNeeded(maxFiles = 600) {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    if (files.length <= maxFiles) return;
    const fileStats = [];
    for (const f of files) {
      if (!f.endsWith(".mp3")) continue;
      const fullPath = path.join(CACHE_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        fileStats.push({ path: fullPath, mtime: stat.mtimeMs });
      } catch (_) {}
    }
    if (fileStats.length <= maxFiles) return;
    fileStats.sort((a, b) => a.mtime - b.mtime);
    const toDelete = fileStats.slice(0, fileStats.length - maxFiles);
    for (const item of toDelete) {
      try { fs.unlinkSync(item.path); } catch (_) {}
    }
    console.log(`[TTS] Pruned ${toDelete.length} old cache files (capped at ${maxFiles})`);
  } catch (err) {
    console.warn("[TTS] Cache prune warning:", err.message);
  }
}
