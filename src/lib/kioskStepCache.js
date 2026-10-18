// kioskStepCache.js — Step Persistence & Deduplication Cache for Greenie AI Kiosk
// Guarantees each stage (Greeting -> Ask Name -> Products -> Product Card Pitch -> Q&A)
// executes exactly once and is never repeated on re-render, component remount, or reconnect.

export const KIOSK_STEPS = {
  INIT: 0,             // Fresh session, connecting WebSocket
  GREETED: 1,          // Greeting finished & SPEECH_DONE acknowledged
  NAME_SET: 2,         // Customer entered name or tapped skip
  BROWSING: 3,         // On pre-built products / categories page
  PRODUCT_SELECTED: 4, // Product card tapped, active pitch & Q&A
};

const CACHE_KEYS = {
  SESSION_ID: "greenie_kiosk_session_id",
  CURRENT_STEP: "greenie_kiosk_current_step",
  CUSTOMER_NAME: "greenie_kiosk_customer_name",
  SELECTED_PRODUCT: "greenie_kiosk_selected_product",
  ACKED_SPEECH_IDS: "greenie_kiosk_acked_speech_ids",
};

// In-memory fallback if sessionStorage is unavailable (e.g. SSR or incognito restrictions)
const memoryStore = new Map();

function storageGet(key) {
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (_) {}
  }
  return memoryStore.get(key) || null;
}

function storageSet(key, value) {
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(key, value);
      return;
    } catch (_) {}
  }
  memoryStore.set(key, value);
}

function storageRemove(key) {
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(key);
    } catch (_) {}
  }
  memoryStore.delete(key);
}

export const KioskStepCache = {
  // ── Session ID ───────────────────────────────────────────
  getOrCreateSessionId() {
    let id = storageGet(CACHE_KEYS.SESSION_ID);
    if (!id) {
      id = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      storageSet(CACHE_KEYS.SESSION_ID, id);
    }
    return id;
  },

  setSessionId(id) {
    if (id) storageSet(CACHE_KEYS.SESSION_ID, id);
  },

  // ── Step Tracking ────────────────────────────────────────
  getCurrentStep() {
    const raw = storageGet(CACHE_KEYS.CURRENT_STEP);
    if (raw === null || raw === undefined) return KIOSK_STEPS.INIT;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? KIOSK_STEPS.INIT : parsed;
  },

  setCurrentStep(step) {
    const current = this.getCurrentStep();
    // Steps strictly move forward during a session (unless explicitly reset)
    if (step >= current) {
      storageSet(CACHE_KEYS.CURRENT_STEP, String(step));
    }
  },

  hasPassedStep(step) {
    return this.getCurrentStep() >= step;
  },

  // ── Customer Name ────────────────────────────────────────
  getCustomerName() {
    const raw = storageGet(CACHE_KEYS.CUSTOMER_NAME) || "";
    if (!raw) return "";
    const words = raw.split(/\s+/).filter(Boolean);
    const dedup = [];
    for (let i = 0; i < words.length; i++) {
      if (i === 0 || words[i].toLowerCase() !== words[i - 1].toLowerCase()) {
        dedup.push(words[i]);
      }
    }
    const clean = dedup.join(" ");
    if (clean !== raw) {
      storageSet(CACHE_KEYS.CUSTOMER_NAME, clean);
    }
    return clean;
  },

  setCustomerName(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      storageSet(CACHE_KEYS.CUSTOMER_NAME, "");
      return;
    }
    const words = trimmed.split(/\s+/).filter(Boolean);
    const dedup = [];
    for (let i = 0; i < words.length; i++) {
      if (i === 0 || words[i].toLowerCase() !== words[i - 1].toLowerCase()) {
        dedup.push(words[i]);
      }
    }
    storageSet(CACHE_KEYS.CUSTOMER_NAME, dedup.join(" "));
    this.setCurrentStep(KIOSK_STEPS.NAME_SET);
  },

  // ── Selected Product ─────────────────────────────────────
  getSelectedProduct() {
    try {
      const raw = storageGet(CACHE_KEYS.SELECTED_PRODUCT);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  },

  setSelectedProduct(product) {
    if (!product) return;
    try {
      storageSet(CACHE_KEYS.SELECTED_PRODUCT, JSON.stringify(product));
      this.setCurrentStep(KIOSK_STEPS.PRODUCT_SELECTED);
    } catch (_) {}
  },

  // ── Speech Deduplication ─────────────────────────────────
  isSpeechAcked(speechId) {
    if (!speechId) return false;
    try {
      const raw = storageGet(CACHE_KEYS.ACKED_SPEECH_IDS);
      const ids = raw ? JSON.parse(raw) : [];
      return ids.includes(speechId);
    } catch (_) {
      return false;
    }
  },

  markSpeechDone(speechId) {
    if (!speechId) return;
    try {
      const raw = storageGet(CACHE_KEYS.ACKED_SPEECH_IDS);
      const ids = raw ? JSON.parse(raw) : [];
      if (!ids.includes(speechId)) {
        ids.push(speechId);
        // Retain last 30 speech IDs to keep storage lean
        const sliced = ids.slice(-30);
        storageSet(CACHE_KEYS.ACKED_SPEECH_IDS, JSON.stringify(sliced));
      }
    } catch (_) {}
    this.setCurrentStep(KIOSK_STEPS.GREETED);
  },

  // ── Session Reset ────────────────────────────────────────
  // Called ONLY when customer taps "Start Over", completes purchase, or 60s idle timeout triggers
  clearCache() {
    storageRemove(CACHE_KEYS.SESSION_ID);
    storageRemove(CACHE_KEYS.CURRENT_STEP);
    storageRemove(CACHE_KEYS.CUSTOMER_NAME);
    storageRemove(CACHE_KEYS.SELECTED_PRODUCT);
    storageRemove(CACHE_KEYS.ACKED_SPEECH_IDS);
    memoryStore.clear();
  },
};

export default KioskStepCache;
