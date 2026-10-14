"use client";
import React from "react";

const CATEGORY_ICONS = {
  all: "✨",
  bottle: "🍶",
  drinkware: "☕",
  "kitchen & dining": "🍽️",
  "kitchen-dining": "🍽️",
  planter: "🪴",
  tableware: "🥢",
  storage: "📦",
  "gift boxes & hampers": "🎁",
  "gift-boxes": "🎁",
};

export default function CategoryTabs({
  active,
  onSelect,
  categories = [],
  products = [],
  onOpenMore,
}) {
  if (!categories || categories.length === 0) return null;

  const getCount = (catId) => {
    if (!products || products.length === 0) return 0;
    if (catId === "all") return products.length;
    const clean = String(catId).toLowerCase().trim();
    return products.filter((p) => {
      const pCat = String(p.category || "").toLowerCase();
      const pCats = Array.isArray(p.categories) ? p.categories.map((c) => String(c).toLowerCase()) : [];
      return pCat.includes(clean) || clean.includes(pCat) || pCats.includes(clean);
    }).length;
  };

  return (
    <div className="category-tabs-container">
      <div className="chips category-chips" role="tablist" aria-label="Product Categories">
        {categories.map((c) => {
          const isSelected = String(c.id).toLowerCase() === String(active || "").toLowerCase();
          const count = getCount(c.id);

          return (
            <button
              key={c.id}
              role="tab"
              id={`tab-${c.id}`}
              aria-selected={isSelected}
              className={`chip chip--dark ${isSelected ? "chip--active" : ""}`}
              onClick={() => onSelect(c)}
            >
              <span className="tab-label">{c.label || c.name}</span>
              <span className={`tab-count ${count === 0 ? "tab-count--zero" : ""}`}>
                {count}
              </span>
            </button>
          );
        })}
        {onOpenMore && (
          <button
            type="button"
            role="tab"
            aria-label="More categories"
            className="chip chip--dark chip--more"
            onClick={onOpenMore}
          >
            <span className="tab-label">More</span>
            <span className="tab-more-arrow">→</span>
          </button>
        )}
      </div>
    </div>
  );
}
