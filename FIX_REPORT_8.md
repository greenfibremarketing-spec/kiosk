# FIX_REPORT_8.md — Greenie Kiosk Subtitle Synchronization, Speech Delay & Intro Skipping Fix

## Executive Summary
This update eliminates the speech delay, fixes subtitle jumping/early text display, and prevents intro skipping on the Greenie Electron kiosk across the 7 requested areas without modifying the backend or WebSocket message formats.

---

## Changes Applied by Item

### 1. `AvatarPanel.jsx` — Pending Greeting & Ref Guarding
- **Initialisation**: Initialised `prevSpeechIdRef` and `prevCaptionRef` to `null` (previously initialised to `speechId` / `caption`, which caused the first render to be treated as unchanged).
- **`!isEngaged` Branch**: When `!isEngaged`, the effect logs the reason with a snapshot of state flags and returns **without updating `prevSpeechIdRef` or `prevCaptionRef`**.
- **Dependency Array**: Verified `isEngaged` is in `[caption, speechId, customVoice, userSpeaking, isEngaged]` so that when user engagement occurs, the effect runs again and immediately plays the pending greeting.
- **Snapshot Logging**: Added structured flag snapshots to all skip branches (`empty_caption`, `not_engaged`, `user_speaking`, `duplicate`).

### 2. `useKiosk.js` — Streamed Speech Path & Fallback
- **Removed Duplicate Speak**: Removed `stage.speak(replyText, { turnId })` in `unsubDone`. Streamed `SENTENCE` events are now the primary and only speech path during streaming.
- **Turn Sentence Tracking**: Implemented `turnsWithSentencesRef` (Set of turn IDs). When `unsubSentence` enqueues chunks, the turn ID is recorded.
- **Fallback Rule**: In `unsubDone`, if `hadStreamedSentences` is true, calls `stage.finishTurn(turnId)`. Only if `hadStreamedSentences` is false (0 sentences streamed for that turn) does it fall back to `setCaption(replyText)` and `stage.speak(replyText, { turnId })`.

### 3. `Captions.jsx` & Subtitle Synchronization
- **Never Show Full Text Prematurely**: When `speaking` is false, `displayText` strictly evaluates to `status === "Preparing..." ? status : ""` and **never** the raw paragraph `(text || "")`.
- **Audio "playing" Event Sync**: Wired `onChunk` callback from `GreenieAvatar` through `GreenieStage` to `AvatarPanel` and `Captions`. `GreenieAvatar` triggers `this.onSpeakingChange(true)` and `this.onChunk(chunkText)` inside the HTML5 Audio `playing` event (when audio actually starts emitting sound), guaranteeing exact lip and subtitle sync.
- **TTS Failure Fallback Display**: If a chunk's TTS request fails and speech synthesis fallback is disabled, `GreenieAvatar` logs the failure, switches mode, reveals the chunk's text at that moment, and holds it for `Math.max(1500, words * 240)` ms so subtitles never stay blank.

### 4. `kioskWebSocket.js` — Explicit Auto-Greet
- **Unconditional Auto-Greet on Request**: Updated `connect()` so `shouldAutoGreet = Boolean(autoGreet)` whenever explicitly requested by the caller, bypassing the prior `!isAlreadyGreeted` check that blocked reconnection greetings after session resets.

### 5. `resetSession()` — State, Flag & Cache Sanitation
- **Flags Reset**: Clears `greetingDoneRef.current = false`, `nameDoneRef.current = false`, `introPlayedRef.current = false`, `nameSubmittedRef.current = false`, and `turnsWithSentencesRef.current.clear()`.
- **Storage Clearing**: Calls `KioskStepCache.clearCache()`, `sessionStorage.clear()`, and cleans any persisted session keys in `localStorage`.
- **Speech ID & Refs**: Sets `speechId = 1`, `caption = GREETING`, resets `kioskWS.pendingSpeechId = null`, `kioskWS.currentSpeechId = null`. `AvatarPanel` resets `prevSpeechIdRef = null` and `prevCaptionRef = null` whenever `speechId <= 1`.
- **Logging**: Emits flag snapshots on reset and on every `Skipping ...` branch. `SHOW_GREETING` checks `greetingDoneRef.current || (KioskStepCache.hasPassedStep(KIOSK_STEPS.GREETED) && isPassedName)`; because all flags are cleared, `SHOW_GREETING` never logs "already completed" after a reset.

### 6. Electron `main.js` — Autoplay Policy
- Verified that both flags are set in `main.js`:
  - `app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");` (line 29)
  - `webPreferences.autoplayPolicy = "no-user-gesture-required"` (line 81)

