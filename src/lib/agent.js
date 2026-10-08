// agent.js — Greenie AI brain connected via Real-time WebSocket (wss://kioskai.greenfibre.org/ws/chat)
import { CATEGORIES, PRODUCTS } from "@/data/products";
import { inr } from "@/lib/format";
import { kioskWS } from "@/lib/kioskWebSocket";

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

export const detectCategory = (t) => {
  if (!t) return null;
  const s = t.toLowerCase().trim();
  if (/\b(?:all|everything|show all|catalog|entire collection)\b/i.test(s)) return "all";
  if (/\b(?:desk|office|stationery|valet)\b/i.test(s)) return "office";
  if (/\b(?:gifts?|corporate gifts?|hampers?)\b/i.test(s)) return "gifts";
  if (/\b(?:kitchen|dining|dinnerware)\b/i.test(s)) return "kitchen";
  if (/\b(?:drinkware|bottles?|mugs?|tumblers?|cups?)\b/i.test(s)) return "drinkware";
  return null;
};

export function matchProductAction(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  // Conversational questions should never switch product showcase
  if (
    /^(?:how are you|who are you|what are you|what can you do|hello|hi|hey|good (?:morning|afternoon|evening)|thank you|thanks|how's it going|what's up)/i.test(
      t
    )
  ) {
    return null;
  }

  // Explicit product queries
  if (/\b(?:viora|viora bottle|eco bottle)\b/i.test(t)) {
    return { type: "SHOW_PRODUCT", productId: "viora-bottle", category: "drinkware" };
  }
  if (/\b(?:statement mug|ceramic-feel mug|coffee mug|mugs?)\b/i.test(t)) {
    return { type: "SHOW_PRODUCT", productId: "statement-mug", category: "drinkware" };
  }
  if (/\b(?:travel tumbler|origin tumbler|travel flask|tumbler)\b/i.test(t)) {
    return { type: "SHOW_PRODUCT", productId: "travel-tumbler", category: "drinkware" };
  }
  if (/\b(?:flora bowl|soup bowl|salad bowl|bowls?)\b/i.test(t)) {
    return { type: "SHOW_PRODUCT", productId: "flora-bowl", category: "kitchen" };
  }
  if (/\b(?:pantry canister|eco-harvest canister|canisters? jar|canister)\b/i.test(t)) {
    return { type: "SHOW_PRODUCT", productId: "canister", category: "kitchen" };
  }
  if (/\b(?:zen bento|bento box|lunch box|bento)\b/i.test(t)) {
    return { type: "SHOW_PRODUCT", productId: "bento-box", category: "kitchen" };
  }
  if (/\b(?:terra desk|desk valet|desk organizer|organizer tray)\b/i.test(t)) {
    return { type: "SHOW_PRODUCT", productId: "desk-organizer", category: "office" };
  }
  if (/\b(?:luxury hamper|executive hamper|gift hamper|corporate hamper|gift box)\b/i.test(t)) {
    return { type: "SHOW_PRODUCT", productId: "gift-box", category: "gifts" };
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
 * Async AI Brain: STRICTLY calls wss://kioskai.greenfibre.org/ws/chat via WebSocket
 * If no answer from backend, returns null (no fake data).
 * @param {{ text: string, name: string, sessionId?: string, onToken?: Function }} params
 */
export async function replyAsync({
  text = "",
  name = "",
  sessionId = "",
  onToken = null,
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

  // ── 1. Query via Real-time WebSocket ──
  try {
    const wsReply = await kioskWS.sendQuery(t, sessionId, onToken);
    if (wsReply && typeof wsReply === "string" && wsReply.trim().length > 0) {
      const action = matchProductAction(t);
      return {
        name: currentName,
        message: wsReply.trim(),
        sessionId,
        action,
      };
    }
  } catch (wsErr) {
    console.warn("WebSocket query notice (retrying via HTTPS):", wsErr.message);
  }

  // ── 2. Fallback to HTTPS API if WebSocket disconnects ──
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch("https://kioskai.greenfibre.org/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: t,
        session_id: sessionId || undefined,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res && res.ok) {
      const data = await res.json();
      if (data?.reply && typeof data.reply === "string" && data.reply.trim().length > 0) {
        const action = matchProductAction(t);
        return {
          name: currentName,
          message: data.reply.trim(),
          sessionId: data.session_id || sessionId,
          action,
        };
      }
    }
  } catch (httpErr) {
    console.error("HTTPS Fallback query error:", httpErr);
  }

  // Strictly no fake data fallback
  return null;
}

/**
 * Empty local fallback (no fake answers).
 */
export function reply() {
  return null;
}
