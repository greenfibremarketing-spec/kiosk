"use client";
import React, { useState } from "react";
import ProductArt from "../products/ProductArt";

export default function CheckoutPage({
  order,
  onBack,
  onOrderSuccess,
}) {
  const { product, selectedColor = "Natural Olive", savings = 0 } = order;

  const [qty, setQty] = useState(order.quantity || 1);
  const [includeGiftWrap, setIncludeGiftWrap] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("upi"); // "upi" | "card" | "cod"

  // Customer form state
  const [formData, setFormData] = useState({
    fullName: "Aarav Sharma",
    phone: "98765 43210",
    email: "aarav.sharma@gmail.com",
    address: "B-402, Green Acre Residences, S.G. Highway",
    city: "Ahmedabad",
    state: "Gujarat",
    pincode: "380054",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const unitPrice = product.salePrice || product.price;
  const itemsSubtotal = unitPrice * qty;
  const grandTotal = itemsSubtotal; // Free shipping and gift wrapping!

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePlaceOrder = (e) => {
    e.preventDefault();
    if (!formData.fullName || !formData.phone || !formData.address) {
      alert("Please fill in your name, phone number, and delivery address.");
      return;
    }

    setIsSubmitting(true);

    // Simulate instant secure processing on kiosk
    setTimeout(() => {
      const generatedOrderId = "GF-" + Math.floor(100000 + Math.random() * 900000);
      onOrderSuccess({
        orderId: generatedOrderId,
        product,
        quantity: qty,
        selectedColor,
        grandTotal,
        customer: formData,
        paymentMethod,
        includeGiftWrap,
        timestamp: new Date().toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    }, 900);
  };

  return (
    <div className="checkout-wrapper" aria-label="Secure Kiosk Checkout">
      {/* ── Top Navigation Bar ── */}
      <nav className="checkout-nav-bar">
        <button
          type="button"
          className="checkout-back-btn"
          onClick={onBack}
          aria-label="Back to Product Details"
        >
          <span className="back-arrow">←</span>
          <span>Back to Product</span>
        </button>

        <div className="checkout-steps-badge">
          <span className="step-dot step-active" />
          <span>Step 2 of 2: Shipping & Payment</span>
        </div>
      </nav>

      {/* ── Main Checkout Columns ── */}
      <form className="checkout-grid" onSubmit={handlePlaceOrder}>
        {/* Left Column: Order Summary */}
        <div className="checkout-summary-col">
          <h2 className="summary-col-title">Order Summary</h2>

          {/* Item Card */}
          <div className="order-item-card">
            <div className="order-item-thumb">
              <ProductArt image={product.image} name={product.name} shape={product.shape} />
            </div>
            <div className="order-item-details">
              <h3 className="order-item-name">{product.name}</h3>
              <span className="order-item-color">Color: {selectedColor}</span>
              <div className="order-item-qty-row">
                <div className="checkout-qty-mini">
                  <button
                    type="button"
                    onClick={() => setQty(Math.max(1, qty - 1))}
                    disabled={qty <= 1}
                  >
                    −
                  </button>
                  <span>{qty}</span>
                  <button type="button" onClick={() => setQty(qty + 1)}>
                    +
                  </button>
                </div>
                <span className="order-item-price">₹{itemsSubtotal}</span>
              </div>
            </div>
          </div>

          {/* Plantable Gift Wrap Toggle */}
          <label className="gift-wrap-option">
            <input
              type="checkbox"
              checked={includeGiftWrap}
              onChange={(e) => setIncludeGiftWrap(e.target.checked)}
            />
            <div className="gift-wrap-meta">
              <strong>🎁 Free Plantable Seed Card & Kraft Box</strong>
              <span>Includes plantable marigold seed paper card and zero-plastic kraft wrap.</span>
            </div>
          </label>

          {/* Eco Guarantee Banner */}
          <div className="checkout-eco-guarantee">
            <span className="eco-badge-icon">🌾</span>
            <div>
              <strong>100% Upcycled Agricultural Biocomposite</strong>
              <p>Your order diverts {qty * 210}g of crop residue from farm burning.</p>
            </div>
          </div>

          {/* Cost Breakdown Table */}
          <div className="checkout-price-table">
            <div className="price-row">
              <span>Item Subtotal ({qty} item{qty > 1 ? "s" : ""})</span>
              <span>₹{itemsSubtotal}</span>
            </div>
            {savings > 0 && (
              <div className="price-row price-row--green">
                <span>Special Kiosk Instant Discount</span>
                <span>-₹{savings}</span>
              </div>
            )}
            <div className="price-row">
              <span>Express Carbon-Neutral Delivery</span>
              <span className="price-free">FREE</span>
            </div>
            <div className="price-row">
              <span>Eco Gift Packaging</span>
              <span className="price-free">FREE</span>
            </div>
            <div className="price-divider" />
            <div className="price-row price-row--total">
              <strong>Total Amount</strong>
              <strong className="grand-total-val">₹{grandTotal}</strong>
            </div>
          </div>
        </div>

        {/* Right Column: Customer Details & Payment */}
        <div className="checkout-form-col">
          {/* Section: Shipping Details */}
          <div className="checkout-card">
            <div className="checkout-card-head">
              <span className="card-num-badge">1</span>
              <h3>Delivery & Contact Information</h3>
            </div>

            <div className="form-fields-grid">
              <div className="form-field form-field--half">
                <label>Full Name *</label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => handleInputChange("fullName", e.target.value)}
                  placeholder="e.g. Aarav Sharma"
                />
              </div>

              <div className="form-field form-field--half">
                <label>Mobile Number (for SMS & WhatsApp Tracking) *</label>
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => handleInputChange("phone", e.target.value)}
                  placeholder="e.g. 98765 43210"
                />
              </div>

              <div className="form-field form-field--full">
                <label>Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  placeholder="name@example.com"
                />
              </div>

              <div className="form-field form-field--full">
                <label>Street Address / Apartment *</label>
                <input
                  type="text"
                  required
                  value={formData.address}
                  onChange={(e) => handleInputChange("address", e.target.value)}
                  placeholder="House number, building name, landmark"
                />
              </div>

              <div className="form-field form-field--third">
                <label>City *</label>
                <input
                  type="text"
                  required
                  value={formData.city}
                  onChange={(e) => handleInputChange("city", e.target.value)}
                />
              </div>

              <div className="form-field form-field--third">
                <label>State *</label>
                <input
                  type="text"
                  required
                  value={formData.state}
                  onChange={(e) => handleInputChange("state", e.target.value)}
                />
              </div>

              <div className="form-field form-field--third">
                <label>PIN Code *</label>
                <input
                  type="text"
                  required
                  value={formData.pincode}
                  onChange={(e) => handleInputChange("pincode", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Section: Payment Method */}
          <div className="checkout-card">
            <div className="checkout-card-head">
              <span className="card-num-badge">2</span>
              <h3>Select Payment Method</h3>
            </div>

            <div className="payment-options-grid">
              <button
                type="button"
                className={`payment-option-card ${paymentMethod === "upi" ? "payment-option-card--active" : ""}`}
                onClick={() => setPaymentMethod("upi")}
              >
                <span className="pay-icon">📱</span>
                <div className="pay-meta">
                  <strong>Instant UPI QR Scan</strong>
                  <span>GPay, PhonePe, Paytm, BHIM</span>
                </div>
                <span className="pay-radio">{paymentMethod === "upi" ? "●" : "○"}</span>
              </button>

              <button
                type="button"
                className={`payment-option-card ${paymentMethod === "card" ? "payment-option-card--active" : ""}`}
                onClick={() => setPaymentMethod("card")}
              >
                <span className="pay-icon">💳</span>
                <div className="pay-meta">
                  <strong>Contactless Card Tap</strong>
                  <span>Debit / Credit Cards & POS</span>
                </div>
                <span className="pay-radio">{paymentMethod === "card" ? "●" : "○"}</span>
              </button>

              <button
                type="button"
                className={`payment-option-card ${paymentMethod === "cod" ? "payment-option-card--active" : ""}`}
                onClick={() => setPaymentMethod("cod")}
              >
                <span className="pay-icon">💵</span>
                <div className="pay-meta">
                  <strong>Pay at Store Counter / Cash</strong>
                  <span>Collect receipt & pay staff</span>
                </div>
                <span className="pay-radio">{paymentMethod === "cod" ? "●" : "○"}</span>
              </button>
            </div>

            {/* Simulated Live Payment QR Code if UPI is selected */}
            {paymentMethod === "upi" && (
              <div className="upi-qr-display-box">
                <div className="qr-visual">
                  <div className="qr-simulated-pattern">
                    <div className="qr-corner qr-tl" />
                    <div className="qr-corner qr-tr" />
                    <div className="qr-corner qr-bl" />
                    <div className="qr-center-logo">🌾</div>
                  </div>
                </div>
                <div className="qr-instructions">
                  <strong>Scan QR with any UPI App</strong>
                  <p>Open Google Pay, PhonePe, or Paytm on your phone to scan and approve ₹{grandTotal}</p>
                  <span className="qr-live-pill">● QR Code Active • Auto-Verification</span>
                </div>
              </div>
            )}
          </div>

          {/* Place Order CTA Button */}
          <button
            type="submit"
            className="checkout-submit-btn"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="submitting-spinner">Processing Secure Kiosk Order...</span>
            ) : (
              <>
                <span className="lock-icon">🔒</span>
                <span className="submit-label">Confirm Order & Pay ₹{grandTotal}</span>
                <span className="submit-arrow">→</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
