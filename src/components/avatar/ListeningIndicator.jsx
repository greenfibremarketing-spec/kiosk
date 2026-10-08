"use client";
/**
 * ListeningIndicator.jsx
 * A small pulsing "Listening" badge displayed near the avatar
 * whenever the kiosk is in the LISTENING state.
 */

export default function ListeningIndicator() {
  return (
    <div
      aria-live="polite"
      aria-label="Listening"
      style={{
        position: "absolute",
        top: "18px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "rgba(0, 30, 15, 0.82)",
        border: "1.5px solid rgba(0, 200, 80, 0.6)",
        borderRadius: "999px",
        padding: "6px 16px",
        backdropFilter: "blur(10px)",
        boxShadow: "0 0 20px rgba(0, 200, 80, 0.35)",
        animation: "listenPulse 2s ease-in-out infinite",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {/* Animated dot */}
      <span
        style={{
          width: "9px",
          height: "9px",
          borderRadius: "50%",
          background: "#22c55e",
          display: "inline-block",
          animation: "dotPulse 1.1s ease-in-out infinite",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: "#86efac",
          fontSize: "13px",
          fontWeight: "700",
          letterSpacing: "0.5px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        Listening
      </span>

      <style>{`
        @keyframes listenPulse {
          0%, 100% { box-shadow: 0 0 14px rgba(0,200,80,0.30); }
          50%       { box-shadow: 0 0 28px rgba(0,200,80,0.60); }
        }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%       { transform: scale(1.5); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
