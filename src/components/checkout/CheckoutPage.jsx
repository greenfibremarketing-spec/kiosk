"use client";
import React, { useState } from "react";
import ProductArt from "../products/ProductArt";
import RazorpayModal from "./RazorpayModal";

export default function CheckoutPage({
  order,
  onBack,
  onOrderSuccess,
}) {
  const { product, selectedColor = "Natural Olive", savings = 0 } = order;

  const [qty, setQty] = useState(order.quantity || 1);
  const [includeGiftWrap, setIncludeGiftWrap] = useState(true);
  const [isRazorpayOpen, setIsRazorpayOpen] = useState(false);

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

  const unitPrice = product.salePrice || product.price;
  const itemsSubtotal = unitPrice * qty;
  const grandTotal = itemsSubtotal;

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleProceedToPay = (e) => {
    e.preventDefault();
    if (!formData.fullName || !formData.phone || !formData.address) {
      alert("Please enter your name, mobile number, and delivery address.");
      return;
    }
    // Automatically open the Razorpay payment popup!
    setIsRazorpayOpen(true);
  };

  const handlePaymentSuccess = (paymentDetails) => {
    setIsRazorpayOpen(false);
    const generatedOrderId = "GF-" + Math.floor(100000 + Math.random() * 900000);
    onOrderSuccess({
      orderId: generatedOrderId,
      paymentId: paymentDetails.paymentId,
      product,
      quantity: qty,
      selectedColor,
      grandTotal,
      customer: formData,
      paymentMethod: paymentDetails.method || "RAZORPAY_UPI",
      includeGiftWrap,
      timestamp: new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
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
      <form className="checkout-grid" onSubmit={handleProceedToPay}>
        {/* Left Column: Order Summary & Eco Bag */}
        <div className="checkout-summary-col">
          <div className="summary-header-row">
            <h2 className="summary-col-title">Order Bag</h2>
            <span className="bag-count-pill">{qty} Item{qty > 1 ? "s" : ""}</span>
          </div>

          {/* Item Card */}
          <div className="order-item-card">
            <div className="order-item-thumb">
              <ProductArt image={product.image} name={product.name} shape={product.shape} />
            </div>
            <div className="order-item-details">
              <h3 className="order-item-name">{product.name}</h3>
              <span className="order-item-color">Finish: {selectedColor}</span>
              <div className="order-item-qty-row">
                <div className="checkout-qty-mini">
                  <button
                    type="button"
                    onClick={() => setQty(Math.max(1, qty - 1))}
                    disabled={qty <= 1}
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <span>{qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty(qty + 1)}
                    aria-label="Increase quantity"
                  >
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
              <p>Your order diverts {qty * 210}g of crop residue from open-field burning.</p>
            </div>
          </div>

          {/* Cost Breakdown Table */}
          <div className="checkout-price-table">
            <div className="price-row">
              <span>Item Subtotal ({qty} unit{qty > 1 ? "s" : ""})</span>
              <span>₹{itemsSubtotal}</span>
            </div>
            {savings > 0 && (
              <div className="price-row price-row--green">
                <span>Special Kiosk Instant Discount</span>
                <span>-₹{savings}</span>
              </div>
            )}
            <div className="price-row">
              <span>Carbon-Neutral Courier Delivery</span>
              <span className="price-free">FREE</span>
            </div>
            <div className="price-row">
              <span>Eco Gift Packaging</span>
              <span className="price-free">FREE</span>
            </div>
            <div className="price-divider" />
            <div className="price-row price-row--total">
              <strong>Grand Total</strong>
              <strong className="grand-total-val">₹{grandTotal}</strong>
            </div>
          </div>
        </div>

        {/* Right Column: Customer Details & Proceed to Pay CTA */}
        <div className="checkout-form-col">
          {/* Section: Shipping Details */}
          <div className="checkout-card">
            <div className="checkout-card-head">
              <span className="card-num-badge">1</span>
              <div>
                <h3>Delivery Address & Contact</h3>
                <p className="card-head-sub">Where should we deliver your handcrafted eco products?</p>
              </div>
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
                <label>Mobile Number (for WhatsApp/SMS tracking) *</label>
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
                <label>Street Address / Apartment / Landmark *</label>
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

          {/* Section: Proceed to Pay Banner with Razorpay Trust */}
          <div className="checkout-payment-box">
            <div className="payment-gateway-strip">
              <div className="gateway-brand">
                <span className="gateway-logo">⚡</span>
                <div>
                  <strong>Razorpay Secure Checkout</strong>
                  <span>Supports GPay, PhonePe, Paytm, All Cards & Netbanking</span>
                </div>
              </div>
              <div className="gateway-badges">
                <span className="pay-tag">UPI</span>
                <span className="pay-tag">CARDS</span>
                <span className="pay-tag">NETBANKING</span>
              </div>
            </div>

            {/* Direct Proceed to Pay Button */}
            <button
              type="submit"
              className="checkout-proceed-btn"
            >
              <div className="btn-content-left">
                <span className="lock-emblem">🔒</span>
                <span className="btn-main-title">Proceed to Pay</span>
              </div>
              <div className="btn-content-right">
                <span className="btn-amount-badge">₹{grandTotal}</span>
                <span className="btn-arrow">→</span>
              </div>
            </button>

            <p className="checkout-trust-footnote">
              Clicking &ldquo;Proceed to Pay&rdquo; will open the official Razorpay payment window automatically.
            </p>
          </div>
        </div>
      </form>

      {/* ── Official Razorpay Modal Overlay ── */}
      <RazorpayModal
        isOpen={isRazorpayOpen}
        onClose={() => setIsRazorpayOpen(false)}
        amount={grandTotal}
        customer={formData}
        productName={product.name}
        onPaymentSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
