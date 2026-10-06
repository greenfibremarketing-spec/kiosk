"use client";
import ProductArt from "./ProductArt";
import PriceTag from "./PriceTag";

export default function ProductDetailModal({ product, onClose, onEnquire }) {
  if (!product) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={onClose}
          aria-label="Close modal"
        >
          ✕
        </button>

        <div className="modal-grid">
          {/* Left: Image */}
          <div className="modal-image-col">
            <ProductArt image={product.image} name={product.name} shape={product.shape} />
            <div className="modal-eco-pill">
              <span>🌾 100% Upcycled Rice-Husk Biocomposite</span>
            </div>
          </div>

          {/* Right: Details & Bulk Tiers */}
          <div className="modal-info-col">
            <div className="modal-header-row">
              {product.badge && <span className="featured__badge">{product.badge}</span>}
              <div className="featured__rating">
                <span className="star-icon">★★★★★</span>
                <strong>{product.rating || "4.9"}</strong>
                <span className="review-num">({product.reviews || 80} reviews)</span>
              </div>
            </div>

            <h2>{product.name}</h2>
            <p className="modal-blurb">{product.blurb}</p>

            <div className="modal-price-box">
              <span className="pricing-label">Single Kiosk Price</span>
              <PriceTag product={product} size="lg" />
            </div>

            {/* Highlights Tags */}
            <div className="modal-tags-list">
              {product.tags?.map((t) => (
                <span key={t} className="modal-tag">✓ {t}</span>
              ))}
            </div>

            {/* Specifications */}
            {product.specs && (
              <div className="modal-specs-list">
                {product.specs.map((s, idx) => (
                  <span key={idx} className="spec-pill">{s}</span>
                ))}
              </div>
            )}

            {/* Corporate Tiered Discounts */}
            <div className="bulk-table">
              <div className="bulk-table-title">💼 Corporate Volume Pricing:</div>
              <div className="bulk-tiers">
                <div className="bulk-tier-item">
                  <span className="tier-qty">25 – 49 units</span>
                  <strong className="tier-disc">15% OFF</strong>
                </div>
                <div className="bulk-tier-item">
                  <span className="tier-qty">50 – 99 units</span>
                  <strong className="tier-disc">25% OFF + Free Logo</strong>
                </div>
                <div className="bulk-tier-item tier-best">
                  <span className="tier-qty">100+ units</span>
                  <strong className="tier-disc">35% OFF + Custom Packaging</strong>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="modal-actions">
              <button
                type="button"
                className="cta cta--primary"
                onClick={() => {
                  onEnquire();
                  onClose();
                }}
              >
                <span>Request Bulk Corporate Quote</span>
                <span className="cta-arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
