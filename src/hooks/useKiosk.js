"use client";
/**
 * useKiosk.js  (v2 – with conversation state machine)
 * ─────────────────────────────────────────────────────────────────────────────
 * States: IDLE → ATTENTIVE → LISTENING → THINKING → SPEAKING → LISTENING …
 *
 * Key behaviours
 *   • userSpeaking true  → LISTENING; interrupts avatar immediately
 *   • end-of-turn silence (900 ms) → send transcript → THINKING → SPEAKING
 *   • Never start avatar speech while userSpeaking is true
 *   • "I can't hear you" NEVER fires while userSpeaking is true
 *   • Low-audio nudge after 2 s of face-evidence-but-no-audio
 *   • Two failures → show push-to-talk
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRODUCTS } from "@/data/products";
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
import { usePresenceDetection } from "@/lib/presence/usePresenceDetection";
import { useUserSignals } from "@/hooks/useUserSignals";
import { useMic } from "@/hooks/useMic";
import { useUserSpeechState } from "@/hooks/useUserSpeechState";
import { useSpeech } from "@/hooks/useSpeech";
import speechConfig from "@/lib/speechConfig";

// ─── Constants ────────────────────────────────────────────────────────────────
const IDLE_RESET_MS = 60_000;

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
  const [name, setName]           = useState("");
  const [category, setCategory]   = useState("all");
  const [productId, setProductId] = useState(PRODUCTS[0].id);
  const [caption, setCaption]     = useState(GREETING);
  const [speechId, setSpeechId]   = useState(1);
  const sessionIdRef = useRef("kiosk-" + Math.random().toString(36).substring(2, 9));
  const pendingSpeechAckRef = useRef(null);
  const speechAckTimerRef = useRef(null);
  const [backendAction, setBackendAction] = useState(null);
  const [backendCatalog, setBackendCatalog] = useState([]);
  const [liveTurnProducts, setLiveTurnProducts] = useState([]);
  const [showDetail, setShowDetail]       = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const sendTranscriptRef = useRef(null);

  // Preload verified database catalog from backend API
  useEffect(() => {
    fetchBackendProducts().then((data) => {
      if (data?.products && Array.isArray(data.products) && data.products.length > 0) {
        const mapped = data.products.map(normalizeBackendProduct).filter(Boolean);
        setBackendCatalog(mapped);
        if (mapped[0]?.id) {
          setProductId(mapped[0].id);
        }
      }
    }).catch(() => {});
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
  const lowAudioTimerRef     = useRef(null);
  const idleTimerRef         = useRef(null);

  // ── Abort controller for SSE/AI fetch ────────────────────────────────────
  const abortRef = useRef(null);

  // ── Presence detection & session lifecycle ──────────────────────────────
  const reset = useCallback(() => {
    setName("");
    setCategory("all");
    setProductId(PRODUCTS[0].id);
    setCaption(GREETING);
    const oldSession = sessionIdRef.current;
    sessionIdRef.current = "kiosk-" + Math.random().toString(36).substring(2, 9);
    kioskWS.connect(sessionIdRef.current);
    resetBackendSession(oldSession);
    pendingSpeechAckRef.current = null;
    clearTimeout(speechAckTimerRef.current);
    if (kioskWS.speechDoneTimer) {
      clearTimeout(kioskWS.speechDoneTimer);
      kioskWS.speechDoneTimer = null;
    }
    kioskWS.pendingSpeechId = null;
    setBackendAction(null);
    setShowDetail(false);
    setOnboardingOpen(false);
    setOnboardingStep(1);
    setSpeechId((p) => p + 1);
    setConv(S.IDLE);
    pendingTranscriptRef.current = "";
    setLastUserSpeech("");
    setLiveTranscript("");
    failureCountRef.current = 0;
    setShowPTT(false);
  }, [setConv]);

  // Connect WebSocket client on mount for current session
  useEffect(() => {
    kioskWS.connect(sessionIdRef.current);
  }, []);

  const presence = usePresenceDetection({
    onEnterEngaged: useCallback(() => {
      if (convStateRef.current === S.IDLE) {
        setConv(S.ATTENTIVE);
      }
    }, [setConv]),
    onExitToIdle: useCallback(() => {
      reset();
    }, [reset]),
  });

  const isEngaged = presence.state === "ENGAGED" || onboardingOpen;

  // Sync engagement presence state with Electron main process
  useEffect(() => {
    if (typeof window !== "undefined" && window.kiosk?.sendPresenceState) {
      window.kiosk.sendPresenceState(isEngaged ? "ENGAGED" : "IDLE");
    }
  }, [isEngaged]);

  // ── Face signals (jaw-open VAD already in useUserSignals) ─────────────────
  const signals = useUserSignals({
    videoRef: presence.videoRef,
    isEngaged,
    onSpeechStart: useCallback(() => {}, []),
    onSpeechEnd:   useCallback(() => {}, []),
  });

  // Build the face object expected by useUserSpeechState
  const face = {
    present:        signals.present,
    jawOpen:        signals.jawOpen,
    lookingAtScreen: signals.attention === "screen",
    // faceSizeRatio from debugStats facePx / 640
    faceSizeRatio:  (presence.debugStats?.facePx ?? 0) / 640,
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
  const COOLDOWN_MS = 200;
  const ECHO_WINDOW_MS = 2500;
  const BARGE_MIN_LEVEL = 0.02;

  const bargeUntilRef = useRef(0); // Timestamp, expires by itself
  const avatarEndedAtRef = useRef(0);
  const avatarActiveNowRef = useRef(false);

  useEffect(() => {
    avatarActiveNowRef.current = isAvatarActive;
    if (isAvatarActive) {
      // A new avatar turn always starts with the gate closed
      bargeUntilRef.current = 0;
    } else {
      avatarEndedAtRef.current = Date.now();
    }
  }, [isAvatarActive]);

  // Watchdog: Ensure speaking state automatically unblocks if TTS onend is missed
  useEffect(() => {
    if (speaking || convState === S.SPEAKING) {
      const maxMs = Math.max(2500, (caption?.length || 20) * 80 + 1500);
      const timer = setTimeout(() => {
        if (speaking || convStateRef.current === S.SPEAKING) {
          console.warn("[Kiosk] Avatar speaking safety watchdog: releasing speaking lock to allow listening");
          setSpeaking(false);
          if (convStateRef.current === S.SPEAKING) {
            setConv(S.ATTENTIVE);
          }
        }
      }, maxMs);
      return () => clearTimeout(timer);
    }
  }, [speaking, convState, caption, setConv]);

  // Read by useSpeech on every audio chunk (refs, so never stale)
  const getGate = useCallback(() => {
    const now = Date.now();
    const inCooldown = now - avatarEndedAtRef.current < COOLDOWN_MS;
    return {
      blocked: avatarActiveNowRef.current || inCooldown,
      bargeIn: now < bargeUntilRef.current,
    };
  }, []);

  // Stronger echo filter as backup
  const lastAvatarTextRef = useRef("");
  useEffect(() => {
    if (caption) lastAvatarTextRef.current = caption;
  }, [caption]);

  const isEchoOfAvatar = useCallback((text) => {
    const sinceEnd = Date.now() - avatarEndedAtRef.current;
    const recent = avatarActiveNowRef.current || sinceEnd < ECHO_WINDOW_MS;
    const cap = lastAvatarTextRef.current;
    if (!recent || !cap || !text) return false;

    const norm = (s) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const capWords = new Set(norm(cap));
    const words = norm(text);
    if (!words.length) return false;
    return words.filter((w) => capWords.has(w)).length / words.length >= 0.5;
  }, []);

  // ── Avatar control helpers (set from AvatarPanel via callbacks) ────────────
  const stageRef = useRef(null);
  const setStageRef = useCallback((ref) => { stageRef.current = ref; }, []);

  const handleServerActionRef = useRef(null);

  // ── Interrupt avatar speech ────────────────────────────────────────────────
  const interruptAvatar = useCallback(async () => {
    abortRef.current?.abort();
    if (typeof window !== "undefined") {
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    }
    stageRef.current?.stop();
    setSpeaking(false);
    setConv(S.LISTENING);

    // Unblock backend state machine if speech was interrupted
    const sid = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
    if (sid) {
      pendingSpeechAckRef.current = null;
      clearTimeout(speechAckTimerRef.current);
      try {
        const ackRes = await sendSpeechDone(sid, sessionIdRef.current);
        if (ackRes?.action) {
          handleServerActionRef.current?.(ackRes.action, ackRes.sales_stage);
        }
      } catch (_) {}
    }
  }, [setConv]);

  // ── Say something (queues new caption + increments speechId) ─────────────
  const say = useCallback((text) => {
    if (!text || typeof text !== "string") return;
    setCaption(text);
    setSpeechId((p) => p + 1);
  }, []);

  // ── AI Screen Director: Handle structured server actions ────────────────
  const handleServerAction = useCallback((action, salesStage) => {
    if (!action && !salesStage) return;
    const actionType =
      action?.action ||
      action?.type ||
      (salesStage === "ASK_NAME"
        ? "ASK_NAME"
        : salesStage === "ASK_CATEGORY" || salesStage === "SELECT_CATEGORY"
        ? "SHOW_CATEGORIES"
        : null);

    if (action && typeof action === "object") {
      setBackendAction(action);
    }

    if (action?.speech_id && action?.awaiting_speech_done) {
      pendingSpeechAckRef.current = action.speech_id;
      clearTimeout(speechAckTimerRef.current);
      // Auto-acknowledge speech completion after 1500ms safety delay (Option A)
      speechAckTimerRef.current = setTimeout(async () => {
        if (pendingSpeechAckRef.current === action.speech_id) {
          console.log("[Kiosk] Auto-acknowledging speech_id safety timer:", action.speech_id);
          const sid = action.speech_id;
          pendingSpeechAckRef.current = null;
          try {
            const ackRes = await sendSpeechDone(sid, sessionIdRef.current);
            if (ackRes?.reply && typeof ackRes.reply === "string" && ackRes.reply.trim().length > 0) {
              say(ackRes.reply.trim());
            }
            if (ackRes?.action) {
              handleServerAction(ackRes.action, ackRes.sales_stage);
            }
          } catch (_) {}
        }
      }, 1500);
    }

    switch (actionType) {
      case "ASK_NAME": {
        // 1. Open Name Popup Modal on the right (Step 1)
        presence.triggerTouchEngaged();
        setOnboardingStep(1);
        setOnboardingOpen(true);
        setShowDetail(false);
        const promptText = action?.prompt || action?.message || action?.text;
        if (promptText && typeof promptText === "string" && promptText.trim().length > 0) {
          say(promptText.trim());
        }
        break;
      }

      case "SHOW_CATEGORIES": {
        // Go directly to All Products page; do not open category drawer
        setCategory("all");
        setOnboardingOpen(false);
        setShowDetail(false);
        break;
      }

      case "SHOW_PRODUCTS": {
        // 3. Navigate to Products Grid (Category or "Show Everything")
        setOnboardingOpen(false);
        setShowDetail(false);

        let resolvedCat = null;
        if (action?.category_id || action?.category) {
          resolvedCat = normalizeCategory(action.category_id || action.category);
        } else if (action?.products?.[0]?.category) {
          resolvedCat = normalizeCategory(action.products[0].category);
        }

        // Store turn-specific products emitted directly by backend
        if (action?.products && Array.isArray(action.products) && action.products.length > 0) {
          const normTurnProducts = action.products.map(normalizeBackendProduct).filter(Boolean);
          setLiveTurnProducts(normTurnProducts);
          if (normTurnProducts[0]?.id) {
            setProductId(normTurnProducts[0].id);
          }
        } else {
          setLiveTurnProducts([]);
        }

        if (resolvedCat) {
          setCategory(resolvedCat);
          const activeList = backendCatalog.length > 0 ? backendCatalog : PRODUCTS;
          const items = productsIn(resolvedCat, activeList);
          if (items.length > 0) setProductId(items[0].id);
        } else {
          setCategory("all");
        }
        break;
      }

      case "SHOW_ALL": {
        setOnboardingOpen(false);
        setShowDetail(false);
        setCategory("all");
        setLiveTurnProducts([]);
        break;
      }

      case "SHOW_PRODUCT": {
        // 4. Navigate to Specific Product Detail Page
        setOnboardingOpen(false);
        setShowDetail(true);

        const currentCatalog = backendCatalog.length > 0 ? backendCatalog : PRODUCTS;
        const target =
          findMatchingLocalProduct(action?.product, currentCatalog) ||
          findMatchingLocalProduct(action?.sku, currentCatalog) ||
          findMatchingLocalProduct(action?.productId, currentCatalog) ||
          findMatchingLocalProduct(action?.product_id, currentCatalog) ||
          (action?.products?.length > 0 ? findMatchingLocalProduct(action.products[0], currentCatalog) : null);

        if (target) {
          setProductId(target.id);
          // Ensure target is present in backendCatalog
          setBackendCatalog((prev) => {
            if (prev.some((p) => p.id === target.id || p.sku === target.sku)) return prev;
            return [target, ...prev];
          });
          if (target.categories) {
            const bestCat = target.categories.find((c) => c !== "all") || "all";
            setCategory(bestCat);
          }
        }
        break;
      }

      case "NAVIGATE_BACK": {
        setShowDetail(false);
        break;
      }

      case "RESTART": {
        reset();
        break;
      }

      default:
        if (actionType) {
          console.log("[Kiosk] Action processed:", actionType);
        }
    }
  }, [reset]);

  handleServerActionRef.current = handleServerAction;

  // Connect WebSocket real-time action listener
  useEffect(() => {
    const unsubAction = kioskWS.on("action", (actionData) => {
      console.log("[KioskWS] Real-time action received:", actionData);
      handleServerAction(actionData);
    });

    const unsubDone = kioskWS.on("done", (doneData) => {
      if (doneData?.action || doneData?.salesStage) {
        handleServerAction(doneData.action, doneData.salesStage);
      }
    });

    return () => {
      unsubAction();
      unsubDone();
    };
  }, [handleServerAction]);

  // ── Core: send transcript to AI (Guarded with isSendingRef to prevent double-firing 409s) ──
  const isSendingRef = useRef(false);
  const nameRef = useRef(name);
  nameRef.current = name;

  const sendTranscript = useCallback(async (text, signalsSnap) => {
    if (isSendingRef.current) {
      console.log("[Kiosk] Dropping duplicate in-flight chat request to avoid 409 conflict:", text);
      return;
    }
    isSendingRef.current = true;
    setConv(S.THINKING);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      let firstSentenceSpoken = false;
      const data = await replyAsync({
        text: String(text ?? ""),
        name: String(nameRef.current ?? ""),
        sessionId: sessionIdRef.current,
        signals: signalsSnap,
        signal: abortRef.current.signal,
        onSentence: (sentence) => {
          if (!firstSentenceSpoken && sentence?.trim()) {
            firstSentenceSpoken = true;
            setConv(S.SPEAKING);
            say(sentence.trim());
          }
        },
        onAction: (act) => {
          if (act) handleServerAction(act);
        },
      });

      if (!data || !data.message) {
        setConv(S.ATTENTIVE);
        return;
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
      if (!firstSentenceSpoken) {
        say(data.message);
      } else {
        setCaption(data.message);
      }
    } catch (err) {
      if (err?.name === "AbortError") return; // User interrupted
      console.error("[Kiosk] AI backend error:", err);
      setConv(S.ATTENTIVE);
    } finally {
      isSendingRef.current = false;
    }
  }, [handleServerAction, say, setConv]);

  sendTranscriptRef.current = sendTranscript;

  // ── End-of-turn logic (used directly or as safety fallback) ───────────────
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

  // Forward interim hypotheses from Deepgram so the UI reacts in real time
  const handleHypothesis = useCallback((text) => {
    if (text) {
      setLiveTranscript(text);
      if (convStateRef.current !== S.LISTENING && convStateRef.current !== S.THINKING) {
        setConv(S.LISTENING);
      }
    }
  }, [setConv]);

  // Deepgram final transcript (Deepgram ends the turn)
  const handleFinal = useCallback((text) => {
    if (isEchoOfAvatar(text)) return; // Last line of defence
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

  // ── UI state + face/jaw barge-in (only real user speech interrupts) ────────
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
          bargeUntilRef.current = Date.now() + 2500; // Gate opens for 2.5s only
          interruptAvatar();
        }
      } else if (convStateRef.current !== S.LISTENING) {
        setConv(S.LISTENING);
      }
    } else if (convStateRef.current === S.LISTENING) {
      clearTimeout(eotTimerRef.current);
      eotTimerRef.current = setTimeout(finaliseAndSend, speechConfig.endOfTurnSilenceMs);
    }
  }, [userSpeaking, vadSpeech, evidence, audioLevel, isEngaged, isAvatarActive, getGate, interruptAvatar, setConv, finaliseAndSend]);

  // ── Web Speech API — browser fallback (feeds pendingTranscriptRef) ────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRec) {
      return;
    }
    if (!isEngaged) return;

    let stopped = false;
    let restartTimer = null;
    let backoffMs = 300;

    const rec = new SpeechRec();
    rec.continuous      = true;
    rec.interimResults  = true;
    rec.lang            = "en-IN";
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      backoffMs = 300;
    };

    const webSpeechTimerRef = { current: null };

    rec.onresult = (event) => {
      if (convStateRef.current === S.SPEAKING && !userSpeakingRef.current) return;

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
        // If final chunk detected, short pause triggers send; if continuous interim, 1.2s pause triggers send
        const waitMs = hasFinal ? 750 : 1300;
        webSpeechTimerRef.current = setTimeout(() => {
          const toSend = pendingTranscriptRef.current.trim() || fullLive;
          if (toSend && convStateRef.current !== S.THINKING) {
            finaliseAndSendRef.current?.(toSend);
          }
        }, waitMs);
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        stopped = true;
      }
    };

    rec.onend = () => {
      clearTimeout(webSpeechTimerRef.current);
      if (pendingTranscriptRef.current.trim() && convStateRef.current !== S.THINKING) {
        finaliseAndSendRef.current?.(pendingTranscriptRef.current.trim());
      }
      if (!stopped && isEngaged) {
        restartTimer = setTimeout(() => {
          if (!stopped) {
            try {
              rec.start();
              backoffMs = Math.min(backoffMs * 1.5, 5000);
            } catch (_) {}
          }
        }, backoffMs);
      }
    };

    try {
      rec.start();
    } catch (_) {}

    return () => {
      stopped = true;
      clearTimeout(restartTimer);
      clearTimeout(webSpeechTimerRef.current);
      try { rec.stop(); } catch (_) {}
    };
  }, [isEngaged, setConv]);

  // ── Avatar speaking → update conv state + acknowledge speech done ────────
  const handleSpeakingChange = useCallback(async (isSpeaking) => {
    setSpeaking(isSpeaking);
    if (!isSpeaking) {
      if (convStateRef.current === S.SPEAKING) {
        setConv(S.ATTENTIVE);
      }
      // Unblock backend state machine if it was awaiting SPEECH_DONE (Option A: On TTS end)
      const sid = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
      if (sid) {
        pendingSpeechAckRef.current = null;
        clearTimeout(speechAckTimerRef.current);
        try {
          const ackRes = await sendSpeechDone(sid, sessionIdRef.current);
          if (ackRes?.reply && typeof ackRes.reply === "string" && ackRes.reply.trim().length > 0) {
            say(ackRes.reply.trim());
          }
          if (ackRes?.action) {
            handleServerAction(ackRes.action, ackRes.sales_stage);
          }
        } catch (_) {}
      }
    }
  }, [handleServerAction, say, setConv]);

  // ── Attentive state: face present but not speaking ────────────────────────
  useEffect(() => {
    if (!isEngaged) return;
    if (
      face.present &&
      !userSpeaking &&
      convStateRef.current === S.IDLE
    ) {
      setConv(S.ATTENTIVE);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face.present, isEngaged, userSpeaking]);

  // ── Idle reset ────────────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(reset, IDLE_RESET_MS);
    return () => clearTimeout(idleTimerRef.current);
  }, [caption, productId, reset]);

  // ── Touch / quick-reply & guided flow helpers ───────────────────────────
  const selectCategory = useCallback((id) => {
    presence.triggerTouchEngaged();
    const cleanId = normalizeCategory(id);
    setCategory(cleanId);
    setShowDetail(false);
    setOnboardingOpen(false);
    const items = productsIn(cleanId);
    if (items.length > 0) setProductId(items[0].id);
    sendFlowAction("SELECT_CATEGORY", { category_id: cleanId }, sessionIdRef.current).then((res) => {
      if (res?.reply) say(res.reply);
      if (res?.action) handleServerAction(res.action, res.sales_stage);
    }).catch(() => {});
  }, [handleServerAction, presence, say]);

  const selectProduct = useCallback((p) => {
    presence.triggerTouchEngaged();
    setProductId(p.id);
    setShowDetail(true);
    setOnboardingOpen(false);
    const dynamicDesc = describeProduct(p, name);
    say(dynamicDesc);
    sendFlowAction("SELECT_PRODUCT", { sku: p.sku || p.id, name: p.name }, sessionIdRef.current).then((res) => {
      if (res?.reply && typeof res.reply === "string" && res.reply.trim().length > 0) {
        say(res.reply.trim());
      }
      if (res?.action) {
        handleServerAction(res.action, res.sales_stage);
      }
    }).catch(() => {});
  }, [handleServerAction, name, presence, say]);

  const submitName = useCallback((n) => {
    setName(n);
    setCategory("all");
    setOnboardingOpen(false);
    setShowDetail(false);
    sendFlowAction("SET_NAME", { name: n }, sessionIdRef.current).then((res) => {
      if (res?.reply) {
        say(res.reply);
      }
      setCategory("all");
      setOnboardingOpen(false);
      setShowDetail(false);
      if (res?.action && res.action.action !== "SHOW_CATEGORIES") {
        handleServerAction(res.action, res.sales_stage);
      }
    }).catch((e) => console.warn("[Kiosk] submitName notice:", e));
  }, [handleServerAction, say]);

  const skipName = useCallback(() => {
    setCategory("all");
    setOnboardingOpen(false);
    setShowDetail(false);
    sendFlowAction("SKIP_NAME", {}, sessionIdRef.current).then((res) => {
      if (res?.reply) {
        say(res.reply);
      }
      setCategory("all");
      setOnboardingOpen(false);
      setShowDetail(false);
      if (res?.action && res.action.action !== "SHOW_CATEGORIES") {
        handleServerAction(res.action, res.sales_stage);
      }
    }).catch((e) => console.warn("[Kiosk] skipName notice:", e));
  }, [handleServerAction, say]);

  const showAll = useCallback(() => {
    setCategory("all");
    setShowDetail(false);
    setOnboardingOpen(false);
    sendFlowAction("SHOW_ALL", {}, sessionIdRef.current).then((res) => {
      if (res?.reply) say(res.reply);
      if (res?.action) handleServerAction(res.action, res.sales_stage);
    }).catch(() => {});
  }, [handleServerAction, say]);

  const navigateBack = useCallback(() => {
    setShowDetail(false);
    sendFlowAction("NAVIGATE_BACK", {}, sessionIdRef.current);
  }, []);

  const restartSession = useCallback(() => {
    sendFlowAction("RESTART", {}, sessionIdRef.current);
    reset();
  }, [reset]);

  const send = useCallback((text) => {
    presence.triggerTouchEngaged();
    pendingTranscriptRef.current = text;
    finaliseAndSend();
  }, [finaliseAndSend, presence]);

  const enquire = useCallback(() => {
    presence.triggerTouchEngaged();
    say(
      `Happy to help with a bulk enquiry${name ? ", " + name : ""}! ` +
      "Our team offers volume discounts, custom logo engraving, and certified eco packaging."
    );
  }, [name, presence, say]);

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
    const list = backendCatalog.length > 0 ? backendCatalog : PRODUCTS;
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

  const products = useMemo(() => {
    if (liveTurnProducts.length > 0) {
      return liveTurnProducts;
    }
    const catalog = backendCatalog.length > 0 ? backendCatalog : PRODUCTS;
    if (!category || category === "all") return catalog;
    const clean = normalizeCategory(category);
    return catalog.filter((p) => {
      const pCat = normalizeCategory(p.category || "");
      const pCats = Array.isArray(p.categories) ? p.categories.map(normalizeCategory) : [];
      return pCat === clean || pCats.includes(clean);
    });
  }, [backendCatalog, category, liveTurnProducts]);

  const product = useMemo(() => {
    const catalog = backendCatalog.length > 0 ? backendCatalog : PRODUCTS;
    return (
      catalog.find((p) => p.id === productId || p.sku === productId) ||
      products[0] ||
      catalog[0]
    );
  }, [backendCatalog, productId, products]);

  return {
    // product/UI
    caption,
    speechId,
    category,
    categories,
    product,
    products,
    name,
    // conv state
    convState,         // "IDLE"|"ATTENTIVE"|"LISTENING"|"THINKING"|"SPEAKING"
    // speech
    speaking,
    listening: deepgram.listening || listening,
    liveTranscript: deepgram.liveTranscript || liveTranscript,
    lastUserSpeech,
    userSpeaking,      // fused
    evidence,          // "audio"|"face"|"both"|"none"
    speakingForMs,
    silentForMs,
    audioLevel,
    vadSpeech,
    // face
    signals,
    // presence
    presence,
    // actions & flow commands
    send,
    selectCategory,
    selectProduct,
    submitName,
    skipName,
    showAll,
    navigateBack,
    restartSession,
    backendAction,
    showDetail,
    setShowDetail,
    enquire,
    // automation & server action screen director
    onboardingOpen,
    setOnboardingOpen,
    onboardingStep,
    setOnboardingStep,
    handleServerAction,
    // avatar wiring
    setStageRef,
    handleSpeakingChange,
    setSpeaking,
    // PTT fallback
    showPTT,
    micError,
  };
}
