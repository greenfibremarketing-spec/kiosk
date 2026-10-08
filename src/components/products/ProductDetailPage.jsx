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
  const [activeTab, setActiveTab] = useState("specs"); // "specs" | "material" | "care"

  if (!product) return null;

  // Recommended complementary products
  const recommended = PRODUCTS.filter((p) => p.id !== product.id)
    .sort((a, b) => {
      const aOverlap = a.categories.filter((c) => product.categories.includes(c)).length;
      const bOverlap = b.categories.filter((c) => product.categories.includes(c)).length;
      return bOverlap - aOverlap;
    })
    .slice(0, 3);

  const colors = [
    { name: "Natural Olive", hex: "#4a6741", desc: "Matte herbal tones" },
    { name: "Raw Husk Cream", hex: "#e2d7c0", desc: "Natural unbleached finish" },
    { name: "Earthy Terracotta", hex: "#b4654a", desc: "Warm clay warmth" },
  ];

  const unitPrice = product.salePrice || product.price;
  const totalPrice = unitPrice * quantity;
  const savings = product.salePrice ? (product.price - product.salePrice) * quantity : 0;

  return (
    <div className="pdp-wrapper" aria-label={`Details for ${product.name}`}>
      {/* ── Top Navigation Bar ── */}
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

        <div className="pdp-top-meta">
          <span className="pdp-stock-indicator">
            <span className="stock-dot" />
            <span>In Stock at Kiosk Terminal #GF-04</span>
          </span>
          <div className="pdp-breadcrumbs">
            <span className="crumb crumb-dim" onClick={onBack}>Products</span>
            <span className="crumb-sep">/</span>
            <span className="crumb crumb-active">{product.name}</span>
          </div>
        </div>
      </nav>

      {/* ── Main Product Hero ── */}
      <div className="pdp-hero-grid">
        {/* Left Column: Media Stage & Circular Proof Badges */}
        <div className="pdp-media-col">
          <div className="pdp-image-stage">
            {product.badge && <span className="pdp-floating-badge">{product.badge}</span>}
            <div className="pdp-art-center">
              <ProductArt image={product.image} name={product.name} shape={product.shape} />
            </div>
            <div className="pdp-stage-accent" />
          </div>

          {/* Eco Proof Highlights */}
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

          {/* Environmental Diverted Stubble Card */}
          <div className="pdp-impact-card">
            <span className="impact-leaf">🌱</span>
            <div className="impact-info">
              <strong>Farm Residue Repurposed</strong>
              <p>Choosing this product prevents ~210g of agricultural rice straw from open-field burning.</p>
            </div>
          </div>
        </div>

        {/* Right Column: Information, Specs & Buy Box */}
        <div className="pdp-info-col">
          {/* Eyebrow & Title */}
          <div className="pdp-header">
            <span className="pdp-eyebrow">🌾 SUSTAINABLE ESSENTIALS • CIRCULAR BIOCOMPOSITE</span>
            <h1 className="pdp-title">{product.name}</h1>
            <div className="pdp-rating-row">
              <div className="pdp-stars">★★★★★</div>
              <span className="pdp-rating-score">{product.rating || "4.9"}</span>
              <span className="pdp-rating-count">({product.reviews || 128} verified kiosk reviews)</span>
            </div>
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
                    Save ₹{product.price - product.salePrice} (19% OFF)
                  </span>
                </>
              )}
            </div>
            <span className="pdp-tax-note">✓ All taxes included • Free express carbon-neutral delivery</span>
          </div>

          {/* Finish & Color Palette Selection */}
          <div className="pdp-option-group">
            <div className="option-label-row">
              <span className="option-label">Select Colorway:</span>
              <strong className="option-selected-name">{selectedColor}</strong>
            </div>
            <div className="color-swatches-grid">
              {colors.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`color-swatch-card ${selectedColor === c.name ? "color-swatch-card--active" : ""}`}
                  onClick={() => setSelectedColor(c.name)}
                >
                  <span className="swatch-circle" style={{ backgroundColor: c.hex }} />
                  <div className="swatch-meta">
                    <span className="swatch-title">{c.name}</span>
                    <span className="swatch-desc">{c.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Tabbed Product Details */}
          <div className="pdp-tabs-container">
            <div className="pdp-tabs-bar" role="tablist">
              <button
                type="button"
                className={`pdp-tab-nav ${activeTab === "specs" ? "pdp-tab-nav--active" : ""}`}
                onClick={() => setActiveTab("specs")}
              >
                Specifications
              </button>
              <button
                type="button"
                className={`pdp-tab-nav ${activeTab === "material" ? "pdp-tab-nav--active" : ""}`}
                onClick={() => setActiveTab("material")}
              >
                Material & Origin
              </button>
              <button
                type="button"
                className={`pdp-tab-nav ${activeTab === "care" ? "pdp-tab-nav--active" : ""}`}
                onClick={() => setActiveTab("care")}
              >
                Care & Warranty
              </button>
            </div>

            <div className="pdp-tab-content">
              {activeTab === "specs" && (
                <div className="specs-grid">
                  {product.specs?.map((spec, idx) => (
                    <div key={idx} className="spec-card">
                      <span className="spec-bullet">✓</span>
                      <span>{spec}</span>
                    </div>
                  ))}
                  <div className="spec-card">
                    <span className="spec-bullet">✓</span>
                    <span>100% Food-Grade Certified</span>
                  </div>
                  <div className="spec-card">
                    <span className="spec-bullet">✓</span>
                    <span>Zero Melamine / Formaldehyde</span>
                  </div>
                </div>
              )}

              {activeTab === "material" && (
                <p className="tab-narrative">
                  Handcrafted from 100% upcycled rice-husk agricultural residue sourced from North Indian farming cooperatives.
                  Naturally colored with food-grade mineral pigments, completely free of virgin plastics and harmful binders.
                </p>
              )}

              {activeTab === "care" && (
                <p className="tab-narrative">
                  Dishwasher friendly (top rack recommended). Microwave safe up to 3 minutes for food reheating.
                  Backed by GreenFibre&apos;s 1-Year Kiosk Replacement Warranty against manufacturing defects.
                </p>
              )}
            </div>
          </div>

          {/* Quantity Selector & High-Impact CTA */}
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
              <div className="cta-left">
                <span className="cta-icon">🛍️</span>
                <span className="cta-text">Add to Cart & Checkout</span>
              </div>
              <div className="cta-right">
                <span className="cta-price">₹{totalPrice}</span>
                <span className="cta-arrow">→</span>
              </div>
            </button>
          </div>

          {/* Bulk Orders Note */}
          <div className="pdp-bulk-banner">
            <span className="bulk-icon">🏢</span>
            <span>Ordering 25+ units for your office or conference? Custom corporate laser logo engraving is available.</span>
          </div>
        </div>
      </div>

      {/* ── Recommended Complementary Products ("Complete Your Routine") ── */}
      <section className="pdp-recommended-section">
        <div className="section-head">
          <div className="section-head__title">
            <span className="section-tag">✨ Recommended Bundles</span>
            <h2>Complete Your Sustainable Routine</h2>
          </div>
          <span className="section-subtitle">Items shoppers frequently pair with the {product.name}</span>
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
