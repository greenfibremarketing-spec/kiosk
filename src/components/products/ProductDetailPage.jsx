"use client";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useFeedbackSpeech } from "@/hooks/useFeedbackSpeech";
import { preloadProductDetailPhotos } from "@/lib/imagePreloader";
import {
  ChevronLeft,
  ChevronRight,
  Star,
  ShoppingBag,
  Minus,
  Plus,
  ArrowLeft,
  Leaf,
  Sprout,
  ShieldCheck,
  Ban,
  Truck,
  Check,
} from "lucide-react";

/**
 * Natural organic colour mapping matching Green Fibre data & earthy eco finishes.
 */
const COLOR_HEX_MAP = {
  "parrot green": "#4a7c59",
  "sage green": "#789781",
  "olive": "#556b2f",
  "natural olive": "#4a6741",
  "orange": "#e26d36",
  "terracotta": "#b4654a",
  "earthy terracotta": "#b4654a",
  "cream": "#e2d7c0",
  "raw husk cream": "#e2d7c0",
  "husk": "#d8cbb5",
  "beige": "#d9cbba",
  "brown": "#8b5a2b",
  "black": "#282828",
  "charcoal": "#3a3a3a",
  "slate": "#64748b",
  "white": "#f8f8f4",
  "teal": "#2a7b7b",
  "blue": "#3b6e8c",
  "navy": "#1e3a5f",
  "yellow": "#e5a93c",
  "pink": "#d47a8a",
  "rose": "#c45b71",
  "red": "#b8423f",
};

function getHexForColor(name, fallbackIdx = 0) {
  if (!name) return "#4a6741";
  const clean = String(name).toLowerCase().trim();
  if (COLOR_HEX_MAP[clean]) return COLOR_HEX_MAP[clean];
  for (const [key, val] of Object.entries(COLOR_HEX_MAP)) {
    if (clean.includes(key) || key.includes(clean)) return val;
  }
  const defaultPalette = ["#4a6741", "#e2d7c0", "#b4654a", "#22c55e", "#f97316"];
  return defaultPalette[fallbackIdx % defaultPalette.length];
}

/**
 * Map real backend fields to 4-5 high quality images for the selected colorway.
 */
function getImagesForProductAndVariant(product, selectedColorName) {
  if (!product) return [];

  const list = [];
  const addImages = (sources) => {
    if (!sources) return;
    const arr = Array.isArray(sources) ? sources : [sources];
    for (const item of arr) {
      if (typeof item === "string" && item.trim() && !list.includes(item.trim())) {
        list.push(item.trim());
      } else if (item && typeof item === "object") {
        const url = item.url || item.src || item.image;
        if (url && typeof url === "string" && !list.includes(url.trim())) {
          list.push(url.trim());
        }
      }
    }
  };

  // 1. Variant matching the selected colorway
  const matchingVariant = product.variants?.find((v) => {
    const vName = (v.name || v.title || "").toLowerCase().trim();
    const target = (selectedColorName || "").toLowerCase().trim();
    return vName === target || vName.includes(target) || target.includes(vName);
  });

  if (matchingVariant) {
    addImages(matchingVariant.images);
    addImages(matchingVariant.image);
  }

  // 2. Top-level product images as baseline
  addImages(product.images);
  addImages(product.image);

  // 3. Supplement with remaining variants if fewer than 4
  if (list.length < 4 && Array.isArray(product.variants)) {
    for (const v of product.variants) {
      addImages(v.images);
      addImages(v.image);
      if (list.length >= 5) break;
    }
  }

  return list.slice(0, 5);
}

/**
 * Slide image component with skeleton placeholder, instant cache detection,
 * high-priority eager loading for the primary slide, and graceful error retry.
 */
