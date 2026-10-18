"use client";
import React, { useEffect, useRef } from "react";
import ProductArt from "./ProductArt";
import PriceTag from "./PriceTag";
import { preloadProductDetailPhotos } from "@/lib/imagePreloader";

export default function ProductCard({ product, active, highlighted, onSelect }) {
  const cardRef = useRef(null);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  const handleWarmup = () => {
    preloadProductDetailPhotos(product);
  };

  return (
    <article
      ref={cardRef}
      className={`luxury-card ${active ? "luxury-card--active" : ""} ${highlighted ? "luxury-card--highlight" : ""}`}
      onClick={() => onSelect(product)}
      onPointerDown={handleWarmup}
      onMouseEnter={handleWarmup}
      role="button"
      tabIndex={0}
      id={`product-card-${product.id}`}
      aria-current={active}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(product);
        }
      }}
    >
      {/* Product Image Stage */}
      <div className="luxury-card__media">
        <ProductArt image={product.image} name={product.name} shape={product.shape} />
      </div>

      {/* Product Information: Title & Price Only */}
      <div className="luxury-card__content">
        <h3 className="luxury-card__title" title={product.name}>
          {product.name}
        </h3>

        <div className="luxury-card__footer">
          <PriceTag product={product} size="md" />
        </div>
      </div>
    </article>
  );
}
