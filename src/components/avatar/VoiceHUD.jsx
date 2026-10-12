"use client";
import React, { useState, useRef, useEffect } from "react";

/**
 * VoiceHUD.jsx — Production-ready Voice Status Bar
 * • Real-time audio level visualization bars
 * • Clear state feedback: Listening / Thinking / Speaking / Ready
 * • Quick text input form for typing questions
 * • Elegant glassmorphism design matching GreenFibre identity
 */
export default function VoiceHUD({
  listening = false,
  speaking = false,
  liveTranscript = "",
  userSpeaking = false,
  convState = "ATTENTIVE",
  onToggleMic,
  micError = null,
  audioLevel = 0,
  onQuickPick = null,
}) {
  const [typedQuestion, setTypedQuestion] = useState("");
  const inputRef = useRef(null);

  const isListening = userSpeaking || listening || convState === "LISTENING";
  const isThinking  = convState === "THINKING";
  const isSpeaking  = speaking || convState === "SPEAKING";
  const isError     = !!micError;
  const isIdle      = !isListening && !isThinking && !isSpeaking && !isError;

  // Compute audio bar heights from audioLevel (0–1)
  const barCount = 5;
  const bars = Array.from({ length: barCount }, (_, i) => {
    const center = Math.abs(i - Math.floor(barCount / 2)) / Math.floor(barCount / 2);
    const baseHeight = 6 + (1 - center) * 8;
    const dynamic = isListening && audioLevel > 0.005
      ? Math.min(32, baseHeight + audioLevel * 80 * (0.6 + Math.random() * 0.8))
      : isThinking
      ? baseHeight + Math.sin(Date.now() / 300 + i) * 5
      : baseHeight;
    return Math.max(4, Math.round(dynamic));
  });

  // Resolve display state
  let statusLabel = "Tap to speak";
  let statusSub   = "or type below";
  let pillBg      = "rgba(10, 26, 16, 0.92)";
  let borderColor = "rgba(34, 197, 94, 0.35)";
  let orbGrad     = "linear-gradient(135deg, #15803d, #22c55e)";
  let barColor    = "#4ade80";
  let glowColor   = "rgba(34, 197, 94, 0.35)";

  if (isError) {
    statusLabel = "Mic Unavailable";
    statusSub   = "Type your question below";
    pillBg      = "rgba(36, 10, 10, 0.94)";
    borderColor = "rgba(239, 68, 68, 0.6)";
    orbGrad     = "linear-gradient(135deg, #dc2626, #ef4444)";
    barColor    = "#f87171";
    glowColor   = "rgba(239, 68, 68, 0.4)";
  } else if (isSpeaking) {
    statusLabel = "Greenie is speaking";
    statusSub   = "Tap to interrupt";
    pillBg      = "rgba(10, 28, 18, 0.94)";
    borderColor = "rgba(16, 185, 129, 0.55)";
    orbGrad     = "linear-gradient(135deg, #059669, #10b981)";
    barColor    = "#34d399";
    glowColor   = "rgba(16, 185, 129, 0.45)";
  } else if (isListening) {
    statusLabel = "Listening...";
    statusSub   = "Speak clearly";
    pillBg      = "rgba(0, 36, 16, 0.96)";
    borderColor = "#22c55e";
    orbGrad     = "linear-gradient(135deg, #00A63E, #22c55e)";
    barColor    = "#4ade80";
    glowColor   = "rgba(34, 197, 94, 0.65)";
  } else if (isThinking) {
    statusLabel = "Thinking...";
    statusSub   = "Processing your question";
    pillBg      = "rgba(28, 24, 8, 0.94)";
    borderColor = "rgba(234, 179, 8, 0.55)";
    orbGrad     = "linear-gradient(135deg, #ca8a04, #eab308)";
    barColor    = "#fbbf24";
    glowColor   = "rgba(234, 179, 8, 0.4)";
  }

  const handleSendTyped = (e) => {
    e?.preventDefault();
    const q = typedQuestion.trim();
    if (q) {
      onQuickPick?.(q);
      setTypedQuestion("");
    }
  };

  return (
    <div
      className="voice-hud-container"
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        pointerEvents: "auto",
        userSelect: "none",
        zIndex: 25,
      }}
    >
      {/* ── Live Transcript Bubble ── */}
      {liveTranscript && (
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
          <span style={{ color: "#fef08a" }}>"{liveTranscript}"</span>
        </div>
      )}

      {/* ── Main Control Bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", maxWidth: "96%" }}>

        {/* Voice Status Pill */}
        <div
          className="voice-control-bar"
          onClick={isSpeaking ? onToggleMic : undefined}
          role="button"
          tabIndex={0}
          aria-label={statusLabel}
          onKeyDown={(e) => e.key === "Enter" && isSpeaking && onToggleMic?.()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            background: pillBg,
            border: `1.5px solid ${borderColor}`,
            borderRadius: "999px",
            padding: "7px 16px 7px 9px",
            boxShadow: `0 0 18px ${glowColor}, 0 8px 24px rgba(0,0,0,0.4)`,
            backdropFilter: "blur(18px)",
            cursor: isSpeaking ? "pointer" : "default",
            transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            minWidth: "180px",
          }}
        >
          {/* Mic Orb with ring pulse */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {(isListening || isIdle) && (
              <span
                style={{
                  position: "absolute",
                  inset: "-4px",
                  borderRadius: "50%",
                  background: isListening
                    ? `rgba(34, 197, 94, ${0.25 + audioLevel * 0.6})`
                    : "rgba(34, 197, 94, 0.15)",
                  animation: isListening
                    ? "pulseListenRing 1.1s ease-in-out infinite"
                    : "pulseOnlineRing 3s ease-in-out infinite",
                  pointerEvents: "none",
                }}
              />
            )}
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: orbGrad,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 2px 10px rgba(0,0,0,0.35), 0 0 12px ${glowColor}`,
                flexShrink: 0,
              }}
            >
              {isThinking ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
                </svg>
              ) : isSpeaking ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              )}
            </div>
          </div>

          {/* Audio Level Bars + Status */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: "#f8fafc", letterSpacing: "0.2px", lineHeight: 1.2 }}>
              {statusLabel}
            </span>
            {/* Animated audio waveform bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "16px" }}>
              {bars.map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: "3px",
                    height: `${h}px`,
                    background: barColor,
                    borderRadius: "2px",
                    opacity: isListening ? 0.9 : isThinking ? 0.7 : 0.45,
                    transition: isListening ? "height 0.08s ease" : "height 0.3s ease",
                  }}
                />
              ))}
              <span style={{
                fontSize: "10px",
                color: isListening ? "#4ade80" : "#94a3b8",
                marginLeft: "4px",
                lineHeight: 1,
                alignSelf: "center",
              }}>
                {statusSub}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Type & Ask Bar */}
        <form
          onSubmit={handleSendTyped}
          style={{
            display: "flex",
            alignItems: "center",
            background: "rgba(10, 26, 16, 0.92)",
            border: "1.5px solid rgba(34, 197, 94, 0.35)",
            borderRadius: "999px",
            padding: "4px 5px 4px 13px",
            backdropFilter: "blur(18px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            flex: 1,
            maxWidth: "200px",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a question..."
            value={typedQuestion}
            onChange={(e) => setTypedQuestion(e.target.value)}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#ffffff",
              fontSize: "11.5px",
              width: "100%",
              minWidth: 0,
            }}
          />
          <button
            type="submit"
            disabled={!typedQuestion.trim()}
            style={{
              background: typedQuestion.trim() ? "#22c55e" : "rgba(34, 197, 94, 0.25)",
              border: "none",
              color: "#052e16",
              width: "26px",
              height: "26px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: typedQuestion.trim() ? "pointer" : "default",
              fontWeight: "700",
              fontSize: "13px",
              flexShrink: 0,
              transition: "background 0.2s",
            }}
            aria-label="Send question"
          >
            ➔
          </button>
        </form>
      </div>

      <style jsx>{`
        @keyframes pulseListenRing {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.4); opacity: 0.1; }
        }
        @keyframes pulseOnlineRing {
          0%, 100% { transform: scale(1); opacity: 0.45; }
          50% { transform: scale(1.2); opacity: 0.08; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
