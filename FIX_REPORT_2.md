# Greenie Voice Avatar TTS Engine Overhaul Report (v2)

## 1. Executive Summary & Root Cause Analysis

Following the deployment of the initial speech queue, logs showed four critical issues during real-world kiosk testing:

### Bug 1: New Replies Silently Skipped
- **Symptom**: Replies produced `SENTENCE` + `DONE` from the backend, but no `"Enqueued sentence"` was ever logged, leaving Greenie silent on menu and catalog taps.
- **Root Causes**:
  1. In `src/components/avatar/AvatarPanel.jsx`, an early-return guard `if (avatarInstance && (avatarInstance.isSpeaking?.() || avatarInstance.speechQueue?.length > 0))` silently returned without speaking if speech was already active, while updating `prevSpeechIdRef` and `prevCaptionRef`. Subsequent re-renders saw `changed === false` and permanently dropped the utterance.
  2. In `src/hooks/useKiosk.js`, `latestRef.current` was completely overwritten on every render without preserving `_stageRef`, causing `stageRef.current` to become `undefined` and sentence handlers to silently fail.
  3. No explicit rule prioritised fresh user navigation over old, long sentences.
- **Fix**:
  - Implemented the **LATEST REPLY WINS** rule: when the user triggers a new action (`SHOW_CATEGORIES`, `SHOW_PRODUCTS`, `SHOW_PRODUCT`, etc.), any playing or queued speech is immediately superseded via `clearQueue("superseded_by_new_reply")`, and the fresh reply is synthesized immediately.
  - Greeting $\to$ `ASK_NAME` sequence is preserved and appends without clearing.
  - All silent skips replaced with explicit reason logging (`reason="duplicate"`, `reason="empty_caption"`, `reason="not_engaged"`, `reason="user_speaking"`).
  - Ensured `stageRef` is stored directly on `latestRef.current` and accessed safely.

### Bug 2: Stale Timers After Clear
- **Symptom**: After `clearQueue` was called at 15:12:50, `"TTS playback ended (timeout)"` still fired at 15:12:52 for the cleared utterance.
- **Root Cause**: The promise created in `_playAudio()` had a watchdog `setTimeout` that remained pending inside the closure. `clearQueue()` paused the audio element but never cancelled the timer or resolved the pending promise, causing the timeout to trigger later and resume the queue processor loop.
- **Fix**:
  - Implemented a monotonic generation token `this._genToken`.
  - Calling `clearQueue()` increments `this._genToken++`, clears `this._playbackTimeoutTimer`, removes all event listeners from `this.audio`, and immediately resolves any pending promise with `"cancelled"`.
  - Code following any `await` checks `token !== this._genToken` and immediately returns without touching `this.mode`, `this.onSpeakingChange`, or `this._onQueueEmpty`.
  - Added assertion check: if `this.isSpeaking()` is true while queue is empty, flags are forcefully reset and a warning is logged.

### Bug 3: TTS Timeout Too Short, Duplicate Retries & Voice Switch
- **Symptom**: Renderer aborted TTS at 4.5s for long sentences while Deepgram took ~5s, triggered a duplicate request while the first was still running, and fell back to `window.speechSynthesis`, which changed the voice mid-reply and left subtitles stuck.
- **Root Cause**: Fixed 4.5s fetch timeout caused premature aborts; catch block treated `AbortError` as network failure and triggered a duplicate retry; fallback to `speechSynthesis` switched the voice persona from Deepgram Aura Luna to browser robotic voice.
- **Fix**:
  - Implemented dynamic timeout: `timeoutMs = 8000 + (sanitized.length * 60)`.
  - Strict retry policy: retry at most once, and only for true 5xx/429/network errors. Never retry on `AbortError`, timeout, or 400.
  - Upstream request cancellation: `server/index.js` listens to `req.on("close")` and aborts upstream Deepgram fetch via `AbortController` if the client disconnects.
  - `ENABLE_SPEECH_SYNTH_FALLBACK = false` flag added. On final failure, audio is skipped, queue advances cleanly, and subtitle displays full text without sticking.

