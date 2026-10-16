"use client";

export default function TranscriptDebug({
  liveTranscript,
  lastUserSpeech,
  userSpeaking,
  vadSpeech,
  audioLevel,
}) {
  const isHearing = Boolean(userSpeaking || vadSpeech);
  const levelPercent = Math.min(100, Math.max(0, Math.round((Number(audioLevel) || 0) * 400)));

  return (
    <aside
      aria-label="Transcript Debug Overlay"
      style={{
        position: "fixed",
        left: "1.5vw",
        top: "9vh",
        width: "min(46vw, 760px)",
        zIndex: 100000,
        pointerEvents: "none",
        backgroundColor: "rgba(10, 20, 12, 0.88)",
        color: "#f3f4f6",
        fontFamily: 'monospace, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New"',
        fontSize: "clamp(14px, 1.7vh, 26px)",
        lineHeight: 1.35,
        borderRadius: "16px",
        padding: "14px 18px",
        boxSizing: "border-box",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.45)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      {/* Line 1: Status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ color: isHearing ? "#22c55e" : "#9ca3af", fontWeight: 600 }}>
          {isHearing ? "● hearing voice" : "○ silent"}
        </span>
        <span style={{ color: "#6b7280", fontSize: "0.85em" }}>
          {levelPercent}%
        </span>
      </div>

      {/* Level bar */}
      <div
        style={{
          width: "100%",
          height: "6px",
          backgroundColor: "rgba(255, 255, 255, 0.14)",
          borderRadius: "4px",
          overflow: "hidden",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            width: `${levelPercent}%`,
            height: "100%",
            backgroundColor: "#22c55e",
            borderRadius: "4px",
            transition: "width 60ms ease-out",
          }}
        />
      </div>

      {/* Hearing now */}
      <div style={{ marginBottom: "6px", wordBreak: "break-word" }}>
        <span style={{ color: "#9ca3af", marginRight: "8px" }}>Hearing now:</span>
        <span style={{ color: "#facc15" }}>{liveTranscript || "…"}</span>
      </div>

      {/* Final */}
      <div style={{ wordBreak: "break-word" }}>
        <span style={{ color: "#9ca3af", marginRight: "8px" }}>Final:</span>
        <span style={{ color: "#e5e7eb" }}>{lastUserSpeech || "–"}</span>
      </div>
    </aside>
  );
}
