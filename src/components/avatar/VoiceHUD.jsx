"use client";
import React, { useState } from "react";

/**
 * VoiceHUD.jsx
 * Clean, minimal Voice Status Pill + Interactive Touch Flow & Question Suggestions
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

  const isListening = userSpeaking || listening || convState === "LISTENING";
  const isThinking  = convState === "THINKING";
  const isSpeaking  = speaking || convState === "SPEAKING";
  const isError     = !!micError;
  const isOnline    = !isError && (convState === "ATTENTIVE" || convState === "IDLE");

  // Dynamic visual parameters
  let title = "Microphone Ready";
  let barBg = "rgba(10, 26, 16, 0.92)";
  let borderStyle = "1.5px solid rgba(34, 197, 94, 0.35)";
  let orbShadow = "0 0 16px rgba(34, 197, 94, 0.35)";

  if (isError) {
    title = "Microphone Unavailable";
    barBg = "rgba(36, 10, 10, 0.94)";
    borderStyle = "1.5px solid rgba(239, 68, 68, 0.6)";
    orbShadow = "0 0 16px rgba(239, 68, 68, 0.4)";
  } else if (isSpeaking) {
    title = "Greenie is speaking...";
    barBg = "rgba(10, 28, 18, 0.94)";
    borderStyle = "1.5px solid rgba(16, 185, 129, 0.55)";
    orbShadow = "0 0 18px rgba(16, 185, 129, 0.45)";
  } else if (isListening) {
    title = "Listening to you...";
    barBg = "rgba(0, 36, 16, 0.96)";
    borderStyle = "2px solid #22c55e";
    orbShadow = "0 0 24px rgba(34, 197, 94, 0.6)";
  } else if (isThinking) {
    title = "Thinking...";
    barBg = "rgba(28, 24, 8, 0.94)";
    borderStyle = "1.5px solid rgba(234, 179, 8, 0.55)";
    orbShadow = "0 0 18px rgba(234, 179, 8, 0.4)";
  }

  const handleSendTyped = (e) => {
    e?.preventDefault();
    if (typedQuestion.trim()) {
      onQuickPick?.(typedQuestion.trim());
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
        gap: "10px",
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
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <span style={{ color: "#4ade80", marginRight: "6px", fontWeight: "700" }}>🗣️ You:</span>
          <span style={{ color: "#fef08a" }}>"{liveTranscript}"</span>
        </div>
      )}

      {/* ── Main Voice Control Bar & Text Input Bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          maxWidth: "95%",
        }}
      >
        {/* Voice Status Pill */}
        <div
          className="voice-control-bar"
          onClick={onToggleMic}
          role="button"
          tabIndex={0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            background: barBg,
            border: borderStyle,
            borderRadius: "999px",
            padding: "8px 18px 8px 10px",
            boxShadow: orbShadow + ", 0 8px 24px rgba(0,0,0,0.4)",
            backdropFilter: "blur(18px)",
            cursor: "pointer",
            transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Animated Microphone Orb */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {(isListening || isOnline) && (
              <span
                style={{
                  position: "absolute",
                  inset: "-4px",
                  borderRadius: "50%",
                  background: isListening ? "rgba(34, 197, 94, 0.45)" : "rgba(34, 197, 94, 0.2)",
                  animation: isListening ? "pulseListenRing 1.2s ease-in-out infinite" : "pulseOnlineRing 3s ease-in-out infinite",
                  pointerEvents: "none",
                }}
              />
            )}

            <div
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "50%",
                background: isListening
                  ? "linear-gradient(135deg, #00A63E, #22c55e)"
                  : isSpeaking
                  ? "linear-gradient(135deg, #059669, #10b981)"
                  : isThinking
                  ? "linear-gradient(135deg, #ca8a04, #eab308)"
                  : isError
                  ? "linear-gradient(135deg, #dc2626, #ef4444)"
                  : "linear-gradient(135deg, #15803d, #22c55e)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
          </div>

          {/* Status Label */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            <span style={{ fontSize: "12.5px", fontWeight: "700", color: "#f8fafc", letterSpacing: "0.2px" }}>
              {title}
            </span>
            <span style={{ fontSize: "10.5px", color: isListening ? "#4ade80" : "#94a3b8" }}>
              {isListening ? "Listening..." : "Speak or tap to ask"}
            </span>
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
            padding: "4px 6px 4px 14px",
            backdropFilter: "blur(18px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <input
            type="text"
            placeholder="Type question..."
            value={typedQuestion}
            onChange={(e) => setTypedQuestion(e.target.value)}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#ffffff",
              fontSize: "12px",
              width: "120px",
            }}
          />
          <button
            type="submit"
            style={{
              background: "#22c55e",
              border: "none",
              color: "#052e16",
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontWeight: "700",
            }}
          >
            ➔
          </button>
        </form>
      </div>

      <style jsx>{`
        @keyframes pulseListenRing {
          0%, 100% {
            transform: scale(1);
            opacity: 0.85;
          }
          50% {
            transform: scale(1.35);
            opacity: 0.15;
          }
        }
        @keyframes pulseOnlineRing {
          0%, 100% {
            transform: scale(1);
            opacity: 0.5;
          }
          50% {
            transform: scale(1.22);
            opacity: 0.1;
          }
        }
      `}</style>
    </div>
  );
}
