"use client";
import React from "react";
import ProductArt from "../products/ProductArt";
import { Sparkles } from "lucide-react";

export default function CartConfirmationModal({
  isOpen,
  onClose,
  product,
  sku,
  buttons = [],
  onButtonClick,
  onProceedToCheckout,
  cartItems = [],
  cartTotals = null,
  suggestions = [],
  onAddPairUp,
  onRemoveItem,
  children,
}) {
  if (!isOpen) return null;

  const defaultButtons = [
    { id: "checkout", label: "Proceed", primary: true },
    { id: "skip", label: "Skip", primary: false },
  ];

  const displayButtons =
    buttons && buttons.length > 0
      ? buttons.map((b) =>
          typeof b === "string"
            ? { id: b.toLowerCase().replace(/\s+/g, "_"), label: b, primary: /checkout|proceed|buy|take/i.test(b) }
            : { ...b, primary: b.primary ?? /checkout|proceed|buy|take/i.test(b.label || b.id || "") }
        )
      : defaultButtons;

  const handleAction = (btn) => {
    const bId = (btn.id || btn.label || "").toLowerCase();
    if (bId === "checkout" || /checkout|proceed/i.test(bId)) {
      onProceedToCheckout?.(product || { sku, cartItems, cartTotals });
    } else if (bId === "skip" || /skip/i.test(bId)) {
      onClose?.();
    }
    onButtonClick?.(btn);
  };

  const hasItems = Array.isArray(cartItems) && cartItems.length > 0;
  const itemsCount = hasItems
    ? cartItems.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0)
    : 1;

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
            <h3>Your Cart ({itemsCount} {itemsCount === 1 ? "Item" : "Items"})</h3>
            <p>Your sustainable essentials are ready in your cart.</p>
          </div>
        </div>

        {/* Cart Items List */}
        <div className="cart-modal-items-container" style={{ maxHeight: "200px", overflowY: "auto", margin: "10px 0" }}>
          {hasItems ? (
            cartItems.map((item, idx) => {
              const itemId = item.id || item.sku || `cart_${idx}`;
              const price = Number(item.price || item.salePrice || 0);
              const qty = Number(item.quantity) || 1;
              return (
                <div key={itemId} className="cart-modal-item" style={{ marginBottom: "10px", position: "relative" }}>
                  <div className="cart-item-thumb">
                    <ProductArt image={item.image} name={item.name} shape={item.shape || "bottle"} />
                  </div>
                  <div className="cart-item-details" style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <h4>{item.name} {qty > 1 ? `(×${qty})` : ""}</h4>
                      {onRemoveItem && (
                        <button
                          type="button"
                          className="cart-item-remove-btn"
                          onClick={() => onRemoveItem(itemId)}
                          aria-label={`Remove ${item.name} from cart`}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <span className="cart-item-sku">SKU: {item.sku || itemId}</span>
                    <div className="cart-item-price-row">
                      <span className="cart-item-price">₹{(price * qty).toLocaleString("en-IN")}</span>
                      {item.isPairUp ? (
                        <span className="cart-pairup-tag">✨ Pair-up item</span>
                      ) : (
                        <span className="cart-item-eco-tag">🌾 100% Upcycled</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : product ? (
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
          ) : null}
        </div>

        {/* Pair-Up 5% Off Suggestions Section */}
        {suggestions && suggestions.length > 0 && (
          <div className="cart-suggestions-section">
            <div className="cart-suggestions-header">
              <span className="cart-suggestions-badge">
                <Sparkles size={14} />
                Extra 5% Off
              </span>
              <h4 className="cart-suggestions-title">
                Pair it up and save 5% on your whole cart
              </h4>
              <p className="cart-suggestions-sub">
                Add any one companion piece below to unlock an extra 5% discount:
              </p>
            </div>

            <div className="cart-suggestions-grid">
              {suggestions.map((item, idx) => {
                const itemId = item.id || item.sku || `sugg_${idx}`;
                const isAdded = cartItems.some(
                  (c) => (c.id === itemId || c.sku === itemId) && c.isPairUp
                );
                const price = Number(item.salePrice || item.price || 0);

                return (
                  <div
                    key={itemId}
                    className={`cart-sugg-card ${isAdded ? "cart-sugg-card--added" : ""}`}
                  >
                    <div className="cart-sugg-thumb">
                      {item.image ? (
                        <img src={item.image} alt={item.name} loading="lazy" />
                      ) : (
                        <ProductArt
                          image={item.image}
                          name={item.name}
                          shape={item.shape || "bottle"}
                        />
                      )}
                    </div>
                    <span className="cart-sugg-name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="cart-sugg-price">
                      ₹{price.toLocaleString("en-IN")}
                    </span>
                    <button
                      type="button"
                      className={`cart-sugg-add-btn ${
                        isAdded
                          ? "cart-sugg-add-btn--added"
                          : "cart-sugg-add-btn--default"
                      }`}
                      onClick={() => onAddPairUp?.(item)}
                      disabled={isAdded}
                      aria-label={
                        isAdded
                          ? `${item.name} added to cart`
                          : `Add ${item.name} for 5% off`
                      }
                    >
                      {isAdded ? "Added ✓" : "+ Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Price & Discount Breakdown */}
        {cartTotals && (
          <div className="cart-modal-price-breakdown" style={{ borderTop: "1px solid #edf1eb", padding: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "16px", color: "#556b2f" }}>
              <span>Subtotal</span>
              <span>₹{cartTotals.subtotal.toLocaleString("en-IN")}</span>
            </div>

            {cartTotals.hasPairUpDiscount && (
              <>
                <div className="cart-discount-row">
                  <span>Pair-up discount (5%)</span>
                  <span className="cart-discount-value">-₹{cartTotals.discount.toLocaleString("en-IN")}</span>
                </div>
                <div className="cart-savings-banner">
                  <span>✨</span>
                  <span>You saved ₹{cartTotals.savings.toLocaleString("en-IN")}!</span>
                </div>
              </>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", fontSize: "20px", fontWeight: "800", color: "#1c2619", borderTop: "1px dashed #dce5da" }}>
              <span>Total</span>
              <span style={{ color: "#2d5a27" }}>₹{cartTotals.total.toLocaleString("en-IN")}</span>
            </div>
          </div>
        )}

        {/* Impact strip */}
        <div className="cart-modal-impact">
          <span>🌱</span>
          <p>Choosing these products diverts <strong>~{itemsCount * 210}g</strong> of crop straw from stubble burning.</p>
        </div>

        {children}

        {/* Action Buttons: Proceed and Skip */}
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
