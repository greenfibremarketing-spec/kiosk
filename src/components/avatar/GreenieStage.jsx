"use client";
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { GreenieAvatar } from "@/lib/avatar/GreenieAvatar";

const GreenieStage = forwardRef(function GreenieStage(
  { onStatus, onSpeakingChange, onBoundary, isEngaged },
  ref
) {
  const containerRef = useRef(null);
  const avatarRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const onStatusRef = useRef(onStatus);
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  const onBoundaryRef = useRef(onBoundary);

  useEffect(() => {
    onStatusRef.current = onStatus;
    onSpeakingChangeRef.current = onSpeakingChange;
    onBoundaryRef.current = onBoundary;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let avatarInstance = null;
    try {
      avatarInstance = new GreenieAvatar(container, {
        modelUrl: "/avatar/greenie.glb",
        onStatus: (msg) => {
          onStatusRef.current?.(msg);
        },
        onSpeakingChange: (speaking) => {
          onSpeakingChangeRef.current?.(speaking);
        },
        onBoundary: (charIndex) => {
          onBoundaryRef.current?.(charIndex);
        },
      });

      avatarRef.current = avatarInstance;

      avatarInstance.ready
        .then(() => {
          setLoaded(true);
          if (isEngaged) {
            avatarInstance.setEngaged(true);
          }
        })
        .catch((err) => {
          console.error("Avatar initialization failed:", err);
          setLoadError("Unable to load 3D character");
        });
    } catch (e) {
      console.error("WebGL / Three.js error:", e);
      setLoadError("WebGL is not supported on this device.");
    }

    return () => {
      if (avatarInstance) {
        avatarInstance.dispose();
      }
      avatarRef.current = null;
    };
  }, []); // Run once on mount to keep WebGL context stable

  useEffect(() => {
    if (avatarRef.current) {
      avatarRef.current.setEngaged(isEngaged);
    }
  }, [isEngaged]);

  useImperativeHandle(
    ref,
    () => ({
      flyIn: (duration) => avatarRef.current?.flyIn(duration),
      speak: (text, options) => avatarRef.current?.speak(text, options),
      wave: (duration) => avatarRef.current?.wave(duration),
      react: (kind) => avatarRef.current?.react(kind),
      stop: () => avatarRef.current?.stop(),
      playSpeech: (url, cues) => avatarRef.current?.playSpeech(url, cues),
      setListening: (active) => avatarRef.current?.setListening(active),
      setEngaged: (engaged) => avatarRef.current?.setEngaged(engaged),
      setExpression: (name) => avatarRef.current?.setExpression(name),
      getInstance: () => avatarRef.current,
    }),
    []
  );

  return (
    <div className="greenie-stage-wrapper">
      {/* ── Rich Studio Botanical Background Stage ── */}
      <div className="stage-bg-backdrop" aria-hidden="true">
        {/* Soft Organic Color Glow Blobs */}
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />

        {/* Soft Blurred Depth Leaves */}
        <svg className="blurleaf" style={{ left: "-60px", top: "-30px", width: "300px", transform: "rotate(18deg)" }} viewBox="0 0 100 100">
          <path d="M10 90 Q5 30 55 8 Q95 40 70 85 Q40 100 10 90Z" fill="#4c9e55" />
        </svg>
        <svg className="blurleaf" style={{ right: "-70px", top: "90px", width: "260px", transform: "rotate(-30deg) scaleX(-1)" }} viewBox="0 0 100 100">
          <path d="M10 90 Q5 30 55 8 Q95 40 70 85 Q40 100 10 90Z" fill="#6bb35f" />
        </svg>
        <svg className="blurleaf" style={{ left: "-50px", bottom: "60px", width: "240px", transform: "rotate(60deg)" }} viewBox="0 0 100 100">
          <path d="M10 90 Q5 30 55 8 Q95 40 70 85 Q40 100 10 90Z" fill="#3f8f4b" />
        </svg>
        <svg className="blurleaf" style={{ right: "-40px", bottom: "-30px", width: "280px", transform: "rotate(-70deg)" }} viewBox="0 0 100 100">
          <path d="M10 90 Q5 30 55 8 Q95 40 70 85 Q40 100 10 90Z" fill="#4c9e55" />
        </svg>

        {/* Floating Glowing Bokeh Orbs */}
        <div className="bokeh" style={{ width: "70px", height: "70px", left: "12%", top: "22%" }} />
        <div className="bokeh" style={{ width: "44px", height: "44px", left: "78%", top: "34%", animationDelay: "-3s" }} />
        <div className="bokeh" style={{ width: "90px", height: "90px", left: "70%", top: "12%", animationDelay: "-5s" }} />
        <div className="bokeh" style={{ width: "36px", height: "36px", left: "22%", top: "52%", animationDelay: "-2s" }} />
        <div className="bokeh" style={{ width: "56px", height: "56px", left: "84%", top: "62%", animationDelay: "-6s" }} />
        <div className="bokeh" style={{ width: "30px", height: "30px", left: "8%", top: "72%", animationDelay: "-4s" }} />

        {/* Drifting Detailed Foreground Eco Leaves */}
        <svg className="leaf" style={{ "--r": "20deg", left: "18%", top: "16%", width: "34px", transform: "rotate(20deg)" }} viewBox="0 0 100 100">
          <path d="M10 90 Q5 30 55 8 Q95 40 70 85 Q40 100 10 90Z" fill="#7fc46b" />
          <path d="M14 88 Q40 55 58 14" stroke="#e8f5d6" strokeWidth="3" fill="none" />
        </svg>
        <svg className="leaf" style={{ "--r": "-25deg", left: "76%", top: "46%", width: "28px", animationDelay: "-4s", transform: "rotate(-25deg)" }} viewBox="0 0 100 100">
          <path d="M10 90 Q5 30 55 8 Q95 40 70 85 Q40 100 10 90Z" fill="#5fb056" />
          <path d="M14 88 Q40 55 58 14" stroke="#e8f5d6" strokeWidth="3" fill="none" />
        </svg>
        <svg className="leaf" style={{ "--r": "40deg", left: "10%", top: "60%", width: "26px", animationDelay: "-7s", transform: "rotate(40deg)" }} viewBox="0 0 100 100">
          <path d="M10 90 Q5 30 55 8 Q95 40 70 85 Q40 100 10 90Z" fill="#9bd47f" />
          <path d="M14 88 Q40 55 58 14" stroke="#f1fae4" strokeWidth="3" fill="none" />
        </svg>
        <svg className="leaf" style={{ "--r": "-10deg", left: "66%", top: "26%", width: "22px", animationDelay: "-2s", transform: "rotate(-10deg)" }} viewBox="0 0 100 100">
          <path d="M10 90 Q5 30 55 8 Q95 40 70 85 Q40 100 10 90Z" fill="#f2b97f" />
        </svg>

        {/* Studio Floor & Contact Shadow */}
        <div className="floor" />
        <div className="shadow" />
        <div className="vignette" />
      </div>

      {/* 3D Canvas Viewport */}
      <div
        ref={containerRef}
        className="greenie-canvas-viewport"
        aria-label="Greenie 3D Avatar"
      />

      {/* Loading / Error States */}
      {!loaded && !loadError && (
        <div className="greenie-loader-overlay">
          <div className="greenie-spinner" />
          <span>Waking up Greenie...</span>
        </div>
      )}

      {loadError && (
        <div className="greenie-error-banner">
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
});

export default GreenieStage;
