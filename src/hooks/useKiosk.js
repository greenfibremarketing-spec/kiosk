"use client";
/**
 * useKiosk.js  (v2 – Production-Hardened Real-Time Kiosk Engine)
 * ─────────────────────────────────────────────────────────────────────────────
 * States: IDLE → ATTENTIVE → LISTENING → THINKING → SPEAKING → LISTENING …
 *
 * Key guarantees:
 *   • Fused human evidence tracker: presence, attention, voice, input.
 *     No inactivity warning/countdown while any evidence exists.
 *     15s absent → 10s wall-clock countdown → reset to Step 1.
 *   • Monotonic onboarding: NAME (1) → CATEGORIES (2) → BROWSING (3).
 *     Synchronous optimistic categories opening; server ASK_NAME / SHOW_GREETING
 *     ignored once NAME_SET is passed.
 *   • Single source of truth for TTS: Deepgram Aura (aura-2-luna-en).
 *   • Latest ref pattern on all callbacks to avoid stale closures.
 *   • Deepgram primary STT with WebSpeech gated only on Deepgram failure (>3s).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  GREETING,
  describeProduct,
  productsIn,
  replyAsync,
  sendSpeechDone,
  sendFlowAction,
  resetBackendSession,
  normalizeCategory,
  findMatchingLocalProduct,
  matchProductAction,
  fetchBackendProducts,
  normalizeBackendProduct,
} from "@/lib/agent";
import { kioskWS } from "@/lib/kioskWebSocket";
import KioskStepCache, { KIOSK_STEPS } from "@/lib/kioskStepCache";
import { usePresenceDetection } from "@/lib/presence/usePresenceDetection";
import { usePresence } from "@/hooks/usePresence";
import {
  PRESENCE_CONFIG,
  ABSENT_SHORT_MS,
  ABSENT_LONG_MS,
  CONFIRMATION_TIMEOUT_MS,
  RESET_DEBOUNCE_MS,
} from "@/lib/presenceConfig";
import { useUserSignals } from "@/hooks/useUserSignals";
import { useMic } from "@/hooks/useMic";
import { useUserSpeechState } from "@/hooks/useUserSpeechState";
import { useSpeech } from "@/hooks/useSpeech";
import speechConfig from "@/lib/speechConfig";
import { prefetchAudio, prewarmVoiceCache } from "@/lib/avatar/GreenieAvatar";
import { speechController, warmupSpeech } from "@/lib/avatar/SpeechController";

// Conversation states
const S = {
  IDLE:       "IDLE",
  ATTENTIVE:  "ATTENTIVE",
  LISTENING:  "LISTENING",
  THINKING:   "THINKING",
  SPEAKING:   "SPEAKING",
};

export function useKiosk() {
  // ── Core product/UI state ──────────────────────────────────────────────────
  const [name, setName]           = useState(() => KioskStepCache.getCustomerName());
  const [category, setCategory]   = useState("all");
  const [productId, setProductId] = useState(null);
  const [caption, setCaption]     = useState("");
  const [speechId, setSpeechId]   = useState(1);
  const sessionIdRef = useRef(KioskStepCache.getOrCreateSessionId());
  const pendingSpeechAckRef = useRef(null);
  const speechAckTimerRef = useRef(null);
  const activeActionReplyIdRef = useRef(null);
  const [backendAction, setBackendAction] = useState(null);
  const [backendCatalog, setBackendCatalog] = useState([]);
  const [liveTurnProducts, setLiveTurnProducts] = useState([]);
  const [showDetail, setShowDetail]       = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [actionButtons, setActionButtons] = useState([]);
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [cartModalData, setCartModalData] = useState(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrModalData, setQrModalData] = useState(null);
  const [goodbyeOpen, setGoodbyeOpen] = useState(false);
  const [goodbyeData, setGoodbyeData] = useState(null);
  const [staffBanner, setStaffBanner] = useState(null);
  const [hintBubble, setHintBubble] = useState(null);

  // Guards & references
  const greetingDoneRef = useRef(false);
  const nameDoneRef = useRef(false);
  const introPlayedRef = useRef(false);
  const turnsWithSentencesRef = useRef(new Set());
  const nameSubmittedRef = useRef(false);
  const categoriesFallbackTimerRef = useRef(null);
  const catalogRetryCountRef = useRef(0);
  const lastAppliedTurnIdRef = useRef(null);
  const lastAppliedSeqRef = useRef(0);
  const lastHandledActionRef = useRef({ key: null, t: 0 });
  const isSendingRef = useRef(false);
  const nameRef = useRef(name);
  nameRef.current = name;

  // Preload catalog with retry backoff & pre-warm voice server cache
  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const data = await fetchBackendProducts();
          if (!active) return;
          if (data?.products && Array.isArray(data.products) && data.products.length > 0) {
            const mapped = data.products.map(normalizeBackendProduct).filter(Boolean);
            setBackendCatalog(mapped);
            if (mapped[0]?.id) {
              setProductId((curr) => curr || mapped[0].id);
            }
            prewarmVoiceCache(mapped);
            return;
          }
        } catch (_) {}
        if (!active) return;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
    loadCatalog();
    return () => { active = false; };
  }, []);

  // Pre-warm static voice cache and warm up speech engine on mount
  useEffect(() => {
    warmupSpeech();
    prewarmVoiceCache();
  }, []);

  // Wire speechController SPEECH_DONE callback
  useEffect(() => {
    speechController.onSpeechDone = (speechId) => {
      console.log(`[Kiosk] SPEECH_DONE emitted by speechController for speech_id: ${speechId}`);
      pendingSpeechAckRef.current = null;
      clearTimeout(speechAckTimerRef.current);
      kioskWS.sendSpeechDone(speechId);
    };
  }, []);

  // ── Conversation state machine ────────────────────────────────────────────
  const [convState, setConvState] = useState(S.IDLE);
  const convStateRef = useRef(S.IDLE);
  const setConv = useCallback((s) => {
    convStateRef.current = s;
    setConvState(s);
  }, []);

  // ── Transcript accumulation ────────────────────────────────────────────────
  const [liveTranscript, setLiveTranscript]   = useState("");
  const [lastUserSpeech, setLastUserSpeech]   = useState("");
  const [listening, setListening]             = useState(false);
  const [speaking, setSpeaking]               = useState(false); // avatar speaking
  const pendingTranscriptRef = useRef("");       // words heard in this turn
  const eotTimerRef          = useRef(null);     // end-of-turn countdown
  const failureCountRef      = useRef(0);
  const [showPTT, setShowPTT] = useState(false); // push-to-talk buttons

  // ── Fused Human Evidence Tracker ──────────────────────────────────────────
  const lastFaceAtRef      = useRef(Date.now());
  const lastAttentionAtRef = useRef(Date.now());
  const lastVoiceAtRef     = useRef(Date.now());
  const lastInputAtRef     = useRef(Date.now());
  const warningDeadlineRef = useRef(null);

  const [sessionTimeoutWarning, setSessionTimeoutWarning] = useState({
    active: false,
    secondsRemaining: 10,
  });
  const sessionTimeoutWarningRef = useRef(sessionTimeoutWarning);
  sessionTimeoutWarningRef.current = sessionTimeoutWarning;

  // ── Abort controller for SSE/AI fetch ────────────────────────────────────
  const abortRef = useRef(null);

  // ── Latest Ref Pattern for zero stale closures across async handlers ───────
  const latestRef = useRef({});

  // ── Short Gap Identity Verification State ──
  const [identityPrompt, setIdentityPrompt] = useState({
    active: false,
    name: "",
    promptCount: 1,
    secondsRemaining: 8,
  });
  const identityPromptRef = useRef(identityPrompt);
  identityPromptRef.current = identityPrompt;
  const identityTimerRef = useRef(null);
  const identityIntervalRef = useRef(null);

  // ── Presence State Machine (usePresence fed by FaceLandmarker) ────────────
  const presenceTracker = usePresence({
    getName: useCallback(() => nameRef.current || KioskStepCache.getCustomerName(), []),
    onShortGapReturn: useCallback(({ elapsed, name: returningName }) => {
      console.log(`[Presence] Short gap return (${elapsed}ms) with name="${returningName}". Initiating verification prompt.`);
      if (!speechController.isSpeaking()) {
        const stage = stageRef.current || latestRef.current._stageRef?.current;
        stage?.speak?.(`Welcome back! Are you still ${returningName}?`);
        setCaption(`Welcome back! Are you still ${returningName}?`);
      }

      clearTimeout(identityTimerRef.current);
      clearInterval(identityIntervalRef.current);

      let secLeft = 8;
      setIdentityPrompt({
        active: true,
        name: returningName,
        promptCount: 1,
        secondsRemaining: 8,
      });

      identityIntervalRef.current = setInterval(() => {
        secLeft -= 1;
        setIdentityPrompt((prev) => ({
          ...prev,
          secondsRemaining: Math.max(0, secLeft),
        }));
      }, 1000);

      identityTimerRef.current = setTimeout(() => {
        // Attempt 1 expired after 8s: ask again once
        clearInterval(identityIntervalRef.current);
        console.log(`[Presence] Verification prompt 1 unanswered after 8s. Repeating prompt once.`);
        if (!speechController.isSpeaking()) {
          const st = stageRef.current || latestRef.current._stageRef?.current;
          st?.speak?.(`Are you still ${returningName}?`);
          setCaption(`Are you still ${returningName}?`);
        }

        secLeft = 8;
        setIdentityPrompt({
          active: true,
          name: returningName,
          promptCount: 2,
          secondsRemaining: 8,
        });

        identityIntervalRef.current = setInterval(() => {
          secLeft -= 1;
          setIdentityPrompt((prev) => ({
            ...prev,
            secondsRemaining: Math.max(0, secLeft),
          }));
        }, 1000);

        identityTimerRef.current = setTimeout(() => {
          // Attempt 2 expired after another 8s: reset session
          clearInterval(identityIntervalRef.current);
          console.log(`[Presence] Verification prompt 2 unanswered after 8s. Resetting session.`);
          setIdentityPrompt({ active: false, name: "", promptCount: 1, secondsRemaining: 8 });
          latestRef.current.resetSession?.("timeout_unanswered");
        }, 8000);
      }, 8000);
    }, []),
    onLongGapAbsent: useCallback(({ elapsed }) => {
      console.log(`[Presence] Long gap absence (${elapsed}ms >= 10s). Resetting session.`);
      clearTimeout(identityTimerRef.current);
      clearInterval(identityIntervalRef.current);
      setIdentityPrompt({ active: false, name: "", promptCount: 1, secondsRemaining: 8 });
      latestRef.current.resetSession?.("absent_long");
    }, []),
  });

  // ── Camera & Hardware Presence Hook ───────────────────────────────────────
  const cameraPresence = usePresenceDetection({
    onEnterEngaged: useCallback(() => {
      lastFaceAtRef.current = Date.now();
      if (convStateRef.current === S.IDLE) {
        setConv(S.ATTENTIVE);
      }
    }, [setConv]),
    onExitToIdle: useCallback(() => {
      if (convStateRef.current === S.ATTENTIVE) {
        setConv(S.IDLE);
      }
    }, [setConv]),
  });

  // Unified presence object: full backward-compatible props + presenceTracker state
  const presence = {
    ...cameraPresence,
    ...presenceTracker,
    state:
      presenceTracker.presenceState === "present" ||
      presenceTracker.presenceState === "confirming" ||
      cameraPresence.state === "ENGAGED"
        ? "ENGAGED"
        : "IDLE",
  };

  const isEngaged = presence.state === "ENGAGED" || onboardingOpen;

  // Sync engagement presence state with Electron main process
  useEffect(() => {
    if (typeof window !== "undefined" && window.kiosk?.sendPresenceState) {
      window.kiosk.sendPresenceState(isEngaged ? "ENGAGED" : "IDLE");
    }
  }, [isEngaged]);

  // ── Face signals (jaw-open VAD in useUserSignals) fed continuously ─────────
  const signals = useUserSignals({
    videoRef: cameraPresence.videoRef,
    isEngaged,
    onSpeechStart: useCallback(() => {}, []),
    onSpeechEnd:   useCallback(() => {}, []),
    onFaceResult:  presenceTracker.handleFaceLandmarks,
  });

  // Build the face object expected by useUserSpeechState (reads facePx from ref to avoid re-renders)
  const face = {
    present:        signals.present,
    jawOpen:        signals.jawOpen,
    lookingAtScreen: signals.attention === "screen",
    faceSizeRatio:  (presence.debugStatsRef?.current?.facePx ?? presence.debugStats?.facePx ?? 0) / 640,
  };

  // ── Mic + single AudioWorklet PCM stream ──────────────────────────────────
  const mic = useMic({ isEngaged });
  const { vadSpeech, audioLevel, micError } = mic;

  // ── Avatar speech / active status ─────────────────────────────────────────
  const isAvatarActive = speaking || convState === S.SPEAKING || convState === S.THINKING;
  const isAvatarActiveRef = useRef(isAvatarActive);
  isAvatarActiveRef.current = isAvatarActive;

  // ── Fused speech state (gated by isAvatarActive to prevent avatar self-hearing) ──
  const { userSpeaking, evidence, speakingForMs, silentForMs } =
    useUserSpeechState({ vadSpeech, audioLevel, face, isSpeaking: isAvatarActive });

  const userSpeakingRef = useRef(userSpeaking);
  userSpeakingRef.current = userSpeaking;

  // ── Audio Gating & Cooldown to prevent avatar hearing itself ──────────────
  const COOLDOWN_MS = 700;
  const ECHO_WINDOW_MS = 3500;
  const BARGE_MIN_LEVEL = 0.02;

  const bargeUntilRef = useRef(0);
  const avatarEndedAtRef = useRef(0);
  const avatarActiveNowRef = useRef(false);

  useEffect(() => {
    avatarActiveNowRef.current = isAvatarActive;
    if (isAvatarActive) {
      bargeUntilRef.current = 0;
    } else {
      avatarEndedAtRef.current = Date.now();
    }
  }, [isAvatarActive]);

  // Watchdog: Ensure speaking state automatically unblocks as a true last resort
  useEffect(() => {
    if (speaking || convState === S.SPEAKING) {
      const maxMs = 35000; // Generous last resort watchdog (35s)
      const timer = setTimeout(() => {
        const stage = latestRef.current._stageRef?.current;
        const isStillPlaying = stage && typeof stage.isSpeaking === "function" ? stage.isSpeaking() : false;
        if (!isStillPlaying && (speaking || convStateRef.current === S.SPEAKING)) {
          console.warn("[Kiosk] Avatar speaking safety watchdog: releasing speaking lock to allow listening");
          setSpeaking(false);
          if (convStateRef.current === S.SPEAKING) {
            setConv(S.ATTENTIVE);
          }
        }
      }, maxMs);
      return () => clearTimeout(timer);
    }
  }, [speaking, convState, setConv]);


  // Read by useSpeech on every audio chunk
  const getGate = useCallback(() => {
    const now = Date.now();
    const inCooldown = now - avatarEndedAtRef.current < COOLDOWN_MS;
    return {
      blocked: avatarActiveNowRef.current || inCooldown,
      bargeIn: now < bargeUntilRef.current,
    };
  }, []);

  // Avatar echo filter
  const lastAvatarTextRef = useRef("");
  useEffect(() => {
    if (caption) lastAvatarTextRef.current = caption;
  }, [caption]);

  const isEchoOfAvatar = useCallback((text) => {
    const sinceEnd = Date.now() - avatarEndedAtRef.current;
    const recent = avatarActiveNowRef.current || sinceEnd < ECHO_WINDOW_MS;
    const cap = lastAvatarTextRef.current;
    if (!recent || !cap || !text) return false;

    const cleanCap = cap.toLowerCase().trim();
    const cleanText = text.toLowerCase().trim();
    if (cleanText.length >= 6 && (cleanCap.includes(cleanText) || cleanText.includes(cleanCap))) {
      return true;
    }

    const norm = (s) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const capWords = new Set(norm(cap));
    const words = norm(text);
    if (!words.length) return false;
    return words.filter((w) => capWords.has(w)).length / words.length >= 0.35;
  }, []);

  // ── Global Document Input Capture Listeners (Touch / Click / Typing counts) ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHumanInput = () => {
      lastInputAtRef.current = Date.now();
    };
    const inputEvents = [
      "pointerdown",
      "touchstart",
      "mousedown",
      "keydown",
      "input",
      "wheel",
      "scroll",
    ];
    inputEvents.forEach((ev) =>
      window.addEventListener(ev, handleHumanInput, { capture: true, passive: true })
    );
    return () => {
      inputEvents.forEach((ev) =>
        window.removeEventListener(ev, handleHumanInput, { capture: true })
      );
    };
  }, []);

  // ── Update Evidence Timestamps each render/event ──────────────────────────
  if (
    (presence.lastFaceAtRef && presence.lastFaceAtRef.current > lastFaceAtRef.current) ||
    signals.present
  ) {
    lastFaceAtRef.current = Date.now();
  }
  if (signals.attention === "screen") {
    lastAttentionAtRef.current = Date.now();
  }
  const isHumanVoice =
    userSpeaking || (vadSpeech && audioLevel > BARGE_MIN_LEVEL && !getGate().blocked);
  if (isHumanVoice) {
    lastVoiceAtRef.current = Date.now();
  }

  // ── Avatar control helpers ────────────────────────────────────────────────
  const stageRef = useRef(null);
  const setStageRef = useCallback((ref) => {
    stageRef.current = ref;
    // Keep latestRef._stageRef in sync so the done/sentence handlers can speak directly
    latestRef.current._stageRef = stageRef;
  }, []);

  // ── User did something: cut Greenie off immediately ──
  const stopSpeechForUserAction = useCallback((reason = "user_action") => {
    lastHandledActionRef.current = { key: null, t: 0 };
    speechController.cancelAll(reason);
    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.stop?.(reason);
    abortRef.current?.abort();
    activeActionReplyIdRef.current = null;
    turnsWithSentencesRef.current.clear();

    // Backend may be waiting for SPEECH_DONE of the line we just cut: release it
    const pendingId = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
    pendingSpeechAckRef.current = null;
    clearTimeout(speechAckTimerRef.current);
    if (pendingId) kioskWS.flushSpeechDone(pendingId);

    setSpeaking(false);
    if (convStateRef.current === S.SPEAKING) setConv(S.ATTENTIVE);
  }, [setConv]);

  // ── Say something ────────────────────────────────────────────────────────
  const say = useCallback((text) => {
    if (!text || typeof text !== "string" || !text.trim()) return;
    const clean = text.trim();
    setCaption(clean);
    setSpeechId((p) => p + 1);
    const replyId = `say_${Date.now()}`;
    speechController.beginReply(replyId, { source: "say" });
    speechController.appendSentence(replyId, clean, { turnId: replyId });
    speechController.endReply(replyId);
  }, []);

  const lastResetAtRef = useRef(0);

  // ── Reset session to Step 1 (presence-based or manual) ───────────────────
  const resetSession = useCallback((reason = "unknown") => {
    const now = Date.now();
    if (now - lastResetAtRef.current < RESET_DEBOUNCE_MS) {
      console.log(`[Session] reset debounced (<${RESET_DEBOUNCE_MS}ms since last reset, reason=${reason})`);
      return;
    }
    lastResetAtRef.current = now;

    const oldSession = sessionIdRef.current;
    const newSession = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);

    // Pre-reset flags snapshot log (JSON.stringify)
    const preSnapshot = {
      greetingDone: greetingDoneRef.current,
      nameDone: nameDoneRef.current,
      introPlayed: introPlayedRef.current,
      nameSubmitted: nameSubmittedRef.current,
      pendingSpeechAck: pendingSpeechAckRef.current,
      cacheStep: KioskStepCache.getCurrentStep(),
      onboardingStep: latestRef.current.onboardingStep,
    };
    console.log(`[Session] reset reason=${reason} oldSession=${oldSession} newSession=${newSession} snapshot=${JSON.stringify(preSnapshot)}`);

    // Clear verification prompt & intervals
    clearTimeout(identityTimerRef.current);
    clearInterval(identityIntervalRef.current);
    setIdentityPrompt({ active: false, name: "", promptCount: 1, secondsRemaining: 8 });

    warningDeadlineRef.current = null;
    setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
    lastFaceAtRef.current = now;
    lastAttentionAtRef.current = now;
    lastVoiceAtRef.current = now;
    lastInputAtRef.current = now;

    // Reset flags & tracking BEFORE speech or new WS connection
    greetingDoneRef.current = false;
    nameDoneRef.current = false;
    introPlayedRef.current = false;
    nameSubmittedRef.current = false;
    turnsWithSentencesRef.current.clear();
    clearTimeout(categoriesFallbackTimerRef.current);

    // Stop speech and clear audio queue immediately via single speechController
    speechController.cancelAll("session_reset");
    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.stop?.("session_reset");
    abortRef.current?.abort();
    abortRef.current = null;
    if (typeof window !== "undefined") {
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    }
    setSpeaking(false);
    convStateRef.current = S.IDLE;
    setConv(S.IDLE);

    // Drop pending speech acknowledgments & timers
    pendingSpeechAckRef.current = null;
    clearTimeout(speechAckTimerRef.current);
    if (kioskWS.speechDoneTimer) {
      clearTimeout(kioskWS.speechDoneTimer);
      kioskWS.speechDoneTimer = null;
    }
    kioskWS.pendingSpeechId = null;
    kioskWS.currentSpeechId = null;

    // Remove ONLY this app's storage keys (no sessionStorage.clear()/localStorage.clear())
    KioskStepCache.clearCache();
    if (typeof window !== "undefined") {
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && (k.startsWith("greenie_") || k.startsWith("kiosk_") || k.includes("session"))) {
            sessionStorage.removeItem(k);
          }
        }
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith("greenie_") || k.startsWith("kiosk_") || k.includes("session"))) {
            localStorage.removeItem(k);
          }
        }
      } catch (_) {}
    }
    presenceTracker.forceResetPresence();

    setName("");
    nameRef.current = "";
    setCategory("all");
    setProductId(backendCatalog[0]?.id || null);
    setCaption("");

    // Warm up the AudioContext and Deepgram connection after each reset
    warmupSpeech();

    // Connect new WebSocket session with auto_greet=1
    KioskStepCache.setSessionId(newSession);
    sessionIdRef.current = newSession;
    kioskWS.connect(newSession, true);
    resetBackendSession(oldSession);

    setBackendAction(null);
    setActionButtons([]);
    setCartModalOpen(false);
    setCartModalData(null);
    setQrModalOpen(false);
    setQrModalData(null);
    setGoodbyeOpen(false);
    setGoodbyeData(null);
    setStaffBanner(null);
    setHintBubble(null);
    setShowDetail(false);
    setOnboardingOpen(false);
    setOnboardingStep(1);
    latestRef.current.onboardingStep = 1;
    setSpeechId(1);
    pendingTranscriptRef.current = "";
    setLastUserSpeech("");
    setLiveTranscript("");
    failureCountRef.current = 0;
    setShowPTT(false);

    // Post-reset flags snapshot log (JSON.stringify)
    const postSnapshot = {
      greetingDone: greetingDoneRef.current,
      nameDone: nameDoneRef.current,
      introPlayed: introPlayedRef.current,
      nameSubmitted: nameSubmittedRef.current,
      cacheStep: KioskStepCache.getCurrentStep(),
      onboardingStep: 1,
      speechId: 1,
      caption: "",
      appStorageCleared: true,
    };
    console.log(`[Session] reset completed. Post-reset flags snapshot: ${JSON.stringify(postSnapshot)}`);
  }, [backendCatalog, setConv, presenceTracker]);

  const reset = useCallback((reason) => {
    resetSession(reason || "manual_reset");
  }, [resetSession]);

  // ── Affirmative identity confirmation (same person returned) ─────────────
  const confirmIdentity = useCallback(() => {
    clearTimeout(identityTimerRef.current);
    clearInterval(identityIntervalRef.current);
    setIdentityPrompt({ active: false, name: "", promptCount: 1, secondsRemaining: 8 });
    presenceTracker.confirmSamePerson();

    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.clearQueue?.("identity_confirmed");
    const currentName = nameRef.current;
    const msg = `Great to have you back${currentName ? `, ${currentName}` : ""}! What can I help you with?`;
    stage?.speak?.(msg);
    setCaption(msg);
  }, [presenceTracker]);

  // ── Multiple Faces speech sanitizer ──────────────────────────────────────
  const sanitizeForMultipleFaces = useCallback((text) => {
    if (!text || !presenceTracker.multipleFaces) return text;
    const currentName = nameRef.current || KioskStepCache.getCustomerName();
    if (!currentName) return text;
    const escaped = currentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text
      .replace(new RegExp(`\\b(?:Hey|Hi|Hello)\\s+${escaped}[,!.]?`, "gi"), "Hello there,")
      .replace(new RegExp(`\\b${escaped}\\b`, "gi"), "you");
  }, [presenceTracker.multipleFaces]);


  // Connect WebSocket on mount for current session with auto_greet
  useEffect(() => {
    kioskWS.connect(sessionIdRef.current, true);
  }, []);

  // ── Single Fused Human Evidence & Inactivity Interval (250 ms) ────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const lastEvidence = Math.max(
        lastFaceAtRef.current,
        lastAttentionAtRef.current,
        lastVoiceAtRef.current,
        lastInputAtRef.current
      );

      const hasCameraError = Boolean(presence.cameraError);
      const noEvidenceThreshold = hasCameraError ? 45000 : 15000;
      const elapsed = now - lastEvidence;

      if (elapsed < noEvidenceThreshold) {
        // Any human evidence immediately cancels active warning/countdown
        if (warningDeadlineRef.current !== null || sessionTimeoutWarningRef.current.active) {
          warningDeadlineRef.current = null;
          setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
        }
        return;
      }

      // No human evidence for threshold: run 10s wall-clock countdown
      if (warningDeadlineRef.current === null) {
        warningDeadlineRef.current = now + 10000;
        setSessionTimeoutWarning({ active: true, secondsRemaining: 10 });
      } else {
        const remainingSec = Math.max(0, Math.ceil((warningDeadlineRef.current - now) / 1000));
        if (remainingSec <= 0) {
          console.log("[Kiosk] Human evidence absent for timeout. Resetting session to Step 1.");
          warningDeadlineRef.current = null;
          setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
          latestRef.current.reset?.();
        } else {
          setSessionTimeoutWarning((prev) =>
            prev.secondsRemaining === remainingSec
              ? prev
              : { active: true, secondsRemaining: remainingSec }
          );
        }
      }
    }, 250);

    return () => clearInterval(interval);
  }, [presence.cameraError]);

  const continueSession = useCallback(() => {
    lastInputAtRef.current = Date.now();
    warningDeadlineRef.current = null;
    setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
    presence.triggerTouchEngaged();
  }, [presence]);

  const exitSession = useCallback(() => {
    warningDeadlineRef.current = null;
    setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
    latestRef.current.reset?.();
  }, []);

  // ── Interrupt avatar speech (User Barge-in) ────────────────────────────────
  const interruptAvatar = useCallback(async () => {
    speechController.cancelAll("user_barge_in");
    activeActionReplyIdRef.current = null;
    const pendingId = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
    if (pendingId) kioskWS.flushSpeechDone(pendingId);

    abortRef.current?.abort();
    if (typeof window !== "undefined") {
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    }
    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.stop?.("user_barge_in");
    setSpeaking(false);
    setConv(S.LISTENING);

    pendingSpeechAckRef.current = null;
    clearTimeout(speechAckTimerRef.current);
  }, [setConv]);

  // ── Monotonic Onboarding Navigation: submitName & skipName ─────────────────
  const submitName = useCallback((n) => {
    stopSpeechForUserAction("user_submit_name");
    lastInputAtRef.current = Date.now();
    const trimmed = String(n || "").trim();
    if (!trimmed) return;

    nameSubmittedRef.current = true;
    KioskStepCache.setCurrentStep(KIOSK_STEPS.NAME_SET);
    KioskStepCache.setCustomerName(trimmed);
    setName(trimmed);

    // Optimistically open Categories screen immediately; never wait for server
    setOnboardingStep(2);
    setOnboardingOpen(true);

    kioskWS.sendSetName(trimmed);

    // 1.5s fallback timer: ensure categories are rendered even if server SHOW_CATEGORIES is delayed
    clearTimeout(categoriesFallbackTimerRef.current);
    categoriesFallbackTimerRef.current = setTimeout(() => {
      if (latestRef.current.onboardingStep <= 2 && latestRef.current.onboardingOpen) {
        console.log("[Kiosk] 1.5s categories fallback timer: displaying categories");
        setOnboardingStep(2);
        setOnboardingOpen(true);
      }
    }, 1500);
  }, [stopSpeechForUserAction]);

  const skipName = useCallback(() => {
    stopSpeechForUserAction("user_skip_name");
    lastInputAtRef.current = Date.now();
    nameSubmittedRef.current = true;
    KioskStepCache.setCurrentStep(KIOSK_STEPS.NAME_SET);

    // Optimistically open Categories screen immediately
    setOnboardingStep(2);
    setOnboardingOpen(true);

    kioskWS.sendSkipName();

    clearTimeout(categoriesFallbackTimerRef.current);
    categoriesFallbackTimerRef.current = setTimeout(() => {
      if (latestRef.current.onboardingStep <= 2 && latestRef.current.onboardingOpen) {
        console.log("[Kiosk] 1.5s categories fallback timer: displaying categories");
        setOnboardingStep(2);
        setOnboardingOpen(true);
      }
    }, 1500);
  }, [stopSpeechForUserAction]);

  // ── AI Screen Director: Handle structured server actions ────────────────
  const handleServerAction = useCallback((action, salesStage) => {
    if (!action && !salesStage) return;

    // Stale action protection: drop actions from different session or out-of-order sequence
    if (action?.session_id && action.session_id !== sessionIdRef.current) {
      console.log("[Kiosk] Dropping action from different session:", action.session_id);
      return;
    }
    if (action?.seq && lastAppliedSeqRef.current && action.seq < lastAppliedSeqRef.current) {
      console.log("[Kiosk] Dropping out-of-order action seq:", action.seq);
      return;
    }
    if (action?.seq) {
      lastAppliedSeqRef.current = action.seq;
    }

    const actionType =
      action?.action ||
      action?.type ||
      (salesStage === "ASK_NAME"
        ? "ASK_NAME"
        : salesStage === "ASK_CATEGORY" || salesStage === "SELECT_CATEGORY"
        ? "SHOW_CATEGORIES"
        : null);

    // Backend re-sends the same action inside the "done" frame: ignore the repeat
    const spokenText = action?.message || action?.prompt || action?.text || action?.blurb || "";
    if (spokenText) {
      const key = `${actionType}|${spokenText}`;
      const nowTs = Date.now();
      if (lastHandledActionRef.current.key === key && nowTs - lastHandledActionRef.current.t < 5000) {
        console.log(`[Kiosk] Ignoring repeated action ${actionType} (already handled)`);
        return;
      }
      lastHandledActionRef.current = { key, t: nowTs };
    }

    if (action && typeof action === "object") {
      setBackendAction(action);
    }

    const actionTurnId = action?.turn_id || kioskWS.currentTurnId || `action_${Date.now()}`;
    activeActionReplyIdRef.current = actionTurnId;

    if (action?.speech_id && action?.awaiting_speech_done) {
      speechController.beginReply(actionTurnId, { source: "action", speechId: action.speech_id });
      pendingSpeechAckRef.current = action.speech_id;
      clearTimeout(speechAckTimerRef.current);
      // Safety watchdog: 15s last resort
      speechAckTimerRef.current = setTimeout(() => {
        if (pendingSpeechAckRef.current === action.speech_id) {
          console.log("[Kiosk] Safety watchdog fallback for speech_id:", action.speech_id);
          const sid = action.speech_id;
          pendingSpeechAckRef.current = null;
          kioskWS.sendSpeechDone(sid);
        }
      }, 15000);
    }

    const isPassedName =
      KioskStepCache.hasPassedStep(KIOSK_STEPS.NAME_SET) ||
      latestRef.current.onboardingStep >= 2 ||
      nameSubmittedRef.current;

    switch (actionType) {
      case "SHOW_GREETING": {
        // Welcome Screen: Avatar speaks greeting, await SPEECH_DONE
        const snapshot = {
          greetingDone: greetingDoneRef.current,
          nameDone: nameDoneRef.current,
          introPlayed: introPlayedRef.current,
          isPassedName,
          cacheStep: KioskStepCache.getCurrentStep(),
          onboardingStep: latestRef.current.onboardingStep,
        };
        // SHOW_GREETING must never be skipped right after reset. If a skip is ever legitimate, do NOT send SPEECH_DONE from the skip branch.
        if (greetingDoneRef.current && (KioskStepCache.hasPassedStep(KIOSK_STEPS.GREETED) && isPassedName)) {
          console.log("[Kiosk] Skipping SHOW_GREETING: greeting or name already completed.", JSON.stringify(snapshot));
          break;
        }
        greetingDoneRef.current = true;
        introPlayedRef.current = true;
        latestRef.current.presence?.triggerTouchEngaged?.();
        setOnboardingOpen(false);
        setShowDetail(false);
        setCartModalOpen(false);
        setQrModalOpen(false);
        setGoodbyeOpen(false);
        const speechId = action?.speech_id || 1;
        kioskWS.currentSpeechId = speechId;
        const greetingText = action?.message || action?.prompt || action?.text || "Hi! I'm Greeny. Welcome to Green Fibre.";
        setCaption(greetingText);

        const replyId = `greeting_${Date.now()}`;
        speechController.beginReply(replyId, { source: "SHOW_GREETING", speechId });
        speechController.appendSentence(replyId, greetingText, { speechId, turnId: replyId });
        speechController.endReply(replyId);
        break;
      }

      case "ASK_NAME": {
        // Name Input Modal / Tab
        const snapshot = {
          isPassedName,
          nameDone: nameDoneRef.current,
          cacheStep: KioskStepCache.getCurrentStep(),
          cachedName: KioskStepCache.getCustomerName(),
          onboardingStep: latestRef.current.onboardingStep,
        };
        if (isPassedName) {
          console.log("[Kiosk] Skipping ASK_NAME: name step already completed. Bypassing prompt.", JSON.stringify(snapshot));
          const cachedName = KioskStepCache.getCustomerName() || latestRef.current.name;
          if (cachedName) {
            kioskWS.sendSetName(cachedName);
          } else {
            kioskWS.sendSkipName();
          }
          setOnboardingStep(2);
          setOnboardingOpen(true);
          break;
        }
        nameDoneRef.current = true;
        latestRef.current.presence?.triggerTouchEngaged?.();
        setOnboardingStep(1);
        setOnboardingOpen(true);
        setShowDetail(false);
        setCartModalOpen(false);
        setQrModalOpen(false);
        if (action?.buttons && Array.isArray(action.buttons)) {
          setActionButtons(action.buttons);
        }
        const promptText = action?.prompt || action?.message || action?.text;
        if (promptText && typeof promptText === "string" && promptText.trim().length > 0) {
          const cleanPrompt = promptText.trim();
          setCaption(cleanPrompt);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "ask_name";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanPrompt, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "SHOW_CATEGORIES": {
        clearTimeout(categoriesFallbackTimerRef.current);
        KioskStepCache.setCurrentStep(KIOSK_STEPS.BROWSING);
        latestRef.current.presence?.triggerTouchEngaged?.();
        setOnboardingStep(2);
        setOnboardingOpen(true);
        setShowDetail(false);
        setCartModalOpen(false);
        setQrModalOpen(false);
        if (action?.buttons && Array.isArray(action.buttons)) {
          setActionButtons(action.buttons);
        }
        const msg = action?.message || action?.text;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          setCaption(cleanMsg);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "show_categories";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "SHOW_CATEGORY": {
        if (action?.category) {
          latestRef.current.selectCategory?.(action.category);
        }
        break;
      }

      case "SHOW_PRODUCTS": {
        KioskStepCache.setCurrentStep(KIOSK_STEPS.BROWSING);
        latestRef.current.presence?.triggerTouchEngaged?.();
        // Server actions must not close categories screen if user is currently selecting categories
        if (latestRef.current.onboardingStep !== 2) {
          setOnboardingOpen(false);
        }
        setShowDetail(false);
        setCartModalOpen(false);
        setQrModalOpen(false);

        let resolvedCat = null;
        if (action?.category_id || action?.category) {
          resolvedCat = normalizeCategory(action.category_id || action.category);
        } else if (action?.products?.[0]?.category) {
          resolvedCat = normalizeCategory(action.products[0].category);
        }

        if (resolvedCat) {
          setCategory(resolvedCat);
        }

        if (action?.products && Array.isArray(action.products) && action.products.length > 0) {
          const normTurnProducts = action.products.map(normalizeBackendProduct).filter(Boolean);
          setLiveTurnProducts(normTurnProducts);
        } else {
          setLiveTurnProducts([]);
        }

        if (action?.buttons && Array.isArray(action.buttons)) {
          setActionButtons(action.buttons);
        }

        const msg = action?.message || action?.text;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          setCaption(cleanMsg);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "show_products";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "SHOW_PRODUCT_CARD":
      case "SHOW_PRODUCT": {
        KioskStepCache.setCurrentStep(KIOSK_STEPS.PRODUCT_SELECTED);
        latestRef.current.presence?.triggerTouchEngaged?.();
        setOnboardingOpen(false);
        setShowDetail(true);
        setCartModalOpen(false);
        setQrModalOpen(false);

        const prodData = action?.product || (action?.products && action.products[0]);
        const currentCatalog = latestRef.current.backendCatalog || [];
        const target =
          (prodData && findMatchingLocalProduct(prodData, currentCatalog)) ||
          (action?.sku && findMatchingLocalProduct(action.sku, currentCatalog)) ||
          (prodData && normalizeBackendProduct(prodData)) ||
          currentCatalog[0] ||
          null;

        if (target) {
          setProductId(target.id || target.sku);
          KioskStepCache.setSelectedProduct(target);
          setBackendCatalog((prev) => {
            if (prev.some((p) => p.id === target.id || p.sku === target.sku)) return prev;
            return [target, ...prev];
          });
          if (target.categories) {
            const bestCat = target.categories.find((c) => c !== "all") || "all";
            setCategory(bestCat);
          }
        }

        if (action?.buttons && Array.isArray(action.buttons)) {
          setActionButtons(action.buttons);
        } else {
          setActionButtons(["Next", "Cheaper", "Compare", "I'll take it"]);
        }

        const msg = action?.message || action?.blurb || action?.text;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          setCaption(cleanMsg);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "show_product";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "CONFIRM_BUY": {
        latestRef.current.presence?.triggerTouchEngaged?.();
        setCartModalOpen(true);
        const currentCatalog = latestRef.current.backendCatalog || [];
        const target =
          findMatchingLocalProduct(action?.sku, currentCatalog) ||
          findMatchingLocalProduct(action?.product, currentCatalog) ||
          latestRef.current.product ||
          currentCatalog[0] ||
          null;

        setCartModalData({
          sku: action?.sku || target?.sku,
          product: target,
          buttons: action?.buttons || ["Checkout", "Keep shopping"],
        });
        const msg = action?.message;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          setCaption(cleanMsg);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "confirm_buy";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "CHECKOUT_HANDOFF": {
        latestRef.current.presence?.triggerTouchEngaged?.();
        setCartModalOpen(false);
        setQrModalOpen(true);
        const currentCatalog = latestRef.current.backendCatalog || [];
        const target =
          findMatchingLocalProduct(action?.sku, currentCatalog) ||
          findMatchingLocalProduct(action?.product, currentCatalog) ||
          latestRef.current.product ||
          currentCatalog[0] ||
          null;

        setQrModalData({
          sku: action?.sku || target?.sku,
          product_url: action?.product_url,
          product: target,
        });
        const msg = action?.message;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          setCaption(cleanMsg);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "checkout_handoff";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "GOODBYE": {
        latestRef.current.presence?.triggerTouchEngaged?.();
        setCartModalOpen(false);
        setQrModalOpen(false);
        setGoodbyeOpen(true);
        setGoodbyeData({
          message: action?.message || "Thank you, have a great day!",
          autoResetAfterMs: action?.auto_reset_after_ms || 4000,
        });
        const msg = action?.message || "Thank you, have a great day!";
        const cleanMsg = msg.trim();
        setCaption(cleanMsg);
        const activeTid = actionTurnId || kioskWS.currentTurnId || "goodbye";
        if (speechController.getEnqueuedCount(activeTid) === 0) {
          speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
          speechController.endReply(activeTid);
        }
        break;
      }

      case "REQUEST_HUMAN": {
        const msg = action?.message || "A store associate is on the way.";
        const cleanMsg = msg.trim();
        setStaffBanner(cleanMsg);
        setCaption(cleanMsg);
        const activeTid = actionTurnId || kioskWS.currentTurnId || "request_human";
        if (speechController.getEnqueuedCount(activeTid) === 0) {
          speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
          speechController.endReply(activeTid);
        }
        break;
      }

      case "SHOW_HINT": {
        setHintBubble(action?.hint || action?.message);
        break;
      }

      case "SHOW_ALL": {
        if (latestRef.current.onboardingStep !== 2) {
          setOnboardingOpen(false);
        }
        setShowDetail(false);
        setCategory("all");
        setLiveTurnProducts([]);
        break;
      }

      case "NAVIGATE_BACK": {
        setShowDetail(false);
        break;
      }

      case "RESTART": {
        latestRef.current.reset?.();
        break;
      }

      default:
        if (actionType) {
          console.log("[Kiosk] Action processed:", actionType);
        }
    }
  }, [say]);

  // Connect WebSocket listeners (reads handlers via latestRef to prevent stale closures)
  const lastSpokenTurnIdRef = useRef(null);

  useEffect(() => {
    const unsubAction = kioskWS.on("action", (actionData) => {
      handleServerAction(actionData);
    });

    const unsubHint = kioskWS.on("hint", (hintData) => {
      setHintBubble(hintData);
    });

    // Streamed sentence listener: start TTS immediately for each completed sentence
    const unsubSentence = kioskWS.on("sentence", (sentence, turnId) => {
      const activeTurnKey = activeActionReplyIdRef.current || turnId || kioskWS.currentTurnId || "turn_default";
      turnsWithSentencesRef.current.add(activeTurnKey);
      console.log(`[Renderer] SENTENCE received ts=${new Date().toISOString()} turn=${activeTurnKey} text="${sentence.slice(0, 50)}"`);
      setConv(S.SPEAKING);
      const textToSpeak = sanitizeForMultipleFaces(sentence);
      speechController.appendSentence(activeTurnKey, textToSpeak, { turnId: activeTurnKey });
    });

    const unsubDone = kioskWS.on("done", (doneData) => {
      console.log(`[Renderer] DONE received ts=${new Date().toISOString()} reply="${(doneData?.reply || "").slice(0, 60)}"`);
      if (doneData?.action || doneData?.salesStage) {
        handleServerAction(doneData.action, doneData.salesStage);
      }
      const turnId = activeActionReplyIdRef.current || doneData?.turnId || doneData?.meta?.turn_id || kioskWS.currentTurnId || "turn_default";
      speechController.endReply(turnId);

      if (doneData?.reply && typeof doneData.reply === "string" && doneData.reply.trim().length > 0) {
        const replyText = sanitizeForMultipleFaces(doneData.reply.trim());
        setCaption(replyText);

        const enqueuedCount = speechController.getEnqueuedCount(turnId);
        if (enqueuedCount === 0) {
          console.log(`[Kiosk] Fallback: No sentence enqueued for turn=${turnId}. Calling speechController.appendSentence.`);
          speechController.appendSentence(turnId, replyText, { turnId });
          speechController.endReply(turnId);
        } else {
          console.log(`[Kiosk] Streamed sentences already enqueued (${enqueuedCount}) for turn=${turnId}. Skipping fallback.`);
        }
      }
    });

    const unsubPingSilence = kioskWS.on("ping_silence", (msg) => {
      setHintBubble(typeof msg === "string" ? msg : "Still there? Tap or speak to continue.");
    });

    const unsubAutoReset = kioskWS.on("auto_reset", (msg) => {
      if (!isEngaged && !onboardingOpen && !nameRef.current && !KioskStepCache.getCustomerName()) {
        latestRef.current.resetSession?.("auto_reset");
      }
    });

    return () => {
      unsubAction();
      unsubHint();
      unsubSentence();
      unsubDone();
      unsubPingSilence();
      unsubAutoReset();
    };
  }, [handleServerAction, say, isEngaged, onboardingOpen]);


  // ── Core: Send transcript to AI backend ───────────────────────────────────
  const sendTranscript = useCallback(async (text, signalsSnap) => {
    if (isSendingRef.current) {
      console.log("[Kiosk] Dropping duplicate in-flight chat request:", text);
      return;
    }

    const trimmed = String(text ?? "").trim();
    if (!trimmed) return;

    // ── Spoken Name & Skip handling during ASK_NAME step ──
    const currentStep = KioskStepCache.getCurrentStep();
    const hasNameAlready = Boolean(KioskStepCache.getCustomerName() || nameRef.current);
    const isAwaitingName =
      (latestRef.current.onboardingOpen && latestRef.current.onboardingStep === 1) ||
      (!nameSubmittedRef.current && !hasNameAlready && currentStep < KIOSK_STEPS.NAME_SET);

    const hasExplicitIntro = /^(?:my name is|i am|i'm|this is|call me|myself)\s+/i.test(trimmed);

    if (isAwaitingName || (!hasNameAlready && !nameSubmittedRef.current && hasExplicitIntro)) {
      if (/^(?:skip|skip name|skip for now|no thanks|later|pass|never mind)$/i.test(trimmed)) {
        console.log("[Kiosk] Spoken skip name detected:", trimmed);
        skipName();
        return;
      }
      let candidate = trimmed
        .replace(/^(?:my name is|i am|i'm|this is|call me|myself|it's|it is)\s+/i, "")
        .replace(/[.,!?]/g, "")
        .trim();

      const isReserved =
        /^(?:what|where|how|why|who|help|hello|hi|good|can|buy|shop|shirt|shirts|t-shirt|tshirts|kurta|kurtas|jeans|trouser|trousers|linen|all|next|back|restart|checkout)\b/i.test(
          candidate
        );

      if (candidate && candidate.split(/\s+/).length <= 3 && !isReserved) {
        const formatted = candidate
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        console.log("[Kiosk] Spoken name detected:", formatted);
        submitName(formatted);
        return;
      }
    }

    // ── Spoken answers during identity verification (Step 3) ──
    if (latestRef.current.identityPrompt?.active) {
      if (/^(?:yes|yeah|yep|correct|that's me|i am|right|sure|it is|it's me)\b/i.test(trimmed)) {
        console.log("[Presence] Voice affirmative verification received:", trimmed);
        latestRef.current.confirmIdentity?.();
        return;
      }
      if (/^(?:no|nope|nah|not me|i am not|i'm not|someone new|different person|new customer|new)\b/i.test(trimmed)) {
        console.log("[Presence] Voice rejection / different person received:", trimmed);
        latestRef.current.resetSession?.("different_person");
        return;
      }
    }

    // ── Spoken restart / identity override intent (Step 7) ──
    const activeName = latestRef.current.name || KioskStepCache.getCustomerName() || "";
    const escapedName = activeName ? activeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
    const notNamePattern = escapedName ? `(?:i am not|i'm not|not)\\s+${escapedName}|` : "";
    const isOverrideIntent = new RegExp(`^(?:${notNamePattern}i am someone else|i'm someone else|someone else|someone new|different person|new customer|start over|restart|reset|that's not me|not me)$`, "i").test(trimmed);

    if (isOverrideIntent) {
      console.log("[Kiosk] Spoken identity override detected:", trimmed);
      latestRef.current.resetSession?.("user_speech");
      return;
    }

    stopSpeechForUserAction("user_voice_turn");

    // ── Spoken purchase / checkout intent ──
    if (/^(?:buy|buy now|checkout|i'll take it|i want this|take it)$/i.test(trimmed)) {
      kioskWS.sendWsMessage("buy");
      return;
    }

    isSendingRef.current = true;
    setConv(S.THINKING);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    // Start a new turn on the stage: aborts any in-flight TTS from previous turn immediately
    const stage = latestRef.current._stageRef?.current;
    stage?.startTurn?.("turn_" + Date.now());

    try {
      const effectiveName = latestRef.current.multipleFaces ? "" : String(nameRef.current ?? "");
      const data = await replyAsync({
        text: String(text ?? ""),
        name: effectiveName,
        sessionId: sessionIdRef.current,
        signals: signalsSnap,
        signal: abortRef.current.signal,
        onAction: (act) => {
          if (act) handleServerAction(act);
        },
      });

      if (!data || !data.message) {
        setConv(S.ATTENTIVE);
        return;
      }

      if (data.turnId) {
        lastSpokenTurnIdRef.current = data.turnId;
      }

      if (data.name) setName(data.name);
      if (data.sessionId) sessionIdRef.current = data.sessionId;

      const a = data.action;
      const textQuery = String(text ?? "").trim();
      const localMatch = matchProductAction(textQuery);

      if (a || localMatch) {
        handleServerAction(a || localMatch, data.salesStage);
      }

      setConv(S.SPEAKING);
      setCaption(data.message);
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("[Kiosk] AI backend error:", err);
      setConv(S.ATTENTIVE);
    } finally {
      isSendingRef.current = false;
    }

  }, [handleServerAction, say, setConv, skipName, stopSpeechForUserAction, submitName]);

  // ── End-of-turn finalization ──────────────────────────────────────────────
  const finaliseAndSend = useCallback((explicitText) => {
    clearTimeout(eotTimerRef.current);
    const text = (typeof explicitText === "string" ? explicitText : pendingTranscriptRef.current).trim();
    if (text) {
      setLastUserSpeech(text);
    }
    pendingTranscriptRef.current = "";
    setLiveTranscript("");

    if (!text) {
      if (convStateRef.current === S.LISTENING) {
        setConv(S.ATTENTIVE);
      }
      return;
    }

    failureCountRef.current = 0;
    sendTranscript(text, signals);
  }, [sendTranscript, setConv, signals]);

  const finaliseAndSendRef = useRef(finaliseAndSend);
  finaliseAndSendRef.current = finaliseAndSend;

  // Hypotheses from Deepgram
  const handleHypothesis = useCallback((text) => {
    if (text) {
      setLiveTranscript(text);
      if (convStateRef.current !== S.LISTENING && convStateRef.current !== S.THINKING) {
        setConv(S.LISTENING);
      }
    }
  }, [setConv]);

  // Final transcript from Deepgram
  const handleFinal = useCallback((text) => {
    if (isEchoOfAvatar(text)) return;
    const g = getGate();
    if (g.blocked && !g.bargeIn) return;
    clearTimeout(eotTimerRef.current);
    if (text && text.trim()) {
      finaliseAndSend(text.trim());
    }
  }, [getGate, isEchoOfAvatar, finaliseAndSend]);

  // ── Single continuous Deepgram Nova-3 STT ─────────────────────────────────
  const deepgram = useSpeech({
    mic: { subscribePcm: mic.subscribePcm, getRecent: mic.getRecent },
    isEngaged,
    onTranscript: handleFinal,
    onHypothesis: handleHypothesis,
    shouldDrop: isEchoOfAvatar,
    getGate,
  });

  // ── UI state + face/jaw barge-in ──────────────────────────────────────────
  useEffect(() => {
    if (!isEngaged) return;
    const gateBlocked = getGate().blocked;
    const talking = userSpeaking || (vadSpeech && !gateBlocked);
    setListening(talking && !isAvatarActive);

    if (talking) {
      clearTimeout(eotTimerRef.current);
      if (isAvatarActive) {
        const realUser = (userSpeaking || vadSpeech) && audioLevel > BARGE_MIN_LEVEL;
        if (realUser) {
          bargeUntilRef.current = Date.now() + 2500;
          interruptAvatar();
        }
      } else if (convStateRef.current !== S.LISTENING) {
        setConv(S.LISTENING);
      }
    } else if (convStateRef.current === S.LISTENING) {
      clearTimeout(eotTimerRef.current);
      eotTimerRef.current = setTimeout(finaliseAndSend, speechConfig.endOfTurnSilenceMs);
    }
  }, [userSpeaking, vadSpeech, audioLevel, isEngaged, isAvatarActive, getGate, interruptAvatar, setConv, finaliseAndSend]);

  // ── Web Speech API — browser fallback (ONLY if Deepgram failed > 3s) ──────
  const deepgramFailedRef = useRef(false);
  const deepgramFailTimerRef = useRef(null);

  useEffect(() => {
    if (deepgram.status === "open") {
      clearTimeout(deepgramFailTimerRef.current);
      deepgramFailedRef.current = false;
    } else {
      clearTimeout(deepgramFailTimerRef.current);
      deepgramFailTimerRef.current = setTimeout(() => {
        if (deepgram.status !== "open") {
          deepgramFailedRef.current = true;
          console.warn("[Kiosk] Deepgram unavailable for >3s, WebSpeech fallback active");
        }
      }, 3000);
    }
    return () => clearTimeout(deepgramFailTimerRef.current);
  }, [deepgram.status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    let stopped = false;
    let restartTimer = null;
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN";
    rec.maxAlternatives = 1;

    const webSpeechTimerRef = { current: null };

    rec.onresult = (event) => {
      // Discard Web Speech if Deepgram is operational to prevent double-send race condition
      if (!deepgramFailedRef.current) return;

      const now = Date.now();
      if (
        avatarActiveNowRef.current ||
        isAvatarActiveRef.current ||
        speaking ||
        convStateRef.current === S.SPEAKING ||
        now - avatarEndedAtRef.current < COOLDOWN_MS
      ) {
        pendingTranscriptRef.current = "";
        setLiveTranscript("");
        return;
      }

      let interim = "";
      let hasFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) {
          pendingTranscriptRef.current += " " + t;
          hasFinal = true;
        } else {
          interim = t;
        }
      }

      const fullLive = (pendingTranscriptRef.current + " " + interim).trim();
      setLiveTranscript(fullLive);

      if (fullLive.length > 0) {
        if (convStateRef.current !== S.LISTENING && convStateRef.current !== S.THINKING) {
          setConv(S.LISTENING);
        }
        clearTimeout(webSpeechTimerRef.current);
        const waitMs = hasFinal ? 400 : 900;
        webSpeechTimerRef.current = setTimeout(() => {
          const toSend = pendingTranscriptRef.current.trim() || fullLive;
          if (toSend && convStateRef.current !== S.THINKING) {
            finaliseAndSendRef.current?.(toSend);
          }
        }, waitMs);
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") stopped = true;
    };

    rec.onend = () => {
      clearTimeout(webSpeechTimerRef.current);
      if (pendingTranscriptRef.current.trim() && convStateRef.current !== S.THINKING) {
        finaliseAndSendRef.current?.(pendingTranscriptRef.current.trim());
      }
      if (!stopped) {
        restartTimer = setTimeout(() => {
          if (!stopped) {
            try { rec.start(); } catch (_) {}
          }
        }, 150);
      }
    };

    try { rec.start(); } catch (_) {}

    return () => {
      stopped = true;
      clearTimeout(restartTimer);
      clearTimeout(webSpeechTimerRef.current);
      try { rec.stop(); } catch (_) {}
    };
  }, [isEngaged, setConv]);

  // ── Avatar speaking → update conv state ──────────────────────────────────
  const handleSpeakingChange = useCallback((isSpeaking) => {
    setSpeaking(isSpeaking);
    if (!isSpeaking) {
      if (convStateRef.current === S.SPEAKING) {
        setConv(S.ATTENTIVE);
      }
    }
  }, [setConv]);


  // ── Attentive state: face present but not speaking ────────────────────────
  useEffect(() => {
    if (!isEngaged) return;
    if (face.present && !userSpeaking && convStateRef.current === S.IDLE) {
      setConv(S.ATTENTIVE);
    }
  }, [face.present, isEngaged, userSpeaking, setConv]);

  // ── Categories & Products Memos ──────────────────────────────────────────
  const categories = useMemo(() => {
    if (backendAction?.categories && Array.isArray(backendAction.categories) && backendAction.categories.length > 0) {
      return [
        { id: "all", label: "All Products", name: "All Products" },
        ...backendAction.categories.map((c) => ({
          id: c.id,
          label: c.name || c.label || c.id,
          name: c.name || c.label || c.id,
        })),
      ];
    }
    const catMap = new Map();
    catMap.set("all", { id: "all", label: "All Products", name: "All Products" });
    const list = backendCatalog;
    list.forEach((p) => {
      const catName = p.category;
      if (catName) {
        const clean = normalizeCategory(catName);
        if (!catMap.has(clean)) {
          catMap.set(clean, {
            id: clean,
            label: catName,
            name: catName,
          });
        }
      }
    });
    return Array.from(catMap.values());
  }, [backendAction, backendCatalog]);

  // ── Flow Actions ──────────────────────────────────────────────────────────
  const selectCategory = useCallback((cat) => {
    stopSpeechForUserAction("user_tap_category");
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    const rawId = typeof cat === "string" ? cat : (cat?.id || "all");
    const cleanId = normalizeCategory(rawId);
    const catObj = categories.find((c) => c.id === cleanId || c.id === rawId);
    const catName =
      typeof cat === "object" && (cat?.label || cat?.name)
        ? (cat?.label || cat?.name)
        : (catObj?.label || catObj?.name || cleanId.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase()));

    setCategory(cleanId);
    setShowDetail(false);
    setOnboardingOpen(false);
    setLiveTurnProducts([]);

    kioskWS.sendSelectCategory({
      category_id: cleanId,
      category_name: catName,
    });
  }, [categories, presence, stopSpeechForUserAction]);

  const selectProduct = useCallback((p) => {
    stopSpeechForUserAction("user_tap_product");
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    setProductId(p.id);
    setShowDetail(true);
    setOnboardingOpen(false);
    KioskStepCache.setSelectedProduct(p);
    kioskWS.sendSelectProduct(p);
  }, [presence, stopSpeechForUserAction]);

  const showAll = useCallback(() => {
    stopSpeechForUserAction("user_tap_show_all");
    lastInputAtRef.current = Date.now();
    setCategory("all");
    setShowDetail(false);
    setOnboardingOpen(false);
    kioskWS.sendWsAction({ action: "SHOW_ALL" });
  }, [stopSpeechForUserAction]);

  const navigateBack = useCallback(() => {
    stopSpeechForUserAction("user_tap_back");
    lastInputAtRef.current = Date.now();
    setShowDetail(false);
    kioskWS.sendWsAction({ action: "NAVIGATE_BACK" });
  }, [stopSpeechForUserAction]);

  const restartSession = useCallback(() => {
    lastInputAtRef.current = Date.now();
    kioskWS.sendWsAction({ action: "RESTART" });
    reset();
  }, [reset]);

  const send = useCallback((text) => {
    stopSpeechForUserAction("user_send");
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    if (text) {
      kioskWS.sendWsMessage(text);
    }
  }, [presence, stopSpeechForUserAction]);

  const enquire = useCallback(() => {
    stopSpeechForUserAction("user_enquire");
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    say(
      `Happy to help with a bulk enquiry${name ? ", " + name : ""}! ` +
      "Our team offers volume discounts, custom logo engraving, and certified eco packaging."
    );
  }, [name, presence, say, stopSpeechForUserAction]);

  const handleButtonClick = useCallback((btn) => {
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    if (!btn) return;
    stopSpeechForUserAction("user_tap_button");
    console.log("[Kiosk] User clicked flow button:", btn);

    const btnId = typeof btn === "string" ? btn.toLowerCase().trim() : (btn.id || btn.label || "").toLowerCase().trim();

    if (btnId === "skip_name" || btnId === "skip") {
      skipName();
      return;
    }

    if (btnId === "checkout") {
      kioskWS.sendWsMessage("checkout");
      setCartModalOpen(false);
      setQrModalOpen(true);
      return;
    }

    if (btnId === "keep_shopping" || btnId === "keep shopping") {
      kioskWS.sendWsMessage("keep shopping");
      setCartModalOpen(false);
      return;
    }

    if (btnId === "restart") {
      restartSession();
      return;
    }

    kioskWS.sendButtonClick(btn);
  }, [presence, restartSession, skipName, stopSpeechForUserAction]);

  const products = useMemo(() => {
    if (liveTurnProducts.length > 0) {
      return liveTurnProducts;
    }
    const catalog = backendCatalog;
    if (!catalog || catalog.length === 0) return [];
    if (!category || category === "all") return catalog;
    const clean = normalizeCategory(category);
    return catalog.filter((p) => {
      const pCat = normalizeCategory(p.category || "");
      const pCats = Array.isArray(p.categories) ? p.categories.map(normalizeCategory) : [];
      return pCat === clean || pCats.includes(clean);
    });
  }, [backendCatalog, category, liveTurnProducts]);

  const product = useMemo(() => {
    const catalog = backendCatalog;
    if (!catalog || catalog.length === 0) return null;
    return (
      catalog.find((p) => p.id === productId || p.sku === productId) ||
      products[0] ||
      catalog[0] ||
      null
    );
  }, [backendCatalog, productId, products]);

  // Keep latestRef synchronized every render
  latestRef.current = {
    backendCatalog,
    product,
    productId,
    name,
    category,
    categories,
    selectCategory,
    presence,
    showDetail,
    onboardingStep,
    onboardingOpen,
    sessionId: sessionIdRef.current,
    say,
    reset,
    resetSession,
    identityPrompt,
    confirmIdentity,
    multipleFaces: presence.multipleFaces,
    setCaption,
    submitName,
    skipName,
    showAll,
    navigateBack,
    restartSession,
    handleServerAction,
    stageRef,
    _stageRef: stageRef,
  };

  return {
    caption,
    speechId,
    category,
    categories,
    product,
    products,
    name,
    convState,
    speaking,
    listening: deepgram.listening || listening,
    liveTranscript: deepgram.liveTranscript || liveTranscript,
    lastUserSpeech,
    userSpeaking,
    evidence,
    speakingForMs,
    silentForMs,
    audioLevel,
    vadSpeech,
    signals,
    presence,
    send,
    selectCategory,
    selectProduct,
    submitName,
    skipName,
    showAll,
    navigateBack,
    restartSession,
    backendAction,
    actionButtons,
    showDetail,
    setShowDetail,
    enquire,
    reset,
    resetSession,
    identityPrompt,
    confirmIdentity,
    handleButtonClick,
    cartModalOpen,
    setCartModalOpen,
    cartModalData,
    qrModalOpen,
    setQrModalOpen,
    qrModalData,
    goodbyeOpen,
    setGoodbyeOpen,
    goodbyeData,
    staffBanner,
    setStaffBanner,
    hintBubble,
    setHintBubble,
    onboardingOpen,
    setOnboardingOpen,
    onboardingStep,
    setOnboardingStep,
    handleServerAction,
    setStageRef,
    handleSpeakingChange,
    setSpeaking,
    showPTT,
    micError,
    sessionTimeoutWarning,
    continueSession,
    exitSession,
  };
}
