"use client";
import React from "react";

export default function StaffAssistanceBanner({
  message = "A store associate is on the way.",
  onDismiss,
}) {
  if (!message) return null;

  return (
    <div className="staff-assistance-banner" role="status" aria-live="polite">
      <div className="staff-banner-content">
        <div className="staff-banner-pulse">
          <span className="staff-bell-icon">🛎️</span>
          <span className="staff-pulse-ring" />
        </div>
        <div className="staff-banner-text">
          <strong>Store Associate Requested</strong>
          <p>{message || "A store associate is on the way."}</p>
        </div>
      </div>
      <button
        type="button"
        className="staff-banner-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss banner"
      >
        Dismiss ✕
      </button>
    </div>
  );
}
