"use client";
import React, { useState, useEffect } from "react";
export default function PremiumSidebar({
  isOpen,
  onClose,
  activeCategory,
  onSelectCategory,
  categories = [],
  products = [],
}) {
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isAdminAuthed, setIsAdminAuthed] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [showSubtitles, setShowSubtitles] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("kiosk_show_subtitles") !== "false";
  });

  const handleAdminAuth = (e) => {
    e?.preventDefault();
    const clean = String(passwordInput || "").trim().toLowerCase();
    if (clean === "rohit malhotra") {
      setIsAdminAuthed(true);
      setAuthError("");
      setPasswordInput("");
    } else {
      setAuthError("Incorrect password. Please try again.");
    }
  };

  const handleToggleSubtitles = () => {
    const nextVal = !showSubtitles;
    setShowSubtitles(nextVal);
    if (typeof window !== "undefined") {
      localStorage.setItem("kiosk_show_subtitles", String(nextVal));
      window.dispatchEvent(new CustomEvent("kiosk_settings_changed", { detail: { showSubtitles: nextVal } }));
    }
  };

  const handleCloseAdmin = () => {
    setIsAdminOpen(false);
    setPasswordInput("");
    setAuthError("");
  };

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
    if (catId === "all") return products.length;
    const clean = String(catId).toLowerCase().trim();
    return products.filter((p) => {
      const pCat = String(p.category || "").toLowerCase();
      const pCats = Array.isArray(p.categories) ? p.categories.map((c) => String(c).toLowerCase()) : [];
      return pCat.includes(clean) || clean.includes(pCat) || pCats.includes(clean);
    }).length;
  };

  const getCategoryIcon = (catId) => {
    const clean = String(catId).toLowerCase();
    if (clean === "all") return "✨";
    if (clean.includes("bottle")) return "💧";
    if (clean.includes("drink") || clean.includes("mug")) return "☕";
    if (clean.includes("gift") || clean.includes("hamper")) return "🎁";
    if (clean.includes("kitchen") || clean.includes("din") || clean.includes("bowl")) return "🥣";
    if (clean.includes("storage") || clean.includes("canister")) return "📦";
    if (clean.includes("planter")) return "🪴";
    if (clean.includes("tableware")) return "🍽️";
    if (clean.includes("office") || clean.includes("desk")) return "📂";
    return "🌿";
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
              <span className="sidebar__section-meta">{products.length} Total Items</span>
            </div>
            <div className="sidebar__nav-list">
              {categories.map((c) => {
                const isSelected = c.id === activeCategory;
                const count = getCategoryCount(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`sidebar__nav-item ${isSelected ? "sidebar__nav-item--active" : ""}`}
                    onClick={() => {
                      onSelectCategory(c);
                      onClose();
                    }}
                  >
                    <span className="nav-item-icon">{getCategoryIcon(c.id)}</span>
                    <span className="nav-item-label">{c.label || c.name || c.id}</span>
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
                <span>&ldquo;Show me your eco gift hampers&rdquo;</span>
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
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              type="button"
              className="sidebar__admin-btn"
              onClick={() => setIsAdminOpen(true)}
              aria-label="Admin Settings"
            >
              ⚙️ Admin
            </button>
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
        </div>

        {/* ── Admin Settings Modal ── */}
        {isAdminOpen && (
          <div
            className="admin-modal-backdrop"
            onClick={handleCloseAdmin}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 99999,
            }}
          >
            <div
              className="admin-modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: "#111827",
                color: "#f9fafb",
                borderRadius: "16px",
                padding: "24px 28px",
                width: "90%",
                maxWidth: "420px",
                boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {!isAdminAuthed ? (
                <form onSubmit={handleAdminAuth}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "22px" }}>🔒</span>
                    <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#ffffff" }}>
                      Admin Authentication
                    </h3>
                  </div>
                  <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#9ca3af" }}>
                    Enter administrator password to access kiosk system settings.
                  </p>

                  <div style={{ marginBottom: "14px" }}>
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(e) => {
                        setPasswordInput(e.target.value);
                        if (authError) setAuthError("");
                      }}
                      placeholder="Enter password..."
                      autoFocus
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        border: authError ? "1px solid #ef4444" : "1px solid #374151",
                        backgroundColor: "#1f2937",
                        color: "#ffffff",
                        fontSize: "15px",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    {authError && (
                      <p style={{ margin: "6px 0 0 0", color: "#f87171", fontSize: "12.5px", fontWeight: "500" }}>
                        {authError}
                      </p>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={handleCloseAdmin}
                      style={{
                        padding: "9px 16px",
                        borderRadius: "8px",
                        border: "1px solid #4b5563",
                        backgroundColor: "transparent",
                        color: "#d1d5db",
                        cursor: "pointer",
                        fontSize: "13.5px",
                        fontWeight: "600",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      style={{
                        padding: "9px 20px",
                        borderRadius: "8px",
                        border: "none",
                        backgroundColor: "#00A63E",
                        color: "#ffffff",
                        cursor: "pointer",
                        fontSize: "13.5px",
                        fontWeight: "700",
                      }}
                    >
                      Unlock
                    </button>
                  </div>
                </form>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "22px" }}>⚙️</span>
                      <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#ffffff" }}>
                        Kiosk Admin Settings
                      </h3>
                    </div>
                    <span
                      style={{
                        backgroundColor: "rgba(0, 166, 62, 0.2)",
                        color: "#4ade80",
                        fontSize: "11px",
                        fontWeight: "700",
                        padding: "3px 8px",
                        borderRadius: "12px",
                        border: "1px solid rgba(74, 222, 128, 0.4)",
                      }}
                    >
                      Authenticated
                    </span>
                  </div>
                  <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#9ca3af" }}>
                    Terminal ID: <strong>#GF-04</strong> • Mode: Production Kiosk
                  </p>

                  {/* Setting: Voice to Text Subtitles Toggle */}
                  <div
                    style={{
                      backgroundColor: "#1f2937",
                      borderRadius: "12px",
                      padding: "16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "14px",
                      border: "1px solid #374151",
                      marginBottom: "20px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "14.5px", fontWeight: "600", color: "#ffffff", marginBottom: "4px" }}>
                        Show Voice to Text on Screen
                      </div>
                      <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: "1.4" }}>
                        Display live speech-to-text transcription and subtitles during conversations.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleSubtitles}
                      aria-checked={showSubtitles}
                      role="switch"
                      style={{
                        position: "relative",
                        width: "52px",
                        height: "28px",
                        borderRadius: "14px",
                        backgroundColor: showSubtitles ? "#00A63E" : "#4b5563",
                        border: "none",
                        cursor: "pointer",
                        padding: "2px",
                        transition: "background-color 0.2s",
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          width: "24px",
                          height: "24px",
                          borderRadius: "50%",
                          backgroundColor: "#ffffff",
                          boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                          transform: showSubtitles ? "translateX(24px)" : "translateX(0px)",
                          transition: "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                      />
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAdminAuthed(false);
                        handleCloseAdmin();
                      }}
                      style={{
                        padding: "9px 16px",
                        borderRadius: "8px",
                        border: "1px solid #4b5563",
                        backgroundColor: "transparent",
                        color: "#9ca3af",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: "600",
                      }}
                    >
                      Lock Admin
                    </button>
                    <button
                      type="button"
                      onClick={handleCloseAdmin}
                      style={{
                        padding: "9px 20px",
                        borderRadius: "8px",
                        border: "none",
                        backgroundColor: "#00A63E",
                        color: "#ffffff",
                        cursor: "pointer",
                        fontSize: "13.5px",
                        fontWeight: "700",
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
