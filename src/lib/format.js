export const inr = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
export const discountPct = (p) => (p.salePrice < p.price ? Math.round((1 - p.salePrice / p.price) * 100) : 0);
