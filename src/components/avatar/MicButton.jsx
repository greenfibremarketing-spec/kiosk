"use client";

export default function MicButton({ listening, onClick }) {
  return (
    <button
      type="button"
      className={`floating-mic-btn ${listening ? "floating-mic-btn--on" : ""}`}
      onClick={onClick}
      aria-label={listening ? "Listening to your voice, tap to finish" : "Tap and speak to Greenie"}
    >
      <span className="floating-mic-icon">{listening ? "🔴" : "🎙️"}</span>
      <span className="floating-mic-text">
        {listening ? "Listening..." : "Speak to Greenie"}
      </span>
    </button>
  );
}
