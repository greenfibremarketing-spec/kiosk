# FIX REPORT: Voice Avatar TTS Queue & SPEECH_DONE Synchronization

## Step 1: Search Results

Files and line numbers containing the searched strings across the project:

### 1. `SENTENCE received`
- **`src/hooks/useKiosk.js`**: Line 869
  ```javascript
  console.log(`[Renderer] SENTENCE received ts=${new Date().toISOString()} turn=${turnId || "N/A"} text="${sentence.slice(0, 50)}"`);
  ```

### 2. `TTS req sent`
- **`src/lib/avatar/GreenieAvatar.js`**: Line 733 (formerly line 675)
  ```javascript
  console.log(`[VoiceServer] TTS req sent attempt=${attempt} ts=${new Date().toISOString()} text="${item.sanitized.slice(0, 60)}"`);
  ```

### 3. `TTS playback start`
- **`src/lib/avatar/GreenieAvatar.js`**: Line 788 (formerly line 797)
  ```javascript
  console.log(`[VoiceServer] TTS playback start ts=${new Date().toISOString()} text="${item.sanitized.slice(0, 50)}"`);
  ```

### 4. `safety watchdog`
- **`src/hooks/useKiosk.js`**: Line 239
  ```javascript
  console.warn("[Kiosk] Avatar speaking safety watchdog: releasing speaking lock to allow listening");
  ```
- **`src/hooks/useKiosk.js`**: Line 577
  ```javascript
  console.log("[Kiosk] Auto-acknowledging speech_id safety watchdog:", action.speech_id);
  ```

### 5. `SPEECH_DONE`
- **`src/hooks/useKiosk.js`**: Line 592 (`// Welcome Screen: Avatar speaks greeting, await SPEECH_DONE`)
- **`src/hooks/useKiosk.js`**: Line 1238, 1250 (`kioskWS.sendSpeechDone(sid)`)
- **`src/lib/kioskWebSocket.js`**: Line 209, 396, 457, 465, 541, 555, 578, 582, 586
- **`src/lib/agent.js`**: Line 322, 329
- **`src/lib/kioskStepCache.js`**: Line 7
- **`frontend_integration_guide.md`**: Lines 25, 74, 79, 239, 354, 376

### 6. `Greeting/Action awaiting`
- **`src/lib/kioskWebSocket.js`**: Line 209
  ```javascript
  console.log(`[KioskWS] Greeting/Action awaiting SPEECH_DONE (speech_id: ${incomingSpeechId})`);
  ```

---

## Step 2: Root Cause Diagnosis

### Plain English Explanation:
The queue stopped after the first auto-greeting due to three compounding root causes:

1. **`SPEECH_DONE` Premature Acknowledgment:**
   When `SHOW_GREETING` was received by `handleServerAction`, `useKiosk.js` set `pendingSpeechAckRef.current = action.speech_id` and called `say(greetingText)`. `AvatarPanel.jsx` called `stageRef.current.speak(caption)`. In `GreenieAvatar.js`, `speak()` invoked `this.startTurn()`, which immediately called `this.stop()`. Inside `this.stop()`, `this.onSpeakingChange(false)` was called. In `useKiosk.js`, `handleSpeakingChange(false)` detected `pendingSpeechAckRef.current` and immediately emitted `kioskWS.sendSpeechDone(sid)` **before any TTS audio was fetched or played**.

2. **Playback Queue Stalling (Missing Timeout & Lack of Finally Block):**
   When the greeting audio was played via `_playAudioChunk`, the promise only resolved on `audio.onended` or `audio.onerror`. It lacked a completion watchdog timeout (`audio.duration + 2s`, or `8s` if unknown). In Electron/Chromium, if media streaming or `AudioContext` analysis delayed `onended`, the promise never resolved. Because `await this._playAudioChunk(next)` never completed, `this.isPlayingQueue` remained locked to `true` forever, and no playback ended log was generated.

