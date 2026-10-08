"use client";
import React from "react";

export default function RightNavbar({
  activeCategory,
  productCount = 8,
  onOpenMenu,
  onSelectCategory,
}) {
  return (
    <nav className="right-navbar" aria-label="Catalog Navigation Bar">
      {/* ── Left: GreenFibre Logo & Identity ── */}
      <div
        className="right-navbar__brand"
        onClick={() => onSelectCategory?.("all")}
        role="button"
        tabIndex={0}
        title="GreenFibre - Return to All Products"
      >
        <div className="brand-logo-icon">
          <svg
            width="26"
            height="26"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M16 3C16 3 8 8.5 8 16.5C8 21.2 11.4 25.1 16 27.5C20.6 25.1 24 21.2 24 16.5C24 8.5 16 3 16 3Z"
              fill="#00A63E"
              fillOpacity="0.16"
            />
            <path
              d="M16 3C16 3 8 8.5 8 16.5C8 21.2 11.4 25.1 16 27.5C20.6 25.1 24 21.2 24 16.5C24 8.5 16 3 16 3Z"
              stroke="#00A63E"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M16 8.5V24.5M16 14.5C18.2 12.8 20.8 13.5 21.5 14.2M16 19C13.8 17.3 11.2 18 10.5 18.7"
              stroke="#00A63E"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="brand-text-group">
          <span className="brand-name">GREENFIBRE</span>
          <span className="brand-tagline">100% Upcycled Biocomposite</span>
        </div>
      </div>

      {/* ── Center: Sustainability & Eco Highlights ── */}
      <div className="right-navbar__center">
        <div className="navbar-eco-badge">
          <span className="eco-leaf-icon">🌾</span>
          <span>Zero Virgin Plastic</span>
        </div>
        <div className="navbar-counter-badge">
          <span className="counter-dot" />
          <span>{productCount} Products</span>
        </div>
      </div>

      {/* ── Right: Menubar & Menu Toggle ── */}
      <div className="right-navbar__actions">
        <button
          type="button"
          className="navbar-menu-btn"
          onClick={onOpenMenu}
          aria-label="Open Navigation Menu"
        >
          <div className="menu-btn-icon" aria-hidden="true">
            <span className="bar bar-1" />
            <span className="bar bar-2" />
            <span className="bar bar-3" />
          </div>
          <span className="menu-btn-label">Menu</span>
        </button>
      </div>
    </nav>
  );
}
