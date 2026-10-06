"use client";
import CategoryTabs from "./CategoryTabs";
import ProductCard from "./ProductCard";
import { CATEGORIES } from "@/data/products";

export default function ProductShowcase({
  category,
  product,
  products,
  onCategory,
  onSelect
}) {
  const currentCategory = CATEGORIES.find((c) => c.id === category);
  const label = currentCategory?.label || "Products";

  return (
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
          <span>{products.length} Products</span>
        </div>
      </header>

      {/* Category Tabs: All (8), Corporate Gifts, Drinkware, Kitchen, Office */}
      <CategoryTabs active={category} onSelect={onCategory} />

      {/* Main Product Listing Grid */}
      <div className="products-grid-wrapper">
        <div className="products-grid">
          {products.map((p) => (
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
  );
}
