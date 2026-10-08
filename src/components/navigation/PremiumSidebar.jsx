"use client";
import React, { useEffect } from "react";
import { CATEGORIES, PRODUCTS } from "@/data/products";

export default function PremiumSidebar({
  isOpen,
  onClose,
  activeCategory,
  onSelectCategory,
}) {
  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getCategoryCount = (catId) => {
    if (catId === "all") return PRODUCTS.length;
    return PRODUCTS.filter((p) => p.categories.includes(catId)).length;
  };

  const getCategoryIcon = (catId) => {
    switch (catId) {
      case "all":
        return "✨";
      case "gifts":
        return "🎁";
      case "drinkware":
        return "☕";
      case "kitchen":
        return "🥣";
      case "office":
        return "📂";
      default:
        return "🌿";
    }
  };

  return (
    <div
      className="sidebar-backdrop"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Navigation and Catalog Menu"
    >
      <aside
        className="premium-sidebar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Sidebar Header ── */}
        <div className="sidebar__header">
          <div className="sidebar__brand">
            <div className="sidebar__brand-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M16 3C16 3 8 8.5 8 16.5C8 21.2 11.4 25.1 16 27.5C20.6 25.1 24 21.2 24 16.5C24 8.5 16 3 16 3Z"
                  fill="#00A63E"
                  fillOpacity="0.2"
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
            <div>
              <h2 className="sidebar__brand-name">GREENFIBRE</h2>
              <p className="sidebar__brand-sub">Sustainable Lifestyle Kiosk</p>
            </div>
          </div>
          <button
            type="button"
            className="sidebar__close-btn"
            onClick={onClose}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {/* ── Scrollable Body Content ── */}
        <div className="sidebar__body">
          {/* Section: Category Navigation */}
          <section className="sidebar__section">
            <div className="sidebar__section-header">
              <span className="sidebar__section-label">Browse Collections</span>
              <span className="sidebar__section-meta">{PRODUCTS.length} Total Items</span>
            </div>
            <div className="sidebar__nav-list">
              {CATEGORIES.map((c) => {
                const isSelected = c.id === activeCategory;
                const count = getCategoryCount(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`sidebar__nav-item ${isSelected ? "sidebar__nav-item--active" : ""}`}
                    onClick={() => {
                      onSelectCategory(c.id);
                      onClose();
                    }}
                  >
                    <span className="nav-item-icon">{getCategoryIcon(c.id)}</span>
                    <span className="nav-item-label">{c.label}</span>
                    <span className="nav-item-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section: Material & Sustainability Innovation */}
          <section className="sidebar__section">
            <div className="sidebar__section-header">
              <span className="sidebar__section-label">The Circular Story</span>
            </div>
            <div className="sidebar__card sidebar__card--highlight">
              <div className="eco-card-header">
                <span className="eco-card-tag">🌾 Agricultural Upcycling</span>
              </div>
              <p className="eco-card-desc">
                By converting discarded crop stubble into high-durability biocomposite, we eliminate agricultural burning while creating zero-plastic everyday essentials.
              </p>
              <div className="eco-metrics-grid">
                <div className="eco-metric-pill">
                  <span className="metric-val">100%</span>
                  <span className="metric-name">Rice-Husk</span>
                </div>
                <div className="eco-metric-pill">
                  <span className="metric-val">0%</span>
                  <span className="metric-name">Virgin Plastic</span>
                </div>
                <div className="eco-metric-pill">
                  <span className="metric-val">-40%</span>
                  <span className="metric-name">CO₂ Footprint</span>
                </div>
                <div className="eco-metric-pill">
                  <span className="metric-val">Safe</span>
                  <span className="metric-name">BPA Free</span>
                </div>
              </div>
            </div>
          </section>

          {/* Section: Voice Assistant Guidance */}
          <section className="sidebar__section">
            <div className="sidebar__section-header">
              <span className="sidebar__section-label">Ask Greenie (Voice Commands)</span>
            </div>
            <div className="voice-prompts-container">
              <div className="voice-prompt-bubble">
                <span className="prompt-icon">🎙️</span>
                <span>&ldquo;Show me drinkware and mugs&rdquo;</span>
              </div>
              <div className="voice-prompt-bubble">
                <span className="prompt-icon">🎙️</span>
                <span>&ldquo;What are your corporate gift ideas?&rdquo;</span>
              </div>
              <div className="voice-prompt-bubble">
                <span className="prompt-icon">🎙️</span>
                <span>&ldquo;Tell me about the Viora Bottle&rdquo;</span>
              </div>
            </div>
          </section>

          {/* Section: Corporate Branding & Customization */}
          <section className="sidebar__section">
            <div className="sidebar__section-header">
              <span className="sidebar__section-label">Bespoke Corporate Services</span>
            </div>
            <div className="sidebar__card">
              <h4 className="corp-card-title">Corporate Logo Laser Engraving</h4>
              <p className="corp-card-text">
                Personalize drinkware, bento sets, and desk organizers with your company branding. Tiered volume pricing available for orders of 25+ units.
              </p>
            </div>
          </section>
        </div>

        {/* ── Sidebar Footer ── */}
        <div className="sidebar__footer">
          <div className="sidebar__terminal-status">
            <span className="terminal-live-dot" />
            <span>Kiosk Terminal #GF-04 • Online</span>
          </div>
          <button
            type="button"
            className="sidebar__reset-btn"
            onClick={() => {
              onSelectCategory("all");
              onClose();
            }}
          >
            Reset Catalog View
          </button>
        </div>
      </aside>
    </div>
  );
}
