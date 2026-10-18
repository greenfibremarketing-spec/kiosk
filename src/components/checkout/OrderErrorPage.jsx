"use client";

import React, { useState } from "react";
import ProductArt from "../products/ProductArt";
import { getPaymentApi } from "@/lib/paymentApi";

export default function OrderErrorPage({
  orderError,
  onRetry,
  onReturnToCatalog,
}) {
  const [assistanceRequested, setAssistanceRequested] = useState(false);
  if (!orderError) return null;

  const isPrelaunch = orderError?.isPrelaunch === true;

  const {
    title = isPrelaunch ? "Could Not Submit Details" : "Order Could Not Be Completed",
    message = isPrelaunch
      ? "We could not save your details right now. Please try submitting again or speak to our staff."
      : "Your payment could not be verified by the store backend. No charges were captured.",
    orderId,
    databaseOrderId,
    orderNumber,
    product,
    items = [],
    quantity = 1,
    selectedColor = "Natural Olive",
    grandTotal,
    amount,
    currency = "INR",
    customer = {},
    failureReason,
  } = orderError;

  const displayOrderNum = orderNumber || orderId || null;
  const displayAmount = amount !== undefined ? amount : grandTotal;
  const activeProduct = product || items[0] || null;

  const handleCallAssistance = () => {
    setAssistanceRequested(true);
    alert("Store staff at Kiosk Terminal has been notified to assist with your order.");
  };

  const handleCancelAndLeave = () => {
    if (!isPrelaunch) {
      try {
        getPaymentApi().finishResolvedCheckout();
      } catch (_) {}
    }
    if (onReturnToCatalog) {
      onReturnToCatalog();
    }
  };

  return (
    <div className="error-wrapper" aria-label="Order Placement Error">
      {/* ── Main Error Card ── */}
      <div className="error-card">
        {/* Animated Warning / Error Icon */}
        <div className="error-badge-glow">
          <div className="error-cross-circle">
            <span className="error-alert-icon">⚠️</span>
            <span className="error-cross-icon">✕</span>
          </div>
        </div>

        <div className="error-header">
          <span className="error-kiosk-tag">
            {isPrelaunch ? "Submission Incomplete" : "Payment Not Verified • Order Not Placed"}
          </span>
          <h1 className="error-title">{title}</h1>
          <p className="error-subtitle">
            {message}
          </p>
        </div>

        {/* Order Identifier if created (Payment Mode Only) */}
        {!isPrelaunch && displayOrderNum && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", margin: "10px 0" }}>
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                padding: "8px 16px",
                borderRadius: "20px",
                fontSize: "13px",
                color: "#b91c1c",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>Attempt Reference:</span>
              <strong style={{ fontFamily: "monospace" }}>#{displayOrderNum}</strong>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#dc2626" }}>● UNVERIFIED</span>
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
        )}

        {/* Reassurance Banner */}
        <div
          style={{
            width: "100%",
            background: "#fff7ed",
            border: "1.5px solid #ffedd5",
            borderRadius: "14px",
            padding: "16px 20px",
            textAlign: "left",
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            boxSizing: "border-box",
          }}
        >
          <span style={{ fontSize: "22px", flexShrink: 0 }}>🛡️</span>
          <div style={{ fontSize: "13px", color: "#7c2d12", lineHeight: "1.45" }}>
            {isPrelaunch ? (
              <>
                <strong style={{ display: "block", fontSize: "14px", color: "#9a3412", marginBottom: "4px" }}>
                  No Payment Required
                </strong>
                No charges or payments were attempted. Your details have been preserved so you can retry immediately.
              </>
            ) : (
              <>
                <strong style={{ display: "block", fontSize: "14px", color: "#9a3412", marginBottom: "4px" }}>
                  Your Money is Safe
                </strong>
                No order was confirmed in the store backend. If your bank account or UPI app shows any debited amount, Razorpay and your bank will automatically reverse it within <strong>3 to 5 business days</strong>.
                {failureReason && (
                  <div style={{ marginTop: "6px", fontSize: "12px", color: "#b45309" }}>
                    <strong>Bank Reason:</strong> {failureReason}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Item & Summary Box */}
        {activeProduct && (
          <div className="error-details-grid" style={{ width: "100%", boxSizing: "border-box" }}>
            <div className="error-product-preview">
              <div className="preview-media">
                <ProductArt image={activeProduct.image} name={activeProduct.name} shape={activeProduct.shape} />
              </div>
              <div className="preview-meta">
                <h3>{activeProduct.name}</h3>
                <p>Color: {selectedColor} • Qty: {quantity}</p>
                {!isPrelaunch && (
                  <span className="preview-price" style={{ color: "#b91c1c" }}>
                    Attempted Amount: {currency === "INR" ? "₹" : `${currency} `}
                    {typeof displayAmount === "number" ? displayAmount.toLocaleString("en-IN") : displayAmount}
                  </span>
                )}
              </div>
            </div>

            <div className="error-shipping-preview">
              <h4>Preserved Delivery Details</h4>
              <p><strong>Recipient:</strong> {customer.fullName || customer.name || "Customer"} ({customer.phone})</p>
              <p><strong>Delivery:</strong> {customer.address || customer.streetAddress}, {customer.city}, {customer.state} - {customer.pincode}</p>
              <p style={{ color: "#6b7280", fontSize: "12px" }}>Your address details are saved so you can retry without re-typing.</p>
            </div>
          </div>
        )}

        {/* Actions Bar */}
        <div className="error-actions-bar">
          <button
            type="button"
            className="error-retry-btn"
            onClick={onRetry}
          >
            <span className="btn-icon">🔄</span>
            <span>{isPrelaunch ? "Try Submitting Again" : "Try Payment Again"}</span>
            <span className="btn-arrow">→</span>
          </button>

          <button
            type="button"
            className="error-assist-btn"
            onClick={handleCallAssistance}
          >
            <span className="btn-icon">🛎️</span>
            <span>{assistanceRequested ? "Staff Alerted" : "Call Staff Assistance"}</span>
          </button>

          <button
            type="button"
            className="error-catalog-btn"
            onClick={handleCancelAndLeave}
          >
            <span>🛍️ Back to Products</span>
          </button>
        </div>
      </div>
    </div>
  );
}
