"use client";
import React, { useState } from "react";
import CategoryTabs from "./CategoryTabs";
import ProductCard from "./ProductCard";
import ProductDetailPage from "./ProductDetailPage";
import CheckoutPage from "../checkout/CheckoutPage";
import OrderSuccessPage from "../checkout/OrderSuccessPage";
import RightNavbar from "@/components/navigation/RightNavbar";
import PremiumSidebar from "@/components/navigation/PremiumSidebar";
import { CATEGORIES } from "@/data/products";

export default function ProductShowcase({
  category,
  product,
  products = [],
  onCategory,
  onSelect,
}) {
  const [view, setView] = useState("catalog"); // "catalog" | "detail" | "checkout" | "success"
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [orderData, setOrderData] = useState(null);
  const [orderResult, setOrderResult] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const currentCategory = CATEGORIES.find((c) => c.id === category);
  const label = currentCategory?.label || "All Products";

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
  };

  // Sidebar category pick
  const handleSidebarCategory = (catId) => {
    onCategory?.(catId);
    setView("catalog");
    setSelectedProduct(null);
  };

  return (
    <div className="showcase-container">
      {/* ── Top Sticky Navbar: Logo on left, Menubar on right ── */}
      <RightNavbar
        activeCategory={category}
        productCount={products?.length || 8}
        onOpenMenu={() => setIsSidebarOpen(true)}
        onSelectCategory={handleSidebarCategory}
      />

      {/* ── Premium Sidebar Drawer ── */}
      <PremiumSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeCategory={category}
        onSelectCategory={handleSidebarCategory}
        totalProducts={products?.length || 8}
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
              <span className="dot-green" />
              <span>{products?.length || 8} Products</span>
            </div>
          </header>

          {/* Category Filter Tabs: All, Corporate Gifts, Drinkware, Kitchen, Office */}
          <CategoryTabs active={category} onSelect={onCategory} />

          {/* Main Product Listing Grid */}
          <div className="products-grid-wrapper">
            <div className="products-grid">
              {products?.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  active={p.id === product?.id}
                  onSelect={handleSelectProduct}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── View 2: Product Detail Page (PDP) ── */}
      {view === "detail" && selectedProduct && (
        <ProductDetailPage
          product={selectedProduct}
          onBack={handleReturnToCatalog}
          onProceedToCheckout={handleProceedToCheckout}
          onSelectProduct={handleSelectProduct}
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
