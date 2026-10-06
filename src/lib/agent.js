// Pure, shared logic. Swap `reply` for a LangChain call in /api/chat when ready.
import { CATEGORIES, PRODUCTS } from "@/data/products";
import { inr } from "@/lib/format";

export const GREETING = "Hello, welcome to GreenFibre! I am Maya, your AI sustainability specialist. How can I assist your eco-conscious journey today?";
export const productsIn = (id) => (id === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.categories.includes(id)));

export function describeProduct(p, name) {
  const who = name ? `${name}, ` : "";
  const price = p.salePrice < p.price
    ? `The standard price is ${inr(p.price)}, and today's kiosk special is ${inr(p.salePrice)}.`
    : `The price is ${inr(p.price)}.`;
  return `${who}this is our ${p.name}. It is sustainably crafted from upcycled rice-husk biocomposite. ${price} Would you like bulk corporate pricing or custom branding?`;
}

const detectCategory = (t) => {
  if (/all|everything|show all|catalog|entire/i.test(t)) return "all";
  if (/desk|office|stationery|organizer|tray|valet/i.test(t)) return "office";
  if (/gift|corporate|bulk|hamper|box/i.test(t)) return "gifts";
  if (/kitchen|dining|bowl|soup|canister|bento|lunch/i.test(t)) return "kitchen";
  if (/bottle|mug|drink|cup|tumbler|flask/i.test(t)) return "drinkware";
  return null;
};

export function reply({ text = "", name = "" }) {
  const t = text.toLowerCase().trim();
  let currentName = name;

  // Check if user is introducing their name
  const nameMatch = text.match(/^(?:my name is|i am|i'm|this is|call me)\s+([a-zA-Z]+)/i);
  if (nameMatch && nameMatch[1]) {
    const extracted = nameMatch[1];
    currentName = extracted.charAt(0).toUpperCase() + extracted.slice(1).toLowerCase();
  }

  // Check if user is asking about rice husk material
  if (/rice husk|material|biocomposite|sustainability|eco|how it's made/i.test(t)) {
    return {
      name: currentName,
      message: `${currentName ? currentName + ", our" : "Our"} products are crafted from agricultural rice-husk biocomposites—diverting crop waste, eliminating virgin plastics, and creating 100% durable, dishwasher-safe lifestyle essentials.`
    };
  }

  // Check if user is asking for a specific product
  const product = PRODUCTS.find((p) =>
    t.includes(p.name.toLowerCase()) ||
    (p.shape && t.includes(p.shape)) ||
    t.includes(p.id.replace(/-/g, " ")) ||
    (p.id === "viora-bottle" && /bottle|viora/i.test(t)) ||
    (p.id === "statement-mug" && /mug|coffee/i.test(t)) ||
    (p.id === "travel-tumbler" && /tumbler|travel/i.test(t)) ||
    (p.id === "flora-bowl" && /bowl|soup/i.test(t)) ||
    (p.id === "canister" && /canister|pantry/i.test(t)) ||
    (p.id === "bento-box" && /bento|lunch/i.test(t)) ||
    (p.id === "desk-organizer" && /desk|organizer/i.test(t)) ||
    (p.id === "gift-box" && /hamper|box/i.test(t))
  );

  if (product && !(/show all|all products/i.test(t))) {
    return {
      name: currentName,
      message: describeProduct(product, currentName),
      action: { type: "SHOW_PRODUCT", productId: product.id, category: product.categories[0] }
    };
  }

  // Check if user is asking for a category
  const cat = detectCategory(t);
  if (cat) {
    const label = CATEGORIES.find((c) => c.id === cat)?.label || "collection";
    return {
      name: currentName,
      message: `Here is our ${label} collection${currentName ? ", " + currentName : ""}. Tap any product to view full specifications, pricing, and bulk enquiry options!`,
      action: { type: "SHOW_CATEGORY", category: cat }
    };
  }

  // If user just gave their name
  if (nameMatch && currentName) {
    return {
      name: currentName,
      message: `Delighted to meet you, ${currentName}! Explore our collections: Corporate Gifts, Drinkware, Kitchen & Dining, or Desk & Office.`
    };
  }

  return {
    name: currentName,
    message: "You can explore Corporate Gifts, Drinkware, Kitchen & Dining, or Desk & Office essentials. Feel free to tap any product on the screen!"
  };
}
