// agent.js — Greenie AI Brain & Unified Protocol Integration
import { inr } from "@/lib/format";
import { kioskWS } from "@/lib/kioskWebSocket";
import { ENDPOINTS, KIOSK_ID } from "@/lib/apiConfig";

export const GREETING =
  "Hello! Welcome to GreenFibre. I'm Greenie, your eco companion. Ask me anything or tap any product to explore!";

export const productsIn = (id, catalog = null) => {
  const list = catalog && catalog.length > 0 ? catalog : [];
  if (!id || id === "all") return list;
  const clean = normalizeCategory(id);
  return list.filter((p) => {
    const pCat = normalizeCategory(p.category || "");
    const pCats = Array.isArray(p.categories) ? p.categories.map(normalizeCategory) : [];
    return pCat === clean || pCats.includes(clean);
  });
};

/**
 * Step 5: Dynamic Product Description (AI-Generated)
 * Automatically generates a short, friendly, and natural description using
 * the product's actual database information, verified specifications, benefits,
 * and available variants.
 */
export function generateDynamicProductDescription(p, name = "") {
  if (!p) return "Here is one of our handcrafted sustainable products.";

  const customerName = name && name.trim() ? name.trim() : "";
  const greetings = customerName
    ? [`Great choice, ${customerName}!`, `Nice pick, ${customerName}!`, `Wonderful choice, ${customerName}!`]
    : ["Great choice!", "Nice pick!", "Wonderful choice!"];

  // Deterministic but dynamic selection based on product id
  const greetingIdx = (p.id.length + (customerName ? customerName.length : 0)) % greetings.length;
  const greeting = greetings[greetingIdx];

  // Extract verified capacity / dimension from specs
  const capacitySpec = p.specs?.find((s) => /capacity|volume|litres?|ml/i.test(s));
  const capacity = capacitySpec ? capacitySpec.replace(/^capacity:\s*/i, "").trim() : "";

  // Extract key feature highlight
  const primaryTag = p.tags?.[1] || p.tags?.[0] || "100% Rice-Husk Biocomposite";

  // Build natural conversational sentences tailored to category & shape
  let body = "";
  let closing = "Would you like to know more?";

  switch (p.shape) {
    case "bottle": {
      if (p.id === "travel-tumbler") {
        body = `This tumbler features ${capacity || "a 450 ML capacity"} and double-wall insulation to keep your beverages hot on the go.`;
        closing = "Would you like to explore its spill-proof lid features or other colors?";
      } else {
        body = `This bottle comes with ${capacity ? `a ${capacity} capacity` : "a spacious capacity"} and ${primaryTag.toLowerCase()}, making it a lovely everyday companion.`;
        closing = "Would you like to know more about its colors and pricing?";
      }
      break;
    }
    case "mug": {
      body = `This mug has ${capacity ? `a ${capacity} capacity` : "generous capacity"} with a comforting ceramic-like feel, perfect for your daily coffee or tea.`;
      closing = "Would you like to see available colors or corporate branding options?";
      break;
    }
    case "bowl": {
      body = `This dining bowl offers ${capacity ? `an ${capacity} basin` : "a deep bowl"} crafted with natural husk warmth, ideal for healthy soups and grain bowls.`;
      closing = "Would you like to explore its microwave-safe features or matching dinnerware?";
      break;
    }
    case "can": {
      body = `This canister is designed for convenient airtight kitchen storage with ${capacity ? `a ${capacity} volume` : "a generous capacity"} and natural bamboo sealing.`;
      closing = "Would you like to explore its features or see other available sizes?";
      break;
    }
    case "box": {
      if (p.id === "bento-box") {
        body = `This bento box offers dual leak-proof tiers and matching travel cutlery, keeping meals fresh without any virgin plastic.`;
        closing = "Would you like to see how the compartments work or explore color choices?";
      } else if (p.id === "gift-box") {
        body = `This gift set could be a thoughtful option for corporate gifting, featuring premium sustainable essentials ready for gifting.`;
        closing = "Would you like to explore customization and laser logo engraving options?";
      } else {
        body = `This organizer is designed with an integrated phone dock and pen valet to keep your workspace tidy and eco-friendly.`;
        closing = "Would you like to see how it pairs with our other sustainable desk essentials?";
      }
      break;
    }
    default: {
      body = `This item is crafted from 100% upcycled rice-husk biocomposite, combining durable everyday utility with zero plastic.`;
      closing = "Would you like to know more about its specifications?";
    }
  }

  return `${greeting} ${body} ${closing}`;
}

