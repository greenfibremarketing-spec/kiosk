export const inr = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

/**
 * Festive Discount Configuration:
 * 20% Total Discount (10% + 10% Navratri & Diwali Special)
 */
export const FESTIVE_DISCOUNT = {
  totalPct: 20,
  breakdown: "10% + 10%",
  occasion: "Navratri & Diwali Special",
  badgeText: "10% + 10% OFF",
};

export const getFestivePricing = (p) => {
  if (!p) {
    return {
      mrp: 0,
      salePrice: 0,
      discountPct: FESTIVE_DISCOUNT.totalPct,
      breakdown: FESTIVE_DISCOUNT.breakdown,
      label: FESTIVE_DISCOUNT.occasion,
      savings: 0,
    };
  }

  const rawMrp = Number(p.mrp ?? p.price ?? 0);
  let salePrice = Number(p.salePrice ?? 0);

  // If salePrice is missing or undiscounted (equal to MRP), apply strictly 20% discount
  if (!salePrice || salePrice >= rawMrp) {
    salePrice = Math.round(rawMrp * 0.80);
  } else {
    // If salePrice was previously calculated with old 10% discount (~0.90 * rawMrp), upgrade it to 20% discount (0.80)
    const currentOff = rawMrp > 0 ? Math.round(((rawMrp - salePrice) / rawMrp) * 100) : 0;
    if (currentOff < 18) {
      salePrice = Math.round(rawMrp * 0.80);
    }
  }

  const calculatedDiscount = rawMrp > salePrice && rawMrp > 0
    ? Math.round(((rawMrp - salePrice) / rawMrp) * 100)
    : FESTIVE_DISCOUNT.totalPct;

  return {
    mrp: rawMrp,
    salePrice,
    discountPct: calculatedDiscount,
    breakdown: FESTIVE_DISCOUNT.breakdown,
    label: FESTIVE_DISCOUNT.occasion,
    savings: rawMrp > salePrice ? rawMrp - salePrice : 0,
  };
};

export const discountPct = (p) => {
  if (!p) return 0;
  return getFestivePricing(p).discountPct;
};

