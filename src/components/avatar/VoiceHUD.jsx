"use client";

/**
 * VoiceHUD.jsx
 * Visual status of the kiosk's always-on voice interface:
 *   - SPEAKING: Avatar is talking (interrupable anytime)
 *   - LISTENING: User is speaking (pulsing green + bouncing equalizer)
 *   - THINKING: AI processing response
 *   - ATTENTIVE / IDLE: Mic is Online & Ready (live green beacon)
 *   - ERROR: Hardware/permission issue
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
}) {
  const isListening = userSpeaking || listening || convState === "LISTENING";
  const isThinking  = convState === "THINKING";
  const isSpeaking  = speaking || convState === "SPEAKING";
  const isError     = !!micError;
  const isOnline    = !isError && (convState === "ATTENTIVE" || convState === "IDLE");

  // Dynamic visual parameters
  let icon = "🎙️";
  let title = "Microphone Online & Ready";
  let subtitle = "Speak naturally — Greenie is ready to help";
  let barBg = "rgba(10, 28, 18, 0.88)";
  let borderStyle = "1.5px solid rgba(34, 197, 94, 0.35)";
  let orbShadow = "0 0 14px rgba(34, 197, 94, 0.4)";

  if (isError) {
    icon = "⚠️";
    title = "Microphone Unavailable";
    subtitle = String(micError);
    barBg = "rgba(40, 10, 10, 0.9)";
    borderStyle = "1.5px solid rgba(239, 68, 68, 0.5)";
    orbShadow = "0 0 14px rgba(239, 68, 68, 0.4)";
  } else if (isSpeaking) {
    icon = "🔊";
    title = "Greenie is speaking...";
    subtitle = "Speak anytime to interrupt";
    barBg = "rgba(12, 32, 22, 0.92)";
    borderStyle = "1.5px solid rgba(16, 185, 129, 0.45)";
    orbShadow = "0 0 16px rgba(16, 185, 129, 0.4)";
  } else if (isListening) {
    icon = "🎙️";
    title = "Listening to you...";
    subtitle = "Streaming your voice to Greenie";
    barBg = "rgba(0, 42, 18, 0.95)";
    borderStyle = "2px solid #00A63E";
    orbShadow = "0 0 24px rgba(0, 166, 62, 0.6)";
  } else if (isThinking) {
    icon = "✨";
    title = "Thinking...";
    subtitle = "Formulating recommendations...";
    barBg = "rgba(28, 26, 10, 0.9)";
    borderStyle = "1.5px solid rgba(234, 179, 8, 0.45)";
    orbShadow = "0 0 16px rgba(234, 179, 8, 0.35)";
  }

  return (
    <div
      className="voice-hud-container"
      style={{
        position: "absolute",
        bottom: 24,
        left: 20,
        right: 20,
        zIndex: 25,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      {/* Live Transcript Bubble (shows words as the user speaks) */}
      {liveTranscript && (
        <div
          className="live-transcript-bubble"
          style={{
            background: "rgba(8, 24, 14, 0.94)",
            border: "1.5px solid rgba(34, 197, 94, 0.6)",
            borderRadius: "20px",
            padding: "8px 20px",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: "600",
            maxWidth: "92%",
            textAlign: "center",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            backdropFilter: "blur(14px)",
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <span style={{ color: "#4ade80", marginRight: "6px" }}>🗣️ You:</span>
          "{liveTranscript}"
        </div>
      )}

      {/* Main Voice Control Bar */}
      <div
        className="voice-control-bar"
        onClick={onToggleMic}
        role="button"
        tabIndex={0}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          background: barBg,
          border: borderStyle,
          borderRadius: "999px",
          padding: "10px 22px",
          boxShadow: orbShadow + ", 0 8px 28px rgba(0,0,0,0.4)",
          backdropFilter: "blur(16px)",
          cursor: "pointer",
          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Animated Microphone Orb with Live Status Indicator */}
        <div style={{ position: "relative" }}>
          <div
            style={{
              width: "38px",
              height: "38px",
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
              fontSize: "19px",
              boxShadow: orbShadow,
              transform: isListening ? "scale(1.1)" : "scale(1)",
              transition: "all 0.2s ease",
            }}
          >
            {icon}
          </div>

          {/* Online green pulse dot */}
          {isOnline && (
            <span
              style={{
                position: "absolute",
                top: "-2px",
                right: "-2px",
                width: "11px",
                height: "11px",
                borderRadius: "50%",
                background: "#22c55e",
                border: "2px solid #08160e",
                boxShadow: "0 0 8px #22c55e",
              }}
            />
          )}
        </div>

        {/* Status Text & Soundwave Animation */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div
            style={{
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: "700",
              letterSpacing: "0.2px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>{title}</span>

            {/* Equalizer Wave while Listening or Speaking */}
            {(isListening || isSpeaking) && (
              <span
                style={{
                  display: "inline-flex",
                  gap: "3px",
                  alignItems: "center",
                  height: "14px",
                }}
              >
                <span className="equalizer-bar eq1" />
                <span className="equalizer-bar eq2" />
                <span className="equalizer-bar eq3" />
                <span className="equalizer-bar eq4" />
              </span>
            )}
          </div>

          <div
            style={{
              color: "rgba(255, 255, 255, 0.72)",
              fontSize: "11.5px",
              fontWeight: "500",
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>

      <style jsx>{`
        .equalizer-bar {
          display: inline-block;
          width: 3px;
          height: 12px;
          background: #4ade80;
          border-radius: 2px;
          animation: eqBounce 0.75s ease-in-out infinite alternate;
        }
        .eq1 {
          animation-delay: 0s;
        }
        .eq2 {
          animation-delay: 0.2s;
          height: 16px;
        }
        .eq3 {
          animation-delay: 0.4s;
          height: 10px;
        }
        .eq4 {
          animation-delay: 0.6s;
          height: 14px;
        }
        @keyframes eqBounce {
          0% {
            transform: scaleY(0.35);
          }
          100% {
            transform: scaleY(1.35);
          }
        }
      `}</style>
    </div>
  );
}
