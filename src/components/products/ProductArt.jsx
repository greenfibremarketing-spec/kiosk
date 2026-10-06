"use client";
import { useState } from "react";

export default function ProductArt({ image, name, shape, fallbackColors = ["#6fa04a", "#2f5a2a"] }) {
  const [hasError, setHasError] = useState(false);

  if (image && !hasError) {
    return (
      <div className="product-art-img-wrap">
        <img
          src={image}
          alt={name || "GreenFibre Product"}
          className="product-art-img"
          onError={() => setHasError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback geometric illustration if image fails to load
  return (
    <div className="product-art-fallback">
      <div className="fallback-placeholder-icon">🌱</div>
      <span>{name}</span>
    </div>
  );
}
