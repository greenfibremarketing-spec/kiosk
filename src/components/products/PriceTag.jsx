import { discountPct, inr } from "@/lib/format";

export default function PriceTag({ product, size = "md" }) {
  if (!product) return null;
  const off = discountPct(product);

  return (
    <div className={`price price--${size}`}>
      <span className="price__now">{inr(product.salePrice ?? product.price)}</span>
      {off > 0 && (
        <>
          <s className="price__was">{inr(product.price)}</s>
          <span className="price__off">-{off}%</span>
        </>
      )}
    </div>
  );
}
