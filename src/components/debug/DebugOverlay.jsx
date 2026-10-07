"use client";

export default function DebugOverlay({
  stats = {},
  config = {},
  state = "IDLE",
  signals = null,
  onCalibrate,
  onClose,
}) {
  const isEngaged = state === "ENGAGED";

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: 16,
        zIndex: 99999,
        background: "rgba(10, 24, 15, 0.94)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(0, 166, 62, 0.5)",
        borderRadius: "14px",
        padding: "16px 20px",
        color: "#e6f7ec",
        fontFamily: "monospace",
        fontSize: "12px",
        lineHeight: "1.6",
        boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
        maxWidth: "360px",
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          borderBottom: "1px solid rgba(255,255,255,0.15)",
          paddingBottom: 6,
        }}
      >
        <strong style={{ color: "#00A63E", fontSize: "13px" }}>
          🛠️ LIVE TELEMETRY [Ctrl+Shift+D]
        </strong>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#aaa",
            fontSize: "16px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      {/* State & Presence */}
      <div>
        <strong>STATE:</strong>{" "}
        <span
          style={{
            color: isEngaged ? "#00A63E" : "#f59e0b",
            fontWeight: "bold",
          }}
        >
          {state}
        </span>
      </div>
      <div>
        <strong>Distance:</strong>{" "}
        <span style={{ color: "#38bdf8", fontWeight: "bold" }}>
          {stats?.smoothCm || 0} cm
        </span>{" "}
        (Raw: {stats?.rawCm || 0}cm)
      </div>

      {/* Live Behaviour & Mood Signals */}
      {signals && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px dashed rgba(255,255,255,0.2)",
          }}
        >
          <div style={{ color: "#00e676", fontWeight: "bold", marginBottom: 4 }}>
            📊 DETECTED BEHAVIOUR & EMOTIONS:
          </div>

          <div>
            <strong>Mood:</strong>{" "}
            <span
              style={{
                color: signals.mood.startsWith("Happy")
                  ? "#10b981"
                  : signals.mood.startsWith("Sad")
                  ? "#ef4444"
                  : signals.mood.startsWith("Conf")
                  ? "#f59e0b"
                  : "#e2e8f0",
                fontWeight: "bold",
                fontSize: "13px",
              }}
            >
              {signals.mood} ({signals.moodScore}%)
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", marginTop: 4 }}>
            <div>😊 Smile: <strong>{Math.round(signals.smile * 100)}%</strong></div>
            <div>🙁 Sad/Frown: <strong>{Math.round((signals.sad || 0) * 100)}%</strong></div>
            <div>🤔 Confused: <strong>{Math.round((signals.confused || 0) * 100)}%</strong></div>
            <div>😲 Surprised: <strong>{Math.round((signals.surprised || 0) * 100)}%</strong></div>
          </div>

          <div style={{ marginTop: 6 }}>
            <strong>Speaking (VAD):</strong>{" "}
            <span style={{ color: signals.speaking ? "#00e676" : "#94a3b8", fontWeight: "bold" }}>
              {signals.speaking ? "🗣️ SPEAKING" : "🤫 SILENT"}
            </span>{" "}
            (Jaw: {Math.round(signals.jawOpen * 100)}%)
          </div>

          <div>
            <strong>Attention:</strong>{" "}
            <span style={{ color: signals.attention === "screen" ? "#38bdf8" : "#f87171" }}>
              {signals.attention === "screen" ? "👀 Looking at Screen" : "↩️ Looking Away"}
            </span>
          </div>

          <div>
            <strong>Silence:</strong> {signals.silenceSec}s | <strong>Dwell:</strong>{" "}
            {Math.round(signals.dwellMs / 1000)}s
          </div>
        </div>
      )}

      {/* Calibration Button */}
      <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 8 }}>
        <button
          onClick={onCalibrate}
          style={{
            width: "100%",
            background: "#00A63E",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            padding: "6px 10px",
            fontSize: "11px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Press 'C' or Click to Calibrate at 100cm
        </button>
      </div>
    </div>
  );
}