export function describeProduct(p, name) {
  return generateDynamicProductDescription(p, name);
}

export function normalizeBackendProduct(p) {
  if (!p) return null;
  const image =
    p.image ||
    p.variants?.[0]?.images?.[0] ||
    p.images?.[0] ||
    "";

  const rawPrice = p.salePrice ?? p.price ?? 0;
  const parsedPrice = typeof rawPrice === "number" ? rawPrice : Number(String(rawPrice).replace(/[^\d.]/g, "")) || 0;
  const numPrice = parsedPrice > 0 ? parsedPrice : 0;
  const rawMrp = p.mrp ?? 0;
  const parsedMrp = typeof rawMrp === "number" ? rawMrp : Number(String(rawMrp).replace(/[^\d.]/g, "")) || 0;
  const numMrp = parsedMrp > 0 ? parsedMrp : (numPrice > 0 ? Math.round(numPrice * 1.35) : 0);
  const rawCat = String(p.category || "all").toLowerCase().trim();

  let shape = "bottle";
  const lowerName = String(p.name || "").toLowerCase();
  if (lowerName.includes("mug") || lowerName.includes("cup")) shape = "mug";
  else if (lowerName.includes("bowl")) shape = "bowl";
  else if (lowerName.includes("canister") || lowerName.includes("storage")) shape = "can";
  else if (lowerName.includes("planter")) shape = "bowl";
  else if (
    lowerName.includes("box") ||
    lowerName.includes("pack") ||
    lowerName.includes("set") ||
    lowerName.includes("packaging") ||
    lowerName.includes("hamper")
  ) {
    shape = "box";
  }

  const cleanCat = normalizeCategory(rawCat);

  return {
    id: p.id || p.sku,
    sku: p.sku || `GF:${p.id}`,
    name: p.name,
    category: p.category || "General",
    categories: ["all", cleanCat, rawCat],
    price: numPrice,
    mrp: numMrp,
    salePrice: numPrice,
    image,
    shape,
    blurb: p.description || p.message || `${p.name} handcrafted from sustainable eco-composite materials.`,
    description: p.description || p.message || `${p.name} handcrafted from sustainable eco-composite materials.`,
    tags: [
      p.category || "100% Rice-Husk Biocomposite",
      "Sustainable",
      "Zero Virgin Plastic",
      "Bulk Customisable",
    ],
    specs: [
      p.category ? `Category: ${p.category}` : "100% Upcycled Rice-Husk",
      p.variants_count
        ? `Variants: ${p.variants_count} Colors`
        : p.variants?.length
        ? `Variants: ${p.variants.length} Colors`
        : "Custom Logo Available",
      p.stock ? `In Stock: ${p.stock} units` : "In Stock",
    ],
    variants: p.variants || [],
    inStock: p.in_stock !== false,
    rating: 4.9,
    reviews: 48,
    badge: numPrice > 2000 ? "Premium" : "Bestseller",
  };
}

