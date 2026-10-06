import ProductArt from "./ProductArt";
import PriceTag from "./PriceTag";

export default function ProductCard({ product, active, onSelect }) {
  return (
    <article
      className={`luxury-card ${active ? "luxury-card--active" : ""}`}
      onClick={() => onSelect(product)}
      role="button"
      tabIndex={0}
      id={`product-card-${product.id}`}
      aria-current={active}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(product);
        }
      }}
    >
      {/* Product Image Stage */}
      <div className="luxury-card__media">
        <ProductArt image={product.image} name={product.name} shape={product.shape} />
      </div>

      {/* Product Information: Title & Price Only */}
      <div className="luxury-card__content">
        <h3 className="luxury-card__title" title={product.name}>
          {product.name}
        </h3>

        <div className="luxury-card__footer">
          <PriceTag product={product} size="md" />
        </div>
      </div>
    </article>
  );
}
