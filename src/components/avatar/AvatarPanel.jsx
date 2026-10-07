"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import GreenieStage from "./GreenieStage";
import Captions from "./Captions";
import DebugOverlay from "@/components/debug/DebugOverlay";
import { preferredVoice } from "@/lib/avatar/voice";

export default function AvatarPanel({
  caption,
  speaking,
  onSpeakingChange,
  presenceState = "IDLE",
  onTap,
  videoRef,
  debugOpen,
  debugStats,
  config,
  onCalibrate,
  onCloseDebug,
  listening,
  signals = null,
}) {
  const isEngaged = presenceState === "ENGAGED";
  const attractVideoRef = useRef(null);
  const stageRef = useRef(null);
  const [avatarStatus, setAvatarStatus] = useState("Ready to chat");
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [spokenCharIndex, setSpokenCharIndex] = useState(0);
  const [showGrandLeaves, setShowGrandLeaves] = useState(false);
  const [customVoice, setCustomVoice] = useState(null);
  const customVoiceOptions = { pitch: 1.15, rate: 0.95 };

  const prevEngagedRef = useRef(false);
  const introTimerRef = useRef(null);
  const arrivedRef = useRef(false);
  const lastReactionRef = useRef(0);

  // Permanently lock Google हिन्दी · hi-IN female voice
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const initVoice = () => {
        const list = window.speechSynthesis.getVoices();
        if (list && list.length > 0) {
          const target = preferredVoice(list, "hi-IN");
          if (target) {
            setCustomVoice(target);
          }
        }
      };

      initVoice();
      window.speechSynthesis.onvoiceschanged = initVoice;
    }
  }, []);

  // 1. Promo Video — play only when IDLE (user not on screen), pause when ENGAGED
  useEffect(() => {
    const video = attractVideoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;

    const playVideo = () => {
      video.muted = true;
      video.play().catch(() => {});
    };

    if (!isEngaged) {
      video.currentTime = 0;
      playVideo();
    } else {
      video.pause();
    }

    video.addEventListener("loadeddata", playVideo);
    video.addEventListener("canplay", playVideo);
    video.addEventListener("ended", () => {
      video.currentTime = 0;
      playVideo();
    });

    return () => {
      video.removeEventListener("loadeddata", playVideo);
      video.removeEventListener("canplay", playVideo);
    };
  }, [isEngaged]);

  // 2. Immediate arrival sequence: Flying Entrance from left WHILE SPEAKING
  useEffect(() => {
    if (isEngaged && !prevEngagedRef.current) {
      arrivedRef.current = true;
      setShowGrandLeaves(true);
      clearTimeout(introTimerRef.current);

      const runArrivalSequence = () => {
        if (!stageRef.current) return;

        // Step 1: Immediately fly in from the left (1.8s) + 3D swirling leaf burst
        stageRef.current.flyIn(1.8);

        // Step 2: Speak greeting IMMEDIATELY as she flies in from the left
        if (caption) {
          stageRef.current.speak(caption, {
            voice: customVoice,
            pitch: customVoiceOptions.pitch,
            rate: customVoiceOptions.rate,
            lang: customVoice?.lang || "hi-IN",
          });
        }

        introTimerRef.current = setTimeout(() => setShowGrandLeaves(false), 3000);
      };

      // Run immediately without delays
      runArrivalSequence();

    } else if (!isEngaged) {
      arrivedRef.current = false;
      setShowGrandLeaves(false);
      clearTimeout(introTimerRef.current);
      if (stageRef.current) {
        stageRef.current.stop();
        stageRef.current.setEngaged(false);
      }
    }

    prevEngagedRef.current = isEngaged;
  }, [isEngaged, caption, customVoice, customVoiceOptions]);

  // 3. Caption updates after arrival → speak new captions
  const prevCaptionRef = useRef(null);
  useEffect(() => {
    if (
      isEngaged &&
      caption &&
      caption !== prevCaptionRef.current &&
      prevEngagedRef.current &&
      arrivedRef.current
    ) {
      if (stageRef.current && !isAvatarSpeaking) {
        stageRef.current.speak(caption, {
          voice: customVoice,
          pitch: customVoiceOptions.pitch,
          rate: customVoiceOptions.rate,
          lang: customVoice?.lang || "hi-IN",
        });
      }
    }
    prevCaptionRef.current = caption;
  }, [caption, isEngaged, isAvatarSpeaking, customVoice, customVoiceOptions]);

  // 4. Drive the ear-cupping listening pose in the 3D avatar
  useEffect(() => {
    if (stageRef.current) {
      stageRef.current.setListening(listening && !isAvatarSpeaking);
    }
  }, [listening, isAvatarSpeaking]);

  // 5. Signal-driven avatar reactions
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

  const handleSpeakingChange = useCallback(
    (speakingState) => {
      setIsAvatarSpeaking(speakingState);
      onSpeakingChange?.(speakingState);
    },
    [onSpeakingChange]
  );

  return (
    <section className="avatar-immersive" aria-label="GreenFibre Kiosk Display">
      {/* Webcam element */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "320px",
          height: "240px",
          opacity: 0.001,
          pointerEvents: "none",
          zIndex: -1,
        }}
        width={320}
        height={240}
      />

      {/* ── ATTRACT SCREEN (IDLE — nobody near) ── */}
      <div
        className={`kiosk-layer attract-layer ${
          !isEngaged ? "kiosk-layer--active" : "kiosk-layer--hidden"
        }`}
        onClick={onTap}
        role="button"
        tabIndex={0}
      >
        <video
          ref={attractVideoRef}
          src="/videos/promo.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
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

      {/* ── GREENIE AVATAR SCREEN (ENGAGED — person detected) ── */}
      <div
        className={`kiosk-layer greenie-layer ${
          isEngaged ? "kiosk-layer--active" : "kiosk-layer--hidden"
        }`}
      >
        {/* Grand Opening Floating Leaves Celebration */}
        {showGrandLeaves && (
          <div className="grand-opening-leaves-container" aria-hidden="true">
            {[...Array(14)].map((_, i) => (
              <span
                key={i}
                className="floating-eco-leaf"
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

        {/* 3D Greenie Canvas (With Botanical Studio Stage Background & Fairy Wings) */}
        <GreenieStage
          ref={stageRef}
          isEngaged={isEngaged}
          onStatus={setAvatarStatus}
          onSpeakingChange={handleSpeakingChange}
          onBoundary={setSpokenCharIndex}
        />

        {/* Dynamic Subtitles In Perfect Sync with Speech */}
        <div className="greenie-bottom-overlay">
          <Captions
            text={caption}
            speaking={isAvatarSpeaking || speaking}
            status={avatarStatus}
            charIndex={spokenCharIndex}
          />
        </div>
      </div>

      {/* Debug Overlay (Ctrl+Shift+D) */}
      {debugOpen && (
        <DebugOverlay
          stats={debugStats}
          config={config}
          state={presenceState}
          signals={signals}
          onCalibrate={onCalibrate}
          onClose={onCloseDebug}
        />
      )}
    </section>
  );
}
