"use client";
import React, { useState } from "react";
import ProductArt from "../products/ProductArt";

export default function OrderSuccessPage({ orderResult, onReturnToCatalog }) {
  const [printed, setPrinted] = useState(false);
  if (!orderResult) return null;

  const {
    orderId,
    product,
    quantity,
    selectedColor,
    grandTotal,
    customer,
    paymentMethod,
    timestamp,
  } = orderResult;

  const handlePrintSlip = () => {
    setPrinted(true);
    setTimeout(() => {
      alert(`Receipt for Order #${orderId} printed at Kiosk Terminal #GF-04.`);
    }, 400);
  };

  return (
    <div className="success-wrapper" aria-label="Order Confirmation">
      {/* ── Main Success Card ── */}
      <div className="success-card">
        {/* Animated Celebration Icon */}
        <div className="success-badge-glow">
          <div className="success-check-circle">
            <span className="success-leaf-anim">🍃</span>
            <span className="success-check-icon">✓</span>
          </div>
        </div>

        <div className="success-header">
          <span className="success-kiosk-tag">Kiosk Terminal #GF-04 • Verified Payment</span>
          <h1 className="success-title">Order Placed Successfully!</h1>
          <p className="success-subtitle">
            Thank you, <strong>{customer.fullName}</strong>. Your sustainable lifestyle order has been confirmed.
          </p>
        </div>

        {/* Order Reference Pill */}
        <div className="order-id-pill">
          <span className="id-label">Order Reference:</span>
          <span className="id-code">#{orderId}</span>
          <span className="id-copy" title="Saved">● Confirmed</span>
        </div>

        {/* Item & Summary Box */}
        <div className="success-details-grid">
          <div className="success-product-preview">
            <div className="preview-media">
              <ProductArt image={product.image} name={product.name} shape={product.shape} />
            </div>
            <div className="preview-meta">
              <h3>{product.name}</h3>
              <p>Color: {selectedColor} • Qty: {quantity}</p>
              <span className="preview-price">Total Paid: ₹{grandTotal}</span>
            </div>
          </div>

          <div className="success-shipping-preview">
            <h4>Delivery Details</h4>
            <p><strong>Recipient:</strong> {customer.fullName} ({customer.phone})</p>
            <p><strong>Shipping To:</strong> {customer.address}, {customer.city}, {customer.state} - {customer.pincode}</p>
            <p><strong>Payment:</strong> {paymentMethod.toUpperCase()} • {timestamp}</p>
          </div>
        </div>

        {/* Eco Impact Certificate */}
        <div className="eco-impact-certificate">
          <div className="certificate-top">
            <span className="cert-badge">🌱 Circular Footprint Certificate</span>
          </div>
          <div className="cert-stats-row">
            <div className="cert-stat">
              <span className="stat-number">{(quantity * 210)}g</span>
              <span className="stat-desc">Agricultural Stubble Diverted</span>
            </div>
            <div className="cert-stat">
              <span className="stat-number">100%</span>
              <span className="stat-desc">Zero Virgin Plastic Guarantee</span>
            </div>
            <div className="cert-stat">
              <span className="stat-number">-40%</span>
              <span className="stat-desc">Carbon Dioxide Reduction</span>
            </div>
          </div>
          <p className="cert-footnote">
            Every unit produced prevents open field crop burning in North India, reducing air pollution while fostering circular design.
          </p>
        </div>

        {/* Actions Bar */}
        <div className="success-actions-bar">
          <button
            type="button"
            className="print-slip-btn"
            onClick={handlePrintSlip}
          >
            <span className="btn-icon">🖨️</span>
            <span>{printed ? "Receipt Slip Printed" : "Print Kiosk Receipt Slip"}</span>
          </button>

          <button
            type="button"
            className="return-catalog-btn"
            onClick={onReturnToCatalog}
          >
            <span>🛍️ Back to All Products</span>
            <span className="btn-arrow">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
