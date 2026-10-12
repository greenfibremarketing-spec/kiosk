"use client";
import React, { useState, useEffect } from "react";
import CategoryTabs from "./CategoryTabs";
import ProductCard from "./ProductCard";
import ProductDetailPage from "./ProductDetailPage";
import CheckoutPage from "../checkout/CheckoutPage";
import OrderSuccessPage from "../checkout/OrderSuccessPage";
import RightNavbar from "@/components/navigation/RightNavbar";
import PremiumSidebar from "@/components/navigation/PremiumSidebar";
export default function ProductShowcase({
  category,
  categories = [],
  product,
  products = [],
  onCategory,
  onSelect,
  showDetail = false,
  onCloseDetail,
  actionButtons = [],
  onButtonClick,
}) {
  const [view, setView] = useState("catalog"); // "catalog" | "detail" | "checkout" | "success"
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [orderData, setOrderData] = useState(null);
  const [orderResult, setOrderResult] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const activeCats = categories && categories.length > 0 ? categories : [{ id: "all", label: "All Products" }];
  const currentCategory = activeCats.find((c) => c.id === category || c.id === String(category).toLowerCase());
  const label = currentCategory?.label || currentCategory?.name || "All Products";

  // Automatically sync product & detail view when AI explores a product
  useEffect(() => {
    if (product) {
      setSelectedProduct(product);
      if (showDetail) {
        setView("detail");
      }
    }
  }, [product, showDetail]);

  // If category changes or detail closed, return to catalog
  useEffect(() => {
    if (!showDetail && view === "detail") {
      setView("catalog");
    }
  }, [category, showDetail, view]);

  // When user clicks a product in the catalog
  const handleSelectProduct = (p) => {
    onSelect?.(p);
    setSelectedProduct(p);
    setView("detail");
  };

  // When user clicks "Add to Cart & Checkout" on the PDP
  const handleProceedToCheckout = (order) => {
    setOrderData(order);
    setView("checkout");
  };

  // When user successfully completes payment
  const handleOrderSuccess = (result) => {
    setOrderResult(result);
    setView("success");
  };

  // Return back to All Products catalog
  const handleReturnToCatalog = () => {
    setView("catalog");
    setSelectedProduct(null);
    onCloseDetail?.();
  };

  // Sidebar category pick
  const handleSidebarCategory = (catId) => {
    onCategory?.(catId);
    setView("catalog");
    setSelectedProduct(null);
    onCloseDetail?.();
  };

  return (
    <div className="showcase-container">
      {/* ── Top Sticky Navbar: Logo on left, Menubar on right ── */}
      <RightNavbar
        activeCategory={category}
        productCount={products?.length || 0}
        onOpenMenu={() => setIsSidebarOpen(true)}
        onSelectCategory={handleSidebarCategory}
      />

      {/* ── Premium Sidebar Drawer ── */}
      <PremiumSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeCategory={category}
        onSelectCategory={handleSidebarCategory}
        categories={activeCats}
        products={products}
      />

      {/* ── View 1: All Products Catalog Grid ── */}
      {view === "catalog" && (
        <section className="showcase" aria-label="Product Catalog">
          {/* Top Header & Counter Bar */}
          <header className="showcase__header">
            <div className="showcase__title-group">
              <h1>{label}</h1>
              <p className="showcase__subtitle">
                Sustainable lifestyle essentials handcrafted from 100% upcycled rice-husk agricultural biocomposite.
              </p>
            </div>
            <div className="showcase__counter-badge">
              <span className={products?.length > 0 ? "dot-green" : "dot-gray"} />
              <span>{products?.length || 0} Products</span>
            </div>
          </header>

          {/* Category Filter Tabs */}
          <CategoryTabs
            active={category}
            onSelect={onCategory}
            categories={activeCats}
            products={products}
          />

          {/* Main Product Listing Grid */}
          <div className="products-grid-wrapper">
            {products && products.length > 0 ? (
              <div className="products-grid">
                {products.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    active={p.id === product?.id}
                    onSelect={handleSelectProduct}
                  />
                ))}
              </div>
            ) : (
              <div className="products-empty-state">
                <div className="empty-state-card">
                  <div className="empty-state-icon">
                    <svg
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                  </div>
                  <h3 className="empty-state-title">No Products Found</h3>
                  <p className="empty-state-desc">
                    {category && category !== "all"
                      ? `We couldn't find any products in the "${label}" collection.`
                      : "No products are currently available in the catalog."}
                  </p>
                  {category && category !== "all" && (
                    <button
                      type="button"
                      className="empty-state-btn"
                      onClick={() => onCategory?.("all")}
                    >
                      <span>View All Products</span>
                      <span>→</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── View 2: Product Detail Page (PDP) ── */}
      {view === "detail" && selectedProduct && (
        <ProductDetailPage
          product={selectedProduct}
          products={products}
          onBack={handleReturnToCatalog}
          onProceedToCheckout={handleProceedToCheckout}
          onSelectProduct={handleSelectProduct}
          buttons={actionButtons}
          onButtonClick={onButtonClick}
        />
      )}

      {/* ── View 3: Checkout Page (Shipping & Payment) ── */}
      {view === "checkout" && orderData && (
        <CheckoutPage
          order={orderData}
          onBack={() => setView("detail")}
          onOrderSuccess={handleOrderSuccess}
        />
      )}

      {/* ── View 4: Order Confirmation & Celebration ── */}
      {view === "success" && orderResult && (
        <OrderSuccessPage
          orderResult={orderResult}
          onReturnToCatalog={handleReturnToCatalog}
        />
      )}
    </div>
  );
}