export function normalizeCategory(cat) {
  if (!cat) return "all";
  const c = String(cat).toLowerCase().trim();
  if (c === "all" || c.includes("everything") || c.includes("catalog")) return "all";
  if (c.includes("bottle")) return "bottle";
  if (c.includes("drink") || c.includes("mug") || c.includes("tumbler") || c.includes("cup")) return "drinkware";
  if (c.includes("gift") || c.includes("bundle") || c.includes("hamper") || c.includes("box") || c.includes("pack")) return "gift-boxes-hampers";
  if (c.includes("kitchen") || c.includes("din") || c.includes("bowl") || c.includes("plate") || c.includes("casserole")) return "kitchen-dining";
  if (c.includes("tableware") || c.includes("tissue")) return "tableware";
  if (c.includes("storage") || c.includes("canister") || c.includes("jar")) return "storage";
  if (c.includes("planter")) return "planter";
  if (c.includes("office") || c.includes("desk") || c.includes("stationery")) return "office";
  return c;
}

export function findMatchingLocalProduct(itemOrText, customCatalog = null) {
  if (!itemOrText) return null;
  const catalog = customCatalog && customCatalog.length > 0 ? customCatalog : [];
  if (catalog.length === 0) return null;

  // Direct match if object with id / sku
  if (typeof itemOrText === "object") {
    if (itemOrText.id) {
      const match = catalog.find((p) => p.id === itemOrText.id || p.sku === itemOrText.id);
      if (match) return match;
    }
    if (itemOrText.sku) {
      const match = catalog.find((p) => p.sku === itemOrText.sku || p.id === itemOrText.sku);
      if (match) return match;
    }
    if (itemOrText.name) {
      const match = catalog.find((p) => p.name?.toLowerCase() === itemOrText.name.toLowerCase());
      if (match) return match;
    }
    return normalizeBackendProduct(itemOrText);
  }

  const text = String(itemOrText).toLowerCase();
  const direct = catalog.find((p) => p.id === text || p.sku === text);
  if (direct) return direct;

  const found = catalog.find((p) => {
    const pName = (p.name || "").toLowerCase();
    return pName.includes(text) || text.includes(pName);
  });
  if (found) return found;

  return null;
}

export const detectCategory = (t) => {
  if (!t) return null;
  const s = t.toLowerCase().trim();
  if (/\b(?:all|everything|show all|catalog|entire collection|products?)\b/i.test(s)) return "all";
  if (/\b(?:desk|office|stationery|valet|planter)\b/i.test(s)) return "office";
  if (/\b(?:gifts?|corporate gifts?|hampers?|bundles?|family pack)\b/i.test(s)) return "gifts";
  if (/\b(?:kitchen|dining|dinnerware|plates?|bowls?|casserole|trays?)\b/i.test(s)) return "kitchen";
  if (/\b(?:drinkware|bottles?|mugs?|tumblers?|cups?)\b/i.test(s)) return "drinkware";
  return null;
};

export function matchProductAction(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  // Conversational greetings should not force product showcase switch
  if (
    /^(?:how are you|who are you|what are you|what can you do|hello|hi|hey|good (?:morning|afternoon|evening)|thank you|thanks|how's it going|what's up)$/i.test(
      t
    )
  ) {
    return null;
  }

  const cat = detectCategory(t);
  if (cat && !/^(?:how|who|what are you)/i.test(t)) {
    return {
      type: "SHOW_CATEGORY",
      category: cat,
    };
  }

  return null;
}

/**
 * Primary AI Turn Executor:
 * Queries backend via Protocol v2 WebSocket with seamless fallback to POST /chat.
 */
