/**
 * Product speech generator for Greeny avatar on the product details screen.
 * Generates natural, short, friendly chunks (~10-12s, max 3 chunks) from real product data.
 */

// Helper to format currency
export function formatRupees(num) {
  const n = Math.round(Number(num) || 0);
  return n > 0 ? `${n.toLocaleString("en-IN")} rupees` : "";
}

// Clean product name for natural speech
export function cleanProductName(name) {
  if (!name || typeof name !== "string") return "this product";
  let clean = name.replace(/\s*[–—\-]\s*(?:set\s+of\s+\d+|pair\s+of\s+\d+)/gi, (m) => ", " + m.replace(/\s*[–—\-]\s*/, "").toLowerCase());
  // Strip size/capacity suffix like - 400 ml, - 900 ml
  clean = clean.replace(/\s*[–—\-]\s*\d+\s*(?:ml|inch|l|litres?|grams?|g)\b/gi, "");
  clean = clean.replace(/\s+[–—\-]\s+/g, ", ");
  clean = clean.replace(/\s+/g, " ").trim();
  return clean;
}

/**
 * Extracts distinct real color names from product variants.
 * Filters out placeholder names like 'Multiple colours', 'Mixed / Product Assortment', 'Natural'.
 */
export function extractProductColours(product) {
  const variants = product?.variants || [];
  const colours = [];
  const placeholderRegex = /^(?:multiple\s*colou?rs?|mixed\s*\/?\s*product\s*assortment|product\s*assortment|mixed|assortment|natural|default|none)$/i;

  for (const v of variants) {
    const raw = (v?.colour || v?.color || v?.name || "").trim();
    if (raw && !placeholderRegex.test(raw) && !colours.includes(raw)) {
      colours.push(raw);
    }
  }
  return colours;
}

/**
 * Extracts one key feature safely from description.
 */
export function extractKeyFeature(product) {
  const desc = (product?.description || "").toLowerCase();
  if (desc.includes("stainless steel")) {
    return "made with a stainless steel inner and natural rice husk";
  }
  if (desc.includes("bamboo")) {
    return "crafted from eco-friendly bamboo and crop fibres";
  }
  return "made from natural rice husk";
}

/**
 * Single normalizer for speech used by TTS server, client, and pre-warm.
 * Converts symbols to natural spoken words, collapses whitespace, ensures ₹ is never sent to TTS.
 */
