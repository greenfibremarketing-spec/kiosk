"use client";

export default function EmoteBar({ onWave, onReact, disabled }) {
  return (
    <div className="greenie-emotes" role="group" aria-label="Interact with Greenie">
      <button
        type="button"
        className="emote-chip"
        onClick={onWave}
        disabled={disabled}
        aria-label="Make Greenie wave hello"
      >
        <span className="emote-icon">👋</span>
        <span className="emote-label">Wave</span>
      </button>

      <button
        type="button"
        className="emote-chip"
        onClick={() => onReact?.("wink")}
        disabled={disabled}
        aria-label="Make Greenie wink"
      >
        <span className="emote-icon">😉</span>
        <span className="emote-label">Wink</span>
      </button>

      <button
        type="button"
        className="emote-chip"
        onClick={() => onReact?.("dance")}
        disabled={disabled}
        aria-label="Make Greenie dance"
      >
        <span className="emote-icon">💃</span>
        <span className="emote-label">Dance</span>
      </button>

      <button
        type="button"
        className="emote-chip"
        onClick={() => onReact?.("blush")}
        disabled={disabled}
        aria-label="Make Greenie blush"
      >
        <span className="emote-icon">🌸</span>
        <span className="emote-label">Blush</span>
      </button>
    </div>
  );
}
