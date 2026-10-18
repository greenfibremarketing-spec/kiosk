"use client";
/**
 * AvatarPanel.jsx (v2)
 * Wires the conversation state machine into the 3-D avatar:
 *   - Drives setExpression("listening"|"thinking"|"speaking"|"attentive")
 *   - Shows a pulsing "Listening" indicator while LISTENING
 *   - Passes full debug props to DebugOverlay
 *   - Forwards stageRef back to useKiosk via setStageRef
 *   - Anchors Greenie small on the bottom-right with transparent canvas
 *   - Anchors VoiceHUD on the bottom-left
 *   - Anchors Speech Bubble floating above Greenie
 */
import { useEffect, useRef, useState, useCallback } from "react";
import GreenieStage from "./GreenieStage";
import Captions from "@/components/avatar/Captions";
import DebugOverlay from "@/components/debug/DebugOverlay";
import LiveSpeechTester from "@/components/debug/LiveSpeechTester";
import { preferredVoice } from "@/lib/avatar/voice";

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
  backendAction = null,
  onSkipName = null,
  onSubmitName = null,
  setStageRef,
  showDetail = false,
  isPairUpOpen = false,
  // debug extras
  vadSpeech,
  audioLevel,
  micError,
  evidence,
  speakingForMs,
  silentForMs,
  showSubtitles = true,
}) {
  const isEngaged = presenceState === "ENGAGED";
  const stageRef = useRef(null);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [spokenCharIndex, setSpokenCharIndex] = useState(0);
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

  // ── Arrival sequence ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isEngaged && !prevEngagedRef.current) {
      arrivedRef.current = true;
      clearTimeout(introTimerRef.current);
      if (stageRef.current) {
        stageRef.current.flyIn(1.8);
      }
    } else if (!isEngaged) {
      arrivedRef.current = false;
      clearTimeout(introTimerRef.current);
      stageRef.current?.stop();
      stageRef.current?.setEngaged(false);
    }
    prevEngagedRef.current = isEngaged;
  }, [isEngaged]);

  // ── Caption / speechId change: updates subtitle text ONLY (never plays audio) ──
  const [activeChunkText, setActiveChunkText] = useState("");
  const prevSpeechIdRef = useRef(null);
  const prevCaptionRef  = useRef(null);

  // Reset refs on fresh session or reset (speechId <= 1)
  useEffect(() => {
    if (speechId <= 1) {
      prevSpeechIdRef.current = null;
      prevCaptionRef.current = null;
      setActiveChunkText("");
    }
  }, [speechId]);

  useEffect(() => {
    const changed = speechId !== prevSpeechIdRef.current || caption !== prevCaptionRef.current;
    if (!changed) return;

    prevSpeechIdRef.current = speechId;
    prevCaptionRef.current  = caption;
  }, [caption, speechId]);

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
    if (!s) {
      setActiveChunkText("");
    }
    onSpeakingChange?.(s);
  }, [onSpeakingChange]);

  return (
    <div className="avatar-immersive-root" aria-label="GreenFibre Avatar Overlay">
      {/* Webcam element (hidden, used by MediaPipe) */}
      <video
        ref={videoRef}
        playsInline muted autoPlay
        style={{
          position: "fixed", top: 0, left: 0,
          width: "2px", height: "2px",
          opacity: 0, pointerEvents: "none", zIndex: -1,
        }}
        width={2} height={2}
      />

      {/* Camera Privacy Notice fixed at bottom center (hidden when pair-up modal is open) */}
      {!isPairUpOpen && (
        <div className="camera-privacy-notice-fixed" aria-label="Privacy Notice">
          Camera is used only to detect presence. Nothing is saved or sent anywhere.
        </div>
      )}

      {/* Floating Greenie Anchor - anchored bottom-right, transparent, pointer-events: none */}
      <div
        className={`greenie-avatar-anchor ${showDetail ? "greenie-avatar-anchor--pdp" : ""}`}
        style={{ display: isEngaged ? "block" : "none", pointerEvents: "none" }}
      >
        <GreenieStage
          ref={stageCallbackRef}
          isEngaged={isEngaged}
          onStatus={() => {}}
          onSpeakingChange={handleSpeakingChange}
          onBoundary={setSpokenCharIndex}
          onChunk={setActiveChunkText}
        />
      </div>

      {/* Speech Bubble floating above Greenie (visible whenever engaged and subtitles enabled) */}
      {isEngaged && showSubtitles && (
        <Captions
          text={caption}
          activeChunkText={activeChunkText}
          speaking={isAvatarSpeaking || speaking}
          status={isAvatarSpeaking ? "Explaining..." : convState === "LISTENING" ? "Listening..." : "Ready to chat"}
          charIndex={spokenCharIndex}
          showDetail={showDetail}
        />
      )}

      {/* User Voice-to-Text Transcript Bubble (Bottom-Left; hidden if showSubtitles is false) */}
      {isEngaged && showSubtitles && (
        <UserTranscriptBubble
          liveTranscript={liveTranscript}
          lastUserSpeech={lastUserSpeech}
        />
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
    </div>
  );
}

function UserTranscriptBubble({ liveTranscript = "", lastUserSpeech = "" }) {
  const [holdingFinal, setHoldingFinal] = useState("");
  const holdTimerRef = useRef(null);

  useEffect(() => {
    if (liveTranscript) {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      setHoldingFinal("");
    } else if (lastUserSpeech) {
      setHoldingFinal(lastUserSpeech);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        setHoldingFinal("");
      }, 2500);
    }
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, [liveTranscript, lastUserSpeech]);

  const activeText = liveTranscript || holdingFinal;
  if (!activeText) return null;

  return (
    <div className="voice-hud-fixed-container" style={{ pointerEvents: "none" }}>
      <div
        className="live-transcript-bubble"
        style={{
          background: "rgba(6, 24, 14, 0.95)",
          border: "1.5px solid rgba(74, 222, 128, 0.7)",
          borderRadius: "18px",
          padding: "8px 18px",
          color: "#ffffff",
          fontSize: "13.5px",
          fontWeight: "600",
          maxWidth: "94%",
          textAlign: "center",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4), 0 0 16px rgba(34, 197, 94, 0.3)",
          backdropFilter: "blur(16px)",
          animation: "fadeIn 0.15s ease-out",
        }}
      >
        <span style={{ color: "#4ade80", marginRight: "6px", fontWeight: "700" }}>🗣️ You:</span>
        <span style={{ color: "#fef08a" }}>"{activeText}"</span>
      </div>
    </div>
  );
}