function SlideImage({ src, alt, isFirst = false, onFirstImageLoaded = null }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const imgRef = React.useRef(null);

  // Check if browser already has the image decoded in memory/cache
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
      if (isFirst) onFirstImageLoaded?.(true);
    } else {
      setLoaded(false);
    }
    setError(false);
  }, [src, retryCount, isFirst]);

  if (error || !src) {
    return (
      <div className="pdp-slide-fallback" aria-label={alt}>
        <Sprout size={48} strokeWidth={1.5} className="pdp-fallback-icon" />
        <span className="pdp-fallback-text">{alt}</span>
      </div>
    );
  }

  const handleImgLoad = () => {
    setLoaded(true);
    if (isFirst) {
      onFirstImageLoaded?.(false);
    }
  };

  const handleImgError = () => {
    if (retryCount === 0 && src) {
      console.warn(`[SlideImage] Retrying load once for image: ${src}`);
      setRetryCount(1);
    } else {
      setError(true);
    }
  };

  const activeSrc =
    retryCount > 0 && src && !src.includes("retry=1")
      ? (src.includes("?") ? `${src}&retry=1` : `${src}?retry=1`)
      : src;

  return (
    <div className="pdp-slide-img-wrap" style={{ aspectRatio: "1 / 1" }}>
      {!loaded && <div className="pdp-slide-skeleton" />}
      <img
        ref={imgRef}
        src={activeSrc}
        alt={alt}
        className={`pdp-slide-img ${loaded ? "pdp-slide-img--loaded" : ""}`}
        onLoad={handleImgLoad}
        onError={handleImgError}
        loading={isFirst ? "eager" : "lazy"}
        fetchPriority={isFirst ? "high" : "auto"}
        decoding={isFirst ? "sync" : "async"}
      />
    </div>
  );
}

