"use client";
import React from "react";
import ProductArt from "../products/ProductArt";
import CartRecommendationStrip from "./CartRecommendationStrip";

export default function CartConfirmationModal({
  isOpen,
  onClose,
  product,
  sku,
  buttons = [],
  onButtonClick,
  onProceedToCheckout,
  children,
}) {
  if (!isOpen) return null;

  const defaultButtons = [
    { id: "checkout", label: "Checkout", primary: true },
    { id: "keep_shopping", label: "Keep shopping", primary: false },
  ];

  const displayButtons =
    buttons && buttons.length > 0
      ? buttons.map((b) =>
          typeof b === "string"
            ? { id: b.toLowerCase().replace(/\s+/g, "_"), label: b, primary: /checkout|buy|take/i.test(b) }
            : { ...b, primary: b.primary ?? /checkout|buy|take/i.test(b.label || b.id || "") }
        )
      : defaultButtons;

  const handleAction = (btn) => {
    if (btn.id === "checkout" || /checkout/i.test(btn.label)) {
      onProceedToCheckout?.(product || { sku });
    }
    onButtonClick?.(btn);
  };

  return (
    <div className="cart-modal-backdrop" onClick={onClose} aria-label="Added to Cart Confirmation">
      <div className="cart-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button type="button" className="cart-modal-close" onClick={onClose} aria-label="Close dialog">
          ✕
        </button>

        {/* Modal Header */}
        <div className="cart-modal-header">
          <div className="cart-modal-icon-badge">🛍️</div>
          <div>
            <h3>Item Added to Your Cart</h3>
            <p>Your sustainable essential is ready in your cart.</p>
          </div>
        </div>

        {/* Product Summary Row */}
        {product && (
          <div className="cart-modal-item">
            <div className="cart-item-thumb">
              <ProductArt image={product.image} name={product.name} shape={product.shape || "bottle"} />
            </div>
            <div className="cart-item-details">
              <h4>{product.name}</h4>
              <span className="cart-item-sku">SKU: {sku || product.sku || product.id}</span>
              <div className="cart-item-price-row">
                <span className="cart-item-price">₹{product.salePrice || product.price || 999}</span>
                <span className="cart-item-eco-tag">🌾 100% Upcycled Rice-Husk</span>
              </div>
            </div>
          </div>
        )}

        {/* Impact strip */}
        <div className="cart-modal-impact">
          <span>🌱</span>
          <p>Choosing this product diverts <strong>~210g</strong> of crop straw from stubble burning.</p>
        </div>

        {children || <CartRecommendationStrip />}

        {/* Action Buttons */}
        <div className="cart-modal-actions">
          {displayButtons.map((btn, idx) => (
            <button
              key={btn.id || idx}
              type="button"
              className={btn.primary ? "cart-btn-primary" : "cart-btn-secondary"}
              onClick={() => handleAction(btn)}
            >
              <span>{btn.label || btn.name || btn.id}</span>
              {btn.primary && <span className="btn-arrow">→</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
