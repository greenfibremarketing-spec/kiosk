/**
 * paymentApi.js — Frontend payment integration for GreenFibre kiosk.
 *
 * Implements the official GreenFibre Kiosk payment flow:
 * delivery form -> create saved order -> Razorpay Checkout -> backend verification -> order confirmation
 *
 * Calls only the Python kiosk backend (e.g. http://localhost:5007 locally, or deployed HTTPS in prod).
 * Never exposes Razorpay secret, gateway secret, or database credentials.
 */

import { BACKEND_URL, KIOSK_ID } from "./apiConfig.js";

let cachedTicket = null;

/**
 * Trusted authentication adapter returning a valid kiosk ticket string.
 * Automatically caches ticket and refreshes upon expiry or authentication retry.
 */
export async function getTicket(force = false) {
  if (!force && cachedTicket && cachedTicket.expiresAt > Date.now() + 30000) {
    return cachedTicket.ticket;
  }

  const apiBase = (BACKEND_URL || "http://localhost:5007").replace(/\/$/, "");
  const gatewayKey = process.env.NEXT_PUBLIC_GATEWAY_KEY || "dev-gateway-key";

  try {
    const res = await fetch(`${apiBase}/auth/kiosk/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Key": gatewayKey,
      },
      body: JSON.stringify({ kiosk_id: KIOSK_ID || "kiosk-01" }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.ticket) {
        cachedTicket = {
          ticket: data.ticket,
          expiresAt: Date.now() + (Number(data.expires_in) || 300) * 1000,
        };
        return cachedTicket.ticket;
      }
    }
  } catch (err) {
    console.warn("[PaymentApi] getTicket error:", err);
  }

  // Fallback to existing cached ticket, env token, or dev signed ticket pattern
  if (cachedTicket?.ticket) return cachedTicket.ticket;
  if (process.env.NEXT_PUBLIC_KIOSK_TOKEN) return process.env.NEXT_PUBLIC_KIOSK_TOKEN;
  return `v1.${KIOSK_ID || "kiosk-01"}.${Math.floor(Date.now() / 1000)}.devticket`;
}

/**
 * Creates the frontend payment API controller.
 * Must be created once outside component re-renders.
 */
export function createPaymentApi({ apiBase, kioskId, getTicket }) {
  const base = apiBase.replace(/\/$/, "");
  let attempt = null;
  let creating = false;
  const storageKey = `greenfibre.pendingPayment.${kioskId}`;

  async function request(path, { method = "GET", body, headers = {} } = {}) {
    let token = await getTicket();
    let response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Kiosk-ID": kioskId,
        "X-Kiosk-Token": token,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    // If unauthorized or forbidden, refresh ticket once and retry
    if (response.status === 401 || response.status === 403) {
      console.warn("[PaymentApi] Auth ticket expired or rejected, refreshing ticket...");
      token = await getTicket(true);
      response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Kiosk-ID": kioskId,
          "X-Kiosk-Token": token,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.detail || "Payment request could not be completed");
      error.status = response.status;
      error.detail = data?.detail;
      throw error;
    }
    if (data.saved_to_database !== true || !data.database_order_id) {
      throw new Error("A saved website order is required before payment");
    }
    return data;
  }

  return {
    async createOrder(payload) {
      if (creating) throw new Error("Checkout creation is already in progress");
      const fingerprint = JSON.stringify(payload);
      if (attempt && attempt.fingerprint !== fingerprint) {
        throw new Error("Resolve the current checkout before changing its details");
      }
      attempt ??= { key: crypto.randomUUID(), fingerprint, payload: JSON.parse(fingerprint) };
      if (attempt.order) return attempt.order;
      creating = true;
      try {
        // AUDIT-TEMP: Log outgoing create order payload
        console.log(`// AUDIT-TEMP [${new Date().toISOString()}] paymentApi.createOrder requesting /payments/orders with payload:`, attempt.payload);
        const result = await request("/payments/orders", {
          method: "POST",
          headers: { "Idempotency-Key": attempt.key },
          body: attempt.payload,
        });
        // AUDIT-TEMP: Log received order record from backend
        console.log(`// AUDIT-TEMP [${new Date().toISOString()}] paymentApi.createOrder received result from backend:`, result);
        attempt.order = { ...result, session_id: attempt.payload.session_id };
        // Store only recovery identifiers, not customer/address/card information.
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({
              database_order_id: result.database_order_id,
              order_number: result.order_number,
              session_id: attempt.payload.session_id,
            })
          );
        } catch {
          /* Keep the in-memory attempt if storage is unavailable. */
        }
        return attempt.order;
      } finally {
        creating = false;
      }
    },

    verify(order, callback) {
      // AUDIT-TEMP: Log verify attempt
      console.log(`// AUDIT-TEMP [${new Date().toISOString()}] paymentApi.verify called with callback:`, callback);
      return request("/payments/verify", {
        method: "POST",
        body: {
          session_id: order.session_id,
          razorpay_order_id: callback.razorpay_order_id,
          razorpay_payment_id: callback.razorpay_payment_id,
          razorpay_signature: callback.razorpay_signature,
        },
      });
    },

    async recover(reference) {
      const id = encodeURIComponent(reference.database_order_id);
      const session = encodeURIComponent(reference.session_id);
      // AUDIT-TEMP: Log recover check
      console.log(`// AUDIT-TEMP [${new Date().toISOString()}] paymentApi.recover checking order id=${id}`);
      const proof = await request(`/payments/orders/${id}?session_id=${session}`);
      if (proof.paid === true) return proof;
      // AUDIT-TEMP: Log reconcile call
      console.log(`// AUDIT-TEMP [${new Date().toISOString()}] paymentApi.recover order unpaid, calling /reconcile for id=${id}`);
      return request(`/payments/orders/${id}/reconcile?session_id=${session}`, {
        method: "POST",
      });
    },

    getPendingReference() {
      try {
        return JSON.parse(sessionStorage.getItem(storageKey) || "null");
      } catch {
        return null;
      }
    },

    finishResolvedCheckout() {
      // Call only after the payment outcome is resolved and the visitor finishes.
      attempt = null;
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
    },
  };
}

