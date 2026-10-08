"use client";
import React, { useState } from "react";
import ProductArt from "./ProductArt";
import PriceTag from "./PriceTag";
import { PRODUCTS } from "@/data/products";

export default function ProductDetailPage({
  product,
  onBack,
  onProceedToCheckout,
  onSelectProduct,
}) {
  const [quantity, setQuantity] = useState(1);
  const [selectedColor, setSelectedColor] = useState("Natural Olive");

  if (!product) return null;

  // Recommended products (excluding current, prefer same category or complementary)
  const recommended = PRODUCTS.filter((p) => p.id !== product.id)
    .sort((a, b) => {
      const aOverlap = a.categories.filter((c) => product.categories.includes(c)).length;
      const bOverlap = b.categories.filter((c) => product.categories.includes(c)).length;
      return bOverlap - aOverlap;
    })
    .slice(0, 3);

  const colors = [
    { name: "Natural Olive", hex: "#4a6741" },
    { name: "Raw Husk Cream", hex: "#e2d7c0" },
    { name: "Earthy Terracotta", hex: "#b4654a" },
  ];

  const unitPrice = product.salePrice || product.price;
  const totalPrice = unitPrice * quantity;
  const savings = product.salePrice ? (product.price - product.salePrice) * quantity : 0;

  return (
    <div className="pdp-wrapper" aria-label={`Details for ${product.name}`}>
      {/* ── Breadcrumb & Back Bar ── */}
      <nav className="pdp-nav-bar">
        <button
          type="button"
          className="pdp-back-btn"
          onClick={onBack}
          aria-label="Back to Catalog"
        >
          <span className="back-arrow">←</span>
          <span>Back to Catalog</span>
        </button>

        <div className="pdp-breadcrumbs">
          <span className="crumb crumb-dim" onClick={onBack}>Products</span>
          <span className="crumb-sep">/</span>
          <span className="crumb crumb-active">{product.name}</span>
        </div>
      </nav>

      {/* ── Main Product Hero ── */}
      <div className="pdp-hero-grid">
        {/* Left Column: Media Stage & Eco Callouts */}
        <div className="pdp-media-col">
          <div className="pdp-image-stage">
            {product.badge && <span className="pdp-floating-badge">{product.badge}</span>}
            <ProductArt image={product.image} name={product.name} shape={product.shape} />
            <div className="pdp-image-glow" />
          </div>

          <div className="pdp-eco-proof-strip">
            <div className="eco-proof-item">
              <span className="proof-icon">🌾</span>
              <div>
                <strong>100% Upcycled</strong>
                <span>Rice-husk biocomposite</span>
              </div>
            </div>
            <div className="eco-proof-item">
              <span className="proof-icon">🚫</span>
              <div>
                <strong>0% Virgin Plastic</strong>
                <span>Non-toxic & food grade</span>
              </div>
            </div>
            <div className="eco-proof-item">
              <span className="proof-icon">♻️</span>
              <div>
                <strong>BPA & Toxin Free</strong>
                <span>Dishwasher safe</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Information, Specs & Buy Box */}
        <div className="pdp-info-col">
          {/* Header & Reviews */}
          <div className="pdp-header">
            <div className="pdp-rating-row">
              <div className="pdp-stars">★★★★★</div>
              <span className="pdp-rating-score">{product.rating || "4.9"}</span>
              <span className="pdp-rating-count">({product.reviews || 120} verified kiosk reviews)</span>
            </div>
            <h1 className="pdp-title">{product.name}</h1>
            <p className="pdp-blurb">{product.blurb}</p>
          </div>

          {/* Pricing Box */}
          <div className="pdp-pricing-card">
            <div className="pdp-price-row">
              <div className="price-main">
                <span className="price-currency">₹</span>
                <span className="price-val">{unitPrice}</span>
              </div>
              {product.salePrice && (
                <>
                  <span className="price-original">₹{product.price}</span>
                  <span className="price-discount-pill">
                    Save ₹{product.price - product.salePrice}
                  </span>
                </>
              )}
            </div>
            <span className="pdp-tax-note">Includes all sustainable packaging taxes • Free express eco courier</span>
          </div>

          {/* Color Selection */}
          <div className="pdp-option-group">
            <label className="option-label">
              Finish Palette: <strong>{selectedColor}</strong>
            </label>
            <div className="color-swatches">
              {colors.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`color-swatch-btn ${selectedColor === c.name ? "color-swatch-btn--active" : ""}`}
                  style={{ backgroundColor: c.hex }}
                  onClick={() => setSelectedColor(c.name)}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
          </div>

          {/* Specifications Pills */}
          {product.specs && (
            <div className="pdp-specs-group">
              <span className="specs-label">Product Specifications</span>
              <div className="specs-grid">
                {product.specs.map((spec, idx) => (
                  <div key={idx} className="spec-card">
                    <span className="spec-bullet">✓</span>
                    <span>{spec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quantity & Add to Cart Bar */}
          <div className="pdp-buy-bar">
            <div className="pdp-qty-control">
              <button
                type="button"
                className="qty-btn"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                disabled={quantity <= 1}
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="qty-number">{quantity}</span>
              <button
                type="button"
                className="qty-btn"
                onClick={() => setQuantity(quantity + 1)}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>

            <button
              type="button"
              className="pdp-cta-btn"
              onClick={() => onProceedToCheckout({ product, quantity, selectedColor, totalPrice, savings })}
            >
              <span className="cta-icon">🛍️</span>
              <span className="cta-text">Add to Cart & Checkout</span>
              <span className="cta-price">₹{totalPrice}</span>
              <span className="cta-arrow">→</span>
            </button>
          </div>

          {/* Bulk Tier Hint */}
          <div className="pdp-bulk-banner">
            <span className="bulk-icon">🏢</span>
            <span>Ordering for your organization? Tiered wholesale discounts & custom logo engraving start at 25+ units.</span>
          </div>
        </div>
      </div>

      {/* ── Recommended Complementary Products ("Pairs Well With") ── */}
      <section className="pdp-recommended-section">
        <div className="section-head">
          <div className="section-head__title">
            <span className="section-tag">✨ Recommended Bundles</span>
            <h2>Complete Your Sustainable Collection</h2>
          </div>
          <span className="section-subtitle">Items customers frequently pair with the {product.name}</span>
        </div>

        <div className="recommended-grid">
          {recommended.map((item) => (
            <article
              key={item.id}
              className="recommended-card"
              onClick={() => onSelectProduct(item)}
              role="button"
              tabIndex={0}
            >
              <div className="rec-card__media">
                <ProductArt image={item.image} name={item.name} shape={item.shape} />
                <span className="rec-badge">{item.badge || "Pairs Well"}</span>
              </div>
              <div className="rec-card__body">
                <h3 className="rec-card__title">{item.name}</h3>
                <div className="rec-card__price-row">
                  <PriceTag product={item} size="md" />
                  <span className="rec-card__action">View Details →</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