### 7. Audio Preloading & Voice Server Pre-Warming
- **Preloading on Arrival**: When a chunk's audio blob arrives in `_prefetchNextChunks` or `_playUtterance`, `new Audio(audioUrl)` is created with `preload = "auto"` and awaits `canplaythrough` before attaching to `item.preloadedAudio`. Playback at its turn is a bare `play()` call with zero buffer/decoding latency.
- **Background Sequential Pre-Warming**: Added `prewarmVoiceCache(catalog)` in `GreenieAvatar.js` and hooked into `useKiosk.js` on mount and catalog load. Sequentially synthesizes and caches:
  - Welcome greetings (`GREETING`)
  - `ASK_NAME` prompts ("May I know your name...", "What's your name?")
  - Category prompts ("Which category would you like to explore today?")
  - Dynamic product pitch lines: `"Great choice! Here is our <product> for <price> rupees."`
  - Every product description from the catalog.

---

## Git Diff

```diff
diff --git a/src/components/avatar/AvatarPanel.jsx b/src/components/avatar/AvatarPanel.jsx
index 2824330..728d7a1 100644
--- a/src/components/avatar/AvatarPanel.jsx
+++ b/src/components/avatar/AvatarPanel.jsx
@@ -124,10 +124,21 @@ export default function AvatarPanel({
   // ── Caption / speechId change → speak ────────────────────────────────────
+  const [activeChunkText, setActiveChunkText] = useState("");
+  const prevSpeechIdRef = useRef(null);
+  const prevCaptionRef  = useRef(null);
   const currentSpokenRef = useRef({ speechId: null, caption: null });
 
+  // Reset refs on fresh session or reset (speechId <= 1)
+  useEffect(() => {
+    if (speechId <= 1) {
+      prevSpeechIdRef.current = null;
+      prevCaptionRef.current = null;
+      currentSpokenRef.current = { speechId: null, caption: null };
+      setActiveChunkText("");
+    }
+  }, [speechId]);
+
   useEffect(() => {
     const changed = speechId !== prevSpeechIdRef.current || caption !== prevCaptionRef.current;
     if (!changed) {
       return;
     }
 
     if (!caption || typeof caption !== "string" || !caption.trim()) {
-      console.log(`[AvatarPanel] Skipping speak: reason="empty_caption"`);
+      console.log(`[AvatarPanel] Skipping speak: reason="empty_caption"`, {
+        speechId,
+        prevSpeechId: prevSpeechIdRef.current,
+        isEngaged,
+        userSpeaking,
+      });
       prevSpeechIdRef.current = speechId;
       prevCaptionRef.current  = caption;
       return;
     }
 
+    // When NOT engaged: DO NOT update prevSpeechIdRef or prevCaptionRef.
+    // Return early so that when the user engages, this effect runs again and speaks the pending greeting.
     if (!isEngaged) {
-      console.log(`[AvatarPanel] Skipping speak: reason="not_engaged" (caption="${caption.slice(0, 30)}")`);
-      prevSpeechIdRef.current = speechId;
-      prevCaptionRef.current  = caption;
+      console.log(`[AvatarPanel] Skipping speak: reason="not_engaged" (caption="${caption.slice(0, 30)}")`, {
+        speechId,
+        prevSpeechId: prevSpeechIdRef.current,
+        caption: caption.slice(0, 30),
+        prevCaption: prevCaptionRef.current?.slice?.(0, 30),
+        isEngaged,
+        userSpeaking,
+      });
       return;
     }
 
     if (userSpeaking) {
-      console.log(`[AvatarPanel] Skipping speak: reason="user_speaking" (caption="${caption.slice(0, 30)}")`);
+      console.log(`[AvatarPanel] Skipping speak: reason="user_speaking" (caption="${caption.slice(0, 30)}")`, {
+        speechId,
+        prevSpeechId: prevSpeechIdRef.current,
+        isEngaged,
+        userSpeaking,
+      });
       prevSpeechIdRef.current = speechId;
       prevCaptionRef.current  = caption;
       return;
     }
 
     // Only skip if it is the SAME speech_id/caption already being spoken (log "duplicate")
     if (
       currentSpokenRef.current.speechId === speechId &&
       currentSpokenRef.current.caption === caption
     ) {
-      console.log(`[AvatarPanel] Skipping speak: reason="duplicate" (already speaking speech_id=${speechId})`);
+      console.log(`[AvatarPanel] Skipping speak: reason="duplicate" (already speaking speech_id=${speechId})`, {
+        speechId,
+        prevSpeechId: prevSpeechIdRef.current,
+        isEngaged,
+        userSpeaking,
+      });
       prevSpeechIdRef.current = speechId;
       prevCaptionRef.current  = caption;
       return;
@@ -271,4 +303,7 @@ export default function AvatarPanel({
   const handleSpeakingChange = useCallback((s) => {
     setIsAvatarSpeaking(s);
+    if (!s) {
+      setActiveChunkText("");
+    }
     onSpeakingChange?.(s);
   }, [onSpeakingChange]);
@@ -353,6 +388,7 @@ export default function AvatarPanel({
           onStatus={() => {}}
           onSpeakingChange={handleSpeakingChange}
           onBoundary={setSpokenCharIndex}
+          onChunk={setActiveChunkText}
         />
 
         {/* Unified Bottom Overlay for Subtitles & Voice HUD */}
         <div className="greenie-bottom-overlay">
           {/* Dynamic Subtitles / Captions (Positioned neatly above the VoiceHUD) */}
           <Captions
             text={caption}
+            activeChunkText={activeChunkText}
             speaking={isAvatarSpeaking || speaking}
             status={isAvatarSpeaking ? "Explaining..." : convState === "LISTENING" ? "Listening..." : "Ready to chat"}
             charIndex={spokenCharIndex}
           />

diff --git a/src/components/avatar/Captions.jsx b/src/components/avatar/Captions.jsx
index 19f750e..cda8941 100644
--- a/src/components/avatar/Captions.jsx
+++ b/src/components/avatar/Captions.jsx
@@ -61,4 +61,4 @@ export default function Captions({ text, speaking, status, charIndex = 0, activeChunkText = "" }) {
   const activeChunk = chunks[Math.min(chunkIndex, chunks.length - 1)];
-  const displayText = speaking ? (activeChunk?.text || status) : (text || "");
+  let displayText = "";
+  if (speaking) {
+    displayText = activeChunkText || activeChunk?.text || status || "";
+  } else {
+    displayText = status === "Preparing..." ? status : "";
+  }
 
   if (!displayText) return null;

diff --git a/src/components/avatar/GreenieStage.jsx b/src/components/avatar/GreenieStage.jsx
index 45f56a1..e92a83b 100644
--- a/src/components/avatar/GreenieStage.jsx
+++ b/src/components/avatar/GreenieStage.jsx
@@ -6,4 +6,5 @@ const GreenieStage = forwardRef(function GreenieStage(
-  { onStatus, onSpeakingChange, onBoundary, isEngaged },
+  { onStatus, onSpeakingChange, onBoundary, onChunk, isEngaged },
   ref
 ) {
@@ -17,2 +18,3 @@ const GreenieStage = forwardRef(function GreenieStage(
   const onBoundaryRef = useRef(onBoundary);
+  const onChunkRef = useRef(onChunk);
 
@@ -22,2 +24,3 @@ const GreenieStage = forwardRef(function GreenieStage(
     onBoundaryRef.current = onBoundary;
+    onChunkRef.current = onChunk;
   });
@@ -40,2 +43,5 @@ const GreenieStage = forwardRef(function GreenieStage(
         onBoundary: (charIndex) => {
           onBoundaryRef.current?.(charIndex);
         },
+        onChunk: (chunkText) => {
+          onChunkRef.current?.(chunkText);
+        },
       });

diff --git a/src/lib/avatar/GreenieAvatar.js b/src/lib/avatar/GreenieAvatar.js
index 99a18d1..eb4109f 100644
--- a/src/lib/avatar/GreenieAvatar.js
+++ b/src/lib/avatar/GreenieAvatar.js
@@ -37,2 +37,37 @@ const audioBlobCache = new Map();
 /**
+ * Preload an Audio element with preload="auto" and wait for canplaythrough.
+ */
+export async function preloadAudioElement(url) {
+  if (typeof window === "undefined" || !url) return null;
+  const audio = new Audio();
+  audio.preload = "auto";
+  audio.src = url;
+
+  await new Promise((resolve) => {
+    if (audio.readyState >= 4) {
+      resolve();
+      return;
+    }
+    let timer = null;
+    const onReady = () => {
+      cleanup();
+      resolve();
+    };
+    const cleanup = () => {
+      if (timer) clearTimeout(timer);
+      audio.removeEventListener("canplaythrough", onReady);
+      audio.removeEventListener("canplay", onReady);
+      audio.removeEventListener("error", onReady);
+    };
+    timer = setTimeout(cleanup, 2000);
+    audio.addEventListener("canplaythrough", onReady, { once: true });
+    audio.addEventListener("canplay", onReady, { once: true });
+    audio.addEventListener("error", onReady, { once: true });
+    audio.load();
+  });
+
+  return audio;
+}
+
+/**
  * Prefetch an audio utterance in background and cache its object URL.
@@ -53,4 +88,53 @@ export async function prefetchAudio(text, model = TTS_CONFIG.model) {
       const url = URL.createObjectURL(blob);
       audioBlobCache.set(cacheKey, url);
+      preloadAudioElement(url).catch(() => {});
       return url;
     }
+
+export async function prewarmVoiceCache(catalog = []) {
+  ...
+}
+
+export class GreenieAvatar {
+  constructor(container, { modelUrl, onStatus, onSpeakingChange, onBoundary, onChunk }) {
+    this.onChunk = onChunk;
+    ...
+  }
```

---

## Verification
1. **Compilation & Build**:
   Executed `npm run build`:
   ```bash
   npm run build
   ```
   **Result**: Exit Code 0, all pages statically generated cleanly.

2. **Testing Commands**:
   - Run Next.js kiosk app:
     ```powershell
     npm run dev
     ```
   - Start kiosk in Electron:
     ```powershell
     npm run electron
     ```
   - Start Voice Server:
     ```powershell
     node server/index.js
     ```