export default function ProductDetailPage({
  product,
  products = [],
  onBack,
  onProceedToCheckout,
  onAddToCart,
  onSelectProduct,
  buttons = [],
  onButtonClick,
  kioskModeRef = null,
  replayingRef = null,
}) {
  const [quantity, setQuantity] = useState(1);
  const [activeSlide, setActiveSlide] = useState(0);
  const { speakFeedback } = useFeedbackSpeech({ kioskModeRef, replayingRef });

  const pdpOpenTimeRef = useRef(typeof window !== "undefined" ? performance.now() : Date.now());

  const handleFirstImageLoaded = useCallback((isInstant = false) => {
    const elapsed = Math.round((typeof window !== "undefined" ? performance.now() : Date.now()) - pdpOpenTimeRef.current);
    console.log(`[ImageTiming] Sku: ${product?.sku || product?.id} - Time to first image load: ${elapsed}ms (instant cache hit: ${isInstant})`);
  }, [product?.id, product?.sku]);

  useEffect(() => {
    pdpOpenTimeRef.current = typeof window !== "undefined" ? performance.now() : Date.now();
    if (product) {
      preloadProductDetailPhotos(product);
    }
  }, [product?.id, product?.sku]);

  // Derive variants and real color values from data
  const colors = useMemo(() => {
    if (product?.variants && product.variants.length > 0) {
      return product.variants.map((v, i) => {
        const name = v.name || v.title || `Variant ${i + 1}`;
        return {
          name,
          hex: v.hex || v.color || getHexForColor(name, i),
          stock: v.stock,
        };
      });
    }
    return [
      { name: "Natural Olive", hex: "#4a6741" },
      { name: "Raw Husk Cream", hex: "#e2d7c0" },
      { name: "Earthy Terracotta", hex: "#b4654a" },
    ];
  }, [product]);

  // Selected colorway with guaranteed synchronization
  const [selectedColor, setSelectedColor] = useState(() => {
    return (
      product?.variant_name ||
      product?.variants?.[0]?.name ||
      colors[0]?.name ||
      "Natural Olive"
    );
  });

  // Re-sync when product or variant changes
  useEffect(() => {
    if (product) {
      const nextColor =
        product.variant_name ||
        product.variants?.[0]?.name ||
        colors[0]?.name ||
        "Natural Olive";
      setSelectedColor(nextColor);
      setActiveSlide(0);
      setQuantity(1);
    }
  }, [product?.id, product?.sku, product?.variant_name, colors]);

  // Resolve images for active colorway
  const images = useMemo(() => {
    const list = getImagesForProductAndVariant(product, selectedColor);
    if (list.length === 0 && product?.image) {
      return [product.image];
    }
    return list;
  }, [product, selectedColor]);

  // Slider touch/drag swipe support
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const isSwiping = useRef(false);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches ? e.touches[0].clientX : e.clientX;
    touchDeltaX.current = 0;
    isSwiping.current = true;
  };

  const handleTouchMove = (e) => {
    if (!isSwiping.current) return;
    const currentX = e.touches ? e.touches[0].clientX : e.clientX;
    touchDeltaX.current = currentX - touchStartX.current;
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current) return;
    isSwiping.current = false;
    const threshold = 40;
    if (images.length > 1) {
      if (touchDeltaX.current > threshold) {
        // Swipe Right -> Previous image
        setActiveSlide((prev) => (prev > 0 ? prev - 1 : images.length - 1));
      } else if (touchDeltaX.current < -threshold) {
        // Swipe Left -> Next image
        setActiveSlide((prev) => (prev < images.length - 1 ? prev + 1 : 0));
      }
    }
  };

  // Swatch selection handler
  const handleColorSelect = (colorName) => {
    setSelectedColor(colorName);
    setActiveSlide(0);
    speakFeedback("colour_change", { colour: colorName });
  };

  if (!product) return null;

  // Pricing calculations
  const unitPrice = Number(product.salePrice || product.price) || 0;
  const mrp = Number(product.mrp || product.price) || 0;
  const hasDiscount = mrp > unitPrice;
  const discountPct = hasDiscount ? Math.round(((mrp - unitPrice) / mrp) * 100) : 0;
  const totalPrice = unitPrice * quantity;
  const savings = hasDiscount ? (mrp - unitPrice) * quantity : 0;

  const displayButtons =
    buttons && buttons.length > 0
      ? buttons
      : ["Next", "Cheaper", "Compare", "I'll take it"];

  return (
    <div className="pdp-redesign-wrapper" aria-label={`Details for ${product.name}`}>
      {/* ── Top Navigation Bar ── */}
      <nav className="pdp-top-nav">
        <button
          type="button"
          className="pdp-nav-back-button"
          onClick={onBack}
          aria-label="Back to Catalog"
        >
          <ArrowLeft size={20} strokeWidth={2.5} />
          <span>Back to Catalog</span>
        </button>

        <div className="pdp-nav-meta">
          <div className="pdp-nav-stock-pill">
            <span className="pdp-stock-dot-pulse" />
            <span>Terminal #GF-04 • In Stock</span>
          </div>
          <div className="pdp-nav-breadcrumbs">
            <span className="crumb-btn" onClick={onBack}>Products</span>
            <span className="crumb-divider">/</span>
            <span className="crumb-current">{product.name}</span>
          </div>
        </div>
      </nav>

      {/* ── Main Two-Column View (Zero Vertical Scroll) ── */}
      <div className="pdp-two-column-grid">
        {/* ── LEFT COLUMN (48%): Image Gallery & Eco Banner ── */}
        <div className="pdp-gallery-column">
          {/* Main Image Slider Stage */}
          <div
            className="pdp-slider-stage"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleTouchStart}
            onMouseMove={handleTouchMove}
            onMouseUp={handleTouchEnd}
            onMouseLeave={handleTouchEnd}
          >
            {/* Non-intrusive Bestseller Badge */}
            {product.badge && (
              <span className="pdp-badge-pill">{product.badge}</span>
            )}

            {/* Slider Track */}
            <div
              className="pdp-slider-track"
              style={{
                transform: `translateX(-${activeSlide * 100}%)`,
              }}
            >
              {images.map((imgUrl, idx) => (
                <div key={idx} className="pdp-slide-frame">
                  <SlideImage
                    src={imgUrl}
                    alt={`${product.name} - Angle ${idx + 1}`}
                    isFirst={idx === 0}
                    onFirstImageLoaded={idx === 0 ? handleFirstImageLoaded : null}
                  />
                </div>
              ))}
            </div>

            {/* Prev / Next Arrow Controls */}
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  className="pdp-slider-nav-btn pdp-slider-nav-btn--prev"
                  onClick={() =>
                    setActiveSlide((prev) => (prev > 0 ? prev - 1 : images.length - 1))
                  }
                  aria-label="Previous image"
                >
                  <ChevronLeft size={24} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  className="pdp-slider-nav-btn pdp-slider-nav-btn--next"
                  onClick={() =>
                    setActiveSlide((prev) => (prev < images.length - 1 ? prev + 1 : 0))
                  }
                  aria-label="Next image"
                >
                  <ChevronRight size={24} strokeWidth={2.5} />
                </button>
              </>
            )}

            {/* Dot Indicators */}
            {images.length > 1 && (
              <div className="pdp-slider-dots-row">
                {images.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`pdp-slider-dot-item ${
                      activeSlide === idx ? "pdp-slider-dot-item--active" : ""
                    }`}
                    onClick={() => setActiveSlide(idx)}
                    aria-label={`Go to slide ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Thumbnail Strip */}
          {images.length > 1 && (
            <div className="pdp-thumbnails-strip" role="tablist">
              {images.map((imgUrl, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`pdp-thumbnail-item ${
                    activeSlide === idx ? "pdp-thumbnail-item--active" : ""
                  }`}
                  onClick={() => setActiveSlide(idx)}
                  aria-label={`Thumbnail ${idx + 1}`}
                >
                  <img
                    src={imgUrl}
                    alt={`Thumbnail ${idx + 1}`}
                    className="pdp-thumb-img"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Slim One-Line Eco Note Banner */}
          <div className="pdp-eco-banner">
            <Leaf size={16} strokeWidth={2.2} className="eco-leaf-icon" />
            <span className="eco-banner-text">
              <strong>Farm Residue Repurposed:</strong> Choosing this item repurposes ~210g of crop straw, preventing open-field burning.
            </span>
          </div>
        </div>

        {/* ── RIGHT COLUMN (52%): Product Info & Swatches ── */}
        <div className="pdp-info-column">
          {/* Header Block: Category Chip, Product Name, Rating */}
          <div className="pdp-header-block">
            <span className="pdp-category-chip">
              <Sprout size={13} strokeWidth={2.2} />
              <span>{String(product.category || "Drinkware").toUpperCase()}</span>
            </span>

            <h1 className="pdp-main-title">{product.name}</h1>

            <div className="pdp-rating-strip">
              <div className="pdp-star-group">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={17} fill="#f59e0b" color="#f59e0b" />
                ))}
              </div>
              <span className="pdp-rating-score-val">{product.rating || "4.9"}</span>
              <span className="pdp-rating-review-count">
                ({product.reviews || 128} verified kiosk reviews)
              </span>
            </div>

            {/* Short Description (Max 2 lines) */}
            <p className="pdp-description-blurb">
              {product.description ||
                product.blurb ||
                `${product.name} handcrafted from sustainable rice-husk agricultural biocomposite.`}
            </p>
          </div>

          {/* Price Block: Big Price, MRP, Save X%, Tax Line */}
          <div className="pdp-price-card">
            <div className="pdp-price-flex">
              <span className="pdp-current-price">₹{unitPrice.toLocaleString("en-IN")}</span>
              {hasDiscount && discountPct > 0 && (
                <>
                  <span className="pdp-old-mrp">₹{mrp.toLocaleString("en-IN")}</span>
                  <span className="pdp-save-tag">Save {discountPct}%</span>
                </>
              )}
            </div>
            <span className="pdp-tax-caption">Inclusive of all taxes</span>
          </div>

          {/* Colour Selector: Round Swatch Chips with Guaranteed Label Match */}
          <div className="pdp-colour-section">
            <div className="pdp-colour-label-row">
              <span className="pdp-colour-heading">Colour:</span>
              <strong className="pdp-colour-selected-name">{selectedColor}</strong>
            </div>

            <div className="pdp-swatches-grid">
              {colors.map((c) => {
                const isSelected =
                  (selectedColor || "").toLowerCase().trim() === c.name.toLowerCase().trim();
                return (
                  <button
                    key={c.name}
                    type="button"
                    className={`pdp-swatch-button ${
                      isSelected ? "pdp-swatch-button--active" : ""
                    }`}
                    onClick={() => handleColorSelect(c.name)}
                    aria-pressed={isSelected}
                  >
                    <span
                      className="pdp-swatch-circle"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span className="pdp-swatch-name-text">{c.name}</span>
                    {isSelected && (
                      <Check size={14} strokeWidth={3} className="pdp-swatch-check-icon" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Highlights Row: 4 Compact Cards with Lucide Icons (Replacing Old Tabs) */}
          <div className="pdp-highlights-grid">
            <div className="pdp-highlight-box">
              <div className="pdp-highlight-icon-wrap">
                <Sprout size={18} strokeWidth={2.2} />
              </div>
              <div className="pdp-highlight-meta">
                <strong>100% Upcycled</strong>
                <span>Rice-husk biocomposite</span>
              </div>
            </div>

            <div className="pdp-highlight-box">
              <div className="pdp-highlight-icon-wrap">
                <Ban size={18} strokeWidth={2.2} />
              </div>
              <div className="pdp-highlight-meta">
                <strong>Zero Plastic</strong>
                <span>0% virgin plastic used</span>
              </div>
            </div>

            <div className="pdp-highlight-box">
              <div className="pdp-highlight-icon-wrap">
                <ShieldCheck size={18} strokeWidth={2.2} />
              </div>
              <div className="pdp-highlight-meta">
                <strong>BPA & Toxin Free</strong>
                <span>100% food-grade safe</span>
              </div>
            </div>

            <div className="pdp-highlight-box">
              <div className="pdp-highlight-icon-wrap">
                <Truck size={18} strokeWidth={2.2} />
              </div>
              <div className="pdp-highlight-meta">
                <strong>Free Delivery</strong>
                <span>Carbon-neutral dispatch</span>
              </div>
            </div>
          </div>

          {/* Avatar Suggestions (Preserved Functionality) */}
          {displayButtons && displayButtons.length > 0 && (
            <div className="pdp-suggestions-row">
              <span className="pdp-suggestions-tag">⚡ Greenie:</span>
              <div className="pdp-suggestions-chips">
                {displayButtons.map((btn, idx) => {
                  const label =
                    typeof btn === "string" ? btn : btn.label || btn.name || btn.id;
                  const isTakeIt = /take it|i'll take it|buy/i.test(label);
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`pdp-suggest-button ${
                        isTakeIt ? "pdp-suggest-button--take" : ""
                      }`}
                      onClick={() => {
                        if (isTakeIt) {
                          if (onAddToCart) {
                            onAddToCart({
                              product,
                              quantity,
                              selectedColor,
                              totalPrice,
                              savings,
                            });
                          } else {
                            onProceedToCheckout?.({
                              product,
                              quantity,
                              selectedColor,
                              totalPrice,
                              savings,
                            });
                          }
                        } else {
                          onButtonClick?.(btn);
                        }
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Sticky Bottom Action Bar (Content Never Hides Behind It) ── */}
      <footer className="pdp-sticky-action-bar">
        {/* Quantity Stepper (min 56px touch targets) */}
        <div className="pdp-action-stepper">
          <button
            type="button"
            className="pdp-stepper-touch-btn"
            onClickCapture={() => speakFeedback("quantity_down", { qty: Math.max(1, quantity - 1) })}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
          >
            <Minus size={22} strokeWidth={2.5} />
          </button>
          <span className="pdp-stepper-count">{quantity}</span>
          <button
            type="button"
            className="pdp-stepper-touch-btn"
            onClickCapture={() => speakFeedback("quantity_up", { qty: quantity + 1 })}
            onClick={() => setQuantity((q) => q + 1)}
            aria-label="Increase quantity"
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
        </div>

        {/* Total Price Display */}
        <div className="pdp-action-price-summary">
          <span className="pdp-action-price-label">Total Price:</span>
          <span className="pdp-action-price-num">₹{totalPrice.toLocaleString("en-IN")}</span>
        </div>

        {/* Big Primary Checkout Button */}
        <button
          type="button"
          className="pdp-primary-checkout-btn"
          onClickCapture={() => {
            if (!onAddToCart) {
              speakFeedback("add_to_cart", { productName: product.name, qty: quantity });
            }
          }}
          onClick={() => {
            if (onAddToCart) {
              onAddToCart({
                product,
                quantity,
                selectedColor,
                totalPrice,
                savings,
              });
            } else {
              onProceedToCheckout?.({
                product,
                quantity,
                selectedColor,
                totalPrice,
                savings,
              });
            }
          }}
        >
          <div className="pdp-checkout-btn-content">
            <ShoppingBag size={22} strokeWidth={2.2} />
            <span className="pdp-checkout-btn-title">Add to Cart &amp; Checkout</span>
          </div>
          <ChevronRight size={22} strokeWidth={2.5} />
        </button>
      </footer>
    </div>
  );
}
