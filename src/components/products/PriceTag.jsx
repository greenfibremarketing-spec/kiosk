"use client";
import React from "react";
import { inr, getFestivePricing } from "@/lib/format";

export default function PriceTag({ product, size = "md", showOccasion = false }) {
  if (!product) return null;
  const { mrp, salePrice, discountPct: off, label } = getFestivePricing(product);

  return (
    <div className={`price price--${size}`}>
      <span className="price__now">{inr(salePrice)}</span>
      {mrp > salePrice && (
        <>
          <s className="price__was">{inr(mrp)}</s>
          <span className="price__off">20% OFF</span>
        </>
      )}
      {showOccasion && (
        <span className="price__festive-occasion">{label}</span>
      )}
    </div>
  );
}

