"use client";
import React, { useState } from "react";

export default function RazorpayModal({
  isOpen,
  onClose,
  amount,
  customer,
  productName,
  onPaymentSuccess,
}) {
  const [activeTab, setActiveTab] = useState("upi"); // "upi" | "card" | "netbanking"
  const [upiId, setUpiId] = useState("");
  const [selectedBank, setSelectedBank] = useState("HDFC");
  const [cardNumber, setCardNumber] = useState("4532 •••• •••• 8912");
  const [cardExpiry, setCardExpiry] = useState("08/29");
  const [cardCvv, setCardCvv] = useState("892");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaid, setIsPaid] = useState(false);

  if (!isOpen) return null;

  const handlePay = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setIsPaid(true);
      setTimeout(() => {
        onPaymentSuccess({
          paymentId: "pay_" + Math.random().toString(36).substring(2, 12).toUpperCase(),
          method: activeTab.toUpperCase(),
        });
      }, 700);
    }, 1200);
  };

  return (
    <div className="rzp-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="rzp-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* ── Razorpay Header Bar ── */}
        <div className="rzp-header">
          <div className="rzp-header-merchant">
            <div className="rzp-merchant-avatar">🌾</div>
            <div className="rzp-merchant-info">
              <span className="rzp-merchant-name">GreenFibre Eco Living</span>
              <span className="rzp-product-desc">{productName || "Sustainable Biocomposite Kiosk Order"}</span>
            </div>
          </div>

          <div className="rzp-header-amount">
            <span className="rzp-amount-label">AMOUNT TO PAY</span>
            <span className="rzp-amount-val">₹{amount}</span>
          </div>

          <button
            type="button"
            className="rzp-close-btn"
            onClick={onClose}
            aria-label="Close Razorpay checkout"
          >
            ✕
          </button>
        </div>

        {/* ── Customer Contact Pill ── */}
        <div className="rzp-contact-strip">
          <div className="rzp-contact-item">
            <span className="rzp-contact-icon">👤</span>
            <span>{customer?.fullName || "Guest Customer"}</span>
          </div>
          <div className="rzp-contact-item">
            <span className="rzp-contact-icon">📱</span>
            <span>+91 {customer?.phone || "98765 43210"}</span>
          </div>
          <div className="rzp-secure-badge">
            <span>🔒 Trusted Business</span>
          </div>
        </div>

        {/* ── Razorpay Body: Methods Navigation & View ── */}
        <div className="rzp-body-grid">
          {/* Left Navigation Tabs */}
          <nav className="rzp-tabs-sidebar" aria-label="Payment Methods">
            <button
              type="button"
              className={`rzp-tab-btn ${activeTab === "upi" ? "rzp-tab-btn--active" : ""}`}
              onClick={() => setActiveTab("upi")}
            >
              <span className="rzp-tab-icon">📱</span>
              <div className="rzp-tab-text">
                <strong>UPI / QR</strong>
                <small>Google Pay, PhonePe, Paytm</small>
              </div>
              <span className="rzp-tab-arrow">›</span>
            </button>

            <button
              type="button"
              className={`rzp-tab-btn ${activeTab === "card" ? "rzp-tab-btn--active" : ""}`}
              onClick={() => setActiveTab("card")}
            >
              <span className="rzp-tab-icon">💳</span>
              <div className="rzp-tab-text">
                <strong>Cards</strong>
                <small>Visa, MasterCard, RuPay</small>
              </div>
              <span className="rzp-tab-arrow">›</span>
            </button>

            <button
              type="button"
              className={`rzp-tab-btn ${activeTab === "netbanking" ? "rzp-tab-btn--active" : ""}`}
              onClick={() => setActiveTab("netbanking")}
            >
              <span className="rzp-tab-icon">🏦</span>
              <div className="rzp-tab-text">
                <strong>Netbanking</strong>
                <small>All Indian Banks</small>
              </div>
              <span className="rzp-tab-arrow">›</span>
            </button>
          </nav>

          {/* Right Method Stage */}
          <div className="rzp-method-stage">
            {/* UPI View */}
            {activeTab === "upi" && (
              <div className="rzp-view rzp-view-upi">
                <div className="rzp-qr-hero">
                  <div className="rzp-qr-wrapper">
                    <div className="rzp-qr-matrix">
                      <div className="rzp-qr-corner tl" />
                      <div className="rzp-qr-corner tr" />
                      <div className="rzp-qr-corner bl" />
                      <div className="rzp-qr-center-leaf">🌾</div>
                    </div>
                  </div>
                  <div className="rzp-qr-instructions">
                    <h4>Scan to Pay ₹{amount}</h4>
                    <p>Open any UPI app (GPay, PhonePe, Paytm, CRED) & scan this dynamic code.</p>
                    <div className="rzp-upi-logos-row">
                      <span className="upi-app-badge">GPay</span>
                      <span className="upi-app-badge">PhonePe</span>
                      <span className="upi-app-badge">Paytm</span>
                      <span className="upi-app-badge">BHIM</span>
                    </div>
                  </div>
                </div>

                <div className="rzp-upi-divider">
                  <span>OR ENTER UPI ID</span>
                </div>

                <div className="rzp-upi-input-group">
                  <input
                    type="text"
                    placeholder="e.g. mobile@upi or username@okhdfcbank"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                  />
                  <span className="rzp-upi-verify-tag">Verified ✓</span>
                </div>
              </div>
            )}

            {/* Card View */}
            {activeTab === "card" && (
              <div className="rzp-view rzp-view-card">
                <div className="rzp-card-header">
                  <h4>Enter Card Details</h4>
                  <div className="rzp-card-brands">
                    <span className="brand-chip">VISA</span>
                    <span className="brand-chip">MC</span>
                    <span className="brand-chip">RuPay</span>
                  </div>
                </div>

                <div className="rzp-input-box">
                  <label>Card Number</label>
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="1234 5678 9101 1121"
                  />
                </div>

                <div className="rzp-card-dual-row">
                  <div className="rzp-input-box">
                    <label>Expires</label>
                    <input
                      type="text"
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(e.target.value)}
                      placeholder="MM/YY"
                    />
                  </div>
                  <div className="rzp-input-box">
                    <label>CVV</label>
                    <input
                      type="password"
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                      placeholder="•••"
                      maxLength={4}
                    />
                  </div>
                </div>

                <div className="rzp-card-secure-note">
                  <span>🔒 Card info is encrypted using 256-bit SSL</span>
                </div>
              </div>
            )}

            {/* Netbanking View */}
            {activeTab === "netbanking" && (
              <div className="rzp-view rzp-view-banks">
                <h4>Popular Banks</h4>
                <div className="rzp-banks-grid">
                  {["HDFC", "SBI", "ICICI", "Axis", "Kotak", "PNB"].map((bank) => (
                    <button
                      key={bank}
                      type="button"
                      className={`rzp-bank-chip ${selectedBank === bank ? "rzp-bank-chip--active" : ""}`}
                      onClick={() => setSelectedBank(bank)}
                    >
                      <span className="bank-icon">🏛️</span>
                      <span>{bank} Bank</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Razorpay Footer Bar ── */}
        <div className="rzp-footer">
          <div className="rzp-security-tag">
            <span className="rzp-shield-icon">🛡️</span>
            <span>Secured by <strong>Razorpay</strong> • PCI-DSS Certified</span>
          </div>

          <button
            type="button"
            className={`rzp-submit-pay-btn ${isPaid ? "rzp-submit-pay-btn--success" : ""}`}
            onClick={handlePay}
            disabled={isProcessing || isPaid}
          >
            {isProcessing ? (
              <span className="rzp-btn-loader">Verifying with Bank...</span>
            ) : isPaid ? (
              <span className="rzp-btn-success">✓ Payment Approved!</span>
            ) : (
              <>
                <span className="btn-lock">🔒</span>
                <span>Pay ₹{amount}</span>
                <span className="btn-arrow">→</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
