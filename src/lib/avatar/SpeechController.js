// src/lib/avatar/SpeechController.js
// Single Speech Controller (one source of truth) for Greenie Kiosk.
// Manages audio synthesis, queueing, decoding, playback and subtitles.

import { TTS_CONFIG, TTS_ENDPOINT } from "../ttsConfig";
import { sanitizeTtsText, splitIntoTtsChunks } from "../ttsTextSanitizer";
import { getAudioContext, attachLipSync, resetLipSync } from "../lipSync";

// In-memory cache for decoded AudioBuffers: key `${model}:${cleanText}` -> AudioBuffer
const audioBufferCache = new Map();

/**
 * Helper to decode ArrayBuffer into AudioBuffer using Web Audio AudioContext.
 */
function decodeAudioBuffer(audioCtx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const res = audioCtx.decodeAudioData(arrayBuffer, resolve, reject);
      if (res && typeof res.then === "function") {
        res.then(resolve).catch(reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Prime AudioContext and issue a tiny test fetch to warm up Deepgram and local TTS cache.
 */
export async function warmupSpeech() {
  if (typeof window === "undefined") return;
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const model = TTS_CONFIG.model || "aura-2-luna-en";
    fetch(`${TTS_ENDPOINT}?text=hi&model=${encodeURIComponent(model)}`)
      .then(async (res) => {
        if (res.ok && ctx) {
          const ab = await res.arrayBuffer();
          decodeAudioBuffer(ctx, ab).catch(() => {});
        }
      })
      .catch(() => {});
  } catch (_) {}
}

export class SpeechController {
  constructor() {
    this.queue = [];
    this.generation = 0;
    this.isDraining = false;
    this.currentPlayingItem = null;
    this.currentSourceNode = null;
    this.currentAudioElement = null;
    this._pendingPlaybackResolve = null;

    // Track active replies: replyId -> { replyId, source, speechId, enqueuedCount, playedCount, ended, sentences, hasLoggedFirstReq, hasLoggedFirstByte }
    this.replyMap = new Map();
    this.currentPendingReplyId = null;

    // Deduplication & history
    this.seenReplyKeys = new Set();
    this.sentSpeechDones = new Set();
    this.lastSpokenSentences = []; // last few normalized sentences

    // Prefetching management
    this._activePrefetches = new Map(); // key -> AbortController
    this._chunkSeq = 0;
    this.cancelledReplyIds = new Set(); // replies the user cut off; never speak them again
    this.recentEnqueued = []; // { norm, t }: lines queued in the last 15s, used to block repeats

    // Subtitle hold timer (2.5s hold)
    this._subtitleHoldTimer = null;
    this._heldSubtitle = "";

    // Avatar ref for lipsync & expressions
    this.avatar = null;

    // Callbacks
    this.onSpeakingChange = null;
    this.onChunkStart = null;
    this.onChunkFail = null;
    this.onSpeechDone = null;
    this.onSubtitleHold = null;
    this.onSubtitleClear = null;
    this._onQueueEmpty = null;
  }

  setAvatar(avatar) {
    this.avatar = avatar;
  }

  isSpeaking() {
    return this.isDraining || this.queue.length > 0 || this.currentPlayingItem !== null;
  }

  isQueueEmpty() {
    return this.queue.length === 0 && this.currentPlayingItem === null;
  }

  onQueueEmpty(cb) {
    if (this.isQueueEmpty()) {
      try { cb(); } catch (_) {}
    } else {
      this._onQueueEmpty = cb;
    }
  }

  getEnqueuedCount(replyId) {
    if (!replyId) return 0;
    const meta = this.replyMap.get(replyId);
    return meta ? meta.enqueuedCount : 0;
  }

  /**
   * Explicitly open a reply turn from an ACTION frame or caller.
   */
  beginReply(replyId, { source = "unknown", speechId = null, userFinalTs = null, firstSentenceReceivedTs = null } = {}) {
    const rid = replyId || `reply_${Date.now()}`;
    if (this.cancelledReplyIds.has(rid)) {
      console.log(`[SpeechController] beginReply ignored, ${rid} was cancelled`);
      return rid;
    }
    let meta = this.replyMap.get(rid);
    if (!meta) {
      meta = {
        replyId: rid,
        source,
        speechId: speechId || null,
        enqueuedCount: 0,
        playedCount: 0,
        sentences: [],
        ended: false,
        hasLoggedFirstReq: false,
        hasLoggedFirstByte: false,
        userFinalTs: userFinalTs || null,
        firstSentenceReceivedTs: firstSentenceReceivedTs || null,
        firstTtsReqTs: null,
        firstByteTs: null,
        hasLoggedLatency: false,
      };
      this.replyMap.set(rid, meta);
    } else {
      if (speechId && !meta.speechId) meta.speechId = speechId;
      if (source && meta.source === "unknown") meta.source = source;
      if (userFinalTs && !meta.userFinalTs) meta.userFinalTs = userFinalTs;
      if (firstSentenceReceivedTs && !meta.firstSentenceReceivedTs) meta.firstSentenceReceivedTs = firstSentenceReceivedTs;
    }

    this.currentPendingReplyId = rid;
    console.log(`[SpeechController] reply start replyId=${rid} source=${source} speechId=${speechId ?? "N/A"}`);
    return rid;
  }

  /**
   * Enqueue a sentence for a reply.
   * NEVER clears the queue; appends behind active audio.
   */
  appendSentence(replyId, text, options = {}) {
    if (!text || typeof text !== "string" || !text.trim()) {
      return;
    }

    // Resolve replyId: bind turn_default or missing replyId to current pending reply
    let rid = replyId;
    if (!rid || rid === "turn_default") {
      rid = this.currentPendingReplyId || this.beginReply(`reply_${Date.now()}`, {
        source: "streamed",
        userFinalTs: options.userFinalTs,
        firstSentenceReceivedTs: options.firstSentenceReceivedTs,
      });
    }

    if (this.cancelledReplyIds.has(rid)) {
      console.log(`[SpeechController] Dropping sentence for cancelled reply ${rid}: "${String(text).slice(0, 40)}"`);
      return;
    }

    let meta = this.replyMap.get(rid);
    if (!meta) {
      this.beginReply(rid, {
        source: options.source || "streamed",
        speechId: options.speechId,
        userFinalTs: options.userFinalTs,
        firstSentenceReceivedTs: options.firstSentenceReceivedTs,
      });
      meta = this.replyMap.get(rid);
    } else {
      if (options.speechId && !meta.speechId) meta.speechId = options.speechId;
      if (options.userFinalTs && !meta.userFinalTs) meta.userFinalTs = options.userFinalTs;
      if (options.firstSentenceReceivedTs && !meta.firstSentenceReceivedTs) meta.firstSentenceReceivedTs = options.firstSentenceReceivedTs;
    }

    const sanitized = sanitizeTtsText(text);
    if (!sanitized) {
      return;
    }

    const chunks = splitIntoTtsChunks(sanitized);
    if (chunks.length === 0) return;

    let enqueuedInBatch = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const normChunk = chunk.toLowerCase().replace(/[^\w\s]/g, "").trim();

      // De-dupe 1: Greeting prefix repeated in ASK_NAME (frontend-only de-dupe)
      // "Expected audio order: 'Hi! I'm Greeny. Welcome to Green Fibre.' THEN 'Hi! I'm Greeny. What's your name?'"
      // If reply has enqueued 0 chunks so far, and the first chunk matches recently spoken greeting prefix, drop it!
      if (meta.enqueuedCount === 0 && i === 0 && this.lastSpokenSentences.length > 0) {
        const matchesRecent = this.lastSpokenSentences.some(
          (prev) => prev.includes(normChunk) || normChunk.includes(prev)
        );
        if (matchesRecent && normChunk.length > 15) {
          console.log(`[SpeechController] Dropping repeated prefix sentence: "${chunk.slice(0, 40)}" (replyId=${rid})`);
          continue;
        }
      }

      // De-dupe 2: Duplicate key check (replyId + normalized text)
      const dedupeKey = `${rid}:${normChunk}`;
      if (this.seenReplyKeys.has(dedupeKey)) {
        console.log(`[SpeechController] duplicate (key=${dedupeKey}) skipped`);
        continue;
      }
      this.seenReplyKeys.add(dedupeKey);

      // De-dupe 3: same words already queued recently, even if chunked differently or under another replyId
      const flatNorm = normChunk.replace(/\s+/g, " ");
      const nowTs = Date.now();
      this.recentEnqueued = this.recentEnqueued.filter((e) => nowTs - e.t < 15000);
      const recentText = this.recentEnqueued.map((e) => e.norm).join(" ");
      const isShortEcho =
        flatNorm.length < 6 &&
        this.recentEnqueued.some((e) => e.norm.startsWith(flatNorm + " "));
      if ((flatNorm.length >= 6 && recentText.includes(flatNorm)) || isShortEcho) {
        console.log(`[SpeechController] Skipping repeated line: "${chunk.slice(0, 40)}" (replyId=${rid})`);
        continue;
      }
      this.recentEnqueued.push({ norm: flatNorm, t: nowTs });

      const item = {
        id: "chunk_" + (++this._chunkSeq),
        replyId: rid,
        speechId: meta.speechId || options.speechId || null,
        text: chunk,
        sanitized: chunk,
        options,
        tEnqueued: Date.now(),
        audioBuffer: null,
      };

      this.queue.push(item);
      meta.enqueuedCount++;
      meta.sentences.push(chunk);
      enqueuedInBatch++;
    }

    if (enqueuedInBatch > 0) {
      console.log(`[SpeechController] Enqueued replyId=${rid} chunks=${enqueuedInBatch} totalQueue=${this.queue.length}`);
    }

    // Start all chunk TTS fetches as soon as enqueued (up to 3 in parallel)
    for (let j = 0; j < Math.min(this.queue.length, 3); j++) {
      const qItem = this.queue[j];
      if (qItem && !qItem.audioBuffer) {
        this._prefetchChunkAudio(qItem, this.generation);
      }
    }

    // Ensure the single drain loop is processing
    this._ensureDrainLoop();
  }

  /**
   * Signal that all sentences for this reply have arrived.
   */
  endReply(replyId) {
    const rid = replyId || this.currentPendingReplyId;
    if (!rid) return;
    const meta = this.replyMap.get(rid);
    if (meta) {
      meta.ended = true;
      // If nothing was enqueued and nothing is playing, check if completed
      if (meta.enqueuedCount === 0) {
        console.log(`[SpeechController] reply ended with 0 chunks enqueued (replyId=${rid})`);
      }
    }
  }

  /**
   * Cancel all playback immediately (session reset, user barge-in, or disengage).
   */
  cancelAll(reason = "user_interrupt") {
    const droppedCount = this.queue.length;
    this.generation++;
    const currentGen = this.generation;

    console.log(`[SpeechController] cancelAll reason=${reason} queueDropped=${droppedCount} generation=${currentGen}`);

    // Clear subtitle hold timer and clear active subtitles immediately on reset/interrupt
    if (this._subtitleHoldTimer) {
      clearTimeout(this._subtitleHoldTimer);
      this._subtitleHoldTimer = null;
    }
    this._heldSubtitle = "";
    this.onSubtitleClear?.();

    // Abort active prefetch fetches
    for (const [, entry] of this._activePrefetches.entries()) {
      try { entry.controller.abort(); } catch (_) {}
    }
    this._activePrefetches.clear();

    // Stop Web Audio node immediately
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch (_) {}
      this.currentSourceNode = null;
    }

    // Stop HTMLAudioElement if any
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.removeAttribute("src");
        this.currentAudioElement.load();
      } catch (_) {}
      this.currentAudioElement = null;
    }

    resetLipSync();

    // Cancel browser speech synthesis if active
    if (typeof window !== "undefined") {
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    }

    // Resolve any pending playback promise immediately
    if (this._pendingPlaybackResolve) {
      const fn = this._pendingPlaybackResolve;
      this._pendingPlaybackResolve = null;
      try { fn("cancelled"); } catch (_) {}
    }

    if (reason !== "session_reset") {
      for (const [rid, meta] of this.replyMap.entries()) {
        if (!meta.ended || this.queue.some((q) => q.replyId === rid)) this.cancelledReplyIds.add(rid);
      }
      if (this.currentPendingReplyId) this.cancelledReplyIds.add(this.currentPendingReplyId);
      if (this.cancelledReplyIds.size > 200) {
        this.cancelledReplyIds = new Set(Array.from(this.cancelledReplyIds).slice(-100));
      }
    }

    // Reset queue state
    this.queue.length = 0;
    this.recentEnqueued.length = 0;
    this.currentPlayingItem = null;
    this.isDraining = false;
    this.currentPendingReplyId = null;

    if (reason === "session_reset") {
      this.cancelledReplyIds.clear();
      this.replyMap.clear();
      this.seenReplyKeys.clear();
      this.sentSpeechDones.clear();
      this.lastSpokenSentences.length = 0;
    }

    // Reset avatar state
    if (this.avatar) {
      this.avatar.mode = "idle";
      this.avatar.setMouth?.("rest", 0);
      this.avatar.setStatus?.("Listening...");
    }
    this.onSpeakingChange?.(false);
  }

  /**
   * Prefetch and decode audio for an utterance into memory cache.
   */
  async prefetchAudioBuffer(text, model = TTS_CONFIG.model || "aura-2-luna-en") {
    if (!text || typeof window === "undefined") return null;
    const sanitized = sanitizeTtsText(text);
    if (!sanitized) return null;
    const cacheKey = `${model}:${sanitized}`;
    if (audioBufferCache.has(cacheKey)) {
      return audioBufferCache.get(cacheKey);
    }

    try {
      const audioCtx = getAudioContext();
      if (!audioCtx) return null;
      const res = await fetch(`${TTS_ENDPOINT}?text=${encodeURIComponent(sanitized)}&model=${encodeURIComponent(model)}`);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        const decoded = await decodeAudioBuffer(audioCtx, ab);
        audioBufferCache.set(cacheKey, decoded);
        return decoded;
      }
    } catch (_) {}
    return null;
  }

  async _prefetchChunkAudio(item, gen) {
    if (gen !== this.generation || !item) return null;
    const model = TTS_CONFIG.model || "aura-2-luna-en";
    const cacheKey = `${model}:${item.sanitized}`;

    if (audioBufferCache.has(cacheKey)) {
      item.audioBuffer = audioBufferCache.get(cacheKey);
      return item.audioBuffer;
    }

    // Same text already being fetched: WAIT for that request (old code returned null = fake failure)
    const inflight = this._activePrefetches.get(cacheKey);
    if (inflight) {
      const buf = await inflight.promise;
      if (gen !== this.generation) return null;
      if (buf) item.audioBuffer = buf;
      return buf;
    }

    const abortCtrl = new AbortController();
    const promise = this._fetchAndDecode(item, gen, cacheKey, model, abortCtrl);
    this._activePrefetches.set(cacheKey, { controller: abortCtrl, promise });
    try {
      return await promise;
    } finally {
      if (this._activePrefetches.get(cacheKey)?.promise === promise) {
        this._activePrefetches.delete(cacheKey);
      }
    }
  }

  async _fetchAndDecode(item, gen, cacheKey, model, abortCtrl) {
    const meta = this.replyMap.get(item.replyId);
    if (meta && !meta.firstTtsReqTs) {
      meta.firstTtsReqTs = typeof window !== "undefined" ? performance.now() : Date.now();
    }
    if (meta && !meta.hasLoggedFirstReq) {
      meta.hasLoggedFirstReq = true;
      console.log(`[SpeechController] first TTS request replyId=${item.replyId} text="${item.sanitized.slice(0, 50)}"`);
    }
    try {
      const audioCtx = getAudioContext();
      const res = await fetch(
        `${TTS_ENDPOINT}?text=${encodeURIComponent(item.sanitized)}&model=${encodeURIComponent(model)}`,
        { signal: abortCtrl.signal }
      );
      if (gen !== this.generation) return null;

      if (meta && !meta.firstByteTs) {
        meta.firstByteTs = typeof window !== "undefined" ? performance.now() : Date.now();
      }
      if (meta && !meta.hasLoggedFirstByte) {
        meta.hasLoggedFirstByte = true;
        console.log(`[SpeechController] first byte replyId=${item.replyId} status=${res.status}`);
      }
      if (res.ok && audioCtx) {
        const ab = await res.arrayBuffer();
        if (gen !== this.generation) return null;
        const decoded = await decodeAudioBuffer(audioCtx, ab);
        if (gen === this.generation) {
          audioBufferCache.set(cacheKey, decoded);
          item.audioBuffer = decoded;
          return decoded;
        }
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.warn(`[SpeechController] TTS fetch failed: "${item.sanitized.slice(0, 40)}"`, err?.message || err);
      }
    }
    return null;
  }

  /**
   * Prefetch up to 2 upcoming chunks (N+1 and N+2) while chunk N is playing.
   */
  _prefetchUpcomingChunks(gen) {
    if (gen !== this.generation) return;
    const model = TTS_CONFIG.model || "aura-2-luna-en";
    let scheduled = 0;

    for (let i = 0; i < this.queue.length && scheduled < 2; i++) {
      const item = this.queue[i];
      if (!item) continue;
      const cacheKey = `${model}:${item.sanitized}`;
      if (!audioBufferCache.has(cacheKey) && !this._activePrefetches.has(cacheKey)) {
        this._prefetchChunkAudio(item, gen);
        scheduled++;
      }
    }
  }

  /**
   * Ensure exactly one drain loop runs.
   */
  _ensureDrainLoop() {
    if (this.isDraining) return;
    this.isDraining = true;
    this._drainLoop(this.generation);
  }

  /**
   * Single FIFO drain loop.
   */
  async _drainLoop(drainGen) {
    try {
      while (this.queue.length > 0) {
        if (drainGen !== this.generation) break;

        const item = this.queue[0];
        this.currentPlayingItem = item;

        // Prefetch next 2 chunks in parallel while this one is prepared/played
        this._prefetchUpcomingChunks(drainGen);

        try {
          await this._playItem(item, drainGen);
        } catch (err) {
          console.error(`[SpeechController] Play error for item ${item.id}:`, err?.message || err);
          this._handleChunkFail(item, err?.message || "playback_error");
        } finally {
          if (drainGen === this.generation) {
            if (this.queue[0] === item) this.queue.shift();
            this.currentPlayingItem = null;
          }
        }

        if (drainGen !== this.generation) break;

        // Check if reply completed
        const meta = this.replyMap.get(item.replyId);
        if (meta) {
          meta.playedCount++;
          const replyQueueRemaining = this.queue.filter((q) => q.replyId === item.replyId).length;
          if (meta.ended && replyQueueRemaining === 0) {
            console.log(`[SpeechController] reply finished replyId=${item.replyId} chunksPlayed=${meta.playedCount}`);
            if (meta.speechId && !this.sentSpeechDones.has(meta.speechId)) {
              this.sentSpeechDones.add(meta.speechId);
              console.log(`[SpeechController] Emitting onSpeechDone for speech_id: ${meta.speechId}`);
              this.onSpeechDone?.(meta.speechId);
            }
          }
        }
      }
    } finally {
      if (drainGen === this.generation) {
        this.isDraining = false;
        this.currentPlayingItem = null;

        // Reset speaking state
        this.onSpeakingChange?.(false);
        if (this.avatar) {
          this.avatar.mode = "idle";
          this.avatar.setMouth?.("rest", 0);
          this.avatar.setStatus?.("Listening...");
        }

        // Hold last subtitle line for 2.5s after speech ends
        this._startSubtitleHold();

        if (this._onQueueEmpty) {
          const cb = this._onQueueEmpty;
          this._onQueueEmpty = null;
          try { cb(); } catch (_) {}
        }
      }
    }
  }

  /**
   * Play an individual chunk using Web Audio AudioBufferSourceNode.
   */
  async _playItem(item, gen) {
    if (gen !== this.generation) return;

    // Retrieve or fetch audio buffer
    let audioBuffer = item.audioBuffer;
    if (!audioBuffer) {
      audioBuffer = await this._prefetchChunkAudio(item, gen);
    }

    if (gen !== this.generation) return;

    if (!audioBuffer) {
      // Audio synthesis failed: display subtitle for reading time and log
      this._handleChunkFail(item, "tts_fetch_failed");
      return;
    }

    const audioCtx = getAudioContext();
    if (!audioCtx) {
      this._handleChunkFail(item, "audio_context_unavailable");
      return;
    }

    if (audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch (_) {}
    }

    if (gen !== this.generation) return;

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    this.currentSourceNode = source;

    if (this.avatar) {
      this.avatar.mode = "audio";
      this.avatar.setStatus?.("Explaining...");
    }

    const detachLipSync = attachLipSync(source);

    // Watchdog timeout = duration + 400ms (Task 2)
    const durationMs = Math.round(audioBuffer.duration * 1000 + 400);

    await new Promise((resolve) => {
      let resolved = false;
      let watchdogTimer = null;

      const safeResolve = (reason) => {
        if (resolved) return;
        resolved = true;
        this._pendingPlaybackResolve = null;

        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }

        try { source.onended = null; } catch (_) {}
        try { detachLipSync(); } catch (_) {}
        try { resetLipSync(); } catch (_) {}

        if (this.currentSourceNode === source) {
          this.currentSourceNode = null;
        }

        resolve(reason);
      };

      this._pendingPlaybackResolve = safeResolve;

      watchdogTimer = setTimeout(() => {
        console.warn(`[SpeechController] Watchdog timeout ended playback (${durationMs}ms) text="${item.sanitized.slice(0, 40)}"`);
        try { source.stop(); } catch (_) {}
        safeResolve("timeout");
      }, durationMs);

      source.onended = () => {
        safeResolve("ended");
      };

      // Logging & subtitle update on playback start
      console.log(`[SpeechController] playback start replyId=${item.replyId} duration=${audioBuffer.duration.toFixed(2)}s text="${item.sanitized.slice(0, 50)}"`);
      this.onSpeakingChange?.(true);

      const meta = this.replyMap.get(item.replyId);
      if (meta && meta.userFinalTs && !meta.hasLoggedLatency) {
        meta.hasLoggedLatency = true;
        const playbackStartTs = typeof window !== "undefined" ? performance.now() : Date.now();
        const sentRecvMs = meta.firstSentenceReceivedTs ? Math.round(meta.firstSentenceReceivedTs - meta.userFinalTs) : Math.round(playbackStartTs - meta.userFinalTs);
        const ttsReqByteMs = meta.firstTtsReqTs && meta.firstByteTs ? Math.round(meta.firstByteTs - meta.firstTtsReqTs) : 0;
        const bytePlayMs = meta.firstByteTs ? Math.round(playbackStartTs - meta.firstByteTs) : 0;
        const totalMs = Math.round(playbackStartTs - meta.userFinalTs);
        console.log(`[Latency] user_final->first_sentence_received=${sentRecvMs}ms first_tts_request->first_byte=${ttsReqByteMs}ms first_byte->playback_start=${bytePlayMs}ms total user_final->audio_start=${totalMs}ms`);
      }

      // Cancel any active subtitle hold timer
      if (this._subtitleHoldTimer) {
        clearTimeout(this._subtitleHoldTimer);
        this._subtitleHoldTimer = null;
      }
      this._heldSubtitle = "";

      this.onChunkStart?.(item.text, item);
      console.log(`[SpeechController] playing event replyId=${item.replyId} text="${item.sanitized.slice(0, 50)}"`);

      // Record normalized sentence in history for prefix deduplication
      const norm = item.sanitized.toLowerCase().replace(/[^\w\s]/g, "").trim();
      this.lastSpokenSentences.push(norm);
      if (this.lastSpokenSentences.length > 6) {
        this.lastSpokenSentences.shift();
      }

      try {
        source.start(0);
      } catch (playErr) {
        console.error(`[SpeechController] Audio source.start failed:`, playErr);
        safeResolve("start_error");
      }
    });
  }

  /**
   * Handle chunk failure: immediately show subtitle text and display for reading duration.
   */
  async _handleChunkFail(item, reason) {
    console.warn(`[SpeechController] Chunk audio failed (reason: ${reason}): "${item.sanitized.slice(0, 60)}"`);
    this.onChunkFail?.(item.text, reason);

    // Cancel any active subtitle hold timer
    if (this._subtitleHoldTimer) {
      clearTimeout(this._subtitleHoldTimer);
      this._subtitleHoldTimer = null;
    }
    this._heldSubtitle = "";

    // Show chunk text immediately in subtitles so it never stays blank
    this.onChunkStart?.(item.text, item);
    this.onSpeakingChange?.(true);

    const words = item.sanitized.split(/\s+/).filter(Boolean).length || 1;
    const displayMs = Math.max(1200, words * 240);

    const currentGen = this.generation;
    await new Promise((r) => setTimeout(r, displayMs));
    if (currentGen !== this.generation) return;

    // Record normalized sentence in history
    const norm = item.sanitized.toLowerCase().replace(/[^\w\s]/g, "").trim();
    this.lastSpokenSentences.push(norm);
    if (this.lastSpokenSentences.length > 6) {
      this.lastSpokenSentences.shift();
    }
  }

  /**
   * Subtitle hold timer: keep displaying the last chunk text for 2.5s after speech ends.
   */
  _startSubtitleHold() {
    if (this._subtitleHoldTimer) {
      clearTimeout(this._subtitleHoldTimer);
    }
    this._subtitleHoldTimer = setTimeout(() => {
      this._subtitleHoldTimer = null;
      this._heldSubtitle = "";
      this.onSubtitleClear?.();
    }, 2500);
  }
}

// Global Singleton SpeechController
export const speechController = new SpeechController();
export default speechController;
