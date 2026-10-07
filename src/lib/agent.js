// agent.js — Greenie AI brain with behaviour signal context awareness
import { CATEGORIES, PRODUCTS } from "@/data/products";
import { inr } from "@/lib/format";

export const GREETING =
  "Hello! Welcome to GreenFibre. I'm Greenie, your eco companion. Ask me anything or tap any product to explore!";

export const productsIn = (id) =>
  id === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.categories.includes(id));

export function describeProduct(p, name) {
  const who = name ? `${name}, ` : "";
  const price =
    p.salePrice < p.price
      ? `The standard price is ${inr(p.price)}, and today's special is ${inr(p.salePrice)}.`
      : `The price is ${inr(p.price)}.`;
  return `${who}this is our ${p.name}. It is crafted from upcycled rice-husk biocomposite — 100% durable and plastic-free. ${price} Would you like bulk corporate pricing or custom branding?`;
}

const detectCategory = (t) => {
  if (/all|everything|show all|catalog|entire/i.test(t)) return "all";
  if (/desk|office|stationery|organizer|tray|valet/i.test(t)) return "office";
  if (/gift|corporate|bulk|hamper|box/i.test(t)) return "gifts";
  if (/kitchen|dining|bowl|soup|canister|bento|lunch/i.test(t)) return "kitchen";
  if (/bottle|mug|drink|cup|tumbler|flask/i.test(t)) return "drinkware";
  return null;
};

/**
 * Build a signal-aware reply.
 * @param {{ text: string, name: string, signals?: object }} params
 */
export function reply({ text = "", name = "", signals = null }) {
  const t = text.toLowerCase().trim();
  let currentName = name;

  // Extract name if offered
  const nameMatch = text.match(
    /^(?:my name is|i am|i'm|this is|call me)\s+([a-zA-Z]+)/i
  );
  if (nameMatch?.[1]) {
    const extracted = nameMatch[1];
    currentName =
      extracted.charAt(0).toUpperCase() + extracted.slice(1).toLowerCase();
  }

  // --- Signal-driven proactive responses (no spoken text needed) ---
  if (!t && signals) {
    // Long silence after being engaged — re-engage
    if (signals.silenceSec >= 8 && signals.attention === "screen") {
      return {
        name: currentName,
        message: currentName
          ? `Still here, ${currentName}! Can I help you find something specific, or would you like to see our bestsellers?`
          : "Still here! Can I help you find something specific, or would you like to see our bestsellers?",
        trigger: "silence",
      };
    }
    // Customer looks away for a while
    if (signals.silenceSec >= 14 && signals.attention === "away") {
      return {
        name: currentName,
        message: "I'll be right here whenever you're ready! Feel free to tap anything.",
        trigger: "look_away",
      };
    }
    // Smiling and dwelling on the kiosk for a while — offer something special
    if (signals.smile > 0.55 && signals.dwellMs > 25000) {
      return {
        name: currentName,
        message: currentName
          ? `You have great taste, ${currentName}! Our bulk packs come with free custom branding — want to hear more?`
          : "Loving the enthusiasm! Our bulk packs come with free custom branding — want to hear more?",
        trigger: "smile_dwell",
      };
    }
    // Frowning / Sad / Frustrated — offer friendly empathetic support
    if (signals.sad > 0.45 && signals.dwellMs > 6000) {
      return {
        name: currentName,
        message: currentName
          ? `I hope your day gets better, ${currentName}! Let me know if you want to explore our most popular gifts.`
          : "I hope your day gets brighter! Can I show you our favorite zero-waste essentials to cheer you up?",
        trigger: "sad_empathy",
      };
    }
    return null; // No proactive message needed
  }

  // --- Text-driven responses ---
  if (!t) return null;

  // Character / fun queries
  if (/dance|dancing/i.test(t)) {
    return {
      name: currentName,
      message: "Happy eco dance! 💃 Celebrating sustainable living every day!",
    };
  }
  if (/wink/i.test(t)) {
    return {
      name: currentName,
      message: "A wink just for you! 😉 Let's make the planet greener together.",
    };
  }
  if (/who are you|what are you|your name/i.test(t)) {
    return {
      name: currentName,
      message:
        "I'm Greenie — leafy pigtails, rosy cheeks, big passion for zero-waste design. Ask me anything, or tap me to see me blush!",
    };
  }

  // Material / sustainability
  if (
    /rice husk|material|biocomposite|sustainability|eco|how it.s made|how are greenfibre/i.test(
      t
    )
  ) {
    return {
      name: currentName,
      message: `${
        currentName ? currentName + ", our" : "Our"
      } products are crafted from agricultural rice-husk biocomposites — diverting crop waste from burning, eliminating virgin plastics, and creating 100% durable, dishwasher-safe essentials.`,
    };
  }

  // Specific product match
  const product = PRODUCTS.find(
    (p) =>
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
  if (product && !/show all|all products/i.test(t)) {
    return {
      name: currentName,
      message: describeProduct(product, currentName),
      action: {
        type: "SHOW_PRODUCT",
        productId: product.id,
        category: product.categories[0],
      },
    };
  }

  // Category match
  const cat = detectCategory(t);
  if (cat) {
    const label = CATEGORIES.find((c) => c.id === cat)?.label || "collection";
    return {
      name: currentName,
      message: `Here is our ${label} collection${
        currentName ? ", " + currentName : ""
      }. Tap any product for full specs, pricing, and bulk options!`,
      action: { type: "SHOW_CATEGORY", category: cat },
    };
  }

  // Name only
  if (nameMatch && currentName) {
    return {
      name: currentName,
      message: `Lovely to meet you, ${currentName}! Explore Corporate Gifts, Drinkware, Kitchen & Dining, or Desk & Office.`,
    };
  }

  // Confusion / repeat questions — check signals
  if (signals?.confused > 0.4) {
    return {
      name: currentName,
      message:
        "Let me make it simple! You can tap any product on the screen to see its full details and price. Or just tell me what you need — like 'show me gifts' or 'eco bottles'.",
    };
  }

  return {
    name: currentName,
    message:
      "You can explore Corporate Gifts, Drinkware, Kitchen & Dining, or Desk & Office. Tap any product or ask me anything!",
  };
}
