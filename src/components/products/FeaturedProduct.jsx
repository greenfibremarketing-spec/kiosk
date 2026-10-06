import ProductArt from "./ProductArt";
import PriceTag from "./PriceTag";

export default function FeaturedProduct({ product, onEnquire }) {
  if (!product) return null;

  return (
    <article className="featured" aria-labelledby="featured-title">
      <div className="featured__art">
        <ProductArt image={product.image} name={product.name} shape={product.shape} />
        <div className="featured__eco-stamp">
          <span className="stamp-icon">🌾</span>
          <span className="stamp-text">100% Rice-Husk Biocomposite</span>
        </div>
      </div>

      <div className="featured__info">
        <div className="featured__header-row">
          {product.badge && <span className="featured__badge">{product.badge}</span>}
          <div className="featured__rating">
            <span className="star-icon">★★★★★</span>
            <strong>{product.rating || "4.9"}</strong>
            <span className="review-num">({product.reviews || 80} verified kiosk reviews)</span>
          </div>
        </div>

        <h2 id="featured-title">{product.name}</h2>
        <p className="featured__blurb">{product.blurb}</p>

        <ul className="tags" aria-label="Key highlights">
          {product.tags?.map((t) => (
            <li key={t}>
              <span className="tag-bullet">✓</span> {t}
            </li>
          ))}
        </ul>

        {product.specs && (
          <div className="featured__specs">
            {product.specs.map((s, idx) => (
              <span key={idx} className="spec-pill">{s}</span>
            ))}
          </div>
        )}

        <div className="featured__pricing-box">
          <div className="pricing-col">
            <span className="pricing-label">Single Unit Price</span>
            <PriceTag product={product} size="lg" />
          </div>
          <div className="bulk-note">
            <span>📦 Tiered discounts for corporate orders (25+ units)</span>
          </div>
        </div>

        <div className="featured__actions">
          <button
            type="button"
            className="cta cta--primary"
            onClick={onEnquire}
            id="btn-enquire-bulk"
          >
            <span>Ask About Bulk & Corporate Pricing</span>
            <span className="cta-arrow">→</span>
          </button>
        </div>
      </div>
    </article>
  );
}
