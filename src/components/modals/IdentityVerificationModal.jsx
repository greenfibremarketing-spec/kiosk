"use client";
// src/components/modals/IdentityVerificationModal.jsx
// Verification modal shown after a short gap (1.5s to 10s absence) when a face returns
// and a name was previously set. Zero facial recognition is used.

import React from "react";

export default function IdentityVerificationModal({
  isOpen,
  name,
  onConfirm,
  onReject,
  secondsRemaining = 8,
  promptCount = 1,
}) {
  if (!isOpen) return null;

  return (
    <div className="identity-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="identity-title">
      <div className="identity-modal-card">
        {/* Eco Accent Icon */}
        <div className="identity-modal-icon-badge" aria-hidden="true">
          <span>🌿</span>
        </div>

        <h2 id="identity-title" className="identity-modal-title">
          Welcome back!
        </h2>

        <p className="identity-modal-body">
          Are you still <strong>{name}</strong>?
        </p>

        <p className="identity-modal-subtext">
          {promptCount === 1
            ? "Tap below or answer with your voice."
            : "Please confirm so we can personalize your experience."}
        </p>

        {/* Action Buttons */}
        <div className="identity-modal-actions">
          <button
            type="button"
            className="identity-btn identity-btn--confirm"
            onClick={onConfirm}
            autoFocus
          >
            <span className="btn-icon">✓</span>
            <span>Yes, I am {name}</span>
          </button>

          <button
            type="button"
            className="identity-btn identity-btn--reject"
            onClick={onReject}
          >
            <span className="btn-icon">✕</span>
            <span>No, I'm someone new</span>
          </button>
        </div>

        {/* Countdown footer */}
        <div className="identity-modal-timer">
          <span className="timer-pulse-dot" />
          <span>Resetting in {secondsRemaining}s if unanswered</span>
        </div>
      </div>
    </div>
  );
}
