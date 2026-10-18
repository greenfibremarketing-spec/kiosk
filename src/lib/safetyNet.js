// safetyNet.js — Grounding & Fallback Safety Net for Greenie Kiosk
// Protects against hallucinated prices, unauthorized discounts, invented specifications, and unexpected AI latency.

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

  // e. Slow AI reply (watchdog timeout)
  taking_longer: [
    "Sorry, that's taking a little longer. Could you ask me again, or tap on the screen?",
    "Pardon me, that took longer than usual. Would you mind asking once more, or tap any item to explore?",
    "Sorry for the delay, that's taking a moment. Could you say that again, or touch the screen to browse?",
  ],
};

const _rotationIndices = {
  not_understood: 0,
  not_in_data: 0,
  not_in_catalog: 0,
  unrelated_topic: 0,
  taking_longer: 0,
};

export function getHonestFallback(type) {
  const pool = HONEST_FALLBACKS[type] || HONEST_FALLBACKS.not_understood;
  const idx = _rotationIndices[type] || 0;
  _rotationIndices[type] = (idx + 1) % pool.length;
  return pool[idx];
}

/**
 * Extracts and verifies every number and factual claim in an AI reply
 * strictly against the product(s) currently in context.
 *
 * @param {string} replyText - The proposed response from Greeny
 * @param {Array|Object} contextProducts - The active product(s) in context (open product, or products being discussed)
 * @returns {{ valid: boolean, text: string, reason?: string, hallucinatedNumber?: string }}
 */
