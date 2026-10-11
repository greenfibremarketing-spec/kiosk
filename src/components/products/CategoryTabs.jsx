import { CATEGORIES as DEFAULT_CATEGORIES, PRODUCTS as DEFAULT_PRODUCTS } from "@/data/products";

export default function CategoryTabs({
  active,
  onSelect,
  categories = DEFAULT_CATEGORIES,
  products = DEFAULT_PRODUCTS,
}) {
  const getCount = (catId) => {
    if (catId === "all") return products.length;
    const clean = String(catId).toLowerCase().trim();
    return products.filter((p) => {
      const pCat = String(p.category || "").toLowerCase();
      const pCats = Array.isArray(p.categories) ? p.categories.map((c) => String(c).toLowerCase()) : [];
      return pCat.includes(clean) || clean.includes(pCat) || pCats.includes(clean);
    }).length;
  };

  return (
    <div className="category-tabs-container">
      <div className="chips category-chips" role="tablist" aria-label="Product Categories">
        {categories.map((c) => {
          const isSelected = c.id === active;
          const count = getCount(c.id);
          return (
            <button
              key={c.id}
              role="tab"
              id={`tab-${c.id}`}
              aria-selected={isSelected}
              className={`chip chip--dark ${isSelected ? "chip--active" : ""}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="tab-label">{c.label || c.name}</span>
              <span className="tab-count">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
