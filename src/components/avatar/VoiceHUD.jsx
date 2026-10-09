"use client";

/**
 * VoiceHUD.jsx
 * Clean, minimal Voice Status Pill for GreenFibre Kiosk:
 *   - SPEAKING: Avatar is talking (interrupable anytime)
 *   - LISTENING: User is speaking (pulsing emerald + bouncing equalizer)
 *   - THINKING: AI processing response
 *   - ATTENTIVE / IDLE: Mic is Online & Ready (live emerald pulse ring)
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
      {/* Live Transcript Bubble (shows words as the user speaks) */}
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

      {/* Main Voice Control Bar - Single-line, Clean, Uncluttered */}
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
          maxWidth: "100%",
        }}
      >
        {/* Animated Microphone Orb with Clean Glowing Aura */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Outer Pulse Ring for Online & Listening */}
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
              color: "#ffffff",
              boxShadow: orbShadow,
              transform: isListening ? "scale(1.06)" : "scale(1)",
              transition: "transform 0.2s ease, background 0.3s ease",
            }}
          >
            {isError ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : isSpeaking ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fillOpacity="0.2" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : isThinking ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v3m0 12v3M5 5l2.2 2.2m9.6 9.6L19 19M3 12h3m12 0h3M5 19l2.2-2.2m9.6-9.6L19 5" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" fill="currentColor" fillOpacity="0.2" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="8" y1="22" x2="16" y2="22" />
              </svg>
            )}
          </div>
        </div>

        {/* Title & Live Soundwave Animation (Clean Single-Line) */}
        <div
          style={{
            color: "#ffffff",
            fontSize: "13.5px",
            fontWeight: "700",
            letterSpacing: "0.2px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          <span>{title}</span>

          {/* Equalizer Wave while Listening or Speaking */}
          {(isListening || isSpeaking) && (
            <span
              style={{
                display: "inline-flex",
                gap: "2.5px",
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
          height: 15px;
        }
        .eq3 {
          animation-delay: 0.4s;
          height: 9px;
        }
        .eq4 {
          animation-delay: 0.6s;
          height: 13px;
        }
        @keyframes eqBounce {
          0% {
            transform: scaleY(0.3);
          }
          100% {
            transform: scaleY(1.3);
          }
        }
      `}</style>
    </div>
  );
}