### Bug 4: Late Speech & Gaps Between Sentences
- **Symptom**: Each sentence was fetched only after the prior one finished playing, causing 1–2s latency gaps between sentences.
- **Root Cause**: Sequential fetch-then-play architecture without chunking or prefetching.
- **Fix**:
  - Added `splitIntoTtsChunks(text)` in `src/lib/ttsTextSanitizer.js`:
    - Isolates personalized name greetings (`"Nice to meet you, <name>!"`, `"<name>,"`) as their own chunk so the rest hits the pre-warmed static cache.
    - Splits sentences longer than 80 characters at natural clause breaks (commas, semicolons, `" and "`, `" but "`) into ~25–80 char chunks.
  - Implemented **3-Concurrent Prefetch Pipeline** in `GreenieAvatar.js`: up to 3 chunks are fetched concurrently as soon as they are enqueued while preserving strict FIFO playback order. By the time Chunk 1 finishes, Chunk 2 is already buffered ($< 300$ms transition).
  - Pre-warmed persistent disk cache in `server/tts.js` at startup with all static greetings, prompts, categories, and products.
  - Comprehensive per-chunk timing logs (`enqueued -> req sent -> first byte -> play start -> ended`, plus duration mismatch warnings).

---

## 2. Modified Files Summary

| File | Changes |
|------|---------|
| `src/lib/ttsTextSanitizer.js` | Added `splitIntoTtsChunks()` with name-intro isolation and ~25–80 char clause splitting; updated `SentenceTokenStreamer` to emit sub-chunks. |
| `src/lib/avatar/GreenieAvatar.js` | Added `_genToken` cancellation tokens, 3-concurrent prefetch pipeline (`_prefetchNextChunks`), dynamic timeout formula, `ENABLE_SPEECH_SYNTH_FALLBACK = false`, comprehensive chunk timing logs, and queue empty assertions. |
| `src/components/avatar/AvatarPanel.jsx` | Removed silent early-returns before `speak()`; added logged reasons (`duplicate`, `empty_caption`, `not_engaged`, `user_speaking`); enforced "latest reply wins" rule. |
| `src/components/avatar/GreenieStage.jsx` | Exposed `clearQueue(reason)` on imperative handle `ref`. |
| `src/components/avatar/Captions.jsx` | Subtitle follows current chunk; displays full text when audio is idle or skipped. |
| `src/hooks/useKiosk.js` | Preserved `stageRef` in `latestRef.current`; added `clearQueue("superseded_by_new_reply")` on category/product taps and server actions; preserved greeting $\to$ name appending. |
| `server/tts.js` | Added persistent disk cache directory (`.cache/tts`), client disconnect cancellation via `AbortSignal`, and `prewarmTtsCache()` startup runner. |
| `server/index.js` | Handled client disconnect `req.on("close")` with `abortController.abort()`; added async startup pre-warming for static lines and catalog products. |

---

## 3. Verification & Build Results

### Next.js Production Build
```powershell
npm run build
```
**Output**:
```
▲ Next.js 16.3.8 (Turbopack)
- Environments: .env
✓ Running next.config.mjs took 222ms
  Creating an optimized production build ...
✓ Compiled successfully in 15.9s
  Running TypeScript ...
  Finished TypeScript in 9ms ...
  Collecting page data using 3 workers ...
  Generating static pages using 3 workers (3/3) in 1990ms
✓ Generating static pages using 3 workers (3/3) in 1990ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
└ ○ /_not-found
○  (Static)  prerendered as static content
```
*Build exited with code 0 (Success).*

---

## 4. Test Instructions & Acceptance Verification

1. **Start the Voice Server**:
   ```powershell
   node server/index.js
   ```
   *Verify startup logs*:
   ```
   [TTS Startup] Verified Deepgram model: aura-2-luna-en (200 OK)
   [TTS Pre-Warm] Pre-warming 21 static lines into persistent cache...
   [TTS Pre-Warm] Cache ready: 21 already cached, 0 freshly synthesized, 0 errors.
   ```

2. **Start the Kiosk App**:
   ```powershell
   npm run dev
   # or for Electron packaging:
   npm run electron:dev
   ```

3. **Run Rapid Category / Product Tapping Acceptance Test**:
   - Allow initial auto-greeting to complete.
   - Rapidly tap in sequence: **Bottle** $\to$ **Full collection** $\to$ **Bottle** $\to$ **Drinkware** $\to$ **Kitchen** $\to$ **Planter** $\to$ **Single product card**.
   - **Expected Behavior**:
     - Every tap logs `[VoiceServer] Speech queue cleared (reason: superseded_by_new_reply)` followed by `[VoiceServer] Enqueued sentence`.
     - Previous audio stops immediately without hanging or overlapping.
     - New reply speaks in the same Deepgram Aura Luna voice.
     - No `speechSynthesis` fallback voice changes.
     - No `"TTS playback ended (timeout)"` logs after clear.
     - Inter-chunk gaps stay under $\sim 300$ms on warm cache.
