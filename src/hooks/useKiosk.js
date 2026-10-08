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

import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCTS } from "@/data/products";
import { GREETING, describeProduct, productsIn, replyAsync } from "@/lib/agent";
import { usePresenceDetection } from "@/lib/presence/usePresenceDetection";
import { useUserSignals } from "@/hooks/useUserSignals";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useUserSpeechState } from "@/hooks/useUserSpeechState";
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

  // ── Presence detection ────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setName("");
    setCategory("all");
    setProductId(PRODUCTS[0].id);
    setCaption(GREETING);
    sessionIdRef.current = "kiosk-" + Math.random().toString(36).substring(2, 9);
    setSpeechId((p) => p + 1);
    setConv(S.IDLE);
    pendingTranscriptRef.current = "";
    setLastUserSpeech("");
    setLiveTranscript("");
    failureCountRef.current = 0;
    setShowPTT(false);
  }, [setConv]);

  const presence = usePresenceDetection({
    onEnterEngaged: useCallback(() => {
      reset();
      setCaption(GREETING);
      setSpeechId((p) => p + 1);
      setConv(S.ATTENTIVE);
    }, [reset, setConv]),
    onExitToIdle: useCallback(() => {
      reset();
    }, [reset]),
  });

  const isEngaged = presence.state === "ENGAGED";

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

  // ── Audio capture (always open while engaged) ─────────────────────────────
  const { audioLevel, vadSpeech, micError, streamRef } = useAudioCapture({ isEngaged });

  // ── Fused speech state ────────────────────────────────────────────────────
  const { userSpeaking, evidence, speakingForMs, silentForMs } =
    useUserSpeechState({ vadSpeech, audioLevel, face });

  const userSpeakingRef = useRef(userSpeaking);
  userSpeakingRef.current = userSpeaking;

  // ── Avatar control helpers (set from AvatarPanel via callbacks) ────────────
  const stageRef = useRef(null); // will be set by AvatarPanel
  const setStageRef = useCallback((ref) => { stageRef.current = ref; }, []);

  // ── Interrupt avatar speech ────────────────────────────────────────────────
  const interruptAvatar = useCallback(() => {
    abortRef.current?.abort();
    stageRef.current?.stop();
    setSpeaking(false);
  }, []);

  // ── Say something (queues new caption + increments speechId) ─────────────
  const say = useCallback((text) => {
    if (userSpeakingRef.current) return; // never speak over the user
    setCaption(text);
    setSpeechId((p) => p + 1);
  }, []);

  // ── Core: send transcript to AI ───────────────────────────────────────────
  const nameRef = useRef(name);
  nameRef.current = name;

  const sendTranscript = useCallback(async (text, signalsSnap) => {
    setConv(S.THINKING);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const data = await replyAsync({
        text: String(text ?? ""),
        name: String(nameRef.current ?? ""),
        sessionId: sessionIdRef.current,
        signals: signalsSnap,
        signal: abortRef.current.signal,
      });

      if (!data || !data.message) {
        setConv(S.ATTENTIVE);
        return;
      }

      if (data.name) setName(data.name);
      if (data.sessionId) sessionIdRef.current = data.sessionId;

      const a = data.action;
      if (a?.category) {
        setCategory(a.category);
        const items = productsIn(a.category);
        if (items.length > 0) setProductId(items[0].id);
      }
      if (a?.type === "SHOW_PRODUCT" && a.productId) setProductId(a.productId);

      if (!userSpeakingRef.current) {
        setConv(S.SPEAKING);
        say(data.message);
      }
    } catch (err) {
      if (err?.name === "AbortError") return; // user interrupted
      console.error("[Kiosk] AI backend error:", err);
      setConv(S.ATTENTIVE);
    }
  }, [say, setConv]);

  // ── End-of-turn logic ─────────────────────────────────────────────────────
  const finaliseAndSend = useCallback(() => {
    clearTimeout(eotTimerRef.current);
    const text = pendingTranscriptRef.current.trim();
    if (text) {
      setLastUserSpeech(text);
    }
    pendingTranscriptRef.current = "";
    setLiveTranscript("");

    if (!text && evidence !== "none" && !vadSpeech) {
      // Face said they were speaking but we got nothing — re-prompt
      failureCountRef.current += 1;
      if (failureCountRef.current >= speechConfig.failuresBeforePTT) {
        setShowPTT(true);
      }
      say("I am here — could you say that once more?");
      setConv(S.ATTENTIVE);
      return;
    }

    if (!text) {
      setConv(S.ATTENTIVE);
      return;
    }

    failureCountRef.current = 0;
    sendTranscript(text, signals);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence, say, sendTranscript, setConv, signals, vadSpeech]);

  const finaliseAndSendRef = useRef(finaliseAndSend);
  finaliseAndSendRef.current = finaliseAndSend;

  // ── React to userSpeaking changes ─────────────────────────────────────────
  useEffect(() => {
    if (!isEngaged) return;

    if (userSpeaking) {
      // ① Interrupt avatar if it is speaking
      if (convStateRef.current === S.SPEAKING) {
        interruptAvatar();
      }

      // ② Cancel any pending end-of-turn countdown
      clearTimeout(eotTimerRef.current);

      // ③ Enter LISTENING
      setConv(S.LISTENING);
      setListening(true);

      // ④ Clear low-audio nudge timer
      clearTimeout(lowAudioTimerRef.current);
    } else {
      setListening(false);

      if (convStateRef.current === S.LISTENING) {
        // Start end-of-turn countdown
        clearTimeout(eotTimerRef.current);
        eotTimerRef.current = setTimeout(finaliseAndSend, speechConfig.endOfTurnSilenceMs);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSpeaking, isEngaged]);

  // ── Low-audio nudge: face says speaking but mic stays quiet ──────────────
  useEffect(() => {
    clearTimeout(lowAudioTimerRef.current);

    if (
      face.present &&
      face.lookingAtScreen &&
      !vadSpeech &&
      audioLevel < speechConfig.audioLevelThreshold &&
      convStateRef.current === S.LISTENING
    ) {
      lowAudioTimerRef.current = setTimeout(() => {
        if (!userSpeakingRef.current && convStateRef.current === S.LISTENING) {
          say(
            "I can see you are speaking, but I cannot hear you clearly. " +
            "Please speak a little closer to the microphone."
          );
        }
      }, speechConfig.lowAudioWithFaceMs);
    }

    return () => clearTimeout(lowAudioTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face.present, face.lookingAtScreen, vadSpeech, audioLevel]);

  // ── Native Windows STT (via Electron IPC bridge) ─────────────────────────
  useEffect(() => {
    if (!isEngaged || typeof window === "undefined" || !window.kiosk?.onSpeechHypothesis) {
      return;
    }

    console.log("[STT] Native Windows Speech Bridge active");

    const unHypo = window.kiosk.onSpeechHypothesis((text) => {
      if (convStateRef.current === S.SPEAKING && !userSpeakingRef.current) return;
      if (text) {
        setLiveTranscript(text);
      }
    });

    const unFinal = window.kiosk.onSpeechFinal((text) => {
      if (convStateRef.current === S.SPEAKING && !userSpeakingRef.current) return;
      if (text && text.trim()) {
        console.log("[STT Native Final]:", text);
        pendingTranscriptRef.current = (pendingTranscriptRef.current + " " + text).trim();
        setLiveTranscript(pendingTranscriptRef.current);
        finaliseAndSendRef.current?.();
      }
    });

    return () => {
      unHypo?.();
      unFinal?.();
    };
  }, [isEngaged]);

  // ── Web Speech API — browser fallback (feeds pendingTranscriptRef) ────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    // If native kiosk STT is supported, skip Web Speech API to avoid duplicate recognition / network errors
    if (window.kiosk?.onSpeechHypothesis) return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRec) {
      console.warn("[STT] SpeechRecognition API not available in this context");
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

    rec.onresult = (event) => {
      if (convStateRef.current === S.SPEAKING && !userSpeakingRef.current) return;

      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) {
          pendingTranscriptRef.current += " " + t;
        } else {
          interim = t;
        }
      }
      setLiveTranscript(
        (pendingTranscriptRef.current + " " + interim).trim()
      );
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        stopped = true;
      }
    };

    rec.onend = () => {
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
      try { rec.stop(); } catch (_) {}
    };
  }, [isEngaged]);

  // ── Avatar speaking → update conv state & mute STT ───────────────────────
  const handleSpeakingChange = useCallback((isSpeaking) => {
    setSpeaking(isSpeaking);
    try {
      window.kiosk?.setSpeechMuted?.(isSpeaking);
    } catch (_) {}
    if (!isSpeaking && convStateRef.current === S.SPEAKING) {
      setConv(S.ATTENTIVE);
    }
  }, [setConv]);

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

  // ── Touch / quick-reply helpers ───────────────────────────────────────────
  const selectCategory = useCallback((id) => {
    presence.triggerTouchEngaged();
    setCategory(id);
    const items = productsIn(id);
    if (items.length > 0) setProductId(items[0].id);
  }, [presence]);

  const selectProduct = useCallback((p) => {
    presence.triggerTouchEngaged();
    setProductId(p.id);
    say(describeProduct(p, name));
  }, [name, presence, say]);

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

  const product  = PRODUCTS.find((p) => p.id === productId) || PRODUCTS[0];
  const products = productsIn(category);

  return {
    // product/UI
    caption,
    speechId,
    category,
    product,
    products,
    name,
    // conv state
    convState,         // "IDLE"|"ATTENTIVE"|"LISTENING"|"THINKING"|"SPEAKING"
    // speech
    speaking,
    listening,
    liveTranscript,
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
    // actions
    send,
    selectCategory,
    selectProduct,
    enquire,
    // avatar wiring
    setStageRef,
    handleSpeakingChange,
    setSpeaking,
    // PTT fallback
    showPTT,
    micError,
  };
}
