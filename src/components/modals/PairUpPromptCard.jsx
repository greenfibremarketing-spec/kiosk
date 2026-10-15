"use client";
/**
 * PairUpPromptCard.jsx
 * Floating prompt card asking whether to view pair-up suggestions after adding to cart.
 * Rendered at the bottom of the screen with two large (>=80px) touch buttons.
 */

import React from "react";
import { Sparkles, ShoppingBag } from "lucide-react";

export default function PairUpPromptCard({
  isOpen,
  question,
  onYes,
  onNo,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="pairup-prompt-card"
      role="dialog"
      aria-modal="true"
      aria-label="Pair-up suggestions prompt"
    >
      <div className="pairup-prompt-header">
        <div className="pairup-prompt-avatar-badge" aria-hidden="true">
          ✨
        </div>
        <div className="pairup-prompt-text-group">
          <div className="pairup-prompt-title">Greenie's Recommendation</div>
          <h2 className="pairup-prompt-question">
            {question || "I have a few lovely matches that go nicely with this. Would you like to see them?"}
          </h2>
        </div>
      </div>

      <div className="pairup-prompt-actions">
        <button
          type="button"
          className="pairup-prompt-btn pairup-prompt-btn--yes"
          onClick={onYes}
          aria-label="Yes, show me pair up suggestions"
        >
          <Sparkles size={26} strokeWidth={2.4} />
          <span>Yes, show me</span>
        </button>

        <button
          type="button"
          className="pairup-prompt-btn pairup-prompt-btn--no"
          onClick={onNo}
          aria-label="No, go to cart"
        >
          <ShoppingBag size={24} strokeWidth={2.2} />
          <span>No, go to cart</span>
        </button>
      </div>

      {/* 12-second progress indicator */}
      <div className="pairup-prompt-timer-bar" aria-hidden="true">
        <div className="pairup-prompt-timer-progress" />
      </div>
    </div>
  );
}
