"use client";
import React, { useState, useEffect } from "react";

export default function GoodbyeOverlay({
  isOpen,
  message = "Thank you, have a great day!",
  autoResetAfterMs = 4000,
  onReset,
}) {
  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.ceil(autoResetAfterMs / 1000)
  );

  useEffect(() => {
    if (!isOpen) return;

    setSecondsRemaining(Math.ceil(autoResetAfterMs / 1000));

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const timeout = setTimeout(() => {
      onReset?.();
    }, autoResetAfterMs);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isOpen, autoResetAfterMs, onReset]);

  if (!isOpen) return null;

  const totalSecs = Math.max(1, Math.ceil(autoResetAfterMs / 1000));
  const progressPercent = ((totalSecs - secondsRemaining) / totalSecs) * 100;

  return (
    <div className="goodbye-overlay-backdrop" role="alertdialog" aria-label="Farewell Screen">
      <div className="goodbye-overlay-card">
        {/* Celebration Eco Emblem */}
        <div className="goodbye-emblem-wrap">
          <span className="goodbye-emblem">🌾</span>
          <span className="goodbye-sparkle">✨</span>
        </div>

        {/* Headline */}
        <h2>Thank You for Visiting GreenFibre!</h2>
        <p className="goodbye-message">{message || "Thank you, have a great day!"}</p>

        {/* Eco contribution callout */}
        <div className="goodbye-impact-pill">
          <span>🌱 Every sustainable switch makes a lasting difference.</span>
        </div>

        {/* Countdown Ring / Progress */}
        <div className="goodbye-countdown-container">
          <div className="countdown-ring">
            <span className="countdown-number">{secondsRemaining}</span>
          </div>
          <span className="countdown-label">
            Resetting kiosk for the next customer in {secondsRemaining}s...
          </span>
          <div className="countdown-progress-bar">
            <div
              className="countdown-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Manual Restart Button */}
        <button
          type="button"
          className="goodbye-btn-restart"
          onClick={() => onReset?.()}
        >
          <span>Start New Session Now</span>
          <span className="btn-arrow">→</span>
        </button>
      </div>
    </div>
  );
}
