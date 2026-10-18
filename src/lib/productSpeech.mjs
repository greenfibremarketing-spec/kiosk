/**
 * Product speech generator for Greeny avatar on the product details screen.
 * Generates natural, short, friendly chunks (~10-12s, max 3 chunks) from real product data.
 */
import { getAllStaticLines } from "./staticSpeechLines.mjs";


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
  t = t.replace(/(?<!\d)([\d,]+)\s*rupees\b/gi, (m, p1) => {
    const num = Math.round(Number(String(p1).replace(/,/g, "")) || 0);
    return num > 0 ? `${num.toLocaleString("en-IN")} rupees` : m;
  });
  // Plain price numbers like 1199 or 1499 that match catalog item prices without 'rupees'
  // Lookahead MUST include rupees|rupee so it is strictly idempotent
  t = t.replace(/\b(799|899|999|1199|1299|1499|1599|1699|3199|6999|7999)\b(?!\s*(?:rupees|rupee|millilitres|ml|percent|%|cm|mm|inches|gm|g|kg))/gi, (m, p1) => {
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

  // Idempotency guarantee: collapse any consecutive repeated words case-insensitively ("rupees rupees" -> "rupees", etc.)
  t = t.replace(/\b([a-zA-Z]+)(?:\s+\1\b)+/gi, "$1");
  t = t.replace(/\s+/g, " ").trim();

  // Dev assertion for repeated words
  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    const repeated = t.match(/\b([a-zA-Z]{3,})\s+\1\b/i);
    if (repeated) {
      console.warn(`[SpeechNorm] Dev assertion warning: repeated word "${repeated[1]}" found in "${t}"`);
    }
  }

  return t;
}

/**
 * Splits a single long sentence (> 110 chars) into natural speech clauses.
 * Priority order:
 *  1. Comma (not inside formatted numbers)
 *  2. Before conjunctions (" but ", " or ", " and ")
 *  3. Word space as last resort
 * Length max ~110 chars, min ~25 chars.
 */
function splitLongSegment(text, maxLen = 110, minLen = 25) {
  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxLen) {
    const slice = remaining.slice(0, maxLen);
    let splitIdx = -1;

    // 1. Comma (not in numbers) between minLen and maxLen
    for (let i = slice.length - 1; i >= minLen; i--) {
      if (slice[i] === ',') {
        const isNumComma = i > 0 && /\d/.test(slice[i - 1]) && i + 1 < slice.length && /\d/.test(slice[i + 1]);
        if (!isNumComma) {
          splitIdx = i + 1; // split right after comma
          break;
        }
      }
    }

    // 2. Before conjunctions (" but ", " or ", " and ")
    if (splitIdx === -1) {
      const conjRegex = /\s+(?=(?:but|or|and)\b)/gi;
      let match;
      let bestConjIdx = -1;
      while ((match = conjRegex.exec(slice)) !== null) {
        if (match.index >= minLen && match.index <= maxLen) {
          bestConjIdx = match.index;
        }
      }
      if (bestConjIdx !== -1) {
        splitIdx = bestConjIdx;
      }
    }

    // 3. Word boundary (space) as last resort
    if (splitIdx === -1) {
      const spaceIdx = slice.lastIndexOf(" ");
      if (spaceIdx >= minLen) {
        splitIdx = spaceIdx;
      }
    }

    // Fallback if no clean delimiter found
    if (splitIdx === -1) {
      splitIdx = maxLen;
    }

    const part = remaining.slice(0, splitIdx).trim();
    if (part) chunks.push(part);
    remaining = remaining.slice(splitIdx).trim();
  }

  if (remaining) {
    if (chunks.length > 0 && remaining.length < minLen && (chunks[chunks.length - 1].length + remaining.length + 1 <= maxLen + 10)) {
      chunks[chunks.length - 1] += " " + remaining;
    } else {
      chunks.push(remaining);
    }
  }

  return chunks;
}

/**
 * Single chunker used by live speech and pre-warm.
 * Split order priority:
 *  1. Sentence end (. ! ?)
 *  2. Comma (not in numbers)
 *  3. Before "but" / "or" / "and"
 *  4. Space as last resort
 * Length max ~110 chars, min ~25 chars.
 */
export function chunkText(text) {
  if (!text || typeof text !== "string") return [];
  const normalized = normalizeForSpeech(text);
  if (!normalized) return [];

  // Split on sentence boundaries (. ? !)
  const rawSentences = normalized
    .split(/(?<=[.?!])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = "";

  for (const s of rawSentences) {
    if (s.length > 110) {
      if (buffer) {
        chunks.push(buffer);
        buffer = "";
      }
      const subChunks = splitLongSegment(s, 110, 25);
      chunks.push(...subChunks);
    } else {
      if (!buffer) {
        buffer = s;
      } else if (buffer.length + s.length + 1 <= 110) {
        buffer += " " + s;
      } else {
        chunks.push(buffer);
        buffer = s;
      }
    }
  }
  if (buffer) {
    if (chunks.length > 0 && buffer.length < 25 && chunks[chunks.length - 1].length + buffer.length + 1 <= 115) {
      chunks[chunks.length - 1] += " " + buffer;
    } else {
      chunks.push(buffer);
    }
  }

  return chunks.filter(Boolean);
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

  // All shared static lines (single source of truth)
  for (const l of getAllStaticLines()) {
    const norm = normalizeForSpeech(l);
    if (norm) lines.add(norm);
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