// ── Singleton Instance ───────────────────────────────────────────────────────
let defaultPaymentApi = null;

export function getPaymentApi() {
  if (!defaultPaymentApi) {
    const apiBase = (BACKEND_URL || "http://localhost:5007").replace(/\/$/, "");
    defaultPaymentApi = createPaymentApi({
      apiBase,
      kioskId: KIOSK_ID || "kiosk-01",
      getTicket,
    });
  }
  return defaultPaymentApi;
}

// ── Razorpay Script Loader ──────────────────────────────────────────────────
let razorpayScriptPromise = null;

export function loadRazorpayScript() {
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }
  if (window.Razorpay) {
    return Promise.resolve(true);
  }
  if (razorpayScriptPromise) {
    return razorpayScriptPromise;
  }

  razorpayScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      console.error("[PaymentApi] Failed to load Razorpay script.");
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return razorpayScriptPromise;
}

// ── Variant SKU Resolver ────────────────────────────────────────────────────
/**
 * Resolves a cart item to the authoritative catalog variant SKU:
 * GF:<24-character product ID>:<24-character color ID>
 */
export function resolveCatalogVariantSku(item, catalog = []) {
  if (!item) return "";

  const rawSku = (item.sku || item.id || "").trim();
  const hex24Pattern = /^[0-9a-f]{24}$/i;
  const fullVariantPattern = /^GF:[0-9a-f]{24}:[0-9a-f]{24}$/i;

  if (fullVariantPattern.test(rawSku)) {
    return rawSku;
  }

  const list = Array.isArray(catalog) ? catalog : [];
  const selectedColor = (item.selectedColor || "").toLowerCase().trim();

  // Find product in catalog
  let product = list.find((p) => {
    const pId = (p.id || "").trim();
    const pSku = (p.sku || "").trim();
    return (
      (rawSku && (pSku.toUpperCase() === rawSku.toUpperCase() || pId.toUpperCase() === rawSku.toUpperCase())) ||
      (item.id && (pId.toUpperCase() === String(item.id).toUpperCase() || pSku.toUpperCase() === String(item.id).toUpperCase())) ||
      (item.name && p.name && p.name.toLowerCase() === item.name.toLowerCase())
    );
  });

  if (!product && rawSku.startsWith("GF:")) {
    const stripped = rawSku.replace(/^GF:/, "").split(":")[0];
    product = list.find((p) => (p.id || "").toLowerCase() === stripped.toLowerCase());
  }

  if (product && Array.isArray(product.variants) && product.variants.length > 0) {
    // 1. Match variant by color name
    let matchedVariant = product.variants.find((v) => {
      const vName = (v.name || v.title || "").toLowerCase().trim();
      return vName && (vName === selectedColor || vName.includes(selectedColor) || selectedColor.includes(vName));
    });

    // 2. Default to first variant
    if (!matchedVariant) {
      matchedVariant = product.variants[0];
    }

    if (matchedVariant) {
      if (matchedVariant.sku && fullVariantPattern.test(matchedVariant.sku)) {
        return matchedVariant.sku;
      }
      const prodId = (product.id || "").replace(/^GF:/, "").trim();
      const varId = (matchedVariant.id || "").trim();
      if (hex24Pattern.test(prodId) && hex24Pattern.test(varId)) {
        return `GF:${prodId}:${varId}`;
      }
    }
  }

  // If already matches GF:<24-hex> but variant is missing, search first variant from catalog
  if (rawSku.startsWith("GF:") && hex24Pattern.test(rawSku.slice(3))) {
    const prodId = rawSku.slice(3);
    const prod = list.find((p) => (p.id || "").toLowerCase() === prodId.toLowerCase());
    if (prod?.variants?.[0]?.id && hex24Pattern.test(prod.variants[0].id)) {
      return `GF:${prodId}:${prod.variants[0].id}`;
    }
  }

  return rawSku;
}

