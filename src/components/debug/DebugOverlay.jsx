"use client";
/**
 * DebugOverlay.jsx (v2)
 * Shows live telemetry for staff tuning:
 *   • Presence & conversation state
 *   • vadSpeech, audioLevel, jawOpen movement/variance
 *   • userSpeaking, evidence, speakingForMs / silentForMs
 *   • Legacy emotion signals
 *
 * Toggle with Ctrl+Shift+D
 */

export default function DebugOverlay({
  stats = {},
  config = {},
  state = "IDLE",
  convState = "IDLE",
  signals = null,
  vadSpeech = false,
  audioLevel = 0,
  userSpeaking = false,
  evidence = "none",
  speakingForMs = 0,
  silentForMs = 0,
  onCalibrate,
  onClose,
}) {
  const isEngaged = state === "ENGAGED";

  const bar = (value, max = 1, color = "#00e676") => {
    const pct = Math.min(100, Math.round((value / max) * 100));
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          flex: 1, height: 6, background: "rgba(255,255,255,0.1)",
          borderRadius: 3, overflow: "hidden",
        }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.1s" }} />
        </div>
        <span style={{ minWidth: 34, textAlign: "right" }}>{pct}%</span>
      </div>
    );
  };

  const stateColor = {
    IDLE: "#94a3b8", ATTENTIVE: "#38bdf8",
    LISTENING: "#00e676", THINKING: "#f59e0b", SPEAKING: "#c084fc",
  }[convState] ?? "#e2e8f0";

  return (
    <div style={{
      position: "fixed", top: 16, left: 16, zIndex: 99999,
      background: "rgba(10, 24, 15, 0.94)",
      backdropFilter: "blur(14px)",
      border: "1px solid rgba(0, 166, 62, 0.5)",
      borderRadius: "14px", padding: "16px 20px",
      color: "#e6f7ec", fontFamily: "monospace",
      fontSize: "12px", lineHeight: "1.7",
      boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
      maxWidth: "380px", userSelect: "none",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.15)", paddingBottom: 6 }}>
        <strong style={{ color: "#00A63E", fontSize: "13px" }}>🛠️ LIVE TELEMETRY [Ctrl+Shift+D]</strong>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#aaa", fontSize: "16px", cursor: "pointer" }}>✕</button>
      </div>

      {/* Presence */}
      <div><strong>Presence:</strong>{" "}
        <span style={{ color: isEngaged ? "#00A63E" : "#f59e0b", fontWeight: "bold" }}>{state}</span>
        {" | "}
        <span style={{ color: stateColor, fontWeight: "bold" }}>{convState}</span>
      </div>
      <div><strong>Distance:</strong>{" "}
        <span style={{ color: "#38bdf8", fontWeight: "bold" }}>{stats?.smoothCm || 0} cm</span>
        {" "}(Raw: {stats?.rawCm || 0} cm)
      </div>

      {/* Audio / VAD */}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed rgba(255,255,255,0.2)" }}>
        <div style={{ color: "#00e676", fontWeight: "bold", marginBottom: 4 }}>🎙️ AUDIO / VAD</div>
        <div>
          <strong>VAD Speech:</strong>{" "}
          <span style={{ color: vadSpeech ? "#00e676" : "#94a3b8", fontWeight: "bold" }}>
            {vadSpeech ? "🟢 YES" : "⚫ NO"}
          </span>
        </div>
        <div><strong>Audio Level (RMS):</strong></div>
        {bar(audioLevel, 0.15, audioLevel > 0.012 ? "#00e676" : "#64748b")}
      </div>

      {/* Fused speech state */}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed rgba(255,255,255,0.2)" }}>
        <div style={{ color: "#c084fc", fontWeight: "bold", marginBottom: 4 }}>🔮 FUSED SPEECH STATE</div>
        <div>
          <strong>userSpeaking:</strong>{" "}
          <span style={{ color: userSpeaking ? "#00e676" : "#94a3b8", fontWeight: "bold", fontSize: 14 }}>
            {userSpeaking ? "🗣️ SPEAKING" : "🤫 SILENT"}
          </span>
        </div>
        <div><strong>Evidence:</strong>{" "}
          <span style={{ color: evidence === "both" ? "#00e676" : evidence === "audio" ? "#38bdf8" : evidence === "face" ? "#f59e0b" : "#64748b", fontWeight: "bold" }}>
            {evidence}
          </span>
        </div>
        <div><strong>Speaking for:</strong> {Math.round(speakingForMs / 100) / 10}s</div>
        <div><strong>Silent for:</strong> {Math.round(silentForMs / 100) / 10}s</div>
      </div>

      {/* Jaw / Face signals */}
      {signals && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed rgba(255,255,255,0.2)" }}>
          <div style={{ color: "#fbbf24", fontWeight: "bold", marginBottom: 4 }}>👁️ FACE SIGNALS</div>
          <div><strong>Jaw Open:</strong></div>
          {bar(signals.jawOpen, 0.5, "#fbbf24")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", marginTop: 4 }}>
            <div>Present: <strong style={{ color: signals.present ? "#00e676" : "#94a3b8" }}>{signals.present ? "✓" : "✗"}</strong></div>
            <div>Gaze: <strong style={{ color: signals.attention === "screen" ? "#38bdf8" : "#f87171" }}>{signals.attention === "screen" ? "Screen" : "Away"}</strong></div>
            <div>😊 Smile: <strong>{Math.round(signals.smile * 100)}%</strong></div>
            <div>🤔 Confused: <strong>{Math.round((signals.confused || 0) * 100)}%</strong></div>
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Jaw VAD (face):</strong>{" "}
            <span style={{ color: signals.speaking ? "#fbbf24" : "#94a3b8", fontWeight: "bold" }}>
              {signals.speaking ? "🗣️ MOVING" : "STILL"}
            </span>
          </div>
          <div>Silence: {signals.silenceSec}s | Dwell: {Math.round(signals.dwellMs / 1000)}s</div>
        </div>
      )}

      {/* Calibrate */}
      <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 8 }}>
        <button
          onClick={onCalibrate}
          style={{ width: "100%", background: "#00A63E", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", cursor: "pointer" }}
        >
          Press 'C' or Click to Calibrate at 100 cm
        </button>
      </div>
    </div>
  );
}
