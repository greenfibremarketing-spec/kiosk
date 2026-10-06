import { CATEGORIES, PRODUCTS } from "@/data/products";

export default function CategoryTabs({ active, onSelect }) {
  const getCount = (catId) => {
    if (catId === "all") return PRODUCTS.length;
    return PRODUCTS.filter((p) => p.categories.includes(catId)).length;
  };

  return (
    <div className="category-tabs-container">
      <div className="chips category-chips" role="tablist" aria-label="Product Categories">
        {CATEGORIES.map((c) => {
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
              <span className="tab-label">{c.label}</span>
              <span className="tab-count">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
