"use client";
import React from "react";

export default function RightNavbar({
  activeCategory,
  productCount = 0,
  onOpenMenu,
  onSelectCategory,
  name = "",
  onResetSession,
  onOpenNameModal,
  onContinueAsGuest,
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
        <img
          src="/images/logo.png"
          alt="Green Fibre"
          className="navbar-brand-logo"
        />
        <div className="brand-text-group">
          <span className="brand-name">GREENFIBRE</span>
          <span className="brand-tagline">100% Upcycled Biocomposite</span>
        </div>
      </div>

      {/* ── Center: Sustainability Highlights & Customer Name Chip ── */}
      <div className="right-navbar__center">
        {name ? (
          <div className="navbar-name-chip" role="region" aria-label="Customer Profile">
            <span className="navbar-name-greeting">Hi, {name}</span>
            <span className="navbar-name-divider" aria-hidden="true">·</span>
            <button
              type="button"
              className="navbar-name-action-btn"
              onClick={onOpenNameModal}
              title={`Edit name, currently ${name}`}
              aria-label={`Edit name, currently ${name}`}
            >
              Edit
            </button>
            <span className="navbar-name-divider" aria-hidden="true">·</span>
            <button
              type="button"
              className="navbar-name-notme-btn"
              onClick={onContinueAsGuest || (() => onResetSession?.("user_tap"))}
              title={`Not ${name}? Continue as Guest`}
              aria-label="Not you? Continue as Guest"
            >
              Not you?
            </button>
          </div>
        ) : (
          <div className="navbar-name-chip navbar-name-chip--guest" role="region" aria-label="Customer Profile">
            <span className="navbar-name-greeting">Hi, Guest</span>
            <span className="navbar-name-divider" aria-hidden="true">·</span>
            <button
              type="button"
              className="navbar-name-action-btn"
              onClick={onOpenNameModal}
              title="Add your name"
              aria-label="Add your name"
            >
              Add your name
            </button>
          </div>
        )}
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
