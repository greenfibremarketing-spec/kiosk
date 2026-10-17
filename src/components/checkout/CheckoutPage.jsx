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
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false);

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

  const hasCartItems = Array.isArray(order.cartItems) && order.cartItems.length > 0;
  const unitPrice = product.salePrice || product.price || 0;
  const itemsSubtotal = hasCartItems
    ? order.cartTotals?.subtotal ||
      order.cartItems.reduce(
        (acc, i) => acc + Number(i.price || i.salePrice || 0) * (Number(i.quantity) || 1),
        0
      )
    : unitPrice * qty;

  const pairUpDiscount =
    hasCartItems && order.cartTotals?.hasPairUpDiscount
      ? order.cartTotals.discount
      : 0;

  const grandTotal = Math.max(0, itemsSubtotal - pairUpDiscount);
  const totalUnits = hasCartItems
    ? order.cartItems.reduce((acc, i) => acc + (Number(i.quantity) || 1), 0)
    : qty;

  const handleInputChange = (field, value) => {
    if (field === "phone") {
      // Keep only digits and prevent exceeding 10 digits
      const numeric = value.replace(/\D/g, "").slice(0, 10);
      setFormData((prev) => ({ ...prev, phone: numeric }));
      return;
    }
    if (field === "pincode") {
      // Keep only digits and prevent exceeding 6 digits
      const numeric = value.replace(/\D/g, "").slice(0, 6);
      setFormData((prev) => ({ ...prev, pincode: numeric }));
      return;
    }
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleProceedToPay = (e) => {
    e.preventDefault();
    if (!formData.fullName.trim() || !formData.address.trim()) {
      alert("Please enter your full name and delivery address.");
      return;
    }

    // Phone validation: exactly 10 digits (standard Indian mobile starting with 6-9)
    const cleanPhone = (formData.phone || "").replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length !== 10) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      alert("Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.");
      return;
    }

    // Email validation: proper user@domain.com format
    const email = (formData.email || "").trim();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!email) {
      alert("Please enter your email address.");
      return;
    }
    if (!emailRegex.test(email)) {
      alert("Please enter a valid email address (e.g. yourname@gmail.com).");
      return;
    }

    if (!formData.city.trim() || !formData.state.trim() || !formData.pincode.trim()) {
      alert("Please fill in your city, state, and PIN code.");
      return;
    }

    if (!deliveryConfirmed) {
      alert("Please confirm that you understand your order will be delivered on 28th–29th.");
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
            <span className="bag-count-pill">{totalUnits} Item{totalUnits > 1 ? "s" : ""}</span>
          </div>

          {/* Cart Item(s) */}
          {hasCartItems ? (
            order.cartItems.map((item, idx) => {
              const itemId = item.id || item.sku || `co_${idx}`;
              const itemQty = Number(item.quantity) || 1;
              const price = Number(item.price || item.salePrice || 0);
              return (
                <div key={itemId} className="order-item-card" style={{ marginBottom: "12px" }}>
                  <div className="order-item-thumb">
                    <ProductArt image={item.image} name={item.name} shape={item.shape} />
                  </div>
                  <div className="order-item-details">
                    <h3 className="order-item-name">{item.name}</h3>
                    <span className="order-item-color">Finish: {item.selectedColor || selectedColor}</span>
                    <div className="order-item-qty-row">
                      <span style={{ fontSize: "16px", fontWeight: "600", color: "#4a5c46" }}>Qty: {itemQty}</span>
                      <span className="order-item-price">₹{(price * itemQty).toLocaleString("en-IN")}</span>
                    </div>
                    {item.isPairUp && (
                      <div style={{ marginTop: "4px" }}>
                        <span className="cart-pairup-tag">✨ Pair-up item</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
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
          )}

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
              <p>Your order diverts {totalUnits * 210}g of crop residue from open-field burning.</p>
            </div>
          </div>

          {/* Cost Breakdown Table */}
          <div className="checkout-price-table">
            <div className="price-row">
              <span>Item Subtotal ({totalUnits} unit{totalUnits > 1 ? "s" : ""})</span>
              <span>₹{itemsSubtotal.toLocaleString("en-IN")}</span>
            </div>
            {pairUpDiscount > 0 && (
              <>
                <div className="price-row price-row--green">
                  <span>Pair-up discount (5%)</span>
                  <span style={{ color: "#2e7d32", fontWeight: "700" }}>-₹{pairUpDiscount.toLocaleString("en-IN")}</span>
                </div>
                <div className="cart-savings-banner" style={{ margin: "6px 0", fontSize: "15px" }}>
                  <span>✨</span>
                  <span>You saved ₹{pairUpDiscount.toLocaleString("en-IN")} (5% off whole cart)</span>
                </div>
              </>
            )}
            {savings > 0 && pairUpDiscount === 0 && (
              <div className="price-row price-row--green">
                <span>Special Kiosk Instant Discount</span>
                <span>-₹{savings.toLocaleString("en-IN")}</span>
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
              <strong className="grand-total-val">₹{grandTotal.toLocaleString("en-IN")}</strong>
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
                  maxLength={10}
                  inputMode="numeric"
                  value={formData.phone}
                  onChange={(e) => handleInputChange("phone", e.target.value)}
                  placeholder="e.g. 9876543210"
                />
              </div>

              <div className="form-field form-field--full">
                <label>Email Address *</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  placeholder="e.g. aarav.sharma@gmail.com"
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
                  maxLength={6}
                  inputMode="numeric"
                  value={formData.pincode}
                  onChange={(e) => handleInputChange("pincode", e.target.value)}
                  placeholder="e.g. 380054"
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

            {/* Delivery Notice Box */}
            <div
              className="delivery-notice-box"
              style={{
                background: "#fdfaf3",
                border: "1.5px solid #ebdfce",
                borderRadius: "14px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <strong style={{ fontSize: "14px", fontWeight: "800", color: "#14271c" }}>
                  📦 Important Delivery Information
                </strong>
              </div>
              <p style={{ margin: 0, fontSize: "12.5px", color: "#4a6153", lineHeight: "1.4" }}>
                Our B2B store goes live on the 25th. Orders placed now will be delivered between 28th – 29th.
              </p>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginTop: "4px",
                  paddingTop: "10px",
                  borderTop: "1px solid #ebdfce",
                  cursor: "pointer",
                  fontSize: "12.5px",
                  fontWeight: "700",
                  color: "#14271c",
                }}
              >
                <input
                  type="checkbox"
                  checked={deliveryConfirmed}
                  onChange={(e) => setDeliveryConfirmed(e.target.checked)}
                  style={{
                    width: "18px",
                    height: "18px",
                    accentColor: "#00A63E",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />
                <span>I understand my order will be delivered on 28th–29th. *</span>
              </label>
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
