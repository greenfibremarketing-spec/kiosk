"use client";
import React, { useState, useEffect } from "react";
import CategoryTabs from "./CategoryTabs";
import ProductCard from "./ProductCard";
import ProductDetailPage from "./ProductDetailPage";
import ProductSkeletonGrid from "./ProductSkeletonGrid";
import CheckoutPage from "../checkout/CheckoutPage";
import OrderSuccessPage from "../checkout/OrderSuccessPage";
import OrderErrorPage from "../checkout/OrderErrorPage";
import RightNavbar from "@/components/navigation/RightNavbar";
import PremiumSidebar from "@/components/navigation/PremiumSidebar";
import ErrorBoundary from "@/components/debug/ErrorBoundary";
import FilterChip from "./FilterChip";
export default function ProductShowcase({
  category,
  categories = [],
  product,
  products = [],
  catalog = [],
  backendCatalog = [],
  isLoading = false,
  onCategory,
  onSelect,
  showDetail = false,
  onCloseDetail,
  actionButtons = [],
  onButtonClick,
  name = "",
  onResetSession,
  onOpenNameModal,
  onContinueAsGuest,
  kioskModeRef = null,
  replayingRef = null,
  onAddToCart,
  cartItems = [],
  cartTotals = null,
  onRemoveItem,
  showCheckout = false,
  onCloseCheckout,
  filtersApplied = null,
  onClearFilters = null,
  highlightSku = null,
  sessionId = null,
}) {
  const [view, setView] = useState("catalog"); // "catalog" | "detail" | "checkout" | "success" | "error"
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [orderData, setOrderData] = useState(null);
  const [orderResult, setOrderResult] = useState(null);
  const [orderError, setOrderError] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // If products list is empty but backendCatalog has items, show backendCatalog (Requirement 3)
  const catalogList = (backendCatalog && backendCatalog.length > 0)
    ? backendCatalog
    : (catalog && catalog.length > 0 ? catalog : []);

  const displayProducts = (products && products.length > 0)
    ? products
    : (catalogList && catalogList.length > 0 ? catalogList : []);

  // If view === "detail" and selectedProduct is null, fall back to the catalog view (Requirement 3)
  useEffect(() => {
    if (view === "detail" && !selectedProduct) {
      setView("catalog");
    }
  }, [view, selectedProduct]);

  const effectiveView = (view === "detail" && !selectedProduct) ? "catalog" : view;

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

  // If showCheckout prop is triggered, navigate to checkout view
  useEffect(() => {
    if (showCheckout) {
      setView("checkout");
    }
  }, [showCheckout]);

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
    setOrderError(null);
    setView("success");
  };

  // When payment verification or order placement fails
  const handleOrderError = (errorDetails) => {
    setOrderError(errorDetails);
    setView("error");
  };

  // Return back to All Products catalog
  const handleReturnToCatalog = () => {
    setView("catalog");
    setSelectedProduct(null);
    setOrderResult(null);
    setOrderError(null);
    setOrderData(null);
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
        productCount={displayProducts?.length || 0}
        onOpenMenu={() => setIsSidebarOpen(true)}
        onSelectCategory={handleSidebarCategory}
        name={name}
        onResetSession={onResetSession}
        onOpenNameModal={onOpenNameModal}
        onContinueAsGuest={onContinueAsGuest}
      />

      {/* ── Premium Sidebar Drawer ── */}
      <PremiumSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeCategory={category}
        onSelectCategory={handleSidebarCategory}
        categories={activeCats}
        products={displayProducts}
      />

      {/* ── View 1: All Products Catalog Grid ── */}
      {effectiveView === "catalog" && (
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
              <span className={isLoading ? "dot-pulsing" : (displayProducts?.length > 0 ? "dot-green" : "dot-gray")} />
              <span>{isLoading ? "Loading collection..." : `${displayProducts?.length || 0} Products`}</span>
            </div>
          </header>

          {/* Category Filter Tabs */}
          <CategoryTabs
            active={category}
            onSelect={onCategory}
            categories={activeCats}
            products={catalogList?.length ? catalogList : displayProducts}
            onOpenMore={() => setIsSidebarOpen(true)}
          />

          {/* Active Conversation Filter Chip */}
          <FilterChip filtersApplied={filtersApplied} onClear={onClearFilters} />

          {/* Main Product Listing Grid */}
          <div className="products-grid-wrapper">
            {isLoading ? (
              <ProductSkeletonGrid count={8} />
            ) : displayProducts && displayProducts.length > 0 ? (
              <div className="products-grid">
                {displayProducts.map((p) => {
                  const isHighlighted = Boolean(
                    highlightSku &&
                      (p.sku === highlightSku ||
                        p.id === highlightSku ||
                        (p.sku &&
                          String(p.sku).replace(/^GF:/, "") === String(highlightSku).replace(/^GF:/, "")))
                  );
                  return (
                    <ProductCard
                      key={p.id}
                      product={p}
                      active={p.id === product?.id}
                      highlighted={isHighlighted}
                      onSelect={handleSelectProduct}
                    />
                  );
                })}
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
      {effectiveView === "detail" && selectedProduct && (
        <ErrorBoundary name="ProductDetailPage">
          <ProductDetailPage
            key={selectedProduct.sku || selectedProduct.id || selectedProduct.name}
            product={selectedProduct}
            products={displayProducts}
            onBack={handleReturnToCatalog}
            onProceedToCheckout={handleProceedToCheckout}
            onAddToCart={onAddToCart}
            onSelectProduct={handleSelectProduct}
            buttons={actionButtons}
            onButtonClick={onButtonClick}
            kioskModeRef={kioskModeRef}
            replayingRef={replayingRef}
          />
        </ErrorBoundary>
      )}

      {/* ── View 3: Checkout Page (Shipping & Payment) ── */}
      {effectiveView === "checkout" && (orderData || (cartItems && cartItems.length > 0)) && (
        <CheckoutPage
          order={
            orderData
              ? { ...orderData, cartItems, cartTotals }
              : {
                  product: selectedProduct || product || cartItems[0] || {},
                  cartItems,
                  cartTotals,
                }
          }
          catalog={displayProducts}
          sessionId={sessionId}
          onBack={() => {
            setView(selectedProduct ? "detail" : "catalog");
            onCloseCheckout?.();
          }}
          onOrderSuccess={handleOrderSuccess}
          onOrderError={handleOrderError}
          onRemoveItem={onRemoveItem}
        />
      )}

      {/* ── View 4: Order Confirmation & Celebration ── */}
      {effectiveView === "success" && orderResult && (
        <OrderSuccessPage
          orderResult={orderResult}
          onReturnToCatalog={handleReturnToCatalog}
          onResetSession={onResetSession}
        />
      )}

      {/* ── View 5: Order Failure & Verification Error Screen ── */}
      {effectiveView === "error" && orderError && (
        <OrderErrorPage
          orderError={orderError}
          onRetry={() => {
            setView("checkout");
          }}
          onReturnToCatalog={handleReturnToCatalog}
        />
      )}
    </div>
  );
}
