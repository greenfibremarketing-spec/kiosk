"use client";
import React, { useState, useEffect } from "react";
import ProductArt from "../products/ProductArt";
import PriceTag from "../products/PriceTag";
import { PRODUCTS } from "@/data/products";

export default function RightOnboardingFlow({
  isOpen,
  onClose,
  name = "",
  step: controlledStep = null,
  backendAction = null,
  categories = [],
  products = [],
  onSubmitName,
  onSkipName,
  onSelectCategory,
  onSelectProduct,
  onGoToAllProducts,
}) {
  // step: 1 = Ask Name, 2 = Show Categories & Recommendations
  const [step, setStep] = useState(controlledStep || 1);
  const [inputName, setInputName] = useState(name || "");
  const [activeTab, setActiveTab] = useState("recommendations");
  const [animatingOut, setAnimatingOut] = useState(false);
  const [transitioningStep, setTransitioningStep] = useState(false);

  // Sync if name was already introduced
  useEffect(() => {
    if (name) {
      setInputName(name);
    }
  }, [name]);

  // Sync if controlledStep changes dynamically (from AI backend action)
  useEffect(() => {
    if (controlledStep) {
      setStep(controlledStep);
    }
  }, [controlledStep]);

  // Reset or initialize step whenever onboarding is newly opened
  useEffect(() => {
    if (isOpen) {
      setStep(controlledStep || 1);
      setAnimatingOut(false);
      setTransitioningStep(false);
    }
  }, [isOpen, controlledStep]);

  if (!isOpen) return null;

  // Handle Step 1 (Name) submission -> Go directly to All Products page
  const handleProceedFromStep1 = (chosenName = "") => {
    const trimmed = (chosenName || inputName).trim();
    if (trimmed) {
      onSubmitName?.(trimmed);
    } else {
      onSkipName?.();
    }
    onGoToAllProducts?.();
    handleDismiss();
  };

  const handleSkipStep1 = () => {
    onSkipName?.();
    onGoToAllProducts?.();
    handleDismiss();
  };

  // Close with smooth exit animation
  const handleDismiss = () => {
    setAnimatingOut(true);
    setTimeout(() => {
      onClose?.();
      setAnimatingOut(false);
    }, 260);
  };

  const categoryMetaMap = {
    "kitchen-dining": { icon: "🍳", desc: "Cookware, bowls & dining sets" },
    kitchen: { icon: "🍳", desc: "Cookware, bowls & dining sets" },
    bottle: { icon: "💧", desc: "Insulated bottles & flasks" },
    drinkware: { icon: "☕", desc: "Mugs, cups & travel tumblers" },
    "gift-boxes-hampers": { icon: "🎁", desc: "Curated gift bundles & sets" },
    gifts: { icon: "🎁", desc: "Curated gift bundles & sets" },
    tableware: { icon: "🍽️", desc: "Plates, bowls & dinnerware" },
    planter: { icon: "🪴", desc: "Desk & home biocomposite pots" },
    storage: { icon: "📦", desc: "Airtight pantry canisters" },
    office: { icon: "💼", desc: "Sustainable desk essentials" },
  };

  const getCategoryCount = (catId) => {
    const clean = String(catId).toLowerCase().trim();
    return (products || []).filter((p) => {
      const pCat = String(p.category || "").toLowerCase();
      const pCats = Array.isArray(p.categories) ? p.categories.map((c) => String(c).toLowerCase()) : [];
      return pCat.includes(clean) || clean.includes(pCat) || pCats.includes(clean);
    }).length;
  };

  // Build clean categories list directly from backend categories or fallback
  const displayCategories =
    categories && categories.length > 0
      ? categories.filter((c) => c.id !== "all")
      : [
          { id: "kitchen-dining", label: "Kitchen & Dining" },
          { id: "bottle", label: "Bottle" },
          { id: "drinkware", label: "Drinkware" },
          { id: "gift-boxes-hampers", label: "Gift Boxes & Hampers" },
          { id: "tableware", label: "Tableware" },
          { id: "planter", label: "Planter" },
          { id: "storage", label: "Storage" },
        ];

  return (
    <div
      className={`right-onboarding-backdrop ${animatingOut ? "right-onboarding--exit" : ""}`}
      onClick={handleDismiss}
      aria-label="Welcome and Category Explorer"
    >
      <div
        className={`right-onboarding-card ${transitioningStep ? "step-transitioning" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          className="right-onboarding-close-btn"
          onClick={handleDismiss}
          aria-label="Close"
        >
          ✕
        </button>

        {/* ═════════════════════════════════════════════════════════════════════════
            STEP 1: ASK NAME (First Step)
            ═════════════════════════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="right-flow-step step-1-anim">
            {/* Step Pill Header */}
            <div className="right-step-eyebrow">
              <span className="step-num-badge">Step 1 of 2</span>
              <span className="step-badge-text">👋 Welcome to GreenFibre</span>
            </div>

            <div className="right-flow-headline">
              <h2>{backendAction?.prompt || backendAction?.message || "What should I call you?"}</h2>
              <p>
                I'm <strong>Greenie</strong>, your AI sustainability companion. Let's personalize your visit!
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleProceedFromStep1();
              }}
              className="right-name-form"
            >
              <div className="right-input-wrapper">
                <span className="right-input-icon">👤</span>
                <input
                  type="text"
                  placeholder="Your name (e.g. Puneet)..."
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  className="right-text-input"
                  autoFocus
                />
              </div>

              <div className="right-name-actions-row">
                <button
                  type="submit"
                  className="right-btn-continue"
                  disabled={!inputName.trim()}
                >
                  <span>Continue</span>
                  <span className="btn-arrow">→</span>
                </button>
                <button
                  type="button"
                  className="right-btn-skip"
                  onClick={handleSkipStep1}
                >
                  Skip for now
                </button>
              </div>
            </form>

            <div className="step-dots-row">
              <span className="dot dot--active" />
              <span className="dot" />
            </div>
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════════════════════
            STEP 2: SHOW CATEGORIES & RECOMMENDATIONS (Then Step)
            ═════════════════════════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div className="right-flow-step step-2-anim">
            {/* Step Pill Header */}
            <div className="right-step-eyebrow">
              <span className="step-num-badge step-num-badge--green">Step 2 of 2</span>
              <span className="step-badge-text">
                {name || inputName ? `🌿 Curated for ${name || inputName}` : "🌿 Sustainable Collections"}
              </span>
            </div>

            <div className="right-flow-headline">
              <h2>
                {backendAction?.message || (name || inputName ? `Nice to meet you, ${name || inputName}! What are you looking for today?` : "Which category would you like to explore?")}
              </h2>
              <p>
                Select a collection below to discover sustainable essentials crafted from 100% upcycled rice-husk:
              </p>
            </div>

            {/* Category Cards Grid */}
            <div className="right-category-cards-grid">
              {displayCategories.map((cat, idx) => {
                const meta = categoryMetaMap[cat.id] || { icon: "🌿", desc: "Eco Collection" };
                const count = getCategoryCount(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className="right-cat-card"
                    style={{ animationDelay: `${idx * 0.04}s` }}
                    onClick={() => {
                      onSelectCategory?.(cat.id);
                      handleDismiss();
                    }}
                  >
                    <div className="right-cat-icon">
                      <span>{meta.icon}</span>
                    </div>
                    <div className="right-cat-info">
                      <h4 className="right-cat-title">{cat.label || cat.name || cat.id}</h4>
                      <span className="right-cat-desc">{count > 0 ? `${count} Products` : meta.desc}</span>
                    </div>
                    <span className="right-cat-arrow">→</span>
                  </button>
                );
              })}
            </div>

            {/* Bottom Primary Action: Go to All Products */}
            <div className="right-flow-footer">
              <button
                type="button"
                className="right-btn-all-products"
                onClick={() => {
                  onGoToAllProducts?.();
                  handleDismiss();
                }}
              >
                <div className="btn-all-left">
                  <span className="btn-all-icon">🛍️</span>
                  <span>{backendAction?.show_all?.name || "Show Everything"}</span>
                </div>
                <span className="btn-all-arrow">→</span>
              </button>
            </div>

            <div className="step-dots-row">
              <span className="dot dot--completed" onClick={() => setStep(1)} title="Back to name" />
              <span className="dot dot--active" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
