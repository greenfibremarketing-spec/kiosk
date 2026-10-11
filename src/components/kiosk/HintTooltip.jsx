"use client";
import React, { useEffect, useState } from "react";

export default function HintTooltip({
  hint,
  onTapHint,
  onDismiss,
}) {
  const [visible, setVisible] = useState(Boolean(hint));

  useEffect(() => {
    setVisible(Boolean(hint));
  }, [hint]);

  if (!visible || !hint) return null;

  return (
    <div className="hint-tooltip-bubble" role="note" aria-label="Helpful hint">
      <div className="hint-bubble-icon">💡</div>
      <div
        className="hint-bubble-content"
        onClick={() => onTapHint?.(hint)}
        role="button"
        tabIndex={0}
      >
        <span className="hint-label">Suggestion:</span>
        <span className="hint-text">
          {typeof hint === "string" ? hint : hint.text || hint.message || JSON.stringify(hint)}
        </span>
      </div>
      <button
        type="button"
        className="hint-bubble-close"
        onClick={() => {
          setVisible(false);
          onDismiss?.();
        }}
        aria-label="Dismiss hint"
      >
        ✕
      </button>
    </div>
  );
}