export function verifyReplyGrounding(replyText, contextProducts = []) {
  if (!replyText || typeof replyText !== "string") {
    return { valid: true, text: replyText || "" };
  }

  // 1. Permitted universal constants (standard counts, universal discounts, 100% eco)
  const allowedNumbers = new Set([0, 1, 2, 3, 4, 5, 6, 10, 100]);

  const prods = Array.isArray(contextProducts)
    ? contextProducts.filter(Boolean)
    : (contextProducts ? [contextProducts] : []);

  // Concatenate context product text for factual grounding verification
  let combinedProductText = "";

  for (const p of prods) {
    if (!p) continue;

    const basePrice = Number(p.price || p.salePrice || p.mrp || 0);
    const mrp = Number(p.mrp || p.price || 0);

    if (basePrice > 0) allowedNumbers.add(Math.round(basePrice));
    if (mrp > 0) allowedNumbers.add(Math.round(mrp));

    // 10% standard kiosk discount: e.g. 1199 * 0.9 = 1079.1 -> 1079
    if (mrp > 0) {
      allowedNumbers.add(Math.round(mrp * 0.9));
      allowedNumbers.add(Math.floor(mrp * 0.9));
      allowedNumbers.add(Math.ceil(mrp * 0.9));
    }
    if (basePrice > 0) {
      allowedNumbers.add(Math.round(basePrice * 0.9));
      allowedNumbers.add(Math.floor(basePrice * 0.9));
      allowedNumbers.add(Math.ceil(basePrice * 0.9));
    }

    // 5% pair-up discount on bundle
    if (mrp > 0) allowedNumbers.add(Math.round(mrp * 0.85));

    // Extract numbers from name, specs, blurb, description, variants
    const variantNames = (p.variants || []).map((v) => v?.name || "").join(" ");
    const textBlob = `${p.name || ""} ${p.description || ""} ${p.blurb || ""} ${(p.specs || []).join(" ")} ${(p.tags || []).join(" ")} ${variantNames}`;
    combinedProductText += " " + textBlob;

    const foundNums = textBlob.match(/\b\d+(?:[\.,]\d+)?\b/g);
    if (foundNums) {
      for (const n of foundNums) {
        const clean = n.replace(/,/g, "");
        allowedNumbers.add(Math.round(Number(clean)));
      }
    }
  }

  const pTextLower = combinedProductText.toLowerCase();

  // 2. Fact Grounding Checks

  // (a) Heat / temperature retention claims (e.g. "hot for 12 hours", "keeps drinks hot for 12 hours")
  const heatClaimMatch = replyText.match(/(?:hot|cold|keep(?:s)?\s+drinks?\s+hot|insulat(?:ed|ion))\s+(?:for\s+)?(\d+)\s*(?:hours|hrs)/i);
  if (heatClaimMatch) {
    const hoursClaimed = heatClaimMatch[1];
    const hasHoursInData = pTextLower.includes(`${hoursClaimed} hour`) || pTextLower.includes(`${hoursClaimed} hr`) || pTextLower.includes(`${hoursClaimed}hour`);
    if (!hasHoursInData) {
      console.warn(`[SafetyNet] Ungrounded heat retention claim "${heatClaimMatch[0]}" detected. Replacing with fallback.`);
      return {
        valid: false,
        text: getHonestFallback("not_in_data"),
        reason: `ungrounded_heat_claim: ${heatClaimMatch[0]}`,
      };
    }
  }

  // (b) Dishwasher / microwave claims
  if (/\b(?:dishwasher\s*(?:safe|friendly)?|safe\s+(?:in|for)\s+(?:the\s+)?dishwasher)\b/i.test(replyText)) {
    if (!pTextLower.includes("dishwasher")) {
      console.warn(`[SafetyNet] Ungrounded dishwasher claim detected in "${replyText}". Replacing with fallback.`);
      return {
        valid: false,
        text: getHonestFallback("not_in_data"),
        reason: "ungrounded_dishwasher_claim",
      };
    }
  }
  if (/\b(?:microwave\s*(?:safe|friendly)?|safe\s+(?:in|for)\s+(?:the\s+)?microwave)\b/i.test(replyText)) {
    if (!pTextLower.includes("microwave")) {
      console.warn(`[SafetyNet] Ungrounded microwave claim detected in "${replyText}". Replacing with fallback.`);
      return {
        valid: false,
        text: getHonestFallback("not_in_data"),
        reason: "ungrounded_microwave_claim",
      };
    }
  }

  // (c) Delivery timeline promises (kiosk does not promise specific delivery dates)
  const deliveryClaimMatch = replyText.match(/\b(?:deliver(?:y|ed)?\s+(?:tomorrow|today|in\s+\d+\s+days?|same\s*day)|by\s+tomorrow)\b/i);
  if (deliveryClaimMatch) {
    console.warn(`[SafetyNet] Ungrounded delivery claim "${deliveryClaimMatch[0]}" detected. Replacing with fallback.`);
    return {
      valid: false,
      text: getHonestFallback("not_in_data"),
      reason: `ungrounded_delivery_claim: ${deliveryClaimMatch[0]}`,
    };
  }

  // (d) Warranty claims
  const warrantyClaimMatch = replyText.match(/\b(?:\d+|one|two|three)\s*(?:year|yr|month)s?\s*(?:warranty|guarantee)\b/i) ||
                             replyText.match(/\blifetime\s*(?:warranty|guarantee)\b/i);
  if (warrantyClaimMatch && !pTextLower.includes("warranty") && !pTextLower.includes("guarantee")) {
    console.warn(`[SafetyNet] Ungrounded warranty claim "${warrantyClaimMatch[0]}" detected. Replacing with fallback.`);
    return {
      valid: false,
      text: getHonestFallback("not_in_data"),
      reason: `ungrounded_warranty_claim: ${warrantyClaimMatch[0]}`,
    };
  }

  // 3. Numerical Verification against active context
  // Match numbers (including with commas like 1,079 or 6,999)
  const replyNumbers = replyText.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g);
  if (!replyNumbers) {
    return { valid: true, text: replyText };
  }

  for (const rawNum of replyNumbers) {
    const cleanNum = rawNum.replace(/,/g, "");
    const parsed = Math.round(Number(cleanNum));

    // If context products exist and this number is not permitted by context or universal rules:
    if (!allowedNumbers.has(parsed)) {
      console.warn(`[SafetyNet] Hallucinated/unverified number "${rawNum}" (${parsed}) detected in reply: "${replyText}". Context products: ${prods.map(p => p?.name || p?.id).join(", ")}. Replacing with fallback.`);
      return {
        valid: false,
        text: getHonestFallback("not_in_data"),
        reason: `unverified_number: ${rawNum}`,
        hallucinatedNumber: rawNum,
      };
    }
  }

  return { valid: true, text: replyText };
}
