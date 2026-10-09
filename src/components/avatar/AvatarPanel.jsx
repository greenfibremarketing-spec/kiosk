"use client";
/**
 * AvatarPanel.jsx (v2)
 * Wires the conversation state machine into the 3-D avatar:
 *   - Drives setExpression("listening"|"thinking"|"speaking"|"attentive")
 *   - Shows a pulsing "Listening" indicator while LISTENING
 *   - Passes full debug props to DebugOverlay
 *   - Forwards stageRef back to useKiosk via setStageRef
 */
import { useEffect, useRef, useState, useCallback } from "react";
import GreenieStage from "./GreenieStage";
import Captions from "@/components/avatar/Captions";
import DebugOverlay from "@/components/debug/DebugOverlay";
import LiveSpeechTester from "@/components/debug/LiveSpeechTester";
import { preferredVoice } from "@/lib/avatar/voice";
import VoiceHUD from "./VoiceHUD";

const CUSTOM_VOICE_OPTIONS = { pitch: 1.15, rate: 0.95 };

export default function AvatarPanel({
  caption,
  speechId = 0,
  speaking,
  onSpeakingChange,
  presenceState = "IDLE",
  convState = "IDLE",
  userSpeaking = false,
  onTap,
  videoRef,
  debugOpen,
  debugStats,
  config,
  onCalibrate,
  onCloseDebug,
  listening,
  liveTranscript = "",
  lastUserSpeech = "",
  onToggleMic,
  signals = null,
  onQuickPick,
  setStageRef,
  // debug extras
  vadSpeech,
  audioLevel,
  micError,
  evidence,
  speakingForMs,
  silentForMs,
}) {
  const isEngaged = presenceState === "ENGAGED";
  const attractVideoRef = useRef(null);
  const stageRef = useRef(null);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [spokenCharIndex, setSpokenCharIndex] = useState(0);
  const [showGrandLeaves, setShowGrandLeaves] = useState(false);
  const [customVoice, setCustomVoice] = useState(null);

  const prevEngagedRef = useRef(false);
  const introTimerRef  = useRef(null);
  const arrivedRef     = useRef(false);
  const lastReactionRef = useRef(0);

  // Forward stageRef to useKiosk so it can interrupt avatar
  const stageCallbackRef = useCallback((node) => {
    stageRef.current = node;
    setStageRef?.(node);
  }, [setStageRef]);

  // ── Preferred voice init ─────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const initVoice = () => {
      const list = window.speechSynthesis.getVoices();
      if (list?.length > 0) {
        const target = preferredVoice(list, "en-IN");
        if (target) setCustomVoice(target);
      }
    };
    initVoice();
    window.speechSynthesis.onvoiceschanged = initVoice;
  }, []);

  // ── Promo attract video ──────────────────────────────────────────────────
  useEffect(() => {
    const video = attractVideoRef.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    const play = () => { video.muted = true; video.play().catch(() => {}); };
    if (!isEngaged) { video.currentTime = 0; play(); }
    else { video.pause(); }
    video.addEventListener("loadeddata", play);
    video.addEventListener("canplay", play);
    video.addEventListener("ended", () => { video.currentTime = 0; play(); });
    return () => {
      video.removeEventListener("loadeddata", play);
      video.removeEventListener("canplay", play);
    };
  }, [isEngaged]);

  // ── Arrival sequence ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isEngaged && !prevEngagedRef.current) {
      arrivedRef.current = true;
      setShowGrandLeaves(true);
      clearTimeout(introTimerRef.current);
      if (stageRef.current) {
        stageRef.current.flyIn(1.8);
        if (caption) {
          stageRef.current.speak(caption, {
            voice: customVoice,
            pitch: CUSTOM_VOICE_OPTIONS.pitch,
            rate: CUSTOM_VOICE_OPTIONS.rate,
            lang: customVoice?.lang || "en-IN",
          });
        }
      }
      introTimerRef.current = setTimeout(() => setShowGrandLeaves(false), 3000);
    } else if (!isEngaged) {
      arrivedRef.current = false;
      setShowGrandLeaves(false);
      clearTimeout(introTimerRef.current);
      stageRef.current?.stop();
      stageRef.current?.setEngaged(false);
    }
    prevEngagedRef.current = isEngaged;
  }, [isEngaged, caption, customVoice]);

  // ── Caption / speechId change → speak ────────────────────────────────────
  const prevSpeechIdRef = useRef(speechId);
  const prevCaptionRef  = useRef(caption);
  useEffect(() => {
    const changed = speechId !== prevSpeechIdRef.current || caption !== prevCaptionRef.current;
    if (caption && changed && !userSpeaking && isEngaged) {
      stageRef.current?.speak(caption, {
        voice: customVoice,
        pitch: CUSTOM_VOICE_OPTIONS.pitch,
        rate: CUSTOM_VOICE_OPTIONS.rate,
        lang: customVoice?.lang || "en-IN",
      });
    }
    prevSpeechIdRef.current = speechId;
    prevCaptionRef.current  = caption;
  }, [caption, speechId, customVoice, userSpeaking, isEngaged]);

  // ── Drive avatar expressions from convState ────────────────────────────────
  useEffect(() => {
    if (!stageRef.current) return;
    const s = stageRef.current;

    switch (convState) {
      case "LISTENING":
        s.setListening(true);
        s.setExpression?.("listening");
        break;

      case "THINKING":
        s.setListening(false);
        s.setExpression?.("thinking");
        break;

      case "SPEAKING":
        s.setListening(false);
        s.setExpression?.("speaking");
        break;

      default: // IDLE, ATTENTIVE
        s.setListening(false);
        s.setExpression?.("attentive");
        break;
    }
  }, [convState]);

  // ── Listening pose via setListening (legacy bridge) ───────────────────────
  useEffect(() => {
    stageRef.current?.setListening(listening && !isAvatarSpeaking);
  }, [listening, isAvatarSpeaking]);

  // ── Emotion reactions ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!signals || !stageRef.current || isAvatarSpeaking) return;
    const now = Date.now();
    if (now - lastReactionRef.current < 8000) return;
    if (signals.smile > 0.65) {
      lastReactionRef.current = now;
      stageRef.current.react("blush");
    } else if (signals.confused > 0.55 && signals.attention === "screen") {
      lastReactionRef.current = now;
      stageRef.current.react("wink");
    }
  }, [signals, isAvatarSpeaking]);

  const handleSpeakingChange = useCallback((s) => {
    setIsAvatarSpeaking(s);
    onSpeakingChange?.(s);
  }, [onSpeakingChange]);

  return (
    <section className="avatar-immersive" aria-label="GreenFibre Kiosk Display">
      {/* Webcam element (hidden, used by MediaPipe) */}
      <video
        ref={videoRef}
        playsInline muted autoPlay
        style={{
          position: "fixed", top: 0, left: 0,
          width: "320px", height: "240px",
          opacity: 0.001, pointerEvents: "none", zIndex: -1,
        }}
        width={320} height={240}
      />

      {/* ── ATTRACT SCREEN ── */}
      <div
        className={`kiosk-layer attract-layer ${!isEngaged ? "kiosk-layer--active" : "kiosk-layer--hidden"}`}
        onClick={onTap} role="button" tabIndex={0}
      >
        <video
          ref={attractVideoRef} src="/videos/promo.mp4"
          autoPlay loop muted playsInline preload="auto"
          className="attract-video"
        />
        <div className="attract-gradient-overlay" />
        <div className="attract-top-brand">
          <span className="attract-brand-badge">🌾 GREENFIBRE</span>
        </div>
        <div className="attract-bottom-cta">
          <div className="attract-tap-hint">✨ Touch Screen or Step Closer to Begin</div>
        </div>
      </div>

      {/* ── GREENIE AVATAR SCREEN ── */}
      <div className={`kiosk-layer greenie-layer ${isEngaged ? "kiosk-layer--active" : "kiosk-layer--hidden"}`}>
        {showGrandLeaves && (
          <div className="grand-opening-leaves-container" aria-hidden="true">
            {[...Array(14)].map((_, i) => (
              <span
                key={i} className="floating-eco-leaf"
                style={{
                  left: `${(i * 7.5 + Math.random() * 5) % 95}%`,
                  animationDelay: `${(i * 0.18).toFixed(2)}s`,
                  animationDuration: `${(2.2 + (i % 4) * 0.4).toFixed(2)}s`,
                  fontSize: `${18 + (i % 3) * 8}px`,
                }}
              >
                {i % 3 === 0 ? "🍃" : i % 3 === 1 ? "🌿" : "✨"}
              </span>
            ))}
          </div>
        )}

        {/* Live Speech Testing Monitor (visible in debug mode) */}
        {debugOpen && (
          <LiveSpeechTester
            liveTranscript={liveTranscript}
            lastUserSpeech={lastUserSpeech}
            userSpeaking={userSpeaking}
            vadSpeech={vadSpeech}
            audioLevel={audioLevel}
            evidence={evidence}
            convState={convState}
          />
        )}

        <GreenieStage
          ref={stageCallbackRef}
          isEngaged={isEngaged}
          onStatus={() => {}}
          onSpeakingChange={handleSpeakingChange}
          onBoundary={setSpokenCharIndex}
        />

        {/* Unified Bottom Overlay for Subtitles & Voice HUD */}
        <div className="greenie-bottom-overlay">
          {/* Dynamic Subtitles / Captions (Positioned neatly above the VoiceHUD) */}
          <Captions
            text={caption}
            speaking={isAvatarSpeaking || speaking}
            status={isAvatarSpeaking ? "Explaining..." : convState === "LISTENING" ? "Listening..." : "Ready to chat"}
            charIndex={spokenCharIndex}
          />

          {/* Integrated Voice HUD / Microphone Bar */}
          <VoiceHUD
            listening={listening}
            speaking={isAvatarSpeaking || speaking}
            liveTranscript={liveTranscript}
            userSpeaking={userSpeaking}
            convState={convState}
            onToggleMic={onToggleMic}
            micError={micError}
            audioLevel={audioLevel}
          />
        </div>
      </div>

      {/* Debug Overlay (Ctrl+Shift+D) */}
      {debugOpen && (
        <DebugOverlay
          stats={debugStats}
          config={config}
          state={presenceState}
          convState={convState}
          signals={signals}
          vadSpeech={vadSpeech}
          audioLevel={audioLevel}
          userSpeaking={userSpeaking}
          evidence={evidence}
          speakingForMs={speakingForMs}
          silentForMs={silentForMs}
          onCalibrate={onCalibrate}
          onClose={onCloseDebug}
        />
      )}
    </section>
  );
}