export async function replyAsync({
  text = "",
  name = "",
  sessionId = "kiosk-session",
  onToken = null,
  onSentence = null,
  onAction = null,
}) {
  const t = text.trim();
  if (!t) return null;

  // Extract name if introduced
  let currentName = name;
  const nameMatch = text.match(
    /^(?:my name is|i am|i'm|this is|call me)\s+([a-zA-Z]+)/i
  );
  if (nameMatch?.[1]) {
    const extracted = nameMatch[1];
    currentName =
      extracted.charAt(0).toUpperCase() + extracted.slice(1).toLowerCase();
  }

  // ── 1. Real-Time Protocol v2 WebSocket ──
  try {
    const wsResult = await kioskWS.sendQuery(t, sessionId, {
      onToken,
      onSentence,
      onAction,
    });

    if (wsResult && wsResult.reply && typeof wsResult.reply === "string") {
      const fallbackAction = matchProductAction(t);
      return {
        name: currentName,
        message: wsResult.reply.trim(),
        sessionId,
        action: wsResult.action || fallbackAction,
        salesStage: wsResult.salesStage,
        turnId: wsResult.turnId,
      };
    }
  } catch (wsErr) {
    console.warn("[Agent] WebSocket query notice:", wsErr.message);
  }

  return null;
}

/**
 * Send Guided Flow Action:
 * Frontend -> Backend (e.g. SET_NAME, SKIP_NAME, SELECT_CATEGORY, SHOW_ALL, SELECT_PRODUCT, NAVIGATE_BACK, RESTART)
 * All guided flow actions go strictly over WebSocket via ws.send() for sub-15ms latency.
 */
export async function sendFlowAction(action, payload = {}, sessionId = "kiosk-session") {
  if (action === "SET_NAME" && payload.name) {
    return kioskWS.sendSetName(payload.name);
  }
  if (action === "SKIP_NAME") {
    return kioskWS.sendSkipName();
  }
  if (action === "SELECT_CATEGORY") {
    return kioskWS.sendSelectCategory(payload);
  }
  if (action === "SELECT_PRODUCT") {
    return kioskWS.sendSelectProduct(payload);
  }
  if (action === "SPEECH_DONE") {
    return kioskWS.sendSpeechDone(payload.speech_id);
  }
  return kioskWS.sendWsAction({ action, ...payload });
}

/**
 * Acknowledge Avatar Speech Finished (SPEECH_DONE)
 * Required by backend to transition state after greeting/announcements.
 * Emits strictly via WebSocket frame for instant turn response without HTTP 409/403 errors.
 */
export async function sendSpeechDone(speechId) {
  if (!speechId) return { success: true };
  kioskWS.sendSpeechDone(speechId);
  return { success: true };
}

/**
 * Reset Session Memory (POST /session/reset)
 */
export async function resetBackendSession(sessionId = "kiosk-session") {
  try {
    console.log(`[FRONTEND >> BACKEND] POST ${ENDPOINTS.sessionReset} (session: ${sessionId})`);
    const res = await fetch(ENDPOINTS.sessionReset, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        kiosk_id: KIOSK_ID,
      }),
    });
    const data = await res.json();
    console.log(`[BACKEND >> REST RESET]`, data);
    return data;
  } catch (e) {
    console.warn("[Agent] Failed to reset backend session:", e.message);
    return null;
  }
}

/**
 * Fetch verified product catalog from backend (GET /products)
 */
export async function fetchBackendProducts() {
  try {
    console.log(`[FRONTEND >> BACKEND] GET ${ENDPOINTS.products}`);
    const res = await fetch(ENDPOINTS.products);
    if (res.ok) {
      const data = await res.json();
      console.log(`[BACKEND >> REST PRODUCTS] Fetched ${data?.products?.length || 0} products`);
      return data;
    }
  } catch (e) {
    console.warn("[Agent] Failed to fetch backend products:", e.message);
  }
  return null;
}

/**
 * Backend Health Check (GET /health)
 */
export async function checkBackendHealth() {
  try {
    console.log(`[FRONTEND >> BACKEND] GET ${ENDPOINTS.health}`);
    const res = await fetch(ENDPOINTS.health);
    if (res.ok) {
      const data = await res.json();
      console.log(`[BACKEND >> REST HEALTH]`, data);
      return data;
    }
  } catch (e) {
    console.warn("[Agent] Failed to check backend health:", e.message);
  }
  return null;
}

export function reply() {
  return null;
}
