"use client";
import { useState } from "react";

/**
 * LiveSpeechTester.jsx
 * Prominent on-screen testing card that displays:
 *   1. Exactly what the user is speaking in real-time
 *   2. Live microphone RMS sound level bar
 *   3. Fused speech detection state
 */
export default function LiveSpeechTester({
  liveTranscript = "",
  lastUserSpeech = "",
  userSpeaking = false,
  vadSpeech = false,
  audioLevel = 0,
  evidence = "none",
  convState = "ATTENTIVE",
}) {
  const [minimized, setMinimized] = useState(false);
  const [closed, setClosed] = useState(false);

  if (closed) return null;

  const currentText = liveTranscript || lastUserSpeech;
  const isActivelySpeaking = userSpeaking || vadSpeech || !!liveTranscript;
  const rmsPercent = Math.min(100, Math.round((audioLevel || 0) * 100 * 3.5)); // scaled for visibility

  return (
    <div
      className="live-speech-tester-card"
      style={{
        position: "absolute",
        top: 20,
        left: 20,
        right: 20,
        zIndex: 40,
        background: "rgba(6, 20, 12, 0.94)",
        border: isActivelySpeaking
          ? "2px solid #22c55e"
          : "1.5px solid rgba(34, 197, 94, 0.4)",
        borderRadius: "16px",
        padding: minimized ? "8px 16px" : "14px 18px",
        color: "#ffffff",
        boxShadow: isActivelySpeaking
          ? "0 0 24px rgba(34, 197, 94, 0.45), 0 12px 32px rgba(0,0,0,0.5)"
          : "0 8px 24px rgba(0,0,0,0.45)",
        backdropFilter: "blur(18px)",
        transition: "all 0.2s ease-out",
        userSelect: "none",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: isActivelySpeaking ? "#22c55e" : "#86efac",
              boxShadow: isActivelySpeaking ? "0 0 10px #22c55e" : "none",
            }}
          />
          <span style={{ fontSize: "13px", fontWeight: "800", letterSpacing: "0.5px", color: "#86efac" }}>
            TEST SPEECH MONITOR
          </span>
          <span
            style={{
              fontSize: "11px",
              padding: "2px 8px",
              borderRadius: "99px",
              background: userSpeaking ? "rgba(34, 197, 94, 0.3)" : "rgba(255,255,255,0.1)",
              color: userSpeaking ? "#4ade80" : "rgba(255,255,255,0.6)",
              fontWeight: "700",
            }}
          >
            {convState}
          </span>
        </div>

        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={() => setMinimized((m) => !m)}
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "none",
              color: "#fff",
              borderRadius: "6px",
              width: "24px",
              height: "24px",
              cursor: "pointer",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? "＋" : "－"}
          </button>
          <button
            onClick={() => setClosed(true)}
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "none",
              color: "#fff",
              borderRadius: "6px",
              width: "24px",
              height: "24px",
              cursor: "pointer",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Close test overlay"
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Big Live Speech Transcript Display */}
          <div
            style={{
              background: "rgba(0, 0, 0, 0.55)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "10px",
              padding: "10px 14px",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
            }}
          >
            {currentText ? (
              <div style={{ fontSize: "15px", lineHeight: "1.4", fontWeight: "600", color: "#ffffff" }}>
                <span style={{ color: "#4ade80", marginRight: "6px", fontWeight: "800" }}>
                  {liveTranscript ? "🗣️ Hearing you:" : "✅ You said:"}
                </span>
                <span style={{ color: liveTranscript ? "#fef08a" : "#ffffff" }}>
                  {currentText}
                </span>
              </div>
            ) : (
              <span style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: "13.5px", fontStyle: "italic" }}>
                Speak into the microphone... your words will stream here live in real-time
              </span>
            )}
          </div>

          {/* Real-time sound level & VAD meter */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12px" }}>
            <span style={{ color: "rgba(255, 255, 255, 0.7)", fontWeight: "600", width: "70px" }}>
              Mic Level:
            </span>
            <div
              style={{
                flex: 1,
                height: "10px",
                background: "rgba(255, 255, 255, 0.1)",
                borderRadius: "99px",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${rmsPercent}%`,
                  background: rmsPercent > 20 ? "linear-gradient(90deg, #22c55e, #eab308)" : "#22c55e",
                  borderRadius: "99px",
                  transition: "width 0.08s ease-out",
                }}
              />
            </div>
            <span style={{ width: "36px", textAlign: "right", fontWeight: "700", color: "#86efac" }}>
              {rmsPercent}%
            </span>
          </div>

          {/* Signal status row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.6)",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              paddingTop: "6px",
            }}
          >
            <span>VAD: <strong style={{ color: vadSpeech ? "#4ade80" : "#9ca3af" }}>{vadSpeech ? "SOUND ON" : "QUIET"}</strong></span>
            <span>Evidence: <strong style={{ color: "#a7f3d0" }}>{evidence.toUpperCase()}</strong></span>
            <span>User Speaking: <strong style={{ color: userSpeaking ? "#4ade80" : "#9ca3af" }}>{userSpeaking ? "YES" : "NO"}</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}
