"use client";
import { useState } from "react";
import CategoryTabs from "./CategoryTabs";
import ProductCard from "./ProductCard";
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const currentCategory = CATEGORIES.find((c) => c.id === category);
  const label = currentCategory?.label || "All Products";

  return (
    <div className="showcase-container">
      {/* ── Top Navbar: GreenFibre logo on left, Menubar on right ── */}
      <RightNavbar
        activeCategory={category}
        productCount={products?.length || 8}
        onOpenMenu={() => setIsSidebarOpen(true)}
        onSelectCategory={onCategory}
      />

      {/* ── Premium Sidebar Flyout ── */}
      <PremiumSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeCategory={category}
        onSelectCategory={onCategory}
        totalProducts={products?.length || 8}
      />

      {/* ── All Products Showcase Catalog Page ── */}
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
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
