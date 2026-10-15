"use client";
// RecommendationModal.jsx — NEW component, additive only.
// Shows the bundle offer: both product images, prices, discount badge,
// and two large touch buttons (Add both / No thanks).
// Tapping the dim backdrop counts as "No thanks".

import React from "react";
import { X, Plus, Sparkles, Leaf } from "lucide-react";

export default function RecommendationModal({
  isOpen,
  data,             // SHOW_RECOMMENDATION action payload
  onAccept,         // () => void
  onDecline,        // () => void
  onClose,          // () => void
}) {
  if (!isOpen || !data) return null;

  const {
    base_product,
    suggested_product,
    individual_total = 0,
    bundle_price = 0,
    discount_percent = 0,
    saved_amount = 0,
  } = data;

  const baseName = base_product?.name || "This item";
  const suggName = suggested_product?.name || "Companion item";

  const fmtINR = (n) =>
    "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onDecline?.();
      onClose?.();
    }
  };

  const handleAccept = () => {
    onAccept?.();
  };

  const handleDecline = () => {
    onDecline?.();
    onClose?.();
  };

  const handleClose = () => {
    onDecline?.();
    onClose?.();
  };

  return (
    <div
      className="reco-modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Bundle recommendation"
    >
      <div className="reco-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button
          type="button"
          className="reco-modal-close"
          onClick={handleClose}
          aria-label="Close recommendation"
        >
          <X size={18} strokeWidth={2.5} />
        </button>

        {/* Header */}
        <div className="reco-modal-header">
          <h3>
            <Sparkles size={18} style={{ display: "inline", marginRight: 6, color: "var(--brand)" }} />
            Perfect Together
          </h3>
          <p>We think these two go really well together.</p>
        </div>

        {/* Both products */}
        <div className="reco-products-row">
          {/* Base product */}
          <div className="reco-product-card">
            {base_product?.image ? (
              <img
                src={base_product.image}
                alt={baseName}
                className="reco-product-img"
              />
            ) : (
              <div className="reco-product-img-fallback">
                <Leaf size={32} strokeWidth={1.5} />
              </div>
            )}
            <span className="reco-product-name">{baseName}</span>
          </div>

          {/* Plus */}
          <Plus size={28} strokeWidth={2.5} className="reco-plus-icon" />

          {/* Suggested product */}
          <div className="reco-product-card">
            {suggested_product?.image ? (
              <img
                src={suggested_product.image}
                alt={suggName}
                className="reco-product-img"
              />
            ) : (
              <div className="reco-product-img-fallback">
                <Leaf size={32} strokeWidth={1.5} />
              </div>
            )}
            <span className="reco-product-name">{suggName}</span>
          </div>
        </div>

        {/* Pricing */}
        <div className="reco-pricing-block">
          {individual_total > bundle_price && (
            <span className="reco-individual-total">
              {fmtINR(individual_total)} individually
            </span>
          )}
          <span className="reco-bundle-price">{fmtINR(bundle_price)}</span>
          {discount_percent > 0 && saved_amount > 0 && (
            <span className="reco-save-badge">
              <Leaf size={14} strokeWidth={2} />
              Save {discount_percent}% ({fmtINR(saved_amount)} rupees)
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="reco-modal-actions">
          <button
            type="button"
            className="reco-modal-btn reco-modal-btn--primary"
            onClick={handleAccept}
            aria-label="Add both to cart"
          >
            <Sparkles size={18} strokeWidth={2} />
            Add both
          </button>
          <button
            type="button"
            className="reco-modal-btn reco-modal-btn--secondary"
            onClick={handleDecline}
            aria-label="No thanks"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