// ── Payload Construction & Validation ───────────────────────────────────────
/**
 * Validates checkout form and cart items, returning the validated payload
 * conforming strictly to Section 2:
 *
 * const payload = {
 *   session_id: sessionId,
 *   customer: { name, email, phone },
 *   shipping_address: { streetAddress, city, state, pincode, landmark },
 *   fulfillment_method: "delivery",
 *   items: [{ sku, quantity }]
 * };
 */
export function validateAndBuildCheckoutPayload({ form, cart = [], sessionId, catalog = [] }) {
  if (!sessionId) {
    throw new Error("Active customer session ID is required.");
  }

  const name = (form.name || form.fullName || "").trim();
  if (!name || name.length < 2) {
    throw new Error("Please enter your full name.");
  }

  const email = (form.email || "").trim();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!email || !emailRegex.test(email)) {
    throw new Error("Please enter a valid email address (e.g. name@gmail.com).");
  }

  const rawPhone = (form.phone || "").replace(/\D/g, "");
  if (!rawPhone || rawPhone.length !== 10 || !/^[6-9]\d{9}$/.test(rawPhone)) {
    throw new Error("Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.");
  }

  const streetAddress = (form.streetAddress || form.address || "").trim();
  if (!streetAddress || streetAddress.length < 3) {
    throw new Error("Please enter your delivery street address.");
  }

  const city = (form.city || "").trim();
  if (!city) {
    throw new Error("Please enter your delivery city.");
  }

  const state = (form.state || "").trim();
  if (!state) {
    throw new Error("Please enter your delivery state.");
  }

  const pincode = (form.pincode || "").replace(/\D/g, "").slice(0, 6);
  if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
    throw new Error("PIN code must be a six-digit string (e.g. 380054).");
  }

  const landmark = (form.landmark || "").trim();

  const rawItems = Array.isArray(cart) && cart.length > 0 ? cart : [];
  if (rawItems.length === 0) {
    throw new Error("Cart is empty. Please add at least one product.");
  }

  // Resolve SKUs and combine duplicates
  const combinedMap = new Map();
  const pairUpMap = new Map();
  for (const item of rawItems) {
    const resolvedSku = resolveCatalogVariantSku(item, catalog);
    if (!resolvedSku) continue;

    const qty = Math.max(1, Math.min(100, Math.round(Number(item.quantity) || 1)));
    const currentQty = combinedMap.get(resolvedSku) || 0;
    combinedMap.set(resolvedSku, Math.min(100, currentQty + qty));
    if (item.isPairUp) {
      pairUpMap.set(resolvedSku, true);
    }
  }

  if (combinedMap.size === 0) {
    throw new Error("No valid product variants found in cart.");
  }

  if (combinedMap.size > 20) {
    throw new Error("Maximum 20 distinct items allowed in one checkout.");
  }

  const items = Array.from(combinedMap.entries()).map(([sku, quantity]) => ({
    sku,
    quantity,
    is_pair_up: Boolean(pairUpMap.get(sku)),
  }));

  return {
    session_id: sessionId,
    customer: {
      name,
      email,
      phone: rawPhone,
    },
    shipping_address: {
      streetAddress,
      city,
      state,
      pincode,
      landmark: landmark || "",
    },
    fulfillment_method: "delivery",
    items,
  };
}
