export default function MicButton({ listening, onClick }) {
  return (
    <button
      type="button"
      className={`floating-mic-btn ${listening ? "floating-mic-btn--on" : ""}`}
      onClick={onClick}
      aria-label={listening ? "Listening to your voice, tap to send" : "Tap and speak to Maya"}
    >
      <span className="floating-mic-icon">{listening ? "🔴" : "🎙️"}</span>
      <span className="floating-mic-text">
        {listening ? "Listening..." : "Speak to Maya"}
      </span>
    </button>
  );
}
