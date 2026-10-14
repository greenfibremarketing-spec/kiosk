"use client";
import React from "react";

export default function ProductSkeletonGrid({ count = 8 }) {
  return (
    <div
      className="products-grid products-grid--skeleton"
      aria-label="Loading products..."
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <article key={idx} className="luxury-card luxury-card--skeleton">
          {/* Shimmering Product Media Box */}
          <div className="luxury-card__media skeleton-media">
            <div className="skeleton-placeholder-circle" />
            <div className="skeleton-shimmer" />
          </div>

          {/* Shimmering Title, Subtitle, and Price Tag */}
          <div className="luxury-card__content">
            <div className="skeleton-line skeleton-title">
              <div className="skeleton-shimmer" />
            </div>
            <div className="skeleton-line skeleton-title-sub">
              <div className="skeleton-shimmer" />
            </div>

            <div className="luxury-card__footer">
              <div className="skeleton-line skeleton-price">
                <div className="skeleton-shimmer" />
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