3. **Silent Sentence Dropping on Turn Change (`turn=N/A`):**
   When subsequent user queries occurred, LLM responses arrived with `turnId = "N/A"` or a different turn ID. In `GreenieAvatar.js`, `enqueueSentence()` checked `if (this.currentTurnId && options.turnId !== this.currentTurnId) this.startTurn()`, which cleared both queues. Furthermore, `_processRequestQueue()` checked `if (!item || item.turnId !== this.currentTurnId) return`, silently discarding all subsequent sentences without logging. Because `this.isPlayingQueue` was also stuck, `_startPlaybackQueue()` exited immediately. After 15 seconds, the safety watchdog in `useKiosk.js` unlocked the UI state, but the avatar TTS engine remained frozen.

### Exact Lines Responsible:
- **`src/lib/avatar/GreenieAvatar.js` lines 589-591 & 598:**
  ```javascript
  stop() {
    ...
    this.onSpeakingChange(false); // Fires before audio fetch, triggering premature SPEECH_DONE
  }
  startTurn(turnId) {
    this.stop(); // Wiped queue on turn ID mismatch
  ...
  ```
- **`src/lib/avatar/GreenieAvatar.js` lines 616-620:**
  ```javascript
  const turnId = options.turnId || this.currentTurnId || ("turn_" + this.generation);
  if (this.currentTurnId && options.turnId && options.turnId !== this.currentTurnId) {
    this.startTurn(options.turnId); // Cleared queue on turn change
  ```
- **`src/lib/avatar/GreenieAvatar.js` lines 656-659:**
  ```javascript
  if (!item || item.turnId !== this.currentTurnId) {
    if (this.ttsRequestQueue.length > 0) this._processRequestQueue();
    return; // Silently dropped sentences with different or N/A turnId
  ```
- **`src/lib/avatar/GreenieAvatar.js` lines 811-822:**
  ```javascript
  audio.onended = cleanup;
  // Missing watchdog timeout: if onended never fired, resolve() was never called
  ```

---

## Step 3: Architecture of the Fix

