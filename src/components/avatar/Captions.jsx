export default function Captions({ text, speaking }) {
  if (!text) return null;

  return (
    <div className={`subs-bar ${speaking ? "subs-bar--speaking" : ""}`} aria-live="polite">
      <div className="subs-badge">CC</div>
      <div className="subs-text-wrap">
        <span className="subs-speaker">Maya</span>
        <span className="subs-text">{text}</span>
      </div>
    </div>
  );
}
