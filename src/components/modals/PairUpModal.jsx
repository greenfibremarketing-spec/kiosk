"use client";
/**
 * PairUpModal.jsx
 * Redesigned bottom sheet modal presenting 3-4 curated pair-up products.
 * Viewed from about 60 cm, typography strictly 24px and above.
 * Pins header and footer; middle area scrolls independently.
 */

import React from "react";
import ProductArt from "../products/ProductArt";
import { Sparkles, Check, Plus, ArrowRight, X, Leaf, MessageCircle } from "lucide-react";

export default function PairUpModal({
  isOpen,
  products = [],
  addedIds = [],
  savings = 0,
  hasDiscount = false,
  captionText = "Psst! Pick any one pair-up from here and unlock an extra 5% off your whole order!",
  onAddProduct,
  onSkip,
  onProceed,
  onDone,
  onClose,
}) {
  if (!isOpen) return null;

  const addedIdSet = new Set(addedIds);
  const handleProceedClick = () => {
    if (onProceed) {
      onProceed();
    } else if (onDone) {
      onDone();
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div
      className="pairup-modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Pair-up suggestion pop-up"
    >
      <div
        className="pairup-modal-sheet"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* ── Fixed Header ── */}
        <header className="pairup-sheet-header">
          <div className="pairup-sheet-header-top">
            <span className="pairup-sheet-pill">
              <Sparkles size={22} strokeWidth={2.5} />
              EXTRA 5% OFF
            </span>

            <div className="pairup-sheet-header-actions">
              {/* Small Greeny avatar in top-right corner */}
              <div className="pairup-sheet-avatar-badge" title="Greenie AI Companion">
                <span className="pairup-sheet-avatar-emoji"><Leaf size="1em" strokeWidth={2.6} /></span>
                <span className="pairup-sheet-avatar-text">Greenie</span>
              </div>

              <button
                type="button"
                className="pairup-sheet-close-btn"
                onClick={onClose}
                aria-label="Close pair-up suggestions"
              >
                <X size={32} strokeWidth={2.8} />
              </button>
            </div>
          </div>

          <div className="pairup-sheet-header-main">
            <h2 className="pairup-sheet-title">Pair it up, save more!</h2>
            <p className="pairup-sheet-subtitle">
              Add any one item to unlock 5% off your whole order
            </p>

            {captionText ? (
              <div className="pairup-caption-chip">
                <span className="pairup-caption-chip-icon"><MessageCircle size="1em" strokeWidth={2.6} /></span>
                <span className="pairup-caption-chip-text">{captionText}</span>
              </div>
            ) : null}
          </div>
        </header>

        {/* ── Middle Scrollable Area (2-Column Grid) ── */}
        <main className="pairup-sheet-body">
          <div className="pairup-2col-grid">
            {products.map((item, idx) => {
              const itemId = item.id || item.sku || `pairup_item_${idx}`;
              const isAdded = addedIdSet.has(itemId);
              const price = Number(item.salePrice || item.price || 0);
              const info =
                item.info ||
                item.description ||
                item.blurb ||
                "100% Upcycled crop residue biocomposite.";
              const oneLineInfo =
                typeof info === "string" ? info.replace(/\r?\n|\r/g, " ").trim() : "";

              return (
                <div
                  key={itemId}
                  className={`pairup-sheet-card ${
                    isAdded ? "pairup-sheet-card--added" : ""
                  }`}
                >
                  {/* Card Image ~240px tall square, object-fit cover */}
                  <div className="pairup-card-image-box">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="pairup-card-image"
                        loading="lazy"
                      />
                    ) : (
                      <ProductArt
                        image={item.image}
                        name={item.name}
                        shape={item.shape || "bottle"}
                      />
                    )}
                  </div>

                  {/* Product Name (28px+, max 2 lines) */}
                  <h3 className="pairup-card-title" title={item.name}>
                    {item.name}
                  </h3>

                  {/* Price (32px+ bold green) */}
                  <div className="pairup-card-price-tag">
                    ₹{price.toLocaleString("en-IN")}
                  </div>

                  {/* One-line Info Text (24px+) */}
                  <p className="pairup-card-subtext" title={oneLineInfo}>
                    {oneLineInfo}
                  </p>

                  {/* Big + Add Button (80px+ tall) */}
                  <button
                    type="button"
                    className={`pairup-card-cta-btn ${
                      isAdded
                        ? "pairup-card-cta-btn--added"
                        : "pairup-card-cta-btn--default"
                    }`}
                    onClick={() => onAddProduct?.(item)}
                    disabled={isAdded}
                    aria-label={
                      isAdded
                        ? `${item.name} added`
                        : `Add ${item.name} for 5% off`
                    }
                  >
                    {isAdded ? (
                      <>
                        <Check size={28} strokeWidth={3.2} />
                        <span>Added</span>
                      </>
                    ) : (
                      <>
                        <Plus size={28} strokeWidth={3} />
                        <span>Add</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </main>

        {/* ── Fixed Footer (Pinned to bottom, never scrolls away) ── */}
        <footer className="pairup-sheet-footer">
          {hasDiscount && savings > 0 && (
            <div className="pairup-footer-discount-banner">
              <Sparkles size={24} strokeWidth={2.4} />
              <span>
                5% discount unlocked! You'll save ₹{Number(savings).toLocaleString("en-IN")}
              </span>
            </div>
          )}

          <div className="pairup-footer-button-row">
            <button
              type="button"
              className="pairup-btn-primary-proceed"
              onClick={handleProceedClick}
              aria-label="Proceed to cart"
            >
              <span>Proceed to cart</span>
              <ArrowRight size={30} strokeWidth={2.8} />
            </button>

            <button
              type="button"
              className="pairup-btn-secondary-skip"
              onClick={onSkip}
              aria-label="Skip pair-up suggestions"
            >
              <span>Skip</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