1. **Single Global FIFO Speech Queue that Never Stalls:**
   - Implemented `speechQueue` as a single FIFO array in [`src/lib/avatar/GreenieAvatar.js`](file:///e:/greenfibre-kiosk/src/lib/avatar/GreenieAvatar.js).
   - In `_processQueue()`, each utterance is processed in a `while (this.speechQueue.length > 0)` loop and shifted inside a `finally` block. The queue can never stall.
   - In `_playAudio()`, every utterance resolves on `ended`, `error`, `abort`, `play()` rejection, or a timeout of `audio.duration + 2s` (or `8s` if unknown).
   - Added `[VoiceServer] TTS playback ended (${reason}) ts=...` and `[VoiceServer] TTS playback error ...` logs.

2. **No Sentence Dropping on Turn Change:**
   - Removed queue wiping on turn change. Sentences are never dropped due to `turn=N/A` or changed turn IDs.
   - Only explicit user interrupts (`interruptAvatar()` or barge-in) clear the queue via `clearQueue("user_interrupt")`.

3. **`SPEECH_DONE` Sent Only After Queue Drains:**
   - In `handleSpeakingChange(isSpeaking)`, `kioskWS.sendSpeechDone(sid)` is sent only if `stage.isQueueEmpty()` is true.
   - If the queue is still playing, `stage.onQueueEmpty(cb)` is registered so `SPEECH_DONE` is transmitted strictly after the last audio chunk ends.

4. **Seamless Reply Appending:**
   - If audio is currently playing, new sentences are pushed to `speechQueue` and played in order. Only one audio element plays at a time.

5. **Speaking State Reset & Last-Resort Watchdog:**
   - Avatar speaking state and mouth visemes reset to `"rest"` when the queue empties in `_processQueue()`'s outer `finally` block and on `stop()`.
   - The safety watchdog in `useKiosk.js` is updated to a generous 35s last-resort timer that checks `stage.isSpeaking()`.

6. **Text Sanitizer & Retry Logic:**
   - Pre-sanitizes: `₹1,199` $\to$ `1,199 rupees`, `&` $\to$ `and`, `..` $\to$ `.`, strips markdown/emojis, expands units (`400 ml` $\to$ `400 millilitres`).
   - Retries at most once only on 5xx/429/network errors with 300ms delay. Never retries 400.
   - Falls back to `window.speechSynthesis` with lip-sync visemes.

---

## Step 4: Git Diff of Changes

### `src/lib/avatar/GreenieAvatar.js`
```diff
--- a/src/lib/avatar/GreenieAvatar.js
+++ b/src/lib/avatar/GreenieAvatar.js
@@ -91,15 +91,15 @@ export class GreenieAvatar {
     this.flyingEntrance = null;
     this._hoverY = 0; // Flight hover height when explaining
 
-    // TTS Queue & Serialization State
-    this.currentTurnId = null;
-    this.ttsRequestQueue = [];
-    this.ttsPlaybackQueue = [];
-    this.isProcessingRequest = false;
-    this.isPlayingQueue = false;
-    this.activeTtsAbort = null;
-    this.hasQueuedSentences = false;
-    this.streamFinished = false;
+    // Global FIFO Speech Queue State
+    this.speechQueue = [];
+    this.isQueueProcessing = false;
+    this.currentPlayingUtterance = null;
+    this.activeFetchAbort = null;
+    this._onQueueEmpty = null;
+    this._uttCounter = 0;
+    this.currentTurnId = null;
+
     this._expression = "attentive";
     this._expressionStart = 0;
@@ -545,6 +545,39 @@ export class GreenieAvatar {
-  stop() {
+  stop(reason = "user_interrupt") {
     this.generation++;
     this.started = 0;
+    this.clearQueue(reason);
+  }
+
+  clearQueue(reason = "user_interrupt") {
+    const droppedCount = this.speechQueue.length;
+    if (droppedCount > 0) {
+      console.log(`[VoiceServer] Speech queue cleared (reason: ${reason}, dropped items: ${droppedCount})`);
+    }
+    this.speechQueue.length = 0;
+    this.currentPlayingUtterance = null;
+    this.isQueueProcessing = false;
+
+    if (this.activeFetchAbort) {
+      try { this.activeFetchAbort.abort(); } catch (_) {}
+      this.activeFetchAbort = null;
+    }
+
+    if (this.detachLipSync) {
+      try { this.detachLipSync(); } catch (_) {}
+      this.detachLipSync = null;
+    }
+    resetLipSync();
+
+    if (typeof window !== "undefined") {
+      try { window.speechSynthesis?.cancel(); } catch (_) {}
+    }
+    if (this.audio) {
+      try {
+        this.audio.pause();
+        this.audio.removeAttribute("src");
+        this.audio.load();
+      } catch (_) {}
+      this.audio = null;
+    }
     this.mode = "idle";
     this.reaction = null;
     this.waveStart = -10000;
@@ -586,30 +619,101 @@ export class GreenieAvatar {
+    if (this._onQueueEmpty) {
+      const cb = this._onQueueEmpty;
+      this._onQueueEmpty = null;
+      try { cb(); } catch (_) {}
+    }
+  }
+
+  isSpeaking() {
+    return this.isQueueProcessing || this.speechQueue.length > 0 || this.mode === "audio" || this.mode === "tts";
+  }
+
+  isQueueEmpty() {
+    return this.speechQueue.length === 0 && !this.isQueueProcessing && !this.audio;
+  }
+
+  onQueueEmpty(cb) {
+    if (this.isQueueEmpty()) {
+      if (typeof cb === "function") cb();
+    } else {
+      this._onQueueEmpty = cb;
+    }
+  }
+
   startTurn(turnId) {
-    this.stop();
-    this.currentTurnId = turnId || ("turn_" + this.generation);
+    this.currentTurnId = turnId || "turn_default";
     this._arrived = true;
     if (this.model && this.model.position.x < -2.0 && !this.flyingEntrance) {
       this.model.position.x = 0;
     }
   }
 
   enqueueSentence(sentence, options = {}) {
-    if (!sentence || typeof sentence !== "string") return;
+    if (!sentence || typeof sentence !== "string" || !sentence.trim()) {
+      console.log("[Avatar] Dropping empty sentence (reason: empty_text)");
+      return;
+    }
     const sanitized = sanitizeTtsText(sentence);
-    if (!sanitized) return;
-
-    const turnId = options.turnId || this.currentTurnId || ("turn_" + this.generation);
-    if (this.currentTurnId && options.turnId && options.turnId !== this.currentTurnId) {
-      this.startTurn(options.turnId);
-    } else if (!this.currentTurnId) {
-      this.currentTurnId = turnId;
+    if (!sanitized) {
+      console.log(`[Avatar] Dropping sentence after sanitization (reason: empty_sanitized, original: "${sentence.slice(0, 40)}")`);
+      return;
     }
 
-    this.hasQueuedSentences = true;
-    this.ttsRequestQueue.push({
-      sentence: sanitized,
-      originalText: sentence,
-      turnId: this.currentTurnId,
+    const item = {
+      id: "utt_" + (++this._uttCounter),
+      text: sentence,
+      sanitized,
+      turnId: options.turnId || this.currentTurnId || "N/A",
       options,
-    });
-    this._processRequestQueue();
+    };
+
+    this.speechQueue.push(item);
+    console.log(`[VoiceServer] Enqueued sentence (queue length: ${this.speechQueue.length}): "${sanitized.slice(0, 60)}" [turn=${item.turnId}]`);
+    this._processQueue();
   }
 
   finishTurn(turnId) {
-    if (turnId && this.currentTurnId && turnId !== this.currentTurnId) return;
-    this.streamFinished = true;
-    if (!this.isPlayingQueue && this.ttsPlaybackQueue.length === 0 && this.ttsRequestQueue.length === 0) {
+    if (this.isQueueEmpty()) {
       this.mode = "idle";
       this.setMouth("rest", 0);
       this.onSpeakingChange(false);
       this.setStatus("Listening...");
+      if (this._onQueueEmpty) {
+        const cb = this._onQueueEmpty;
+        this._onQueueEmpty = null;
+        try { cb(); } catch (_) {}
+      }
     }
   }
 
-  async _processRequestQueue() {
-    if (this.isProcessingRequest || this.ttsRequestQueue.length === 0) return;
-    const item = this.ttsRequestQueue.shift();
-    ...
-  }
+  async _processQueue() {
+    if (this.isQueueProcessing) return;
+    this.isQueueProcessing = true;
+    try {
+      while (this.speechQueue.length > 0) {
+        const item = this.speechQueue[0];
+        this.currentPlayingUtterance = item;
+        try {
+          await this._playUtterance(item);
+        } catch (err) {
+          console.error(`[VoiceServer] Utterance error in queue (${item.id}):`, err?.message || err);
+        } finally {
+          if (this.speechQueue[0] === item) this.speechQueue.shift();
+          this.currentPlayingUtterance = null;
+        }
+      }
+    } finally {
+      this.isQueueProcessing = false;
+      this.currentPlayingUtterance = null;
+      this.mode = "idle";
+      this.setMouth("rest", 0);
+      this.onSpeakingChange(false);
+      this.setStatus("Listening...");
+      if (this._onQueueEmpty) {
+        const cb = this._onQueueEmpty;
+        this._onQueueEmpty = null;
+        try { cb(); } catch (_) {}
+      }
+    }
+  }
```

### `src/components/avatar/GreenieStage.jsx`
```diff
--- a/src/components/avatar/GreenieStage.jsx
+++ b/src/components/avatar/GreenieStage.jsx
@@ -82,6 +82,9 @@ export default function GreenieStage({
       startTurn: (turnId) => avatarRef.current?.startTurn(turnId),
       finishTurn: (turnId) => avatarRef.current?.finishTurn(turnId),
+      isSpeaking: () => avatarRef.current?.isSpeaking(),
+      isQueueEmpty: () => avatarRef.current?.isQueueEmpty(),
+      onQueueEmpty: (cb) => avatarRef.current?.onQueueEmpty(cb),
       wave: (duration) => avatarRef.current?.wave(duration),
```

### `src/components/avatar/AvatarPanel.jsx`
```diff
--- a/src/components/avatar/AvatarPanel.jsx
+++ b/src/components/avatar/AvatarPanel.jsx
@@ -132,7 +132,7 @@ export default function AvatarPanel({
       const avatarInstance = stageRef.current?.getInstance?.();
-      if (avatarInstance && (avatarInstance.hasQueuedSentences || avatarInstance.mode === "audio" || avatarInstance.mode === "tts")) {
+      if (avatarInstance && (avatarInstance.isSpeaking?.() || avatarInstance.speechQueue?.length > 0)) {
         prevSpeechIdRef.current = speechId;
         prevCaptionRef.current  = caption;
         return;
       }
```

### `src/hooks/useKiosk.js`
```diff
--- a/src/hooks/useKiosk.js
+++ b/src/hooks/useKiosk.js
@@ -234,11 +234,13 @@ export function useKiosk({ backendCatalog = [] }) {
   useEffect(() => {
     if (speaking || convState === S.SPEAKING) {
-      const maxMs = Math.max(2500, (caption?.length || 20) * 80 + 1500);
+      const maxMs = 35000;
       const timer = setTimeout(() => {
-        if (speaking || convStateRef.current === S.SPEAKING) {
+        const stage = latestRef.current._stageRef?.current;
+        const isStillPlaying = stage && typeof stage.isSpeaking === "function" ? stage.isSpeaking() : false;
+        if (!isStillPlaying && (speaking || convStateRef.current === S.SPEAKING)) {
           console.warn("[Kiosk] Avatar speaking safety watchdog: releasing speaking lock to allow listening");
           setSpeaking(false);
         }
       }, maxMs);
       return () => clearTimeout(timer);
     }
@@ -889,3 +891,3 @@ export function useKiosk({ backendCatalog = [] }) {
           const avatar = stage.getInstance?.();
-          if (avatar && avatar.hasQueuedSentences && (avatar.currentTurnId === turnId || !turnId)) {
+          if (avatar && (avatar.isSpeaking?.() || avatar.speechQueue?.length > 0)) {
             stage.finishTurn?.(turnId);
@@ -1233,6 +1235,24 @@ export function useKiosk({ backendCatalog = [] }) {
-      const sid = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
-      if (sid) {
-        pendingSpeechAckRef.current = null;
-        clearTimeout(speechAckTimerRef.current);
-        kioskWS.sendSpeechDone(sid);
-      }
+      const stage = latestRef.current._stageRef?.current;
+      const isQueueEmpty = !stage || (typeof stage.isQueueEmpty === "function" ? stage.isQueueEmpty() : true);
+      if (isQueueEmpty) {
+        const sid = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
+        if (sid) {
+          console.log(`[Kiosk] All queued sentences finished playing. Sending SPEECH_DONE for sid: ${sid}`);
+          pendingSpeechAckRef.current = null;
+          clearTimeout(speechAckTimerRef.current);
+          kioskWS.sendSpeechDone(sid);
+        }
+      } else if (stage && typeof stage.onQueueEmpty === "function") {
+        stage.onQueueEmpty(() => {
+          const sid = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
+          if (sid) {
+            console.log(`[Kiosk] All queued sentences finished playing (onQueueEmpty). Sending SPEECH_DONE for sid: ${sid}`);
+            pendingSpeechAckRef.current = null;
+            clearTimeout(speechAckTimerRef.current);
+            kioskWS.sendSpeechDone(sid);
+          }
+        });
+      }
```

---

## Step 5: Exact Commands to Test

1. **Verify Build:**
   ```powershell
   npm run build
   ```

2. **Start EdgeTTS Voice Server (Terminal 1):**
   ```powershell
   node server/index.js
   ```

3. **Launch Electron Kiosk (Terminal 2):**
   ```powershell
   npm start
   # Or for development with devtools:
   npm run dev
   ```

4. **Verify Acceptance Criteria in Console Logs:**
   - On kiosk greeting:
     1. `[VoiceServer] Enqueued sentence (queue length: 1): "Welcome to Green Fibre..."`
     2. `[VoiceServer] TTS req sent attempt=0 ts=...`
     3. `[VoiceServer] TTS playback start ts=...`
     4. `[VoiceServer] TTS playback ended (ended) ts=...`
     5. `[Kiosk] All queued sentences finished playing. Sending SPEECH_DONE for sid: ...`
   - On follow-up user query (e.g. asking about bottles):
     1. `[Renderer] SENTENCE received ts=... turn=N/A text="Great choice! Here is our Viora Water Bottle..."`
     2. `[VoiceServer] Enqueued sentence (queue length: 1)...`
     3. `[VoiceServer] TTS req sent attempt=0...`
     4. `[VoiceServer] TTS playback start...`
     5. Subsequent sentences append to queue without stalling or dropping.
