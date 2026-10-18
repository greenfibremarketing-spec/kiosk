// safetyNet.js — Grounding & Fallback Safety Net for Greenie Kiosk
// Protects against hallucinated prices, unauthorized discounts, and unexpected AI latency.

export const HONEST_FALLBACKS = {
  // a. Not understood (empty, noise, very short, low confidence)
  not_understood: [
    "Sorry, I couldn't catch that, it may be some noise around. Could you say it again, or tap on the screen?",
    "Pardon me, there seems to be a little background noise. Could you repeat that or tap on the display?",
    "I didn't quite catch that. Would you mind repeating, or you can tap any category to explore!",
  ],

  // b. Understood but the answer is not in the data
  not_in_data: [
    "Sorry, I don't have that detail right now. I can tell you about the material, colours, size and price instead.",
    "I don't have that exact detail handy. But I'd love to share the colours, size, or material with you!",
    "That detail isn't in my notes right now. I can tell you about its eco-material, size, or pricing instead!",
  ],

  // c. Not in the catalogue (e.g. laptop, shoes, clothing)
  not_in_catalog: [
    "I couldn't find that here, but you can browse our categories on screen, or tell me what you need and I'll suggest something.",
    "We don't have that in our collection, but feel free to explore our sustainable kitchen and drinkware on screen!",
    "I don't see that item in our catalogue, but tell me what you're looking for and I'll find our closest eco-match.",
  ],

  // d. Unrelated topic (weather, news, politics)
  unrelated_topic: [
    "I'm best at helping with our eco-friendly products. What are you looking for today?",
    "I focus on our sustainable lifestyle collection here at GreenFibre. What can I help you find today?",
    "I'm here to help you shop our sustainable essentials! Tell me what you'd like to explore.",
  ],
};

const _rotationIndices = {
  not_understood: 0,
  not_in_data: 0,
  not_in_catalog: 0,
  unrelated_topic: 0,
};

export function getHonestFallback(type) {
  const pool = HONEST_FALLBACKS[type] || HONEST_FALLBACKS.not_understood;
  const idx = _rotationIndices[type] || 0;
  _rotationIndices[type] = (idx + 1) % pool.length;
  return pool[idx];
}

/**
 * Extracts and verifies every number in an AI reply against contextual products.
 * If any number (price, dimensions, percentages) does not exist in the context,
 * flags the reply as ungrounded.
 */
export function verifyReplyGrounding(replyText, contextProducts = []) {
  if (!replyText || typeof replyText !== "string") {
    return { valid: true, text: replyText };
  }

  // Permitted universal constants (e.g., 100% rice husk, 10% discount, 5% pair-up discount, small counts)
  const allowedNumbers = new Set([0, 1, 2, 3, 4, 5, 10, 100]);

  // Extract all valid numbers from contextProducts
  const prods = Array.isArray(contextProducts) ? contextProducts : [contextProducts].filter(Boolean);
  for (const p of prods) {
    if (!p) continue;
    if (p.price) allowedNumbers.add(Math.round(Number(p.price)));
    if (p.salePrice) allowedNumbers.add(Math.round(Number(p.salePrice)));
    if (p.mrp) allowedNumbers.add(Math.round(Number(p.mrp)));
    if (p.rating) allowedNumbers.add(Math.round(Number(p.rating)));
    if (p.reviews) allowedNumbers.add(Math.round(Number(p.reviews)));

    // Extract numbers from name, specs, blurb, description
    const textBlob = `${p.name || ""} ${p.description || ""} ${p.blurb || ""} ${(p.specs || []).join(" ")} ${(p.tags || []).join(" ")}`;
    const foundNums = textBlob.match(/\b\d+(?:\.\d+)?\b/g);
    if (foundNums) {
      for (const n of foundNums) {
        allowedNumbers.add(Math.round(Number(n)));
      }
    }
  }

  // Extract numbers from reply text
  const replyNumbers = replyText.match(/\b\d+(?:\.\d+)?\b/g);
  if (!replyNumbers) {
    return { valid: true, text: replyText };
  }

  for (const rawNum of replyNumbers) {
    const parsed = Math.round(Number(rawNum));
    if (!allowedNumbers.has(parsed)) {
      console.warn(`[SafetyNet] Hallucinated/unverified number "${rawNum}" detected in reply: "${replyText}". Replacing with fallback.`);
      return {
        valid: false,
        text: getHonestFallback("not_in_data"),
        hallucinatedNumber: rawNum,
      };
    }
  }

  return { valid: true, text: replyText };
}
