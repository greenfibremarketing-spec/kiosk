"use client";

export default function DebugOverlay({ stats, config, state, onCalibrate, onClose }) {
  return (
    <div style={{
      position: "fixed",
      top: 16,
      left: 16,
      zIndex: 9999,
      background: "rgba(10, 24, 15, 0.92)",
      backdropFilter: "blur(12px)",
      border: "1px solid rgba(0, 166, 62, 0.4)",
      borderRadius: "14px",
      padding: "16px 20px",
      color: "#e6f7ec",
      fontFamily: "monospace",
      fontSize: "13px",
      lineHeight: "1.6",
      boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      maxWidth: "340px",
      userSelect: "none"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.15)", paddingBottom: 6 }}>
        <strong style={{ color: "#00A63E", fontSize: "14px" }}>🛠️ KIOSK DEBUG [Ctrl+Shift+D]</strong>
        <button onClick={onClose} style={{ color: "#aaa", fontSize: "16px", cursor: "pointer" }}>✕</button>
      </div>

      <div><strong>STATE:</strong> <span style={{ color: state === "ENGAGED" ? "#00A63E" : "#f59e0b", fontWeight: "bold" }}>{state}</span></div>
      <div><strong>FPS:</strong> {stats.fps}</div>
      <div><strong>Faces Detected:</strong> {stats.facesCount}</div>
      <div><strong>Facing Screen:</strong> {stats.isFacing ? "YES" : "NO"}</div>
      <div><strong>Face Width:</strong> {stats.facePx} px</div>
      <div><strong>Raw Distance:</strong> {stats.rawCm} cm</div>
      <div><strong>Smooth Distance:</strong> <span style={{ color: "#38bdf8", fontWeight: "bold" }}>{stats.smoothCm} cm</span></div>
      
      <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px dashed rgba(255,255,255,0.15)" }}>
        <div><strong>Thresholds:</strong> Enter &lt; {config.enterCm}cm | Exit &gt; {config.exitCm}cm</div>
        <div><strong>Focal Px:</strong> {config.focalPx}px</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <button
          onClick={onCalibrate}
          style={{
            width: "100%",
            background: "#00A63E",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            padding: "8px 12px",
            fontSize: "12px",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          Press 'C' or Click to Calibrate at 100cm
        </button>
      </div>
    </div>
  );
}
