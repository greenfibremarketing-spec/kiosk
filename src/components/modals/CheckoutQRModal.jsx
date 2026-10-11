"use client";
import React, { useState } from "react";
import ProductArt from "../products/ProductArt";

export default function CheckoutQRModal({
  isOpen,
  onClose,
  sku,
  productUrl,
  product,
  onComplete,
}) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const resolvedUrl =
    productUrl ||
    (sku ? `https://greenfibre.org/product/${encodeURIComponent(sku)}` : "https://greenfibre.org/checkout");

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&color=14271c&bgcolor=ffffff&data=${encodeURIComponent(
    resolvedUrl
  )}`;

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(resolvedUrl).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="qr-modal-backdrop" onClick={onClose} aria-label="Mobile Checkout QR Screen">
      <div className="qr-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button type="button" className="qr-modal-close" onClick={onClose} aria-label="Close QR Modal">
          ✕
        </button>

        {/* Modal Header */}
        <div className="qr-modal-header">
          <div className="qr-header-badge">📱 Mobile Express Pay</div>
          <h2>Scan & Pay on Your Phone</h2>
          <p>Complete your checkout seamlessly on your phone browser or payment app.</p>
        </div>

        {/* QR Code Presentation Box */}
        <div className="qr-code-box">
          <div className="qr-image-wrapper">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImageUrl}
              alt="Scan QR code to checkout on phone"
              className="qr-image"
              width={220}
              height={220}
            />
            <div className="qr-scan-line" />
          </div>
          <span className="qr-scan-caption">📷 Point your phone camera or Google Lens here</span>
        </div>

        {/* Product Meta Card */}
        {product && (
          <div className="qr-product-preview">
            <div className="qr-product-thumb">
              <ProductArt image={product.image} name={product.name} shape={product.shape || "bottle"} />
            </div>
            <div className="qr-product-info">
              <h4>{product.name}</h4>
              <span className="qr-sku">SKU: {sku || product.sku || product.id}</span>
              <strong className="qr-price">₹{product.salePrice || product.price || 999}</strong>
            </div>
          </div>
        )}

        {/* Supported Payment Badges */}
        <div className="qr-supported-badges">
          <span className="pay-chip">UPI</span>
          <span className="pay-chip">GPay</span>
          <span className="pay-chip">PhonePe</span>
          <span className="pay-chip">Paytm</span>
          <span className="pay-chip">Cards</span>
        </div>

        {/* Action Row */}
        <div className="qr-modal-actions">
          <button
            type="button"
            className="qr-btn-copy"
            onClick={handleCopy}
            title="Copy checkout URL"
          >
            <span>{copied ? "✓ Link Copied" : "🔗 Copy Link"}</span>
          </button>
          <button
            type="button"
            className="qr-btn-done"
            onClick={() => {
              onComplete?.();
              onClose?.();
            }}
          >
            <span>Done / Return to Kiosk</span>
          </button>
        </div>
      </div>
    </div>
  );
}
