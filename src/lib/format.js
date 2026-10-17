export const inr = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
export const discountPct = (p) => {
  if (!p) return 0;
  const sale = Number(p.salePrice ?? p.price ?? 0);
  const was = Number(p.mrp ?? p.price ?? 0);
  return was > sale && was > 0 ? Math.round(((was - sale) / was) * 100) : 0;
};
