import { discountPct, inr } from "@/lib/format";

export default function PriceTag({ product, size = "md" }) {
  if (!product) return null;
  const off = discountPct(product);
  const now = product.salePrice ?? product.price;
  const was = product.mrp ?? product.price;

  return (
    <div className={`price price--${size}`}>
      <span className="price__now">{inr(now)}</span>
      {off > 0 && (
        <>
          <s className="price__was">{inr(was)}</s>
          <span className="price__off">-{off}%</span>
        </>
      )}
    </div>
  );
}
