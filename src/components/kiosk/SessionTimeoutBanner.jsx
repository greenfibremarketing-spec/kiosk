"use client";
import React from "react";

export default function SessionTimeoutBanner({
  isOpen,
  secondsRemaining = 10,
  onContinue,
  onExit,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="session-timeout-banner"
      role="alertdialog"
      aria-label="Session Inactivity Warning"
    >
      <div className="timeout-banner-header">
        <div className="timeout-timer-badge">
          <span className="timeout-clock-icon">⏳</span>
          <span className="timeout-countdown-num">{secondsRemaining}s</span>
        </div>
        <div className="timeout-title-wrap">
          <strong className="timeout-title">Still there?</strong>
          <span className="timeout-subtitle">Session ending soon</span>
        </div>
      </div>

      <p className="timeout-message">
        Are you still shopping with Greenie? The session will return to the welcome screen if no one is here.
      </p>

      <div className="timeout-actions-row">
        <button
          type="button"
          className="timeout-btn-continue"
          onClick={onContinue}
        >
          <span>Continue Shopping</span>
          <span className="btn-icon">🌿</span>
        </button>
        <button
          type="button"
          className="timeout-btn-exit"
          onClick={onExit}
        >
          <span>Exit / New User</span>
        </button>
      </div>
    </div>
  );
}
