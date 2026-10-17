"use client";

import React from "react";
import ProductArt from "../products/ProductArt";
import { getPaymentApi } from "@/lib/paymentApi";

export default function OrderSuccessPage({ orderResult, onReturnToCatalog }) {
  if (!orderResult) return null;

  const {
    orderId,
    databaseOrderId,
    orderNumber,
    product,
    quantity = 1,
    selectedColor = "Natural Olive",
    grandTotal,
    amount,
    currency = "INR",
    orderStatus = "confirmed",
    confirmedAt,
    stockConflict = false,
    emailStatus = "sent",
    customer = {},
    paymentMethod = "RAZORPAY",
    timestamp,
  } = orderResult;

  const displayOrderNum = orderNumber || orderId || "GF-ORD";
  const displayAmount = amount !== undefined ? amount : grandTotal;

  const handleFinish = () => {
    try {
      getPaymentApi().finishResolvedCheckout();
    } catch (_) {}
    if (onReturnToCatalog) {
      onReturnToCatalog();
    }
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
          <span className="success-kiosk-tag">
            Verified Website-Backed Order • Razorpay Captured
          </span>
          <h1 className="success-title">
            {stockConflict ? "Payment Received — Under Staff Review" : "Order Placed Successfully!"}
          </h1>
          <p className="success-subtitle">
            Thank you, <strong>{customer.fullName || customer.name || "Valued Customer"}</strong>.{" "}
            {stockConflict
              ? "Payment was received; availability requires staff review."
              : "Your sustainable lifestyle order has been confirmed by the backend."}
          </p>
        </div>

        {/* Order Reference Pill & Database ID */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", margin: "14px 0" }}>
          <div className="order-id-pill">
            <span className="id-label">Order Number:</span>
            <span className="id-code">#{displayOrderNum}</span>
            <span className="id-copy" title="Status">
              ● {orderStatus.toUpperCase()}
            </span>
          </div>

          {databaseOrderId && (
            <div
              style={{
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                padding: "8px 14px",
                borderRadius: "20px",
                fontSize: "12px",
                color: "#4b5563",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>Database ID:</span>
              <strong style={{ fontFamily: "monospace", color: "#111827" }}>{databaseOrderId}</strong>
            </div>
          )}
        </div>

        {/* Status Alert for Stock Review (if applicable) */}
        {stockConflict && (
          <div
            style={{
              background: "#fffbe6",
              border: "1px solid #ffe58f",
              borderRadius: "10px",
              padding: "10px 14px",
              fontSize: "13px",
              color: "#d48806",
              textAlign: "center",
              margin: "10px 0 20px 0",
            }}
          >
            ⚠️ <strong>Stock review required:</strong> Payment received; item availability requires store staff review.
          </div>
        )}

        {/* Item & Summary Box */}
        <div className="success-details-grid">
          <div className="success-product-preview">
            {product && (
              <div className="preview-media">
                <ProductArt image={product.image} name={product.name} shape={product.shape} />
              </div>
            )}
            <div className="preview-meta">
              <h3>{product?.name || "Sustainable Kiosk Selection"}</h3>
              <p>
                Color: {selectedColor} • Qty: {quantity}
              </p>
              <span className="preview-price">
                Total Paid: {currency === "INR" ? "₹" : `${currency} `}
                {typeof displayAmount === "number" ? displayAmount.toLocaleString("en-IN") : displayAmount}
              </span>
            </div>
          </div>

          <div className="success-shipping-preview">
            <h4>Delivery Details</h4>
            <p>
              <strong>Recipient:</strong> {customer.fullName || customer.name} ({customer.phone})
            </p>
            <p>
              <strong>Shipping To:</strong> {customer.address || customer.streetAddress}, {customer.city},{" "}
              {customer.state} - {customer.pincode}
              {customer.landmark ? ` (Landmark: ${customer.landmark})` : ""}
            </p>
            <p>
              <strong>Payment:</strong> {paymentMethod.toUpperCase()} •{" "}
              {confirmedAt
                ? new Date(confirmedAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : timestamp || "Just now"}
            </p>
          </div>
        </div>
        {/* Confirmation Email Notice Card */}
        <div className="success-email-notice-card">
          <div className="email-notice-icon-circle">
            <span>✉️</span>
          </div>
          <div className="email-notice-text">
            <h4>Confirmation Email on the Way</h4>
            <p>
              A confirmation email with your order receipt, invoice, and tracking details will be sent to{" "}
              <strong>{customer.email || "your email address"}</strong>.
            </p>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="success-actions-bar">
          <button type="button" className="return-catalog-btn return-catalog-btn--full" onClick={handleFinish}>
            <span>🛍️ Back to All Products</span>
            <span className="btn-arrow">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