export function normalizeForSpeech(text) {
  if (!text || typeof text !== "string") return "";
  let t = String(text);

  t = t.replace(/₹\s*([\d,]+(?:\.\d+)?)(?:\s*rupees)?(?!\w)/gi, (m, p1) => {
    const num = Math.round(Number(String(p1).replace(/,/g, "")) || 0);
    return num > 0 ? `${num.toLocaleString("en-IN")} rupees ` : "";
  });
  t = t.replace(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d+)?)(?:\s*rupees)?(?!\w)/gi, (m, p1) => {
    const num = Math.round(Number(String(p1).replace(/,/g, "")) || 0);
    return num > 0 ? `${num.toLocaleString("en-IN")} rupees ` : "";
  });
  t = t.replace(/\b(\d{3,5})\s*rupees\b/gi, (m, p1) => {
    const num = Math.round(Number(p1) || 0);
    return num > 0 ? `${num.toLocaleString("en-IN")} rupees` : m;
  });
  // Plain price numbers like 1199 or 1499 that match catalog item prices without 'rupees'
  t = t.replace(/\b(799|899|999|1199|1299|1499|1599|1699|3199|6999|7999)\b(?!\s*(?:millilitres|ml|percent|%|cm|mm|inches|gm|g|kg))/gi, (m, p1) => {
    const num = Math.round(Number(p1) || 0);
    return `${num.toLocaleString("en-IN")} rupees`;
  });

  t = t.replace(/(\d+)\s*%/g, "$1 percent");
  t = t.replace(/\s*&\s*/g, " and ");
  t = t.replace(/\s+[–—\-]\s+/g, ", ");
  t = t.replace(/(\d+)\s*ml\b/gi, "$1 millilitres");
  t = t.replace(/[*#_`~|>{}\[\]]/g, " ");
  t = t.replace(/\.{2,}/g, ".");
  t = t.replace(/,{2,}/g, ",");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * Single chunker used by live speech and pre-warm.
 * Rules:
 *  - Split only at sentence ends (. ! ?)
 *  - Never at commas
 *  - Never inside numbers (1,199 stays together)
 *  - Max chunk ~80 chars, min chunk ~25 chars
 */
export function chunkText(text) {
  if (!text || typeof text !== "string") return [];
  const normalized = normalizeForSpeech(text);
  if (!normalized) return [];

  // Split ONLY on sentence boundaries (. ? !) - never at commas
  const rawSentences = normalized
    .split(/(?<=[.?!])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = "";

  for (const s of rawSentences) {
    if (!buffer) {
      buffer = s;
    } else if (buffer.length + s.length + 1 <= 80) {
      buffer += " " + s;
    } else {
      chunks.push(buffer);
      buffer = s;
    }
  }
  if (buffer) {
    if (chunks.length > 0 && buffer.length < 25 && chunks[chunks.length - 1].length + buffer.length + 1 <= 85) {
      chunks[chunks.length - 1] += " " + buffer;
    } else {
      chunks.push(buffer);
    }
  }

  // Handle sentences that exceed 80 characters: split ONLY at word spaces, NEVER at commas
  const finalChunks = [];
  for (const c of chunks) {
    if (c.length <= 80) {
      finalChunks.push(c);
      continue;
    }

    let remaining = c;
    while (remaining.length > 80) {
      const spaceIdx = remaining.slice(0, 80).lastIndexOf(" ");
      const splitIdx = spaceIdx >= 20 ? spaceIdx : 80;

      const part = remaining.slice(0, splitIdx).trim();
      if (part) finalChunks.push(part);
      remaining = remaining.slice(splitIdx).trim();
    }
    if (remaining) {
      if (finalChunks.length > 0 && remaining.length < 25 && finalChunks[finalChunks.length - 1].length + remaining.length + 1 <= 85) {
        finalChunks[finalChunks.length - 1] += " " + remaining;
      } else {
        finalChunks.push(remaining);
      }
    }
  }

  return finalChunks.filter(Boolean);
}

/**
 * Builds friendly, chunked speech lines for a product on details screen.
 * Maximum 3 chunks, ~10-12 seconds total.
 *
 * @param {Object} product
 * @param {Object} [options]
 * @param {number} [options.variantIndex] - Rotation index (0 to 2)
 * @param {boolean} [options.hasPairUp] - If true, skip optional CTA chunk
 * @returns {{ chunks: string[], fullText: string }}
 */
export function buildProductSpeech(product, options = {}) {
  if (!product) {
    const fallback = "Here are our sustainable products. Tap any item to explore.";
    return {
      chunks: [fallback],
      fullText: fallback,
    };
  }

  const cleanName = cleanProductName(product.name);
  const variantIdx = typeof options.variantIndex === "number"
    ? Math.abs(options.variantIndex) % 3
    : (cleanName.length) % 3;

  const chunks = [];
  const keyFeature = extractKeyFeature(product);

  // 1. Intro + one key feature
  const introTemplates = [
    `This is the ${cleanName}, ${keyFeature}.`,
    `Here is the ${cleanName}, ${keyFeature}.`,
    `Meet the ${cleanName}, ${keyFeature}.`,
  ];
  chunks.push(normalizeForSpeech(introTemplates[variantIdx]));

  // 2. Price in a plain sentence, plus colours only if real
  const rawPrice = product.salePrice ?? product.price ?? 0;
  const priceNum = Math.round(
    typeof rawPrice === "number"
      ? rawPrice
      : (Number(String(rawPrice).replace(/[^\d.]/g, "")) || 0)
  );
  const priceStr = priceNum > 0 ? formatRupees(priceNum) : "";
  const colours = extractProductColours(product);

  if (priceStr && colours.length >= 1) {
    const colourText = colours.length === 1
      ? colours[0]
      : (colours.length === 2 ? `${colours[0]} and ${colours[1]}` : `${colours.slice(0, 2).join(", ")} and ${colours[2]}`);
    chunks.push(normalizeForSpeech(`It's ${priceStr} and comes in ${colourText}.`));
  } else if (priceStr) {
    chunks.push(normalizeForSpeech(`It's ${priceStr}.`));
  } else if (colours.length >= 1) {
    const colourText = colours.length === 1
      ? colours[0]
      : (colours.length === 2 ? `${colours[0]} and ${colours[1]}` : `${colours.slice(0, 2).join(", ")} and ${colours[2]}`);
    chunks.push(normalizeForSpeech(`It comes in ${colourText}.`));
  }

  // 3. Optional short rotating next step
  if (!options.hasPairUp) {
    const closingTemplates = [
      "Tap Add to Cart whenever you're ready.",
      "Have a look around, I'm here if you need me.",
      "Take your time to explore, or tap Add to Cart.",
    ];
    chunks.push(closingTemplates[variantIdx]);
  }

  return {
    chunks,
    fullText: chunks.join(" "),
  };
}

/**
 * Pre-warm list generator:
 * Gathers all 3 rotating variants for all products, plus static greeting & interaction lines.
 */
export function getAllProductSpeechLines(catalog = []) {
  const lines = new Set();

  // Static greeting flow lines (Part C)
  const staticGreetingLines = [
    "Nice to meet you,",
    "Wonderful to meet you,",
    "Great to meet you,",
    "Hello, welcome to Green Fibre!",
    "You can pick a category here. We have a lovely variety of eco-friendly products.",
    "Take a look at our categories above. We have a lovely variety of eco-friendly products.",
    "Choose any category to start exploring. We have a lovely variety of eco-friendly products.",
    "If you have any questions, just ask me, I'm here to help.",
    "I'm Greeny, your shopping guide. If you have any questions, just ask me, I'm here to help.",
    // Static Small Talk & Out-of-Context variants (excluding customer name)
    "I'm doing great, thank you for asking! How can I help you today?",
    "I'm having a wonderful day, thank you! What can I help you find today?",
    "Doing very well, thank you! What would you like to explore today?",
    "You're most welcome! I'm right here if you need anything.",
    "Always happy to help! Let me know if you'd like to see more items.",
    "Anytime! Feel free to tap the screen or ask me about any product.",
    "I'm Greeny, your shopping guide. I can show you products, prices and colours, just ask me.",
    "I'm Greeny, your store assistant. You can ask me about our sustainable collection, prices, or tap the screen to explore.",
    "I'm Greeny! I help you find eco-friendly tableware, bottles and gifts. Tell me what you need, or tap any category.",
    "Thank you for visiting Green Fibre! Have a lovely day.",
    "Goodbye! Thank you for stopping by Green Fibre. Have a wonderful day ahead.",
    "Take care! Thank you for exploring Green Fibre. See you soon.",
    "I couldn't find that here, but you can browse our categories on the screen, or tap the item you like. You can try the touch navigation too.",
    "We don't have that in our collection today, but you can check our categories on the screen or tap any item to explore.",
    "That item isn't available with us, but you can explore our eco-friendly products on the screen or ask me about our bottles and tableware.",
    "I'm best at helping with our eco-friendly products. Please tell me what you're looking for, or tap on the screen to explore.",
    "I'm here to help you shop our sustainable collection. Tell me what you'd like to see, or browse the screen.",
    "I specialize in our Green Fibre products. Feel free to ask about our tableware, bottles, or tap the screen.",
    "Sorry, I couldn't catch that, it may be some noise around. Please say it again, or use the touch screen.",
    "I didn't quite get that through the background sound. Please try saying it again, or tap on the screen.",
    "Pardon me, I couldn't hear that clearly. Could you please repeat, or explore using the touch screen.",
  ];
  for (const l of staticGreetingLines) {
    lines.add(normalizeForSpeech(l));
  }

  if (Array.isArray(catalog)) {
    for (const product of catalog) {
      if (!product || !product.name) continue;
      for (let v = 0; v < 3; v++) {
        // Both with and without pair-up CTA
        const speech = buildProductSpeech(product, { variantIndex: v, hasPairUp: false });
        for (const chunk of speech.chunks) {
          const norm = normalizeForSpeech(chunk);
          if (norm && norm.length >= 3) {
            lines.add(norm);
          }
        }
      }
    }
  }

  return Array.from(lines);
}

/**
 * Answers follow-up questions from product data in 1 to 2 friendly sentences.
 */
export function answerProductQuestion(product, question = "") {
  if (!product) return "I'd be happy to help! Which product would you like to know about?";

  const cleanName = cleanProductName(product.name);
  const q = String(question || "").toLowerCase();
  const desc = (product.description || "").toLowerCase();
  const rawPrice = product.salePrice ?? product.price ?? 0;
  const priceNum = Math.round(
    typeof rawPrice === "number"
      ? rawPrice
      : (Number(String(rawPrice).replace(/[^\d.]/g, "")) || 0)
  );
  const priceStr = priceNum > 0 ? formatRupees(priceNum) : "";

  // 1. Colours
  if (q.includes("colour") || q.includes("color") || q.includes("shade") || q.includes("variant")) {
    const colours = extractProductColours(product);
    if (colours.length >= 2) {
      return `The ${cleanName} is available in ${colours.join(" and ")}. You can tap any color swatch on screen to switch!`;
    }
    if (colours.length === 1) {
      return `The ${cleanName} comes in our signature ${colours[0]} finish.`;
    }
    return `The ${cleanName} comes in its natural single finish as shown on the screen.`;
  }

  // 2. Material
  if (q.includes("material") || q.includes("made of") || q.includes("plastic") || q.includes("eco") || q.includes("safe")) {
    if (desc.includes("stainless steel")) {
      return `The ${cleanName} is made from upcycled rice husk with a food-safe stainless steel interior. It is 100 percent BPA-free and non-toxic.`;
    }
    if (desc.includes("bamboo")) {
      return `The ${cleanName} is crafted from natural bamboo fibres and crop biocomposite. It is durable, non-toxic, and climate positive.`;
    }
    return `The ${cleanName} is crafted from sustainable rice husk biocomposite and zero virgin plastic. It is food-safe, non-toxic, and BPA-free.`;
  }

  // 3. Kids / School
  if (q.includes("kid") || q.includes("child") || q.includes("school") || q.includes("office")) {
    if (desc.includes("school") || desc.includes("kids")) {
      return `Yes, the ${cleanName} is lightweight, durable, and perfect for school kids as well as office and daily travel.`;
    }
    return `Yes! It is durable, break-resistant, and 100 percent food-safe, making it great for children and the whole family.`;
  }

  // 4. Care instructions / microwave / dishwasher
  if (q.includes("wash") || q.includes("clean") || q.includes("microwave") || q.includes("dishwasher")) {
    if (desc.includes("microwave") || desc.includes("dishwasher")) {
      return `Yes, the ${cleanName} is microwave-reheat safe and completely dishwasher friendly.`;
    }
    return "You can easily clean it by hand washing with mild dish soap and warm water.";
  }

  // 5. Price
  if (q.includes("price") || q.includes("cost") || q.includes("how much") || q.includes("rate")) {
    return priceStr ? `The ${cleanName} is ${priceStr}.` : `The price for ${cleanName} is shown on the screen.`;
  }

  return priceStr
    ? `The ${cleanName} is made from sustainable rice husk for ${priceStr}. Let me know if you would like to add it to your cart!`
    : `The ${cleanName} is made from sustainable rice husk. Let me know if you would like to add it to your cart!`;
}

/**
 * Generates greeting flow speech lines for Part C.
 * Handles both name-given (prefix + name chunk, then category, then help)
 * and name-skipped (welcome, then category, then help) flows.
 *
 * @param {Object} params
 * @param {string} [params.name] - Customer name (if provided)
 * @param {boolean} [params.isSkipped] - Whether name was skipped
 * @param {number} [params.variantIndex=0] - 0, 1, or 2 for rotating variants
 * @returns {{
 *   introChunks: string[],
 *   categoryChunk: string,
 *   helpChunk: string,
 *   allChunks: string[]
 * }}
 */
export function getGreetingFlowLines({ name = "", isSkipped = false, variantIndex = 0 } = {}) {
  const v = Math.abs(variantIndex || 0) % 3;

  const categoryPrompts = [
    "You can pick a category here. We have a lovely variety of eco-friendly products.",
    "Take a look at our categories above. We have a lovely variety of eco-friendly products.",
    "Choose any category to start exploring. We have a lovely variety of eco-friendly products.",
  ];

  const categoryChunk = normalizeForSpeech(categoryPrompts[v]);

  if (isSkipped || !name || !name.trim()) {
    const welcomeChunk = normalizeForSpeech("Hello, welcome to Green Fibre!");
    const helpChunk = normalizeForSpeech("I'm Greeny, your shopping guide. If you have any questions, just ask me, I'm here to help.");
    return {
      introChunks: [welcomeChunk],
      categoryChunk,
      helpChunk,
      allChunks: [welcomeChunk, categoryChunk, helpChunk],
    };
  }

  const cleanName = name.trim();
  const greetingPrefixes = [
    "Nice to meet you,",
    "Wonderful to meet you,",
    "Great to meet you,",
  ];

  const prefixChunk = normalizeForSpeech(greetingPrefixes[v]);
  const nameChunk = `${cleanName}!`;
  const helpChunk = normalizeForSpeech("If you have any questions, just ask me, I'm here to help.");

  return {
    introChunks: [prefixChunk, nameChunk],
    categoryChunk,
    helpChunk,
    allChunks: [prefixChunk, nameChunk, categoryChunk, helpChunk],
  };
}
