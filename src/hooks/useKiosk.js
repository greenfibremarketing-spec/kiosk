"use client";
/**
 * useKiosk.js  (v2 – Production-Hardened Real-Time Kiosk Engine)
 * ─────────────────────────────────────────────────────────────────────────────
 * States: IDLE → ATTENTIVE → LISTENING → THINKING → SPEAKING → LISTENING …
 *
 * Key guarantees:
 *   • Fused human evidence tracker: presence, attention, voice, input.
 *     No inactivity warning/countdown while any evidence exists.
 *     15s absent → 10s wall-clock countdown → reset to Step 1.
 *   • Monotonic onboarding: NAME (1) → CATEGORIES (2) → BROWSING (3).
 *     Synchronous optimistic categories opening; server ASK_NAME / SHOW_GREETING
 *     ignored once NAME_SET is passed.
 *   • Single source of truth for TTS: Deepgram Aura (aura-2-luna-en).
 *   • Latest ref pattern on all callbacks to avoid stale closures.
 *   • Deepgram primary STT with WebSpeech gated only on Deepgram failure (>3s).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trace } from "@/lib/debugTrace";
import { isVideoOnly } from "@/lib/kioskMode";

import {
  GREETING,
  describeProduct,
  productsIn,
  replyAsync,
  sendSpeechDone,
  sendFlowAction,
  resetBackendSession,
  normalizeCategory,
  findMatchingLocalProduct,
  matchProductAction,
  fetchBackendProducts,
  normalizeBackendProduct,
  INITIAL_BACKEND_CATALOG,
} from "@/lib/agent";
import { BACKEND_URL } from "@/lib/apiConfig";
import { kioskWS } from "@/lib/kioskWebSocket";
import KioskStepCache, { KIOSK_STEPS } from "@/lib/kioskStepCache";
import { usePresenceDetection } from "@/lib/presence/usePresenceDetection";
import { usePresence } from "@/hooks/usePresence";
import { useFaceGuard } from "@/hooks/useFaceGuard";
import {
  PRESENCE_CONFIG,
  ABSENT_SHORT_MS,
  ABSENT_LONG_MS,
  CONFIRMATION_TIMEOUT_MS,
  RESET_DEBOUNCE_MS,
  FACE_ID_ENABLED,
  FACE_ID_DEBUG,
  RETURN_MEMORY_MS,
} from "@/lib/presenceConfig";
import {
  enrollFace,
  clearFace,
  hasEnrolled,
  snapshotFace,
  restoreGallery,
  compareToGallery,
} from "@/lib/presence/faceIdentity";
import { useUserSignals } from "@/hooks/useUserSignals";
import { useMic } from "@/hooks/useMic";
import { useUserSpeechState } from "@/hooks/useUserSpeechState";
import { useSpeech } from "@/hooks/useSpeech";
import speechConfig from "@/lib/speechConfig";
import {
  returnFromDetail,
  PAIRUP_ASK_TIMEOUT_MS,
  PAIRUP_DISCOUNT_PERCENT,
  PAIRUP_MAX_PER_SESSION,
  getPairUpSpeech,
} from "@/lib/greetConfig";
import { prefetchAudio, prewarmVoiceCache } from "@/lib/avatar/GreenieAvatar";
import { speechController, warmupSpeech } from "@/lib/avatar/SpeechController";
import { buildProductSpeech, getGreetingFlowLines, cleanProductName } from "@/lib/productSpeech.mjs";
import { getPaymentApi } from "@/lib/paymentApi";
import { preloadCatalogThumbnails, preloadProductDetailPhotos } from "@/lib/imagePreloader";
import { getHonestFallback, verifyReplyGrounding } from "@/lib/safetyNet";

// Conversation states
const S = {
  IDLE: "IDLE",
  ATTENTIVE: "ATTENTIVE",
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  SPEAKING: "SPEAKING",
};

const STOP_NAME_WORDS = new Set([
  "only", "just", "show", "me", "the", "yes", "no", "okay", "ok",
  "bottle", "bottles", "mug", "mugs", "price", "cost", "plate", "plates",
  "bowl", "bowls", "casserole", "canister", "canisters", "gift", "gifts", "gifting",
  "hamper", "planter", "planters", "dining", "products", "product", "items",
  "item", "all", "everything", "something", "anything", "please", "help",
  "hi", "hello", "hey", "skip", "next", "pass", "what", "which", "where",
  "how", "who", "why", "is", "are", "can", "will", "tell", "explore", "buy",
  "cart", "checkout", "greenie", "greenfibre", "water", "cups", "set",
  "collection", "sustainable", "eco", "good", "more", "cheaper", "glass",
  "rice", "husk", "none", "nothing", "kitchen", "best", "cheap", "take", "bye",
  "later", "never", "mind", "browse"
]);

/**
 * Validates candidate customer names against greeting rules:
 * 1 to 2 words, letters only, 2 to 25 characters, rejects request/product words.
 * Collapses consecutive repeated words case-insensitively ("Puneet Puneet" -> "Puneet").
 */
export function validateCustomerName(str) {
  if (!str || typeof str !== "string") return { valid: false, reason: "empty" };
  const clean = str.replace(/[.,!?]/g, "").trim();
  if (clean.length < 2) return { valid: false, reason: "length" };
  const rawWords = clean.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) return { valid: false, reason: "empty" };

  // Collapse consecutive repeated words case-insensitively ("Puneet Puneet" -> "Puneet")
  const words = [];
  for (let i = 0; i < rawWords.length; i++) {
    if (i === 0 || rawWords[i].toLowerCase() !== rawWords[i - 1].toLowerCase()) {
      words.push(rawWords[i]);
    }
  }

  if (words.length > 2) return { valid: false, reason: "word_count" };
  const collapsedClean = words.join(" ");
  if (!/^[a-zA-Z]+(?:\s+[a-zA-Z]+)?$/.test(collapsedClean)) return { valid: false, reason: "letters_only" };
  if (collapsedClean.length < 2 || collapsedClean.length > 25) return { valid: false, reason: "length" };

  for (const w of words) {
    if (STOP_NAME_WORDS.has(w.toLowerCase())) return { valid: false, reason: "stop_word" };
  }
  const formatted = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return { valid: true, name: formatted };
}

function prewarmNameLines(name) {
  if (!name || typeof window === "undefined") return;
  const ttsUrl = process.env.NEXT_PUBLIC_TTS_URL || "http://localhost:4000/api/tts";
  const lines = [
    `Nice to meet you, ${name}!`,
    `${name}!`,
    `Before you go, ${name}!`,
    `No problem, ${name}!`,
    `Lovely, ${name}!`,
  ];
  setTimeout(() => {
    for (const text of lines) {
      try {
        fetch(`${ttsUrl}?text=${encodeURIComponent(text)}&model=aura-2-luna-en`, {
          method: "GET",
          priority: "low",
        }).catch(() => {});
      } catch (_) {}
    }
  }, 100);
}


// ── Natural category phrase mapper ─────────────────────────────────────────
function getCategoryNaturalLine(id, name) {
  const cl = ((name || id || "") + "").toLowerCase();
  if (cl.includes("bottle") || cl.includes("tumbler")) return "Here are our bottles.";
  if (cl.includes("gift") || cl.includes("hamper")) return "Here are our gifting picks.";
  if (cl.includes("drinkware") || cl.includes("mug") || cl.includes("cup")) return "Here are our drinkware picks.";
  if (cl.includes("kitchen") || cl.includes("dining") || cl.includes("casserole") || cl.includes("bowl")) return "Here are our kitchen and dining essentials.";
  if (cl.includes("planter")) return "Here are our planters.";
  if (cl.includes("tableware") || cl.includes("plate")) return "Here are our tableware pieces.";
  if (cl.includes("storage") || cl.includes("canister")) return "Here are our storage canisters.";
  if (cl.includes("office") || cl.includes("stationery") || cl.includes("desk")) return "Here are our desk essentials.";
  return "Here are all our products.";
}

export function useKiosk() {
  // ── Core product/UI state ──────────────────────────────────────────────────
  const [name, setName] = useState(() => KioskStepCache.getCustomerName());
  const [category, setCategory] = useState("all");
  const [productId, setProductId] = useState(null);
  const [caption, setCaption] = useState("");
  const [speechId, setSpeechId] = useState(1);
  const sessionIdRef = useRef(KioskStepCache.getOrCreateSessionId());
  const pendingSpeechAckRef = useRef(null);
  const speechAckTimerRef = useRef(null);
  const activeActionReplyIdRef = useRef(null);
  const [backendAction, setBackendAction] = useState(null);
  const [backendCatalog, setBackendCatalog] = useState(INITIAL_BACKEND_CATALOG || []);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(!(INITIAL_BACKEND_CATALOG?.length > 0));
  const [liveTurnProducts, setLiveTurnProducts] = useState([]);
  const liveTurnProductsRef = useRef(liveTurnProducts);
  liveTurnProductsRef.current = liveTurnProducts;
  const [filtersApplied, setFiltersApplied] = useState(null);
  const [highlightSku, setHighlightSku] = useState(null);
  const [sessionResetKey, setSessionResetKey] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const onboardingDoneRef = useRef(false);
  const [actionButtons, setActionButtons] = useState([]);
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [cartModalData, setCartModalData] = useState(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrModalData, setQrModalData] = useState(null);
  const [goodbyeOpen, setGoodbyeOpen] = useState(false);
  const [goodbyeData, setGoodbyeData] = useState(null);
  const [staffBanner, setStaffBanner] = useState(null);
  const [hintBubble, setHintBubble] = useState(null);
  const [recommendationOpen, setRecommendationOpen] = useState(false);
  const [recommendationData, setRecommendationData] = useState(null);

  // ── Cart & Pair-Up Suggestions State ───────────────────────────────────────
  const [cartItems, setCartItems] = useState([]);
  const cartItemsRef = useRef(cartItems);
  cartItemsRef.current = cartItems;

  const clearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  const [pairUpPromptOpen, setPairUpPromptOpen] = useState(false);
  const [pairUpModalOpen, setPairUpModalOpen] = useState(false);
  const [pairUpProducts, setPairUpProducts] = useState([]);
  const [pairUpQuestionText, setPairUpQuestionText] = useState("");
  const [pairUpCaption, setPairUpCaption] = useState(
    "Psst! Pick any one pair-up from here and unlock an extra 5% off your whole order!"
  );
  const [showCheckout, setShowCheckout] = useState(false);

  const pairUpTimerRef = useRef(null);
  const sessionPairUpAskCountRef = useRef(0);
  const consecutiveNoCountRef = useRef(0);
  const askedProductIdsRef = useRef(new Set());
  const pairupCacheRef = useRef(new Map());
  const pairUpVariantIdxRef = useRef({
    pairUpAsk: -1,
    pairUpYes: -1,
    pairUpNo: -1,
    pairUpAdded: -1,
    pairUpSkipped: -1,
  });
  const pairUpActiveProductIdRef = useRef(null);
  const addedPairUpInCurrentModalRef = useRef(false);

  // Integer paise money math (no float rounding errors)
  const cartTotals = useMemo(() => {
    let subtotalPaise = 0;
    let hasPairUp = false;

    for (const item of cartItems) {
      const qty = Number(item.quantity) || 1;
      const pricePaise = Math.round(Number(item.salePrice || item.price || 0) * 100);
      subtotalPaise += pricePaise * qty;
      if (item.isPairUp) {
        hasPairUp = true;
      }
    }

    const discountPaise = hasPairUp
      ? Math.round((subtotalPaise * PAIRUP_DISCOUNT_PERCENT) / 100)
      : 0;

    const totalPaise = subtotalPaise - discountPaise;

    const subtotal = Math.round(subtotalPaise / 100);
    const discount = Math.round(discountPaise / 100);
    const total = Math.round(totalPaise / 100);

    return {
      subtotalPaise,
      discountPaise,
      totalPaise,
      subtotal,
      discount,
      total,
      savings: discount,
      hasPairUpDiscount: hasPairUp && discount > 0,
      itemCount: cartItems.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0),
    };
  }, [cartItems]);

  // Helper to select 3-4 suggestions (balancing same category and different categories)
  const getPairUpSuggestions = useCallback(
    (targetProduct, currentCartItems = [], allProducts = []) => {
      const catalog = allProducts && allProducts.length > 0 ? allProducts : backendCatalog;
      if (!catalog || catalog.length === 0) return [];

      const cartIds = new Set(
        (currentCartItems || []).map((i) => String(i.id || i.sku || "").toLowerCase())
      );
      if (targetProduct) {
        cartIds.add(String(targetProduct.id || targetProduct.sku || "").toLowerCase());
      }

      const targetCategory = String(targetProduct?.category || "").toLowerCase();

      const sameCategory = [];
      const diffCategory = [];

      for (const p of catalog) {
        const pid = String(p.id || p.sku || "").toLowerCase();
        if (cartIds.has(pid)) continue;

        const pCat = String(p.category || "").toLowerCase();
        if (targetCategory && (pCat === targetCategory || pCat.includes(targetCategory))) {
          sameCategory.push(p);
        } else {
          diffCategory.push(p);
        }
      }

      const selected = [];
      if (sameCategory.length > 0) {
        selected.push(...sameCategory.slice(0, 2));
      }
      if (diffCategory.length > 0) {
        const needed = 4 - selected.length;
        selected.push(...diffCategory.slice(0, Math.max(2, needed)));
      }
      if (selected.length < 4) {
        for (const p of catalog) {
          const pid = String(p.id || p.sku || "").toLowerCase();
          if (!cartIds.has(pid) && !selected.some((s) => String(s.id || s.sku || "").toLowerCase() === pid)) {
            selected.push(p);
            if (selected.length >= 4) break;
          }
        }
      }

      return selected.slice(0, 4);
    },
    [backendCatalog]
  );

  // Guards & references
  const greetingDoneRef = useRef(false);
  const nameDoneRef = useRef(false);
  const introPlayedRef = useRef(false);
  const turnsWithSentencesRef = useRef(new Set());
  const nameSubmittedRef = useRef(false);
  const categoriesFallbackTimerRef = useRef(null);
  const aiTurnTimeoutRef = useRef(null);
  const timedOutTurnIdRef = useRef(null);
  const catalogRetryCountRef = useRef(0);
  const lastAppliedTurnIdRef = useRef(null);
  const lastAppliedSeqRef = useRef(0);
  const lastHandledActionRef = useRef({ key: null, t: 0 });
  const isSendingRef = useRef(false);
  const nameRef = useRef(name);
  nameRef.current = name;
  const backFromDetailTimerRef = useRef(null);
  const backNavSeqRef = useRef(0);
  const isBackFromDetailPendingRef = useRef(false);
  const productDetailOpenedRef = useRef(false);
  const backTurnIdRef = useRef(null);
  const lastProductSpokenRef = useRef(null);
  const selectProductRef = useRef(null);
  const categoryBeforeDetailRef = useRef("all");
  const justReturnedFromDetailRef = useRef(false);
  const justReturnedTimerRef = useRef(null);

  const markOnboardingDone = useCallback((reason) => {
    if (!onboardingDoneRef.current) {
      console.log(`[Kiosk] onboardingDone=true reason=${reason}`);
      onboardingDoneRef.current = true;
      setOnboardingDone(true);
    }
    clearTimeout(categoriesFallbackTimerRef.current);
  }, []);

  const openCategoryPicker = useCallback((source) => {
    console.log(`[Kiosk] categories open source=${source} onboardingDone=${onboardingDoneRef.current}`);
    if (onboardingDoneRef.current) {
      setOnboardingOpen(false);
      trace("showDetail=false", { caller: "openCategoryPicker" });
      setShowDetail(false);
      setCartModalOpen(false);
      setQrModalOpen(false);
      if (typeof window !== "undefined") {
        const el = document.querySelector(".category-tabs-container, .category-chips, .categories-section");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("category-tabs--highlight");
          setTimeout(() => el.classList.remove("category-tabs--highlight"), 2000);
        }
      }
    } else {
      setOnboardingStep(2);
      setOnboardingOpen(true);
    }
  }, []);

  const hintIdleTimerRef = useRef(null);
  const resetHintIdleTimer = useCallback(() => {
    if (hintIdleTimerRef.current) {
      clearTimeout(hintIdleTimerRef.current);
      hintIdleTimerRef.current = null;
    }
    if (kioskModeRef.current !== "ENGAGED" || latestRef.current.speaking) return;
    console.log(`[DebugTiming] hintIdleTimer armed at=${Math.round(typeof window !== "undefined" ? performance.now() : Date.now())}`);
    hintIdleTimerRef.current = setTimeout(() => {
      if (
        kioskModeRef.current === "ENGAGED" &&
        !latestRef.current.onboardingOpen &&
        !latestRef.current.showDetail &&
        !latestRef.current.cartModalOpen &&
        !latestRef.current.showCheckout &&
        !latestRef.current.speaking
      ) {
        console.log(`[DebugTiming] hintIdleTimer fired at=${Math.round(typeof window !== "undefined" ? performance.now() : Date.now())}`);
        setHintBubble("Say what you're looking for, or tap any category to explore!");
      }
    }, 18000);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(categoriesFallbackTimerRef.current);
      if (hintIdleTimerRef.current) {
        clearTimeout(hintIdleTimerRef.current);
        hintIdleTimerRef.current = null;
      }
    };
  }, []);

  // Preload catalog with retry backoff & pre-warm voice server cache
  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      setIsLoadingCatalog(true);
      for (let attempt = 0; attempt <= 5; attempt++) {
        try {
          const data = await fetchBackendProducts();
          if (!active) return;
          if (data?.products && Array.isArray(data.products) && data.products.length > 0) {
            const mapped = data.products.map(normalizeBackendProduct).filter(Boolean);
            if (mapped.length > 0) {
              setBackendCatalog(mapped);
              if (mapped[0]?.id) {
                setProductId((curr) => curr || mapped[0].id);
              }
              setIsLoadingCatalog(false);
              try {
                prewarmVoiceCache(mapped);
                preloadCatalogThumbnails(mapped);
              } catch (_) { }
              return;
            }
          }
        } catch (_) { }
        if (!active) return;
        await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(1.5, attempt), 5000)));
      }
      if (active) {
        setIsLoadingCatalog(false);
      }
    }
    loadCatalog();
    return () => { active = false; };
  }, []);

  // Pre-warm static voice cache and warm up speech engine on mount
  useEffect(() => {
    warmupSpeech();
    prewarmVoiceCache();
  }, []);

  // Wire speechController SPEECH_DONE callback
  useEffect(() => {
    speechController.onSpeechDone = (speechId) => {
      console.log(`[Kiosk] SPEECH_DONE emitted by speechController for speech_id: ${speechId}`);
      pendingSpeechAckRef.current = null;
      clearTimeout(speechAckTimerRef.current);
      kioskWS.sendSpeechDone(speechId);
    };
  }, []);

  // ── Conversation state machine ────────────────────────────────────────────
  const [convState, setConvState] = useState(S.IDLE);
  const convStateRef = useRef(S.IDLE);
  const setConv = useCallback((s) => {
    convStateRef.current = s;
    setConvState(s);
  }, []);

  // ── Transcript accumulation ────────────────────────────────────────────────
  const [liveTranscript, setLiveTranscript] = useState("");
  const [lastUserSpeech, setLastUserSpeech] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false); // avatar speaking
  const pendingTranscriptRef = useRef("");       // words heard in this turn
  const eotTimerRef = useRef(null);     // end-of-turn countdown
  const failureCountRef = useRef(0);
  const [showPTT, setShowPTT] = useState(false); // push-to-talk buttons

  // ── Fused Human Evidence Tracker ──────────────────────────────────────────
  const lastFaceAtRef = useRef(Date.now());
  const lastAttentionAtRef = useRef(Date.now());
  const lastVoiceAtRef = useRef(Date.now());
  const lastInputAtRef = useRef(Date.now());
  const warningDeadlineRef = useRef(null);
  const lastEvidenceLogRef = useRef(0);

  const [sessionTimeoutWarning, setSessionTimeoutWarning] = useState({
    active: false,
    secondsRemaining: 10,
  });
  const sessionTimeoutWarningRef = useRef(sessionTimeoutWarning);
  sessionTimeoutWarningRef.current = sessionTimeoutWarning;
  const [identityMasked, setIdentityMasked] = useState(false);
  const identityCutSpeechRef = useRef(false);
  const [faceEnrolled, setFaceEnrolled] = useState(false);

  // ── Abort controller for SSE/AI fetch ────────────────────────────────────
  const abortRef = useRef(null);

  // ── Latest Ref Pattern for zero stale closures across async handlers ───────
  const latestRef = useRef({});

  // ── Short Gap Identity Verification State ──
  const [identityPrompt, setIdentityPrompt] = useState({
    active: false,
    name: "",
    promptCount: 1,
    secondsRemaining: 8,
  });
  const identityPromptRef = useRef(identityPrompt);
  identityPromptRef.current = identityPrompt;
  const identityTimerRef = useRef(null);
  const identityIntervalRef = useRef(null);

  // ── Mode State (IDLE | ENGAGED) ───────────────────────────────────────────
  const [kioskMode, setKioskMode] = useState("IDLE");
  const kioskModeRef = useRef("IDLE");
  kioskModeRef.current = kioskMode;

  const isEngaged = kioskMode === "ENGAGED";

  const say = useCallback((text) => {
    if (kioskModeRef.current === "IDLE") return;
    if (!text || typeof text !== "string" || !text.trim()) return;
    const clean = text.trim();
    setCaption(clean);
    setSpeechId((p) => p + 1);
    const replyId = `say_${Date.now()}`;
    speechController.beginReply(replyId, { source: "say" });
    speechController.appendSentence(replyId, clean, { turnId: replyId });
    speechController.endReply(replyId);
  }, []);

  const lastCustomerRef = useRef(null);
  const returnMemoryTimerRef = useRef(null);
  const engagingRef = useRef(false);
  const cameraPresenceRef = useRef(null);
  const presenceTrackerRef = useRef(null);
  const signalsRef = useRef(null);
  const lastComparedCustomerRef = useRef(null);
  const pendingTappedProductRef = useRef(null);
  const replayingRef = useRef(false);

  // Clear returning customer RAM snapshot on window beforeunload
  useEffect(() => {
    const handleUnload = () => {
      lastCustomerRef.current = null;
      if (returnMemoryTimerRef.current) {
        clearTimeout(returnMemoryTimerRef.current);
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      if (returnMemoryTimerRef.current) {
        clearTimeout(returnMemoryTimerRef.current);
      }
    };
  }, []);

  const handleLateRestore = useCallback(async () => {
    const saved = lastComparedCustomerRef.current;
    if (!saved) return;
    if (kioskModeRef.current !== "ENGAGED") return;

    console.log(`[Restore] Applying late restore for customer: "${saved.name}"`);
    const isOpen = await kioskWS.waitForOpen(3000);
    if (!isOpen) return;

    const runReplayStep = async (send) => {
      const p = kioskWS.waitForDone(4000);
      send();
      return p;
    };

    replayingRef.current = true;
    let ok = false;
    let failedStep = "";
    try {
      ok = await runReplayStep(() => kioskWS.sendSetName(saved.name));
      if (!ok) {
        failedStep = "SET_NAME";
      } else if (saved.category && saved.category !== "all") {
        ok = await runReplayStep(() =>
          kioskWS.sendSelectCategory({ category_id: saved.category, category_name: saved.category })
        );
        if (!ok) failedStep = "SELECT_CATEGORY";
      }
      const savedProd =
        saved.product ||
        backendCatalog.find((p) => p.id === saved.productId) ||
        (saved.productId ? { id: saved.productId } : null);
      if (ok && saved.showDetail && savedProd) {
        ok = await runReplayStep(() => kioskWS.sendSelectProduct(savedProd));
        if (!ok) failedStep = "SELECT_PRODUCT";
      }
    } finally {
      replayingRef.current = false;
    }

    if (!ok) {
      console.log(`[Restore] late replay failed at ${failedStep || "unknown"}`);
      return;
    }

    console.log("[Restore] replay ok");
    const restoredName = saved.name || "";
    setName(restoredName);
    nameRef.current = restoredName;
    KioskStepCache.setCustomerName(restoredName);
    KioskStepCache.setCurrentStep(KIOSK_STEPS.NAME_SET);

    if (saved.productId) {
      setProductId(saved.productId);
    }
    if (saved.category) {
      setCategory(saved.category);
    }
    if (!saved.showDetail) trace("showDetail=false", { caller: "restoreSavedSession" });
    setShowDetail(Boolean(saved.showDetail));
    productDetailOpenedRef.current = Boolean(saved.showDetail);
    setOnboardingOpen(false);
    setOnboardingStep(2);

    if (saved.gallery) {
      restoreGallery(saved.gallery);
      setFaceEnrolled(true);
    }

    console.log(`[Restore] kioskMode=${kioskModeRef.current}`);
    say(`Welcome back${restoredName ? ", " + restoredName : ""}!`);
  }, [backendCatalog, say]);

  const compareReturningCustomerWithTimeout = useCallback((targetGallery, timeoutMs = 3500) => {
    const t0 = Date.now();
    const video = cameraPresenceRef.current?.videoRef?.current;
    if (!video || video.readyState < 2) {
      const elapsed = Date.now() - t0;
      console.log(`[Restore] compare status=no_video_frame ms=${elapsed}`);
      return Promise.resolve({ status: "no_video_frame", elapsed });
    }

    let timedOut = false;
    let timeoutId;

    const compPromise = compareToGallery(video, targetGallery, 3, 80)
      .then((res) => {
        const elapsed = Date.now() - t0;
        if (timedOut) {
          console.log(`[Restore] late result status=${res.status} ms=${elapsed}`);
          if (res.status === "same") {
            handleLateRestore();
          }
        } else {
          console.log(`[Restore] compare status=${res.status} ms=${elapsed}`);
        }
        return { ...res, elapsed };
      })
      .catch((err) => {
        const elapsed = Date.now() - t0;
        console.warn(`[Restore] compare status=error ms=${elapsed}`, err);
        return { status: "error", elapsed };
      });

    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        const elapsed = Date.now() - t0;
        console.log(`[Restore] compare status=timeout ms=${elapsed}`);
        resolve({ status: "timeout", elapsed });
      }, timeoutMs);
    });

    return Promise.race([compPromise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  }, [handleLateRestore]);

  const engage = useCallback(async (reasonString = "unknown", { restoreFrom } = {}) => {
    if (isVideoOnly()) return;
    const reason = typeof reasonString === "string" ? reasonString : "unknown";

    if (kioskModeRef.current === "ENGAGED") return;
    console.log(`[Kiosk] Entering ENGAGED mode (reason=${reason})`);

    // a. set kioskModeRef.current = "ENGAGED" synchronously (and state) BEFORE connecting
    trace("kioskMode", { from: kioskModeRef.current, to: "ENGAGED", reason });
    kioskModeRef.current = "ENGAGED";
    setKioskMode("ENGAGED");

    const newSession = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    sessionIdRef.current = newSession;
    KioskStepCache.setSessionId(newSession);

    warmupSpeech();

    const runFreshEngage = (sessId) => {
      // Normal (non-restore) engage: Clean state completely so ASK_NAME is never bypassed
      KioskStepCache.clearCache();
      KioskStepCache.setCurrentStep(0);
      setName("");
      nameRef.current = "";
      nameSubmittedRef.current = false;
      greetingDoneRef.current = false;
      nameDoneRef.current = false;
      introPlayedRef.current = false;

      // On entering ENGAGED for a new session, make sure onboardingOpen is true and onboardingStep is 1 (Requirement 4)
      setOnboardingOpen(true);
      setOnboardingStep(1);
      latestRef.current.onboardingStep = 1;
      console.log("[Session] engage state", { onboardingOpen: true, onboardingStep: 1 });

      // Connect WebSocket with auto_greet = 1
      kioskWS.connect(sessId, true);

      if (typeof window !== "undefined" && window.kiosk?.sendPresenceState) {
        window.kiosk.sendPresenceState("ENGAGED");
      }

      // Check if a tapped product started this session
      if (pendingTappedProductRef.current) {
        const tapped = pendingTappedProductRef.current;
        pendingTappedProductRef.current = null;
        setProductId(tapped.id);
        setShowDetail(true);
        setOnboardingOpen(false);
        KioskStepCache.setSelectedProduct(tapped);
        kioskWS.sendSelectProduct(tapped);
      }
    };

    if (restoreFrom) {
      kioskWS.connect(newSession, false);

      const isOpen = await kioskWS.waitForOpen(3000);
      if (!isOpen) {
        console.warn("[Restore] socket failed, falling back");
        kioskWS.disconnect();
        runFreshEngage(newSession);
        return;
      }

      console.log(`[Restore] kioskMode=${kioskModeRef.current}`);

      const runReplayStep = async (send) => {
        const p = kioskWS.waitForDone(4000);
        send();
        return p;
      };

      const s = restoreFrom || lastCustomerRef.current;
      replayingRef.current = true;
      let ok = false;
      let failedStep = "";
      try {
        ok = await runReplayStep(() => kioskWS.sendSetName(s.name));
        if (!ok) {
          failedStep = "SET_NAME";
        } else if (s.category && s.category !== "all") {
          ok = await runReplayStep(() =>
            kioskWS.sendSelectCategory({ category_id: s.category, category_name: s.category })
          );
          if (!ok) failedStep = "SELECT_CATEGORY";
        }
        const savedProd =
          s.product ||
          backendCatalog.find((p) => p.id === s.productId) ||
          (s.productId ? { id: s.productId } : null);
        if (ok && s.showDetail && savedProd) {
          ok = await runReplayStep(() => kioskWS.sendSelectProduct(savedProd));
          if (!ok) failedStep = "SELECT_PRODUCT";
        }
      } finally {
        replayingRef.current = false;
      }

      if (!ok) {
        console.log(`[Restore] replay failed at ${failedStep || "unknown"}`);
        kioskWS.disconnect();
        runFreshEngage(newSession);
        return;
      }

      console.log("[Restore] replay ok");

      // Set UI and cache from snapshot only after replay succeeds
      greetingDoneRef.current = true;
      nameDoneRef.current = true;
      introPlayedRef.current = true;
      nameSubmittedRef.current = true;

      const restoredName = s.name || "";
      setName(restoredName);
      nameRef.current = restoredName;
      KioskStepCache.setCustomerName(restoredName);
      KioskStepCache.setCurrentStep(KIOSK_STEPS.NAME_SET);

      if (s.productId) {
        setProductId(s.productId);
      }
      if (s.category) {
        setCategory(s.category);
      }
      if (!s.showDetail) trace("showDetail=false", { caller: "restoreFromMemory" });
      setShowDetail(Boolean(s.showDetail));
      productDetailOpenedRef.current = Boolean(s.showDetail);
      setOnboardingOpen(false);
      setOnboardingStep(2);

      // Restore face gallery so real-time face guard continues
      if (s.gallery) {
        restoreGallery(s.gallery);
        setFaceEnrolled(true);
      }

      if (typeof window !== "undefined" && window.kiosk?.sendPresenceState) {
        window.kiosk.sendPresenceState("ENGAGED");
      }

      // Check if a tapped product started this session
      if (pendingTappedProductRef.current) {
        const tapped = pendingTappedProductRef.current;
        pendingTappedProductRef.current = null;
        setProductId(tapped.id);
        setShowDetail(true);
        productDetailOpenedRef.current = true;
        setOnboardingOpen(false);
        KioskStepCache.setSelectedProduct(tapped);
        kioskWS.sendSelectProduct(tapped);
      }

      say(`Welcome back${restoredName ? ", " + restoredName : ""}!`);
    } else {
      runFreshEngage(newSession);
    }
  }, [backendCatalog, say]);

  const enterEngaged = useCallback((reason = "unknown") => {
    const reasonStr = typeof reason === "string" ? reason : "unknown";
    engage(reasonStr);
  }, [engage]);

  // ── Camera & Hardware Presence Hook ───────────────────────────────────────
  const cameraPresence = usePresenceDetection({
    onEnterEngaged: useCallback(async () => {
      lastFaceAtRef.current = Date.now();

      if (kioskModeRef.current === "ENGAGED" || engagingRef.current) return;
      engagingRef.current = true;

      try {
        const faceVisible = true;
        const hasLastCustomer = Boolean(lastCustomerRef.current);
        console.log(
          `[Restore] engage trigger=face faceVisible=${faceVisible} lastCustomer=${hasLastCustomer ? "yes" : "null"}`
        );

        const savedCustomer = lastCustomerRef.current;
        const isSnapshotFresh = savedCustomer && (Date.now() - savedCustomer.savedAt < RETURN_MEMORY_MS);
        let restoreCandidate = null;

        if (isSnapshotFresh) {
          if (presenceTrackerRef.current?.multipleFaces) {
            console.log("[Restore] discarded reason=multiple_faces");
            lastCustomerRef.current = null;
            clearTimeout(returnMemoryTimerRef.current);
          } else {
            lastComparedCustomerRef.current = savedCustomer;
            lastCustomerRef.current = null;
            clearTimeout(returnMemoryTimerRef.current);

            try {
              const comp = await compareReturningCustomerWithTimeout(savedCustomer.gallery, 3500);
              if (comp.status === "same") {
                restoreCandidate = savedCustomer;
              }
            } catch (err) {
              console.warn("[Restore] compare exception:", err);
            }
          }
        }

        // Whatever happens (same, different, unsure, timeout, error) the kiosk MUST engage right after
        engage("face_in_range_stable", { restoreFrom: restoreCandidate });

        if (convStateRef.current === S.IDLE) {
          setConv(S.ATTENTIVE);
        }
      } finally {
        if (kioskModeRef.current !== "ENGAGED") {
          engagingRef.current = false;
        }
      }
    }, [compareReturningCustomerWithTimeout, engage, setConv]),
    onExitToIdle: useCallback(() => {
      if (kioskModeRef.current === "ENGAGED") {
        latestRef.current.resetSession?.("presence_detector_exit");
      }
    }, []),
  });
  cameraPresenceRef.current = cameraPresence;

  const handleTouchEngagement = useCallback(async (source = "screen_touch") => {
    lastInputAtRef.current = Date.now();
    cameraPresence.triggerTouchEngaged();

    const reasonStr = typeof source === "string" ? source : "screen_touch";

    if (kioskModeRef.current === "ENGAGED" || engagingRef.current) return;
    engagingRef.current = true;

    try {
      const now = Date.now();
      const faceSeenRecently = (now - lastFaceAtRef.current) <= 1500;
      const faceVisible = Boolean(
        signalsRef.current?.present ||
        cameraPresenceRef.current?.state === "ENGAGED" ||
        faceSeenRecently
      );
      const hasLastCustomer = Boolean(lastCustomerRef.current);

      console.log(
        `[Restore] engage trigger=touch faceVisible=${faceVisible} lastCustomer=${hasLastCustomer ? "yes" : "null"}`
      );

      let restoreCandidate = null;

      if (hasLastCustomer) {
        if (!faceVisible) {
          // Only discard with "touch_without_face" if no face has been seen for more than 1.5s
          console.log("[Restore] discarded reason=touch_without_face");
          lastCustomerRef.current = null;
          clearTimeout(returnMemoryTimerRef.current);
        } else {
          // Face is currently visible AND lastCustomerRef exists: run compare first (max 3500ms), then engage
          const savedCustomer = lastCustomerRef.current;
          const isSnapshotFresh = savedCustomer && (now - savedCustomer.savedAt < RETURN_MEMORY_MS);

          if (isSnapshotFresh) {
            if (presenceTrackerRef.current?.multipleFaces) {
              console.log("[Restore] discarded reason=multiple_faces");
              lastCustomerRef.current = null;
              clearTimeout(returnMemoryTimerRef.current);
            } else {
              lastComparedCustomerRef.current = savedCustomer;
              lastCustomerRef.current = null;
              clearTimeout(returnMemoryTimerRef.current);

              try {
                const comp = await compareReturningCustomerWithTimeout(savedCustomer.gallery, 3500);
                if (comp.status === "same") {
                  restoreCandidate = savedCustomer;
                }
              } catch (err) {
                console.warn("[Restore] compare exception:", err);
              }
            }
          } else {
            lastCustomerRef.current = null;
            clearTimeout(returnMemoryTimerRef.current);
          }
        }
      }

      engage(reasonStr, { restoreFrom: restoreCandidate });
    } finally {
      if (kioskModeRef.current !== "ENGAGED") {
        engagingRef.current = false;
      }
    }
  }, [cameraPresence, compareReturningCustomerWithTimeout, engage]);

  // ── Verification voice prompt helper ("Welcome back! Are you still <name>?") ─
  const triggerIdentityVoiceCheck = useCallback((returningName) => {
    const currentName = returningName || nameRef.current;
    if (!currentName) return;
    console.log(`[Presence] Initiating verification prompt for name="${currentName}".`);
    if (!speechController.isSpeaking()) {
      const stage = stageRef.current || latestRef.current._stageRef?.current;
      stage?.speak?.(`Welcome back! Are you still ${currentName}?`);
      setCaption(`Welcome back! Are you still ${currentName}?`);
    }

    clearTimeout(identityTimerRef.current);
    clearInterval(identityIntervalRef.current);

    let secLeft = 8;
    setIdentityPrompt({
      active: true,
      name: currentName,
      promptCount: 1,
      secondsRemaining: 8,
    });

    identityIntervalRef.current = setInterval(() => {
      secLeft -= 1;
      setIdentityPrompt((prev) => ({
        ...prev,
        secondsRemaining: Math.max(0, secLeft),
      }));
    }, 1000);

    identityTimerRef.current = setTimeout(() => {
      // Attempt 1 expired after 8s: ask again once
      clearInterval(identityIntervalRef.current);
      console.log(`[Presence] Verification prompt 1 unanswered after 8s. Repeating prompt once.`);
      if (!speechController.isSpeaking()) {
        const st = stageRef.current || latestRef.current._stageRef?.current;
        st?.speak?.(`Are you still ${currentName}?`);
        setCaption(`Are you still ${currentName}?`);
      }

      secLeft = 8;
      setIdentityPrompt({
        active: true,
        name: currentName,
        promptCount: 2,
        secondsRemaining: 8,
      });

      identityIntervalRef.current = setInterval(() => {
        secLeft -= 1;
        setIdentityPrompt((prev) => ({
          ...prev,
          secondsRemaining: Math.max(0, secLeft),
        }));
      }, 1000);

      identityTimerRef.current = setTimeout(() => {
        // Attempt 2 expired after another 8s: reset session
        clearInterval(identityIntervalRef.current);
        console.log(`[Presence] Verification prompt 2 unanswered after 8s. Resetting session.`);
        setIdentityPrompt({ active: false, name: "", promptCount: 1, secondsRemaining: 8 });
        latestRef.current.resetSession?.("timeout_unanswered");
      }, 8000);
    }, 8000);
  }, []);

  // ── Presence State Machine (usePresence fed by FaceLandmarker) ────────────
  const presenceTracker = usePresence({
    getName: useCallback(() => nameRef.current || KioskStepCache.getCustomerName(), []),
    onShortGapReturn: useCallback(({ elapsed, name: returningName }) => {
      console.log(`[Presence] Short gap return (${elapsed}ms) with name="${returningName}".`);
      if (hasEnrolled()) {
        // Handled by useFaceGuard; skip speaking here to prevent double-speaking
        return;
      }
      triggerIdentityVoiceCheck(returningName);
    }, [triggerIdentityVoiceCheck]),
    onLongGapAbsent: useCallback(({ elapsed }) => {
      console.log(`[Presence] Long gap absence (${elapsed}ms >= 10s). Resetting session.`);
      clearTimeout(identityTimerRef.current);
      clearInterval(identityIntervalRef.current);
      setIdentityPrompt({ active: false, name: "", promptCount: 1, secondsRemaining: 8 });
      latestRef.current.resetSession?.("absent_long");
    }, []),
  });
  presenceTrackerRef.current = presenceTracker;

  // Unified presence object: full backward-compatible props + presenceTracker state
  const presence = {
    ...cameraPresence,
    ...presenceTracker,
    state: kioskMode,
    triggerTouchEngaged: handleTouchEngagement,
  };

  // Sync engagement presence state with Electron main process
  useEffect(() => {
    if (typeof window !== "undefined" && window.kiosk?.sendPresenceState) {
      window.kiosk.sendPresenceState(kioskMode);
    }
  }, [kioskMode]);

  // ── Face signals (jaw-open VAD in useUserSignals) fed continuously ─────────
  const signals = useUserSignals({
    videoRef: cameraPresence.videoRef,
    isEngaged,
    onSpeechStart: useCallback(() => { }, []),
    onSpeechEnd: useCallback(() => { }, []),
    onFaceResult: presenceTracker.handleFaceLandmarks,
  });
  signalsRef.current = signals;

  // Build the face object expected by useUserSpeechState (reads facePx from ref to avoid re-renders)
  const face = {
    present: signals.present,
    jawOpen: signals.jawOpen,
    lookingAtScreen: signals.attention === "screen",
    faceSizeRatio: (presence.debugStatsRef?.current?.facePx ?? presence.debugStats?.facePx ?? 0) / 640,
  };

  // ── Face Identity Enrollment (1.5s stable looking at screen after name/greeting) ─
  const isEnrollingRef = useRef(false);
  useEffect(() => {
    if (!FACE_ID_ENABLED || hasEnrolled() || isEnrollingRef.current) {
      return;
    }

    const canEnroll = nameSubmittedRef.current || greetingDoneRef.current;
    const isGoodConditions =
      canEnroll &&
      signals.present &&
      signals.attention === "screen" &&
      !presenceTracker.multipleFaces;

    if (!isGoodConditions) {
      return;
    }

    const timer = setTimeout(() => {
      const stillGood =
        !hasEnrolled() &&
        !isEnrollingRef.current &&
        signals.present &&
        signals.attention === "screen" &&
        !presenceTracker.multipleFaces;

      if (stillGood && cameraPresence.videoRef?.current) {
        isEnrollingRef.current = true;
        enrollFace(cameraPresence.videoRef.current)
          .then((enrolled) => {
            if (enrolled) setFaceEnrolled(true);
          })
          .finally(() => {
            isEnrollingRef.current = false;
          });
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [
    signals.present,
    signals.attention,
    presenceTracker.multipleFaces,
    cameraPresence.videoRef,
    onboardingStep,
  ]);

  // ── Mic + single AudioWorklet PCM stream ──────────────────────────────────
  const mic = useMic({ isEngaged });
  const { vadSpeech, audioLevel, micError } = mic;

  // ── Avatar speech / active status ─────────────────────────────────────────
  const isAvatarActive = speaking || convState === S.SPEAKING || convState === S.THINKING;
  const isAvatarActiveRef = useRef(isAvatarActive);
  isAvatarActiveRef.current = isAvatarActive;

  // ── Fused speech state (gated by isAvatarActive to prevent avatar self-hearing) ──
  const { userSpeaking, evidence, speakingForMs, silentForMs } =
    useUserSpeechState({ vadSpeech, audioLevel, face, isSpeaking: isAvatarActive });

  const userSpeakingRef = useRef(userSpeaking);
  userSpeakingRef.current = userSpeaking;

  // ── Audio Gating & Cooldown to prevent avatar hearing itself ──────────────
  const COOLDOWN_MS = 700;
  const ECHO_WINDOW_MS = 3500;
  const BARGE_MIN_LEVEL = 0.02;

  const bargeUntilRef = useRef(0);
  const avatarEndedAtRef = useRef(0);
  const avatarActiveNowRef = useRef(false);

  useEffect(() => {
    avatarActiveNowRef.current = isAvatarActive;
    if (isAvatarActive) {
      bargeUntilRef.current = 0;
    } else {
      avatarEndedAtRef.current = Date.now();
    }
  }, [isAvatarActive]);

  // Watchdog: Ensure speaking state automatically unblocks as a true last resort
  useEffect(() => {
    if (speaking || convState === S.SPEAKING) {
      const maxMs = 35000; // Generous last resort watchdog (35s)
      const timer = setTimeout(() => {
        const stage = latestRef.current._stageRef?.current;
        const isStillPlaying = stage && typeof stage.isSpeaking === "function" ? stage.isSpeaking() : false;
        if (!isStillPlaying && (speaking || convStateRef.current === S.SPEAKING)) {
          console.warn("[Kiosk] Avatar speaking safety watchdog: releasing speaking lock to allow listening");
          setSpeaking(false);
          if (convStateRef.current === S.SPEAKING) {
            setConv(S.ATTENTIVE);
          }
        }
      }, maxMs);
      return () => clearTimeout(timer);
    }
  }, [speaking, convState, setConv]);

  // Idle timer cancellation while speaking & re-arming when done
  useEffect(() => {
    if (speaking) {
      if (hintIdleTimerRef.current) {
        clearTimeout(hintIdleTimerRef.current);
        hintIdleTimerRef.current = null;
        console.log(`[DebugTiming] hintIdleTimer cancelled: avatar speaking at=${Math.round(typeof window !== "undefined" ? performance.now() : Date.now())}`);
      }
    } else {
      resetHintIdleTimer();
    }
  }, [speaking, resetHintIdleTimer]);

  // Reset idle timer on any user interaction (touch, pointer, click, keydown)
  useEffect(() => {
    const onUserInteraction = () => {
      lastInputAtRef.current = Date.now();
      resetHintIdleTimer();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pointerdown", onUserInteraction, { passive: true });
      window.addEventListener("touchstart", onUserInteraction, { passive: true });
      window.addEventListener("keydown", onUserInteraction, { passive: true });
      return () => {
        window.removeEventListener("pointerdown", onUserInteraction);
        window.removeEventListener("touchstart", onUserInteraction);
        window.removeEventListener("keydown", onUserInteraction);
      };
    }
  }, [resetHintIdleTimer]);

  // Voice activity resets idle timer
  useEffect(() => {
    if (userSpeaking || vadSpeech) {
      lastInputAtRef.current = Date.now();
      resetHintIdleTimer();
    }
  }, [userSpeaking, vadSpeech, resetHintIdleTimer]);


  // Read by useSpeech on every audio chunk
  const getGate = useCallback(() => {
    const now = Date.now();
    const inCooldown = now - avatarEndedAtRef.current < COOLDOWN_MS;
    return {
      blocked: avatarActiveNowRef.current || inCooldown,
      bargeIn: now < bargeUntilRef.current,
    };
  }, []);

  // Avatar echo filter
  const lastAvatarTextRef = useRef("");
  useEffect(() => {
    if (caption) lastAvatarTextRef.current = caption;
  }, [caption]);

  const isEchoOfAvatar = useCallback((text) => {
    const sinceEnd = Date.now() - avatarEndedAtRef.current;
    const recent = avatarActiveNowRef.current || sinceEnd < ECHO_WINDOW_MS;
    const cap = lastAvatarTextRef.current;
    if (!recent || !cap || !text) return false;

    const cleanCap = cap.toLowerCase().trim();
    const cleanText = text.toLowerCase().trim();
    if (cleanText.length >= 6 && (cleanCap.includes(cleanText) || cleanText.includes(cleanCap))) {
      return true;
    }

    const norm = (s) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const capWords = new Set(norm(cap));
    const words = norm(text);
    if (!words.length) return false;
    return words.filter((w) => capWords.has(w)).length / words.length >= 0.35;
  }, []);

  // ── Global Document Input Capture Listeners (Touch / Click / Typing counts) ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHumanInput = () => {
      lastInputAtRef.current = Date.now();
    };
    const inputEvents = [
      "pointerdown",
      "touchstart",
      "mousedown",
      "keydown",
      "input",
      "wheel",
      "scroll",
    ];
    inputEvents.forEach((ev) =>
      window.addEventListener(ev, handleHumanInput, { capture: true, passive: true })
    );
    return () => {
      inputEvents.forEach((ev) =>
        window.removeEventListener(ev, handleHumanInput, { capture: true })
      );
    };
  }, []);

  // ── Update Evidence Timestamps each render/event ──────────────────────────
  if (
    (presence.lastFaceAtRef && presence.lastFaceAtRef.current > lastFaceAtRef.current) ||
    signals.present
  ) {
    lastFaceAtRef.current = Date.now();
  }
  if (signals.present && signals.attention === "screen") {
    lastAttentionAtRef.current = Date.now();
  }
  const faceSeenRecently = Date.now() - lastFaceAtRef.current < 5000;
  const isHumanVoice =
    faceSeenRecently &&
    (userSpeaking || (vadSpeech && audioLevel > BARGE_MIN_LEVEL && !getGate().blocked));
  if (isHumanVoice) {
    lastVoiceAtRef.current = Date.now();
  }

  // ── Avatar control helpers ────────────────────────────────────────────────
  const stageRef = useRef(null);
  const setStageRef = useCallback((ref) => {
    stageRef.current = ref;
    // Keep latestRef._stageRef in sync so the done/sentence handlers can speak directly
    latestRef.current._stageRef = stageRef;
  }, []);

  const cancelPendingReturnFromDetail = useCallback((reason = "user_navigated") => {
    if (backFromDetailTimerRef.current) {
      clearTimeout(backFromDetailTimerRef.current);
      backFromDetailTimerRef.current = null;
    }
    if (isBackFromDetailPendingRef.current) {
      console.log(`[Kiosk] returnFromDetail cancelled (${reason})`);
      isBackFromDetailPendingRef.current = false;
      backNavSeqRef.current++;
    }
  }, []);

  const triggerReturnFromDetail = useCallback((turnId = null) => {
    if (!productDetailOpenedRef.current && !latestRef.current.showDetail && !justReturnedFromDetailRef.current) {
      console.log("[Kiosk] triggerReturnFromDetail skipped: no product detail was open");
      return;
    }
    productDetailOpenedRef.current = false;

    if (backFromDetailTimerRef.current) {
      clearTimeout(backFromDetailTimerRef.current);
      backFromDetailTimerRef.current = null;
    }

    speechController.cancelAll("back_from_detail");
    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.stop?.("back_from_detail");
    setSpeaking(false);
    if (convStateRef.current === S.SPEAKING) setConv(S.ATTENTIVE);

    const seq = ++backNavSeqRef.current;
    isBackFromDetailPendingRef.current = true;
    const tid = turnId || kioskWS.currentTurnId || "back_from_detail";
    backTurnIdRef.current = tid;

    backFromDetailTimerRef.current = setTimeout(() => {
      backFromDetailTimerRef.current = null;
      isBackFromDetailPendingRef.current = false;

      if (backNavSeqRef.current !== seq) {
        console.log("[Kiosk] returnFromDetail skipped: user navigated again during 400ms");
        return;
      }
      if (kioskModeRef.current === "IDLE") {
        console.log("[Kiosk] returnFromDetail skipped: kiosk in IDLE mode");
        return;
      }
      if (latestRef.current.showDetail) {
        console.log("[Kiosk] returnFromDetail skipped: product detail re-opened");
        return;
      }

      const targetCat = categoryBeforeDetailRef.current || latestRef.current.category || "all";
      const line = getCategoryNaturalLine(targetCat);
      setCaption(line);

      const activeTid = backTurnIdRef.current || tid || "back_from_detail";
      if (speechController.getEnqueuedCount(activeTid) === 0) {
        speechController.appendSentence(activeTid, line, { turnId: activeTid });
        speechController.endReply(activeTid);
      } else {
        console.log(`[Kiosk] returnFromDetail already enqueued for turn=${activeTid}, skipping.`);
      }
    }, 400);
  }, [setCaption, setConv]);

  // ── User did something: cut Greenie off immediately ──
  const stopSpeechForUserAction = useCallback((reason = "user_action") => {
    lastHandledActionRef.current = { key: null, t: 0 };
    speechController.cancelAll(reason);
    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.stop?.(reason);
    abortRef.current?.abort();
    activeActionReplyIdRef.current = null;
    turnsWithSentencesRef.current.clear();

    // Backend may be waiting for SPEECH_DONE of the line we just cut: release it
    const pendingId = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
    pendingSpeechAckRef.current = null;
    clearTimeout(speechAckTimerRef.current);
    if (pendingId) kioskWS.flushSpeechDone(pendingId);

    setSpeaking(false);
    clearTimeout(aiTurnTimeoutRef.current);
    if (convStateRef.current === S.SPEAKING) setConv(S.ATTENTIVE);
  }, [setConv]);

  const lastResetAtRef = useRef(0);

  // ── Reset session to Step 1 (presence-based or manual) ───────────────────
  const resetSession = useCallback((reason = "unknown") => {
    const now = Date.now();
    trace("resetSession", {
      reason,
      faceAbsentMs: now - (lastFaceAtRef.current || now),
      touchIdleMs: now - (lastInputAtRef.current || now),
      presenceState: presence?.presenceState || presence?.state || cameraPresenceRef.current?.state || kioskModeRef.current,
      multipleFaces: Boolean(presenceTrackerRef.current?.multipleFaces || presence?.multipleFaces),
      cameraError: Boolean(presence?.cameraError || cameraPresenceRef.current?.cameraError),
    });
    if (now - lastResetAtRef.current < RESET_DEBOUNCE_MS) {
      console.log(`[Session] reset debounced (<${RESET_DEBOUNCE_MS}ms since last reset, reason=${reason})`);
      return;
    }
    lastResetAtRef.current = now;

    // Inactivity/presence resets must not clear an unresolved checkout
    const pendingPayment = getPaymentApi().getPendingReference();
    if (pendingPayment && pendingPayment.database_order_id) {
      console.log(`[Session] reset skipped: unresolved checkout pending (order=${pendingPayment.order_number || pendingPayment.database_order_id})`);
      return;
    }

    const oldSession = sessionIdRef.current;
    const newSession = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);

    // Pre-reset flags snapshot log (JSON.stringify)
    const preSnapshot = {
      greetingDone: greetingDoneRef.current,
      nameDone: nameDoneRef.current,
      introPlayed: introPlayedRef.current,
      nameSubmitted: nameSubmittedRef.current,
      pendingSpeechAck: pendingSpeechAckRef.current,
      cacheStep: KioskStepCache.getCurrentStep(),
      onboardingStep: latestRef.current.onboardingStep,
    };
    console.log(`[Session] reset reason=${reason} oldSession=${oldSession} newSession=${newSession} snapshot=${JSON.stringify(preSnapshot)}`);

    // Clear verification prompt & intervals
    clearTimeout(identityTimerRef.current);
    clearInterval(identityIntervalRef.current);
    setIdentityPrompt({ active: false, name: "", promptCount: 1, secondsRemaining: 8 });

    warningDeadlineRef.current = null;
    setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
    lastFaceAtRef.current = now;
    lastAttentionAtRef.current = now;
    lastVoiceAtRef.current = now;
    lastInputAtRef.current = now;

    // Reset flags & tracking BEFORE speech or new WS connection
    greetingDoneRef.current = false;
    nameDoneRef.current = false;
    introPlayedRef.current = false;
    nameSubmittedRef.current = false;
    turnsWithSentencesRef.current.clear();
    clearTimeout(categoriesFallbackTimerRef.current);
    clearTimeout(hintIdleTimerRef.current);
    onboardingDoneRef.current = false;
    setOnboardingDone(false);
    cancelPendingReturnFromDetail("session_reset");
    productDetailOpenedRef.current = false;

    // Stop speech and clear audio queue immediately via single speechController
    lastProductSpokenRef.current = null;
    speechController.cancelAll("session_reset");
    setCaption("");
    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.stop?.("session_reset");
    abortRef.current?.abort();
    abortRef.current = null;
    if (typeof window !== "undefined") {
      try { window.speechSynthesis?.cancel(); } catch (_) { }
    }
    setSpeaking(false);
    convStateRef.current = S.IDLE;
    setConv(S.IDLE);

    // Drop pending speech acknowledgments & timers
    pendingSpeechAckRef.current = null;
    clearTimeout(speechAckTimerRef.current);
    if (kioskWS.speechDoneTimer) {
      clearTimeout(kioskWS.speechDoneTimer);
      kioskWS.speechDoneTimer = null;
    }
    kioskWS.pendingSpeechId = null;
    kioskWS.currentSpeechId = null;

    // Remove ONLY this app's storage keys (no sessionStorage.clear()/localStorage.clear())
    KioskStepCache.clearCache();
    if (typeof window !== "undefined") {
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && (k.startsWith("greenie_") || k.startsWith("kiosk_") || k.includes("session"))) {
            sessionStorage.removeItem(k);
          }
        }
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith("greenie_") || k.startsWith("kiosk_") || k.includes("session"))) {
            localStorage.removeItem(k);
          }
        }
      } catch (_) { }
    }

    const absenceReasons = [
      "absent_long",
      "face_absent_hard_timeout",
      "timeout_unanswered",
      "auto_reset",
      "user_exit",
      "presence_detector_exit",
    ];
    const canSave =
      absenceReasons.includes(reason) &&
      faceEnrolled &&
      !presenceTracker.multipleFaces;
    if (canSave) {
      const savedProd =
        KioskStepCache.getSelectedProduct() ||
        backendCatalog.find((p) => p.id === productId) ||
        (productId ? { id: productId } : null);
      lastCustomerRef.current = {
        gallery: snapshotFace(),
        name: nameRef.current || "",
        category,
        productId,
        product: savedProd,
        showDetail,
        savedAt: Date.now(),
      };
      console.log(`[Restore] saved reason=${reason} name="${nameRef.current}" product=${productId}`);
      clearTimeout(returnMemoryTimerRef.current);
      returnMemoryTimerRef.current = setTimeout(() => {
        if (lastCustomerRef.current) {
          console.log("[Restore] discarded reason=memory_expired");
          lastCustomerRef.current = null;
        }
      }, RETURN_MEMORY_MS);
    } else {
      console.log(
        `[Restore] skipped reason=${reason} faceEnrolled=${faceEnrolled} ` +
        `hasName=${Boolean(nameRef.current)} hasProduct=${Boolean(productId)} ` +
        `multipleFaces=${presenceTracker.multipleFaces}`
      );
      if (!absenceReasons.includes(reason)) {
        lastCustomerRef.current = null;
        clearTimeout(returnMemoryTimerRef.current);
      }
    }

    clearFace();
    setFaceEnrolled(false);
    setIdentityMasked(false);
    identityCutSpeechRef.current = false;
    engagingRef.current = false;
    replayingRef.current = false;
    presenceTracker.forceResetPresence();
    cameraPresenceRef.current?.forceResetToIdle?.();
    pendingTappedProductRef.current = null;
    lastComparedCustomerRef.current = null;

    setName("");
    nameRef.current = "";
    setCategory("all");
    categoryBeforeDetailRef.current = "all";
    justReturnedFromDetailRef.current = false;
    setProductId(backendCatalog[0]?.id || null);
    setCaption("");

    // Close WebSocket and transition back to IDLE mode (do NOT reconnect with auto_greet!)
    kioskWS.disconnect();
    trace("kioskMode", { from: kioskModeRef.current, to: "IDLE", reason });
    setKioskMode("IDLE");
    kioskModeRef.current = "IDLE";
    engagingRef.current = false;
    if (typeof window !== "undefined" && window.kiosk?.sendPresenceState) {
      window.kiosk.sendPresenceState("IDLE");
    }
    resetBackendSession(oldSession);

    const clearedLiveTurn = liveTurnProductsRef.current?.length ?? 0;
    const clearedCart = cartItemsRef.current?.length ?? 0;
    const currentView = latestRef.current.showCheckout
      ? "checkout"
      : latestRef.current.showDetail
        ? "detail"
        : "catalog";

    setLiveTurnProducts([]);
    setFiltersApplied(null);
    setHighlightSku(null);
    clearCart();
    setCartItems([]);
    setShowCheckout(false);
    setSessionResetKey((prev) => prev + 1);
    console.log(`[Session] reset cleared liveTurn=${clearedLiveTurn} cart=${clearedCart} view=${currentView}`);

    setBackendAction(null);
    setActionButtons([]);
    setCartModalOpen(false);
    setCartModalData(null);
    setQrModalOpen(false);
    setQrModalData(null);
    setGoodbyeOpen(false);
    setGoodbyeData(null);
    setStaffBanner(null);
    setHintBubble(null);
    setRecommendationOpen(false);
    setRecommendationData(null);
    setPairUpPromptOpen(false);
    setPairUpModalOpen(false);
    setPairUpProducts([]);
    setPairUpCaption("Psst! Pick any one pair-up from here and unlock an extra 5% off your whole order!");
    sessionPairUpAskCountRef.current = 0;
    consecutiveNoCountRef.current = 0;
    askedProductIdsRef.current.clear();
    pairupCacheRef.current.clear();
    if (pairUpTimerRef.current) clearTimeout(pairUpTimerRef.current);
    trace("showDetail=false", { caller: "reset" });
    setShowDetail(false);
    setOnboardingOpen(false);
    setOnboardingStep(1);
    latestRef.current.onboardingStep = 1;
    setSpeechId(1);
    pendingTranscriptRef.current = "";
    setLastUserSpeech("");
    setLiveTranscript("");
    failureCountRef.current = 0;
    setShowPTT(false);

    // Post-reset flags snapshot log (JSON.stringify)
    const postSnapshot = {
      greetingDone: greetingDoneRef.current,
      nameDone: nameDoneRef.current,
      introPlayed: introPlayedRef.current,
      nameSubmitted: nameSubmittedRef.current,
      cacheStep: KioskStepCache.getCurrentStep(),
      onboardingStep: 1,
      speechId: 1,
      caption: "",
      appStorageCleared: true,
    };
    console.log(`[Session] reset completed. Post-reset flags snapshot: ${JSON.stringify(postSnapshot)}`);
  }, [backendCatalog, setConv, presenceTracker]);

  const reset = useCallback((reason) => {
    resetSession(reason || "manual_reset");
  }, [resetSession]);

  // ── Affirmative identity confirmation (same person returned) ─────────────
  const confirmIdentity = useCallback(() => {
    clearTimeout(identityTimerRef.current);
    clearInterval(identityIntervalRef.current);
    setIdentityPrompt({ active: false, name: "", promptCount: 1, secondsRemaining: 8 });
    presenceTracker.confirmSamePerson();

    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.clearQueue?.("identity_confirmed");
    const currentName = nameRef.current;
    const msg = `Great to have you back${currentName ? `, ${currentName}` : ""}! What can I help you with?`;
    stage?.speak?.(msg);
    setCaption(msg);
  }, [presenceTracker]);

  // ── Multiple Faces speech sanitizer ──────────────────────────────────────
  const sanitizeForMultipleFaces = useCallback((text) => {
    if (!text || !presenceTracker.multipleFaces) return text;
    const currentName = nameRef.current || KioskStepCache.getCustomerName();
    if (!currentName) return text;
    const escaped = currentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text
      .replace(new RegExp(`\\b(?:Hey|Hi|Hello)\\s+${escaped}[,!.]?`, "gi"), "Hello there,")
      .replace(new RegExp(`\\b${escaped}\\b`, "gi"), "you");
  }, [presenceTracker.multipleFaces]);

  // ── Privacy Mask & Face Guard System ──────────────────────────────────────
  useFaceGuard({
    videoRef: cameraPresence.videoRef,
    active: FACE_ID_ENABLED && faceEnrolled,
    faceVisible: Boolean(signals.present),
    getFaceBox: () => latestRef.current.faceBox || null,
    onSuspect: (reason) => {
      setIdentityMasked(true);
      if (reason === "return" && speechController.isSpeaking()) {
        identityCutSpeechRef.current = true;
        speechController.cancelAll("identity_check");
      }
    },
    onSame: () => {
      setIdentityMasked(false);
      if (identityCutSpeechRef.current) {
        identityCutSpeechRef.current = false;
        const n = nameRef.current;
        say(`Welcome back${n ? ", " + n : ""}!`);
      }
    },
    onDifferent: (reason, gap) => {
      identityCutSpeechRef.current = false;
      setIdentityMasked(false);
      resetSession(`different_person_swap (reason=${reason}, gap=${gap}ms)`);
    },
    onUnsure: () => {
      identityCutSpeechRef.current = false;
      setIdentityMasked(false);
    },
  });




  // ── Single Fused Human Evidence & Inactivity Interval (250 ms) ────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const lastEvidence = Math.max(
        lastFaceAtRef.current,
        lastAttentionAtRef.current,
        lastVoiceAtRef.current,
        lastInputAtRef.current
      );

      const hasCameraError = Boolean(presence.cameraError);
      const noEvidenceThreshold = hasCameraError ? 45000 : 15000;
      const elapsed = now - lastEvidence;

      // Diagnostic: shows which signal is keeping the session alive
      if (now - lastEvidenceLogRef.current > 5000) {
        lastEvidenceLogRef.current = now;
        console.log(
          `[Evidence] face=${Math.round((now - lastFaceAtRef.current) / 1000)}s ` +
          `attn=${Math.round((now - lastAttentionAtRef.current) / 1000)}s ` +
          `voice=${Math.round((now - lastVoiceAtRef.current) / 1000)}s ` +
          `input=${Math.round((now - lastInputAtRef.current) / 1000)}s ` +
          `presence=${latestRef.current.presence?.presenceState}`
        );
      }

      // HARD RULE: no face and no touch for a while means the customer left. Voice is ignored.
      const faceAbsentMs = now - lastFaceAtRef.current;
      const touchIdleMs = now - lastInputAtRef.current;
      const hasSession =
        Boolean(nameRef.current) ||
        latestRef.current.onboardingStep >= 2 ||
        latestRef.current.showDetail;
      if (
        !hasCameraError &&
        hasSession &&
        faceAbsentMs > ABSENT_LONG_MS + 2000 &&
        touchIdleMs > ABSENT_LONG_MS + 2000
      ) {
        console.log(`[Kiosk] Face absent ${Math.round(faceAbsentMs / 1000)}s with an active session. Hard reset.`);
        warningDeadlineRef.current = null;
        setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
        latestRef.current.reset?.(`face_absent_hard_timeout (faceAbsentMs=${faceAbsentMs}, touchIdleMs=${touchIdleMs}, threshold=${ABSENT_LONG_MS + 2000}ms, hasSession=${hasSession})`);
        return;
      }

      if (latestRef.current.pairUpPromptOpen || latestRef.current.pairUpModalOpen) {
        // Pause idle inactivity timers while prompt card or pop-up is open,
        // but keep the face-absence hard reset intact.
        if (warningDeadlineRef.current !== null || sessionTimeoutWarningRef.current.active) {
          warningDeadlineRef.current = null;
          setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
        }
        return;
      }

      if (elapsed < noEvidenceThreshold) {
        // Any human evidence immediately cancels active warning/countdown
        if (warningDeadlineRef.current !== null || sessionTimeoutWarningRef.current.active) {
          warningDeadlineRef.current = null;
          setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
        }
        return;
      }

      // No human evidence for threshold: run 10s wall-clock countdown
      if (warningDeadlineRef.current === null) {
        warningDeadlineRef.current = now + 10000;
        setSessionTimeoutWarning({ active: true, secondsRemaining: 10 });
      } else {
        const remainingSec = Math.max(0, Math.ceil((warningDeadlineRef.current - now) / 1000));
        if (remainingSec <= 0) {
          console.log("[Kiosk] Human evidence absent for timeout. Resetting session to Step 1.");
          warningDeadlineRef.current = null;
          setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
          latestRef.current.reset?.();
        } else {
          setSessionTimeoutWarning((prev) =>
            prev.secondsRemaining === remainingSec
              ? prev
              : { active: true, secondsRemaining: remainingSec }
          );
        }
      }
    }, 250);

    return () => clearInterval(interval);
  }, [presence.cameraError]);

  const continueSession = useCallback(() => {
    lastInputAtRef.current = Date.now();
    warningDeadlineRef.current = null;
    setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
    presence.triggerTouchEngaged();
  }, [presence]);

  const exitSession = useCallback(() => {
    warningDeadlineRef.current = null;
    setSessionTimeoutWarning({ active: false, secondsRemaining: 10 });
    latestRef.current.reset?.();
  }, []);

  // ── Interrupt avatar speech (User Barge-in) ────────────────────────────────
  const interruptAvatar = useCallback(async () => {
    speechController.cancelAll("user_barge_in");
    activeActionReplyIdRef.current = null;
    const pendingId = pendingSpeechAckRef.current || kioskWS.pendingSpeechId;
    if (pendingId) kioskWS.flushSpeechDone(pendingId);

    abortRef.current?.abort();
    if (typeof window !== "undefined") {
      try { window.speechSynthesis?.cancel(); } catch (_) { }
    }
    const stage = stageRef.current || latestRef.current._stageRef?.current;
    stage?.stop?.("user_barge_in");
    setSpeaking(false);
    setConv(S.LISTENING);

    pendingSpeechAckRef.current = null;
    clearTimeout(speechAckTimerRef.current);
  }, [setConv]);

  // ── Monotonic Onboarding Navigation: submitName & skipName ─────────────────
  const submitName = useCallback((n) => {
    stopSpeechForUserAction("user_submit_name");
    lastInputAtRef.current = Date.now();
    const trimmed = String(n || "").trim();
    if (!trimmed) return;

    const validation = validateCustomerName(trimmed);
    if (!validation.valid) {
      console.warn(`[Kiosk] Customer name validation failed: "${trimmed}" (reason=${validation.reason})`);
      const retryLine = "Sorry, I didn't quite catch that name. Could you say it again?";
      setCaption(retryLine);
      const retryTid = `name_retry_${Date.now()}`;
      speechController.beginReply(retryTid, { source: "name_retry" });
      speechController.appendSentence(retryTid, retryLine, { turnId: retryTid });
      speechController.endReply(retryTid);
      return;
    }

    const formattedName = validation.name;
    nameRef.current = formattedName;
    setName(formattedName);
    KioskStepCache.setCustomerName(formattedName);
    prewarmNameLines(formattedName);

    // Mid-session edit from top header chip or voice
    if (onboardingDoneRef.current) {
      setOnboardingOpen(false);

      kioskWS.sendNameSubmitted(formattedName);
      kioskWS.sendSetName(formattedName);

      // Part 3 Req 4: Greeny says one short line: "Nice to meet you, <name>!" (name as its own short chunk). Do not redo whole greeting.
      const nameTid = `name_update_${Date.now()}`;
      speechController.beginReply(nameTid, { source: "name_update" });
      speechController.appendSentence(nameTid, "Nice to meet you,", { turnId: nameTid });
      speechController.appendSentence(nameTid, `${formattedName}!`, { turnId: nameTid });
      speechController.endReply(nameTid);
      setCaption(`Nice to meet you, ${formattedName}!`);
      return;
    }

    nameSubmittedRef.current = true;
    KioskStepCache.setCurrentStep(KIOSK_STEPS.NAME_SET);

    kioskWS.sendNameSubmitted(formattedName);

    // Part C: Greeting Flow (Name provided)
    // 1. Say: "Nice to meet you," + "${name}!"
    // 2. Open category tab after greeting
    // 3. Say category line
    // 4. Say help line
    const vIdx = formattedName.length % 3;
    const flow = getGreetingFlowLines({ name: formattedName, isSkipped: false, variantIndex: vIdx });


    const tid = `greeting_name_${Date.now()}`;
    speechController.beginReply(tid, { source: "greeting_flow" });
    for (const chunk of flow.introChunks) {
      speechController.appendSentence(tid, chunk, { turnId: tid });
    }
    speechController.appendSentence(tid, flow.categoryChunk, { turnId: tid });
    speechController.appendSentence(tid, flow.helpChunk, { turnId: tid });
    speechController.endReply(tid);
    setCaption(flow.allChunks.join(" "));

    // Switch to category screen right after greeting (Step 2)
    if (!onboardingDoneRef.current) {
      clearTimeout(categoriesFallbackTimerRef.current);
      categoriesFallbackTimerRef.current = setTimeout(() => {
        if (!onboardingDoneRef.current) {
          openCategoryPicker("submitName_greeting_flow");
        }
      }, 1100);
    }
  }, [stopSpeechForUserAction, openCategoryPicker]);

  const continueAsGuest = useCallback(() => {
    stopSpeechForUserAction("continue_as_guest");
    lastInputAtRef.current = Date.now();
    setName("");
    nameRef.current = "";
    KioskStepCache.setCustomerName("");
    kioskWS.sendSkipName();
    setOnboardingOpen(false);

    const guestLine = "No problem at all! Continuing as Guest.";
    setCaption(guestLine);
    const guestTid = `guest_${Date.now()}`;
    speechController.beginReply(guestTid, { source: "continue_as_guest" });
    speechController.appendSentence(guestTid, guestLine, { turnId: guestTid });
    speechController.endReply(guestTid);
  }, [stopSpeechForUserAction]);

  const skipName = useCallback(() => {
    stopSpeechForUserAction("user_skip_name");
    lastInputAtRef.current = Date.now();
    nameSubmittedRef.current = true;
    KioskStepCache.setCurrentStep(KIOSK_STEPS.NAME_SET);

    kioskWS.sendNameSkipped();
    kioskWS.sendSkipName();

    // Part C: Greeting Flow (Name skipped)
    // 1. Say: "Hello, welcome to Green Fibre!"
    // 2. Open category tab
    // 3. Say category line
    // 4. Say help line
    const flow = getGreetingFlowLines({ isSkipped: true, variantIndex: 0 });

    const tid = `greeting_skip_${Date.now()}`;
    speechController.beginReply(tid, { source: "greeting_flow" });
    for (const chunk of flow.introChunks) {
      speechController.appendSentence(tid, chunk, { turnId: tid });
    }
    speechController.appendSentence(tid, flow.categoryChunk, { turnId: tid });
    speechController.appendSentence(tid, flow.helpChunk, { turnId: tid });
    speechController.endReply(tid);
    setCaption(flow.allChunks.join(" "));

    // Open category tab (Step 2)
    if (!onboardingDoneRef.current) {
      clearTimeout(categoriesFallbackTimerRef.current);
      categoriesFallbackTimerRef.current = setTimeout(() => {
        if (!onboardingDoneRef.current) {
          openCategoryPicker("skipName_greeting_flow");
        }
      }, 600);
    }
  }, [stopSpeechForUserAction, openCategoryPicker]);

  // ── AI Screen Director: Handle structured server actions ────────────────
  const handleServerAction = useCallback((action, salesStage) => {
    clearTimeout(categoriesFallbackTimerRef.current);
    if (replayingRef.current) {
      console.log("[Restore] replay: ignored action");
      return;
    }
    if (!action && !salesStage) return;

    if (kioskModeRef.current === "IDLE") {
      console.log("[Kiosk] Dropping server action in IDLE mode:", action?.action || action?.type || salesStage);
      return;
    }

    // Stale action protection: drop actions from different session or out-of-order sequence
    if (action?.session_id && action.session_id !== sessionIdRef.current) {
      console.log("[Kiosk] Dropping action from different session:", action.session_id);
      return;
    }
    if (action?.seq && lastAppliedSeqRef.current && action.seq < lastAppliedSeqRef.current) {
      console.log("[Kiosk] Dropping out-of-order action seq:", action.seq);
      return;
    }
    if (action?.seq) {
      lastAppliedSeqRef.current = action.seq;
    }

    const actionType =
      action?.action ||
      action?.type ||
      (salesStage === "ASK_NAME"
        ? "ASK_NAME"
        : salesStage === "ASK_CATEGORY" || salesStage === "SELECT_CATEGORY"
          ? "SHOW_CATEGORIES"
          : null);

    // Backend re-sends the same action inside the "done" frame: ignore the repeat
    const spokenText = action?.message || action?.prompt || action?.text || action?.blurb || "";
    if (spokenText) {
      const skusKey = (action?.products?.map((p) => p.sku || p.id) || []).join(",");
      const filtersKey = action?.filters_applied ? JSON.stringify(action.filters_applied) : "";
      const key = `${actionType}|${spokenText}|${skusKey}|${filtersKey}`;
      const nowTs = Date.now();
      if (lastHandledActionRef.current.key === key && nowTs - lastHandledActionRef.current.t < 5000) {
        console.log(`[Kiosk] Ignoring repeated action ${actionType} (already handled)`);
        return;
      }
      lastHandledActionRef.current = { key, t: nowTs };
    }

    if (action && typeof action === "object") {
      setBackendAction(action);
    }

    const actionTurnId = action?.turn_id || kioskWS.currentTurnId || `action_${Date.now()}`;
    activeActionReplyIdRef.current = actionTurnId;

    if (action?.speech_id && action?.awaiting_speech_done) {
      speechController.beginReply(actionTurnId, { source: "action", speechId: action.speech_id });
      pendingSpeechAckRef.current = action.speech_id;
      clearTimeout(speechAckTimerRef.current);
      // Safety watchdog: 15s last resort
      speechAckTimerRef.current = setTimeout(() => {
        if (pendingSpeechAckRef.current === action.speech_id) {
          console.log("[Kiosk] Safety watchdog fallback for speech_id:", action.speech_id);
          const sid = action.speech_id;
          pendingSpeechAckRef.current = null;
          kioskWS.sendSpeechDone(sid);
        }
      }, 15000);
    }

    const isPassedName =
      KioskStepCache.hasPassedStep(KIOSK_STEPS.NAME_SET) ||
      latestRef.current.onboardingStep >= 2 ||
      nameSubmittedRef.current;

    switch (actionType) {
      case "SHOW_GREETING": {
        if (kioskModeRef.current === "IDLE") {
          console.log("[Kiosk] Dropping SHOW_GREETING in IDLE mode");
          break;
        }
        if (greetingDoneRef.current) {
          console.log("[Kiosk] Skipping duplicate SHOW_GREETING for this session.");
          break;
        }
        // Welcome Screen: Avatar speaks greeting, await SPEECH_DONE
        const snapshot = {
          greetingDone: greetingDoneRef.current,
          nameDone: nameDoneRef.current,
          introPlayed: introPlayedRef.current,
          isPassedName,
          cacheStep: KioskStepCache.getCurrentStep(),
          onboardingStep: latestRef.current.onboardingStep,
        };
        // SHOW_GREETING must never be skipped right after reset. If a skip is ever legitimate, do NOT send SPEECH_DONE from the skip branch.
        if (greetingDoneRef.current && (KioskStepCache.hasPassedStep(KIOSK_STEPS.GREETED) && isPassedName)) {
          console.log("[Kiosk] Skipping SHOW_GREETING: greeting or name already completed.", JSON.stringify(snapshot));
          break;
        }
        greetingDoneRef.current = true;
        introPlayedRef.current = true;
        setOnboardingOpen(false);
        trace("showDetail=false", { caller: "SHOW_GREETING" });
        setShowDetail(false);
        setCartModalOpen(false);
        setQrModalOpen(false);
        setGoodbyeOpen(false);
        const speechId = action?.speech_id || 1;
        kioskWS.currentSpeechId = speechId;
        const greetingText = action?.message || action?.prompt || action?.text || "Hi! I'm Greeny. Welcome to Green Fibre.";
        setCaption(greetingText);

        const replyId = `greeting_${Date.now()}`;
        speechController.beginReply(replyId, { source: "SHOW_GREETING", speechId });
        speechController.appendSentence(replyId, greetingText, { speechId, turnId: replyId });
        speechController.endReply(replyId);
        break;
      }

      case "ASK_NAME": {
        if (kioskModeRef.current === "IDLE") {
          console.log("[Kiosk] Dropping ASK_NAME in IDLE mode");
          break;
        }
        // Name Input Modal / Tab
        const snapshot = {
          isPassedName,
          nameDone: nameDoneRef.current,
          cacheStep: KioskStepCache.getCurrentStep(),
          cachedName: KioskStepCache.getCustomerName(),
          onboardingStep: latestRef.current.onboardingStep,
        };
        if (isPassedName) {
          console.log("[Kiosk] Skipping ASK_NAME: name step already completed. Bypassing prompt.", JSON.stringify(snapshot));
          const cachedName = KioskStepCache.getCustomerName() || latestRef.current.name;
          if (cachedName) {
            kioskWS.sendSetName(cachedName);
          } else {
            kioskWS.sendSkipName();
          }
          setOnboardingStep(2);
          setOnboardingOpen(true);
          break;
        }
        nameDoneRef.current = true;
        setOnboardingStep(1);
        setOnboardingOpen(true);
        trace("showDetail=false", { caller: "ASK_NAME" });
        setShowDetail(false);
        setCartModalOpen(false);
        setQrModalOpen(false);
        if (action?.buttons && Array.isArray(action.buttons)) {
          setActionButtons(action.buttons);
        }
        const promptText = action?.prompt || action?.message || action?.text;
        if (promptText && typeof promptText === "string" && promptText.trim().length > 0) {
          const cleanPrompt = promptText.trim();
          setCaption(cleanPrompt);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "ask_name";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanPrompt, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "SHOW_CATEGORIES": {
        clearTimeout(categoriesFallbackTimerRef.current);
        KioskStepCache.setCurrentStep(KIOSK_STEPS.BROWSING);
        openCategoryPicker("SHOW_CATEGORIES");
        trace("showDetail=false", { caller: "SHOW_CATEGORIES" });
        setShowDetail(false);
        setCartModalOpen(false);
        setQrModalOpen(false);
        setLiveTurnProducts([]);
        setFiltersApplied(null);
        setHighlightSku(null);
        if (action?.buttons && Array.isArray(action.buttons)) {
          setActionButtons(action.buttons);
        }
        const msg = action?.message || action?.text;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          const isOldDup = /which category would you like|please select a category to view/i.test(cleanMsg);
          if (!isOldDup) {
            setCaption(cleanMsg);
            const activeTid = actionTurnId || kioskWS.currentTurnId || "show_categories";
            if (speechController.getEnqueuedCount(activeTid) === 0) {
              speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
              speechController.endReply(activeTid);
            }
          }
        }
        break;
      }

      case "SHOW_CATEGORY": {
        if (action?.category) {
          latestRef.current.selectCategory?.(action.category);
        }
        break;
      }

      case "SHOW_PRODUCTS": {
        const wasInDetail =
          latestRef.current.showDetail ||
          productDetailOpenedRef.current ||
          isBackFromDetailPendingRef.current ||
          justReturnedFromDetailRef.current;

        KioskStepCache.setCurrentStep(KIOSK_STEPS.BROWSING);
        markOnboardingDone("SHOW_PRODUCTS");
        setOnboardingOpen(false);
        trace("showDetail=false", { caller: "SHOW_PRODUCTS" });
        setShowDetail(false);
        productDetailOpenedRef.current = false;
        setCartModalOpen(false);
        setQrModalOpen(false);

        if (wasInDetail) {
          // Returning from detail: restore pre-detail category, never overwrite with backend's stale subset
          const targetCat = categoryBeforeDetailRef.current || "all";
          setCategory(targetCat);
          setLiveTurnProducts([]);
          setFiltersApplied(null);
          setHighlightSku(null);

          const naturalLine = getCategoryNaturalLine(targetCat);
          setCaption(naturalLine);

          if (!isBackFromDetailPendingRef.current) {
            triggerReturnFromDetail(actionTurnId);
          }
        } else {
          let resolvedCat = null;
          if (action?.category_id || action?.category) {
            resolvedCat = normalizeCategory(action.category_id || action.category);
          } else if (action?.products?.[0]?.category) {
            resolvedCat = normalizeCategory(action.products[0].category);
          }

          if (resolvedCat) {
            categoryBeforeDetailRef.current = resolvedCat;
            setCategory(resolvedCat);
          }

          if (action?.products && Array.isArray(action.products) && action.products.length > 0) {
            const normTurnProducts = action.products.map(normalizeBackendProduct).filter(Boolean);
            setLiveTurnProducts(normTurnProducts);
          } else {
            setLiveTurnProducts([]);
          }

          if (action?.filters_applied) {
            setFiltersApplied(action.filters_applied);
          } else {
            setFiltersApplied(null);
          }

          if (action?.highlight_sku) {
            setHighlightSku(action.highlight_sku);
          } else {
            setHighlightSku(null);
          }

          const msg = action?.message || action?.text;
          if (msg && typeof msg === "string" && msg.trim().length > 0) {
            const cleanMsg = msg.trim();
            setCaption(cleanMsg);
            const activeTid = actionTurnId || kioskWS.currentTurnId || "show_products";
            if (speechController.getEnqueuedCount(activeTid) === 0) {
              speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
              speechController.endReply(activeTid);
            }
          }
        }

        if (action?.buttons && Array.isArray(action.buttons)) {
          setActionButtons(action.buttons);
        }
        break;
      }

      case "SHOW_PRODUCT_CARD":
      case "SHOW_PRODUCT": {
        const prodData = action?.product || (action?.products && action.products[0]);
        const currentCatalog = latestRef.current.backendCatalog || [];
        const target =
          (prodData && findMatchingLocalProduct(prodData, currentCatalog)) ||
          (action?.sku && findMatchingLocalProduct(action.sku, currentCatalog)) ||
          (prodData && normalizeBackendProduct(prodData)) ||
          null;

        if (action?.buttons && Array.isArray(action.buttons)) {
          setActionButtons(action.buttons);
        } else {
          setActionButtons(["Next", "Cheaper", "Compare", "I'll take it"]);
        }

        if (target) {
          selectProductRef.current?.(target, { fromServer: true, actionTurnId, speechId: action?.speech_id });
        }
        break;
      }

      case "CONFIRM_BUY": {
        const currentCatalog = latestRef.current.backendCatalog || [];
        const target =
          findMatchingLocalProduct(action?.sku, currentCatalog) ||
          findMatchingLocalProduct(action?.product, currentCatalog) ||
          latestRef.current.product ||
          currentCatalog[0] ||
          null;

        if (target) {
          const targetItem = {
            id: target.id || target.sku,
            sku: target.sku || target.id,
            name: target.name,
            price: target.salePrice || target.price || 0,
            quantity: 1,
            selectedColor: "Natural Olive",
            image: target.image,
            shape: target.shape,
            isPairUp: false,
          };
          setCartItems((prev) => {
            if (prev.some((i) => i.id === targetItem.id || i.sku === targetItem.sku)) return prev;
            return [...prev, targetItem];
          });

          // Generate 3-4 suggestions for the popup
          const suggs = getPairUpSuggestions(target, cartItemsRef.current, currentCatalog);
          setPairUpProducts(suggs);
        }

        setPairUpModalOpen(true);
        setCartModalOpen(false);
        const msg = action?.message;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          setCaption(cleanMsg);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "confirm_buy";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "CHECKOUT_HANDOFF": {
        setCartModalOpen(false);
        setQrModalOpen(true);
        const currentCatalog = latestRef.current.backendCatalog || [];
        const target =
          findMatchingLocalProduct(action?.sku, currentCatalog) ||
          findMatchingLocalProduct(action?.product, currentCatalog) ||
          latestRef.current.product ||
          currentCatalog[0] ||
          null;

        setQrModalData({
          sku: action?.sku || target?.sku,
          product_url: action?.product_url,
          product: target,
        });
        const msg = action?.message;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          setCaption(cleanMsg);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "checkout_handoff";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      case "GOODBYE": {
        setCartModalOpen(false);
        setQrModalOpen(false);
        setGoodbyeOpen(true);
        setGoodbyeData({
          message: action?.message || "Thank you, have a great day!",
          autoResetAfterMs: action?.auto_reset_after_ms || 4000,
        });
        const msg = action?.message || "Thank you, have a great day!";
        const cleanMsg = msg.trim();
        setCaption(cleanMsg);
        const activeTid = actionTurnId || kioskWS.currentTurnId || "goodbye";
        if (speechController.getEnqueuedCount(activeTid) === 0) {
          speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
          speechController.endReply(activeTid);
        }
        break;
      }

      case "REQUEST_HUMAN": {
        const msg = action?.message || "A store associate is on the way.";
        const cleanMsg = msg.trim();
        setStaffBanner(cleanMsg);
        setCaption(cleanMsg);
        const activeTid = actionTurnId || kioskWS.currentTurnId || "request_human";
        if (speechController.getEnqueuedCount(activeTid) === 0) {
          speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
          speechController.endReply(activeTid);
        }
        break;
      }

      case "SHOW_HINT": {
        setHintBubble(action?.hint || action?.message);
        break;
      }

      case "SHOW_ALL": {
        if (latestRef.current.onboardingStep !== 2) {
          setOnboardingOpen(false);
        }
        trace("showDetail=false", { caller: "SHOW_ALL" });
        setShowDetail(false);
        productDetailOpenedRef.current = false;
        categoryBeforeDetailRef.current = "all";
        setCategory("all");
        setLiveTurnProducts([]);
        setFiltersApplied(null);
        setHighlightSku(null);
        setCaption("Here are all our products.");
        break;
      }

      case "NAVIGATE_BACK": {
        const wasInDetail =
          latestRef.current.showDetail ||
          productDetailOpenedRef.current ||
          isBackFromDetailPendingRef.current ||
          justReturnedFromDetailRef.current;

        trace("showDetail=false", { caller: "NAVIGATE_BACK" });
        setShowDetail(false);
        productDetailOpenedRef.current = false;
        setLiveTurnProducts([]);
        setFiltersApplied(null);
        setHighlightSku(null);

        if (wasInDetail) {
          const targetCat = categoryBeforeDetailRef.current || "all";
          setCategory(targetCat);
          const naturalLine = getCategoryNaturalLine(targetCat);
          setCaption(naturalLine);
          if (!isBackFromDetailPendingRef.current) {
            triggerReturnFromDetail(actionTurnId);
          }
        }
        break;
      }

      case "RESTART": {
        latestRef.current.reset?.();
        break;
      }

      case "SHOW_RECOMMENDATION": {
        if (replayingRef.current) break;
        if (kioskModeRef.current === "IDLE") break;
        setRecommendationOpen(true);
        setRecommendationData(action);
        console.log("[Reco] shown");
        const msg = action?.message;
        if (msg && typeof msg === "string" && msg.trim().length > 0) {
          const cleanMsg = msg.trim();
          setCaption(cleanMsg);
          const activeTid = actionTurnId || kioskWS.currentTurnId || "show_recommendation";
          if (speechController.getEnqueuedCount(activeTid) === 0) {
            speechController.appendSentence(activeTid, cleanMsg, { turnId: activeTid, speechId: action?.speech_id });
            speechController.endReply(activeTid);
          }
        }
        break;
      }

      default:
        if (actionType) {
          console.log("[Kiosk] Action processed:", actionType);
        }
    }
  }, [say]);

  // Connect WebSocket listeners (reads handlers via latestRef to prevent stale closures)
  const lastSpokenTurnIdRef = useRef(null);

  useEffect(() => {
    const unsubAction = kioskWS.on("action", (actionData) => {
      if (replayingRef.current) {
        console.log("[Restore] replay: ignored action");
        return;
      }
      if (kioskModeRef.current === "IDLE") {
        console.log("[Kiosk] Dropping action in IDLE mode");
        return;
      }
      handleServerAction(actionData);
    });

    const unsubHint = kioskWS.on("hint", (hintData) => {
      if (replayingRef.current) return;
      setHintBubble(hintData);
    });

    // Streamed sentence listener: start TTS immediately for each completed sentence
    const unsubSentence = kioskWS.on("sentence", (sentence, turnId) => {
      if (replayingRef.current) {
        console.log("[Restore] replay: ignored sentence");
        return;
      }
      if (kioskModeRef.current === "IDLE") {
        console.log("[Kiosk] dropped sentence in IDLE");
        return;
      }
      const activeTurnKey = activeActionReplyIdRef.current || turnId || kioskWS.currentTurnId || "turn_default";
      clearTimeout(aiTurnTimeoutRef.current);

      if (timedOutTurnIdRef.current && (activeTurnKey === timedOutTurnIdRef.current || turnId === timedOutTurnIdRef.current)) {
        console.log(`[Kiosk] Dropping late streamed sentence for timed-out turn=${activeTurnKey}`);
        return;
      }

      if (isBackFromDetailPendingRef.current || (backTurnIdRef.current && (turnId === backTurnIdRef.current || activeTurnKey === backTurnIdRef.current))) {
        console.log(`[Kiosk] Dropping streamed sentence for back_from_detail turn=${activeTurnKey}`);
        return;
      }
      turnsWithSentencesRef.current.add(activeTurnKey);
      console.log(`[Renderer] SENTENCE received ts=${new Date().toISOString()} turn=${activeTurnKey} text="${sentence.slice(0, 50)}"`);
      setConv(S.SPEAKING);

      // Part 1 Req 7: Safety net checking all numbers and facts against context product(s) only
      const activeContextProducts = latestRef.current.product
        ? [latestRef.current.product]
        : (latestRef.current.liveTurnProducts && latestRef.current.liveTurnProducts.length > 0)
          ? latestRef.current.liveTurnProducts
          : [];
      const groundingCheck = verifyReplyGrounding(sentence, activeContextProducts);
      const safeSentence = groundingCheck.text;

      const textToSpeak = sanitizeForMultipleFaces(safeSentence);
      const userFinalTs = kioskWS.getTurnUserFinalTs(activeTurnKey);
      const firstSentenceReceivedTs = typeof window !== "undefined" ? performance.now() : Date.now();
      speechController.appendSentence(activeTurnKey, textToSpeak, {
        turnId: activeTurnKey,
        userFinalTs,
        firstSentenceReceivedTs,
      });
    });

    const unsubDone = kioskWS.on("done", (doneData) => {
      clearTimeout(aiTurnTimeoutRef.current);
      const turnId = activeActionReplyIdRef.current || doneData?.turnId || doneData?.meta?.turn_id || kioskWS.currentTurnId || "turn_default";

      if (timedOutTurnIdRef.current && (turnId === timedOutTurnIdRef.current || doneData?.turnId === timedOutTurnIdRef.current)) {
        console.log(`[Kiosk] Dropping late done reply for timed-out turn=${turnId}`);
        timedOutTurnIdRef.current = null;
        return;
      }

      if (replayingRef.current) {
        console.log("[Restore] replay: ignored done");
        return;
      }
      if (kioskModeRef.current === "IDLE") {
        console.log("[Kiosk] Dropping done in IDLE mode");
        return;
      }
      console.log(`[Renderer] DONE received ts=${new Date().toISOString()} reply="${(doneData?.reply || "").slice(0, 60)}"`);
      if (doneData?.action || doneData?.salesStage) {
        handleServerAction(doneData.action, doneData.salesStage);
      }
      if (isBackFromDetailPendingRef.current || (backTurnIdRef.current && turnId === backTurnIdRef.current)) {
        console.log(`[Kiosk] unsubDone: holding for returnFromDetail turn=${turnId}`);
        return;
      }
      speechController.endReply(turnId);

      if (doneData?.reply && typeof doneData.reply === "string" && doneData.reply.trim().length > 0) {
        // Part 1 Req 7: Safety net checking all numbers and facts in done reply against context product(s) only
        const activeContextProducts = latestRef.current.product
          ? [latestRef.current.product]
          : (latestRef.current.liveTurnProducts && latestRef.current.liveTurnProducts.length > 0)
            ? latestRef.current.liveTurnProducts
            : [];
        const groundingCheck = verifyReplyGrounding(doneData.reply.trim(), activeContextProducts);
        const replyText = sanitizeForMultipleFaces(groundingCheck.text);
        setCaption(replyText);

        const enqueuedCount = speechController.getEnqueuedCount(turnId);
        if (enqueuedCount === 0) {
          console.log(`[Kiosk] Fallback: No sentence enqueued for turn=${turnId}. Calling speechController.appendSentence.`);
          speechController.appendSentence(turnId, replyText, { turnId });
          speechController.endReply(turnId);
        } else {
          console.log(`[Kiosk] Streamed sentences already enqueued (${enqueuedCount}) for turn=${turnId}. Skipping fallback.`);
        }
      }
    });

    const unsubPingSilence = kioskWS.on("ping_silence", (msg) => {
      trace("backend_frame", { type: "ping_silence", data: msg });
      setHintBubble(typeof msg === "string" ? msg : "Still there? Tap or speak to continue.");
    });

    const unsubAutoReset = kioskWS.on("auto_reset", (msg) => {
      trace("backend_frame", { type: "auto_reset", data: msg });
      if (kioskModeRef.current === "IDLE" && !onboardingOpen && !nameRef.current && !KioskStepCache.getCustomerName()) {
        latestRef.current.resetSession?.("auto_reset");
      }
    });

    const unsubCancelled = kioskWS.on("cancelled", (data) => {
      trace("backend_frame", { type: "cancelled", data });
    });

    const unsubError = kioskWS.on("error", (data) => {
      clearTimeout(aiTurnTimeoutRef.current);
      trace("backend_frame", { type: "error", data });
    });

    return () => {
      unsubAction();
      unsubHint();
      unsubSentence();
      unsubDone();
      unsubPingSilence();
      unsubAutoReset();
      unsubCancelled();
      unsubError();
    };
  }, [handleServerAction, say, onboardingOpen]);


  // ── Core: Send transcript to AI backend ───────────────────────────────────
  const sendTranscript = useCallback(async (text, signalsSnap, timing = {}) => {
    if (isSendingRef.current) {
      console.log("[Kiosk] Dropping duplicate in-flight chat request:", text);
      return;
    }

    const trimmed = String(text ?? "").trim();
    if (!trimmed) return;

    // ── Spoken name change request ("change my name", "edit my name", "not me", "wrong name", "not you") ──
    if (
      !latestRef.current.identityPrompt?.active &&
      /^(?:not me|change my name|edit my name|wrong name|not you|change name|edit name)$/i.test(trimmed)
    ) {
      console.log("[Kiosk] Spoken shortcut: open name modal for name change:", trimmed);
      setOnboardingStep(1);
      setOnboardingOpen(true);
      const askNameLine = "What name should I call you?";
      setCaption(askNameLine);
      const askTid = `ask_name_${Date.now()}`;
      speechController.beginReply(askTid, { source: "ask_name" });
      speechController.appendSentence(askTid, askNameLine, { turnId: askTid });
      speechController.endReply(askTid);
      return;
    }

    // ── Explicit name introduction ("my name is <X>", "call me <X>", etc.) anytime ──
    const explicitNameMatch = trimmed.match(/^(?:my name is|call me|i am|i'm|this is|myself)\s+([a-zA-Z\s]+)$/i);
    if (explicitNameMatch && !latestRef.current.identityPrompt?.active) {
      const candidate = explicitNameMatch[1].trim();
      const validation = validateCustomerName(candidate);
      if (validation.valid) {
        console.log("[Kiosk] Spoken name explicitly provided:", validation.name);
        submitName(validation.name);
        return;
      }
    }

    // ── Spoken Name & Skip handling during ASK_NAME step ──
    const currentStep = KioskStepCache.getCurrentStep();
    const hasNameAlready = Boolean(KioskStepCache.getCustomerName() || nameRef.current);
    const isAwaitingName =
      (latestRef.current.onboardingOpen && latestRef.current.onboardingStep === 1) ||
      (!nameSubmittedRef.current && !hasNameAlready && currentStep < KIOSK_STEPS.NAME_SET);

    if (isAwaitingName) {
      if (/^(?:skip|skip name|skip for now|no thanks|later|pass|never mind|no name|just browse)$/i.test(trimmed)) {
        console.log("[Kiosk] Spoken skip name detected:", trimmed);
        skipName();
        return;
      }
      let candidate = trimmed
        .replace(/^(?:my name is|i am|i'm|this is|call me|myself|it's|it is)\s+/i, "")
        .replace(/[.,!?]/g, "")
        .trim();

      const validation = validateCustomerName(candidate);
      if (validation.valid) {
        console.log("[Kiosk] Spoken name detected in awaiting state:", validation.name);
        submitName(validation.name);
        return;
      }
    }

    // ── Spoken answers during identity verification (Step 3) ──
    if (latestRef.current.identityPrompt?.active) {
      if (/^(?:yes|yeah|yep|correct|that's me|i am|right|sure|it is|it's me)\b/i.test(trimmed)) {
        console.log("[Presence] Voice affirmative verification received:", trimmed);
        latestRef.current.confirmIdentity?.();
        return;
      }
      if (/^(?:no|nope|nah|not me|i am not|i'm not|someone new|different person|new customer|new)\b/i.test(trimmed)) {
        console.log("[Presence] Voice rejection / different person received:", trimmed);
        latestRef.current.resetSession?.(`different_person (voice_rejection="${trimmed}")`);
        return;
      }
    }

    // ── Spoken restart / identity override intent (Step 7) ──
    const activeName = latestRef.current.name || KioskStepCache.getCustomerName() || "";
    const escapedName = activeName ? activeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
    const notNamePattern = escapedName ? `(?:i am not|i'm not|not)\\s+${escapedName}|` : "";
    const isOverrideIntent = new RegExp(`^(?:${notNamePattern}i am someone else|i'm someone else|someone else|someone new|different person|new customer|start over|restart|reset|that's not me|not me)$`, "i").test(trimmed);

    if (isOverrideIntent) {
      console.log("[Kiosk] Spoken identity override detected:", trimmed);
      latestRef.current.resetSession?.("user_speech");
      return;
    }

    // ── Spoken answers during Pair-Up Prompt ──
    if (latestRef.current.pairUpPromptOpen) {
      const clean = trimmed
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const isYes = /^(?:yes|sure|okay|ok|show\s+me|haan|ha|dikhao|ji)\b/i.test(clean);
      const isNo = /^(?:no|nope|skip|not\s+now|nahi|nahin|no\s+thanks)\b/i.test(clean);

      if (isYes) {
        console.log("[PairUp] Spoken YES received:", trimmed);
        latestRef.current.handlePairUpYes?.();
        return;
      }
      if (isNo) {
        console.log("[PairUp] Spoken NO received:", trimmed);
        latestRef.current.handlePairUpNo?.();
        return;
      }

      // Ignore unrelated interruptions while prompt is active, keep waiting without guessing
      console.log("[PairUp] Unmatched voice input while prompt active, ignoring:", trimmed);
      return;
    }

    // ── Spoken recommendations intent ──
    if (latestRef.current.cartModalOpen || latestRef.current.recommendationOpen) {
      if (/^(?:yes|yeah|sure|show me|show suggestions|show me suggestions|suggestions|recommend|recommendations)\b/i.test(trimmed)) {
        console.log("[Reco] voice shortcut: REQUEST_RECOMMENDATION");
        latestRef.current.requestRecommendation?.();
        return;
      }
      if (/^(?:add both|both|take both|add bundle|accept)\b/i.test(trimmed)) {
        console.log("[Reco] voice shortcut: ACCEPT_RECOMMENDATION");
        latestRef.current.acceptRecommendation?.();
        return;
      }
      if (/^(?:no|no thanks|nope|nah|not now|skip|decline)\b/i.test(trimmed)) {
        console.log("[Reco] voice shortcut: DECLINE_RECOMMENDATION");
        latestRef.current.declineRecommendation?.();
        return;
      }
    }

    // ── Spoken answers during Pair-Up Modal Sheet ──
    if (latestRef.current.pairUpModalOpen) {
      const pairList = latestRef.current.pairUpProducts || [];
      const clean = trimmed
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // 1. "first one", "add the first one", "add first", "the first"
      if (/(?:first one|the first one|add the first|add first|first item)\b/i.test(clean)) {
        if (pairList[0]) {
          console.log("[PairUpVoice] adding first item:", pairList[0].name);
          latestRef.current.handlePairUpAddProduct?.(pairList[0]);
          return;
        }
      }

      // 2. "second one", "add the second one", "add second", "the second"
      if (/(?:second one|the second one|add the second|add second|second item)\b/i.test(clean)) {
        if (pairList[1]) {
          console.log("[PairUpVoice] adding second item:", pairList[1].name);
          latestRef.current.handlePairUpAddProduct?.(pairList[1]);
          return;
        }
      }

      // 3. "third one", "add the third one", "add third", "the third"
      if (/(?:third one|the third one|add the third|add third|third item)\b/i.test(clean)) {
        if (pairList[2]) {
          console.log("[PairUpVoice] adding third item:", pairList[2].name);
          latestRef.current.handlePairUpAddProduct?.(pairList[2]);
          return;
        }
      }

      // 4. "no", "skip", "take me to cart", "proceed", "go to cart"
      if (/^(?:no|skip|no thanks|proceed|continue|take me to cart|go to cart|view cart)\b/i.test(clean)) {
        console.log("[PairUpVoice] proceed to cart:", clean);
        latestRef.current.handlePairUpProceed?.();
        return;
      }

      // 5. Generic "add it" / "add this" / "take it"
      if (/^(?:add it|add this|take it|add to cart|i will take it|i'll take it)$/i.test(clean)) {
        if (pairList.length === 1) {
          latestRef.current.handlePairUpAddProduct?.(pairList[0]);
          return;
        }
        if (pairList.length >= 2) {
          const p1 = cleanProductName(pairList[0]?.name || "item");
          const p2 = cleanProductName(pairList[1]?.name || "item");
          say(`Which one, the ${p1} or the ${p2}?`);
          return;
        }
      }

      // 6. Match specific product name in pairList: "add the mug", "i'll take the bowl", etc.
      const words = clean.split(/\s+/).filter((w) => w.length >= 3 && !["add", "the", "take", "and", "one", "for", "please"].includes(w));
      const matchedPair = pairList.find((p) => {
        const pName = (p.name || "").toLowerCase();
        return words.some((w) => pName.includes(w));
      });
      if (matchedPair) {
        console.log("[PairUpVoice] matched specific item:", matchedPair.name);
        latestRef.current.handlePairUpAddProduct?.(matchedPair);
        return;
      }
    }

    // ── Spoken add-to-cart intent while browsing ──
    if (/^(?:add to cart|add it|add this|add product|i'll take it|i will take it|buy this)$/i.test(trimmed)) {
      if (latestRef.current.showDetail && latestRef.current.product) {
        console.log("[CartVoice] Adding currently open product to cart:", latestRef.current.product.name);
        latestRef.current.handleAddToCart?.({ product: latestRef.current.product });
        return;
      }
      say("What would you like me to add to your cart?");
      return;
    }

    stopSpeechForUserAction("user_voice_turn");

    // ── Voice shortcut: "go back" / "back" / "back to products" / "back to all products" ──
    if (/^(?:go back|back|back to products|back to all products|back to catalog|previous)$/i.test(trimmed)) {
      if (latestRef.current.showDetail || productDetailOpenedRef.current) {
        console.log("[Kiosk] voice shortcut: navigateBack from detail");
        navigateBack();
        return;
      }
    }

    // ── "Show me more products" / "more products" / "browse all" ──
    if (/^(?:show (?:me )?more products|more products|browse all|show all|show everything|see more products|show more)$/i.test(trimmed)) {
      console.log("[Kiosk] voice shortcut: show me more products -> SHOW_PRODUCTS");
      markOnboardingDone("voice_more_products");
      showAll();
      kioskWS.sendWsAction({ action: "SHOW_PRODUCTS", category_id: "all" });
      return;
    }

    // ── Spoken purchase / checkout intent ──
    if (/^(?:buy|buy now|checkout|i'll take it|i want this|take it)$/i.test(trimmed)) {
      kioskWS.sendWsMessage("buy");
      return;
    }

    setConv(S.THINKING);
    const uTs = timing?.userFinalTs || (typeof window !== "undefined" ? performance.now() : Date.now());
    const sTs = timing?.sttFinalTs || Date.now();
    const wsSentTs = typeof window !== "undefined" ? performance.now() : Date.now();

    // Part 2: 4-second timeout watchdog for slow AI reply
    const sentTurnId = kioskWS.sendWsMessage(trimmed, {
      userFinalTs: uTs,
      stt_final_ts: sTs,
      client_sent_ts: wsSentTs,
    });
    activeActionReplyIdRef.current = sentTurnId;

    clearTimeout(aiTurnTimeoutRef.current);
    aiTurnTimeoutRef.current = setTimeout(() => {
      if (kioskModeRef.current !== "ENGAGED") return;
      if (convStateRef.current === S.THINKING) {
        console.warn(`[Kiosk] AI turn timed out (4000ms) for turn=${sentTurnId}. Speaking taking_longer fallback.`);
        timedOutTurnIdRef.current = sentTurnId;
        const fallback = getHonestFallback("taking_longer");
        setConv(S.SPEAKING);
        setCaption(fallback);
        const fbTurnId = `timeout_fb_${Date.now()}`;
        speechController.beginReply(fbTurnId, { source: "ai_timeout" });
        speechController.appendSentence(fbTurnId, fallback, { turnId: fbTurnId });
        speechController.endReply(fbTurnId);
      }
    }, 4000);

  }, [handleServerAction, say, setConv, skipName, stopSpeechForUserAction, submitName]);

  // ── End-of-turn finalization ──────────────────────────────────────────────
  const finaliseAndSend = useCallback((explicitText) => {
    clearTimeout(eotTimerRef.current);
    const userFinalTs = typeof window !== "undefined" ? performance.now() : Date.now();
    const sttFinalTs = Date.now();
    const text = (typeof explicitText === "string" ? explicitText : pendingTranscriptRef.current).trim();
    if (text) {
      setLastUserSpeech(text);
    }
    pendingTranscriptRef.current = "";
    setLiveTranscript("");

    if (!text) {
      if (convStateRef.current === S.LISTENING) {
        setConv(S.ATTENTIVE);
      }
      return;
    }

    failureCountRef.current = 0;
    sendTranscript(text, signals, { userFinalTs, sttFinalTs });
  }, [sendTranscript, setConv, signals]);

  const finaliseAndSendRef = useRef(finaliseAndSend);
  finaliseAndSendRef.current = finaliseAndSend;

  // Hypotheses from Deepgram
  const handleHypothesis = useCallback((text) => {
    resetHintIdleTimer();
    if (text) {
      setLiveTranscript(text);
      if (convStateRef.current !== S.LISTENING && convStateRef.current !== S.THINKING) {
        setConv(S.LISTENING);
      }
    }
  }, [setConv, resetHintIdleTimer]);

  // Final transcript from Deepgram
  const handleFinal = useCallback((text) => {
    if (isEchoOfAvatar(text)) return;
    const g = getGate();
    if (g.blocked && !g.bargeIn) return;
    clearTimeout(eotTimerRef.current);
    if (text && text.trim()) {
      finaliseAndSend(text.trim());
    }
  }, [getGate, isEchoOfAvatar, finaliseAndSend]);

  // ── Single continuous Deepgram Nova-3 STT ─────────────────────────────────
  const deepgram = useSpeech({
    mic: { subscribePcm: mic.subscribePcm, getRecent: mic.getRecent },
    isEngaged,
    onTranscript: handleFinal,
    onHypothesis: handleHypothesis,
    shouldDrop: isEchoOfAvatar,
    getGate,
  });

  // ── UI state + face/jaw barge-in ──────────────────────────────────────────
  useEffect(() => {
    if (!isEngaged) return;
    const gateBlocked = getGate().blocked;
    const talking = userSpeaking || (vadSpeech && !gateBlocked);
    setListening(talking && !isAvatarActive);

    if (talking) {
      clearTimeout(eotTimerRef.current);
      if (isAvatarActive) {
        const realUser = (userSpeaking || vadSpeech) && audioLevel > BARGE_MIN_LEVEL;
        if (realUser) {
          bargeUntilRef.current = Date.now() + 2500;
          interruptAvatar();
        }
      } else if (convStateRef.current !== S.LISTENING) {
        setConv(S.LISTENING);
      }
    } else if (convStateRef.current === S.LISTENING) {
      clearTimeout(eotTimerRef.current);
      const text = (pendingTranscriptRef.current || liveTranscript || "").trim();
      const isPunctEnd = /[.?!]\s*$/.test(text);
      const isTrailing = /[,;]\s*$|\b(?:and|or|but|because|with|ki|aur)\s*$/i.test(text);
      const waitMs = isTrailing ? 1200 : isPunctEnd ? 150 : speechConfig.endOfTurnSilenceMs;
      eotTimerRef.current = setTimeout(finaliseAndSend, waitMs);
    }
  }, [userSpeaking, vadSpeech, audioLevel, isEngaged, isAvatarActive, getGate, interruptAvatar, setConv, finaliseAndSend]);

  // ── Web Speech API — browser fallback (ONLY if Deepgram failed > 3s) ──────
  const deepgramFailedRef = useRef(false);
  const deepgramFailTimerRef = useRef(null);

  useEffect(() => {
    if (deepgram.status === "open") {
      clearTimeout(deepgramFailTimerRef.current);
      deepgramFailedRef.current = false;
    } else {
      clearTimeout(deepgramFailTimerRef.current);
      deepgramFailTimerRef.current = setTimeout(() => {
        if (deepgram.status !== "open") {
          deepgramFailedRef.current = true;
          console.warn("[Kiosk] Deepgram unavailable for >3s, WebSpeech fallback active");
        }
      }, 3000);
    }
    return () => clearTimeout(deepgramFailTimerRef.current);
  }, [deepgram.status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    let stopped = false;
    let restartTimer = null;
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN";
    rec.maxAlternatives = 1;

    const webSpeechTimerRef = { current: null };

    rec.onresult = (event) => {
      // Discard Web Speech if Deepgram is operational to prevent double-send race condition
      if (!deepgramFailedRef.current) return;

      const now = Date.now();
      if (
        avatarActiveNowRef.current ||
        isAvatarActiveRef.current ||
        speaking ||
        convStateRef.current === S.SPEAKING ||
        now - avatarEndedAtRef.current < COOLDOWN_MS
      ) {
        pendingTranscriptRef.current = "";
        setLiveTranscript("");
        return;
      }

      let interim = "";
      let hasFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) {
          pendingTranscriptRef.current += " " + t;
          hasFinal = true;
        } else {
          interim = t;
        }
      }

      const fullLive = (pendingTranscriptRef.current + " " + interim).trim();
      setLiveTranscript(fullLive);

      if (fullLive.length > 0) {
        if (convStateRef.current !== S.LISTENING && convStateRef.current !== S.THINKING) {
          setConv(S.LISTENING);
        }
        clearTimeout(webSpeechTimerRef.current);
        const waitMs = hasFinal ? 400 : 900;
        webSpeechTimerRef.current = setTimeout(() => {
          const toSend = pendingTranscriptRef.current.trim() || fullLive;
          if (toSend && convStateRef.current !== S.THINKING) {
            finaliseAndSendRef.current?.(toSend);
          }
        }, waitMs);
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") stopped = true;
    };

    rec.onend = () => {
      clearTimeout(webSpeechTimerRef.current);
      if (pendingTranscriptRef.current.trim() && convStateRef.current !== S.THINKING) {
        finaliseAndSendRef.current?.(pendingTranscriptRef.current.trim());
      }
      if (!stopped) {
        restartTimer = setTimeout(() => {
          if (!stopped) {
            try { rec.start(); } catch (_) { }
          }
        }, 150);
      }
    };

    try { rec.start(); } catch (_) { }

    return () => {
      stopped = true;
      clearTimeout(restartTimer);
      clearTimeout(webSpeechTimerRef.current);
      try { rec.stop(); } catch (_) { }
    };
  }, [isEngaged, setConv]);

  // ── Avatar speaking → update conv state ──────────────────────────────────
  const handleSpeakingChange = useCallback((isSpeaking) => {
    resetHintIdleTimer();
    setSpeaking(isSpeaking);
    if (!isSpeaking) {
      setCaption("");
      if (convStateRef.current === S.SPEAKING) {
        setConv(S.ATTENTIVE);
      }
    }
  }, [setConv, resetHintIdleTimer, setCaption]);


  // ── Attentive state: face present but not speaking ────────────────────────
  useEffect(() => {
    if (!isEngaged) return;
    if (face.present && !userSpeaking && convStateRef.current === S.IDLE) {
      setConv(S.ATTENTIVE);
    }
  }, [face.present, isEngaged, userSpeaking, setConv]);

  // ── Categories & Products Memos ──────────────────────────────────────────
  const categories = useMemo(() => {
    if (backendAction?.categories && Array.isArray(backendAction.categories) && backendAction.categories.length > 0) {
      return [
        { id: "all", label: "All Products", name: "All Products" },
        ...backendAction.categories.map((c) => ({
          id: c.id,
          label: c.name || c.label || c.id,
          name: c.name || c.label || c.id,
        })),
      ];
    }
    const catMap = new Map();
    catMap.set("all", { id: "all", label: "All Products", name: "All Products" });
    const list = backendCatalog;
    list.forEach((p) => {
      const catName = p.category;
      if (catName) {
        const clean = normalizeCategory(catName);
        if (!catMap.has(clean)) {
          catMap.set(clean, {
            id: clean,
            label: catName,
            name: catName,
          });
        }
      }
    });
    return Array.from(catMap.values());
  }, [backendAction, backendCatalog]);

  // ── Natural category phrase mapper ─────────────────────────────────────────
  const getCategoryNaturalLine = useCallback((id, name) => {
    const cl = ((name || id || "") + "").toLowerCase();
    if (cl.includes("bottle") || cl.includes("tumbler")) return "Here are our bottles.";
    if (cl.includes("gift") || cl.includes("hamper")) return "Here are our gifting picks.";
    if (cl.includes("drinkware") || cl.includes("mug") || cl.includes("cup")) return "Here are our drinkware picks.";
    if (cl.includes("kitchen") || cl.includes("dining") || cl.includes("casserole") || cl.includes("bowl")) return "Here are our kitchen and dining essentials.";
    if (cl.includes("planter")) return "Here are our planters.";
    if (cl.includes("tableware") || cl.includes("plate")) return "Here are our tableware pieces.";
    if (cl.includes("storage") || cl.includes("canister")) return "Here are our storage canisters.";
    if (cl.includes("office") || cl.includes("stationery") || cl.includes("desk")) return "Here are our desk essentials.";
    return "Here are all our products.";
  }, []);

  // ── Flow Actions ──────────────────────────────────────────────────────────
  const selectCategory = useCallback((cat) => {
    cancelPendingReturnFromDetail("user_tap_category");
    productDetailOpenedRef.current = false;
    stopSpeechForUserAction("user_tap_category");
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    resetHintIdleTimer();
    markOnboardingDone("selectCategory");

    const rawId = typeof cat === "string" ? cat : (cat?.id || "all");
    const cleanId = normalizeCategory(rawId);
    const catObj = categories.find((c) => c.id === cleanId || c.id === rawId);
    const catName =
      typeof cat === "object" && (cat?.label || cat?.name)
        ? (cat?.label || cat?.name)
        : (catObj?.label || catObj?.name || cleanId.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase()));

    categoryBeforeDetailRef.current = cleanId;
    setCategory(cleanId);
    trace("showDetail=false", { caller: "selectCategory" });
    setShowDetail(false);
    setOnboardingOpen(false);
    setLiveTurnProducts([]);
    setFiltersApplied(null);
    setHighlightSku(null);

    // Immediately update avatar caption to reflect selected category
    const catCaption = getCategoryNaturalLine(cleanId, catName);
    setCaption(catCaption);
    console.log(`[DebugTiming] selectCategory click: id=${cleanId} at=${Math.round(typeof window !== "undefined" ? performance.now() : Date.now())}`);

    const catProds = (backendCatalog || []).filter((p) => {
      const pCat = normalizeCategory(p.category || "");
      return cleanId === "all" || pCat === cleanId;
    });

    kioskWS.sendSelectCategory({
      category_id: cleanId,
      category_name: catName,
    });
    kioskWS.sendScreenChanged({
      type: "list",
      category: cleanId,
      sku: null,
      skus: catProds.map((p) => p.sku || p.id).filter(Boolean),
    });
  }, [categories, backendCatalog, presence, stopSpeechForUserAction, cancelPendingReturnFromDetail, markOnboardingDone, resetHintIdleTimer, getCategoryNaturalLine, setCaption]);

  const selectProduct = useCallback((p, options = {}) => {
    cancelPendingReturnFromDetail("select_product");

    // Remember category before entering detail (only if not already in detail)
    if (!latestRef.current.showDetail && !productDetailOpenedRef.current) {
      categoryBeforeDetailRef.current = latestRef.current.category || "all";
    }

    productDetailOpenedRef.current = true;
    justReturnedFromDetailRef.current = false;
    stopSpeechForUserAction("select_product");
    speechController.cancelAll("select_product");
    lastInputAtRef.current = Date.now();
    if (kioskModeRef.current === "IDLE") {
      pendingTappedProductRef.current = p;
    }
    presence.triggerTouchEngaged();
    resetHintIdleTimer();
    markOnboardingDone("selectProduct");

    // Look up the full product from backendCatalog to ensure verified pricing and fields
    const currentCatalog = latestRef.current.backendCatalog || backendCatalog || [];
    const fullProd = (currentCatalog || []).find(
      (item) =>
        (p?.sku && (item.sku === p.sku || item.id === p.sku)) ||
        (p?.id && (item.id === p.id || item.sku === p.id))
    ) || (typeof p === "object" ? p : findMatchingLocalProduct(p, currentCatalog));

    if (!fullProd) return;

    preloadProductDetailPhotos(fullProd);

    const sku = fullProd?.sku || fullProd?.id || p?.sku || p?.id;
    const prodId = fullProd?.id || fullProd?.sku || p?.id || p?.sku;
    setProductId(prodId);
    setShowDetail(true);
    setOnboardingOpen(false);
    setCartModalOpen(false);
    setQrModalOpen(false);

    setBackendCatalog((prev) => {
      if (prev.some((item) => item.id === prodId || item.sku === sku)) return prev;
      return [fullProd, ...prev];
    });

    // Opening a product must ONLY set selected product id/view; it must not change list, category or search state

    KioskStepCache.setSelectedProduct(fullProd);
    KioskStepCache.setCurrentStep(KIOSK_STEPS.PRODUCT_SELECTED);

    // Track single trigger for this product open
    lastProductSpokenRef.current = sku;

    // Immediately update avatar caption and speech to reflect selected product
    const speech = buildProductSpeech(fullProd, { customerName: nameRef.current });
    setCaption(speech.chunks[0] || speech.fullText);
    const activeTid = options.actionTurnId || `prod_${sku}_${Date.now()}`;
    speechController.beginReply(activeTid, { source: "select_product" });
    for (const chunk of speech.chunks) {
      speechController.appendSentence(activeTid, chunk, { turnId: activeTid, speechId: options.speechId });
    }
    speechController.endReply(activeTid);
    console.log(`[DebugTiming] selectProduct: sku=${sku} fromServer=${Boolean(options.fromServer)}`);

    if (!options.fromServer) {
      kioskWS.sendSelectProduct(fullProd);
      kioskWS.sendScreenChanged({
        type: "product",
        category: fullProd?.category || null,
        sku,
        skus: sku ? [sku] : [],
      });
    }

    // Prefetch pair-up suggestions in background
    const pid = prodId;
    if (pid && !pairupCacheRef.current.has(pid)) {
      const cartSkus = cartItemsRef.current.map((i) => i.sku || i.id).join(",");
      fetch(`${BACKEND_URL}/pairups?product_id=${encodeURIComponent(pid)}&cart=${encodeURIComponent(cartSkus)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (Array.isArray(data?.products)) {
            pairupCacheRef.current.set(pid, data.products);
            console.log(`[PairUp] Prefetched ${data.products.length} pair-up products for ${pid}`);
          }
        })
        .catch((err) => {
          console.warn("[PairUp] Prefetch notice:", err?.message || err);
        });
    }
  }, [presence, stopSpeechForUserAction, cancelPendingReturnFromDetail, markOnboardingDone, resetHintIdleTimer, setCaption, backendCatalog]);

  selectProductRef.current = selectProduct;

  const showAll = useCallback(() => {
    cancelPendingReturnFromDetail("user_tap_show_all");
    productDetailOpenedRef.current = false;
    stopSpeechForUserAction("user_tap_show_all");
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    resetHintIdleTimer();
    markOnboardingDone("showAll");

    categoryBeforeDetailRef.current = "all";
    setCategory("all");
    trace("showDetail=false", { caller: "showAll" });
    setShowDetail(false);
    setOnboardingOpen(false);
    setLiveTurnProducts([]);
    setFiltersApplied(null);
    setHighlightSku(null);

    setCaption("Here are all our products.");
    console.log(`[DebugTiming] showAll click at=${Math.round(typeof window !== "undefined" ? performance.now() : Date.now())}`);

    kioskWS.sendWsAction({ action: "SHOW_ALL" });
    kioskWS.sendScreenChanged({
      type: "list",
      category: "all",
      sku: null,
      skus: (backendCatalog || []).map((p) => p.sku || p.id).filter(Boolean),
    });
  }, [presence, stopSpeechForUserAction, cancelPendingReturnFromDetail, markOnboardingDone, backendCatalog, resetHintIdleTimer, setCaption]);

  const clearFilters = useCallback(() => {
    setLiveTurnProducts([]);
    setFiltersApplied(null);
    setHighlightSku(null);
    kioskWS.sendWsAction({ action: "SHOW_ALL" });
  }, []);

  const navigateBack = useCallback(() => {
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    resetHintIdleTimer();
    if (isBackFromDetailPendingRef.current) {
      return;
    }
    const wasDetail = productDetailOpenedRef.current || latestRef.current.showDetail;
    lastProductSpokenRef.current = null;
    speechController.cancelAll("navigate_back");
    clearTimeout(aiTurnTimeoutRef.current);

    trace("showDetail=false", { caller: "navigateBack" });
    setShowDetail(false);
    productDetailOpenedRef.current = false;
    setLiveTurnProducts([]);
    setFiltersApplied(null);
    setHighlightSku(null);

    // Track return window so incoming server responses to NAVIGATE_BACK do not overwrite category/list
    justReturnedFromDetailRef.current = wasDetail;
    clearTimeout(justReturnedTimerRef.current);
    justReturnedTimerRef.current = setTimeout(() => {
      justReturnedFromDetailRef.current = false;
    }, 1500);

    const targetCat = categoryBeforeDetailRef.current || "all";
    if (wasDetail) {
      setCategory(targetCat);
      const naturalLine = getCategoryNaturalLine(targetCat);
      setCaption(naturalLine);
    } else {
      setCaption("");
    }

    kioskWS.sendScreenChanged({
      type: "list",
      category: targetCat && targetCat !== "all" ? targetCat : null,
      sku: null,
      skus: (backendCatalog || []).map((p) => p.sku || p.id).filter(Boolean),
    });

    const turnId = kioskWS.sendWsAction({ action: "NAVIGATE_BACK" });
    if (wasDetail) {
      triggerReturnFromDetail(turnId);
    } else {
      openCategoryPicker("navigate_back");
      stopSpeechForUserAction("user_tap_back");
    }
  }, [presence, stopSpeechForUserAction, triggerReturnFromDetail, category, backendCatalog, resetHintIdleTimer, openCategoryPicker, setCaption]);

  const restartSession = useCallback(() => {
    lastInputAtRef.current = Date.now();
    kioskWS.sendWsAction({ action: "RESTART" });
    reset();
  }, [reset]);

  const send = useCallback((text) => {
    stopSpeechForUserAction("user_send");
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    if (text) {
      kioskWS.sendWsMessage(text);
    }
  }, [presence, stopSpeechForUserAction]);

  const enquire = useCallback(() => {
    stopSpeechForUserAction("user_enquire");
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    say(
      `Happy to help with a bulk enquiry${name ? ", " + name : ""}! ` +
      "Our team offers volume discounts, custom logo engraving, and certified eco packaging."
    );
  }, [name, presence, say, stopSpeechForUserAction]);

  const handleButtonClick = useCallback((btn) => {
    lastInputAtRef.current = Date.now();
    presence.triggerTouchEngaged();
    if (!btn) return;
    stopSpeechForUserAction("user_tap_button");
    console.log("[Kiosk] User clicked flow button:", btn);

    const btnId = typeof btn === "string" ? btn.toLowerCase().trim() : (btn.id || btn.label || "").toLowerCase().trim();

    if (btnId === "skip_name") {
      skipName();
      return;
    }

    if (btnId === "checkout" || btnId === "proceed" || btnId === "proceed_to_cart") {
      openCart({ fromPairUp: true });
      return;
    }

    if (btnId === "skip") {
      if (onboardingOpen) {
        skipName();
      } else {
        openCart({ fromPairUp: true });
      }
      return;
    }

    if (btnId === "keep_shopping" || btnId === "keep shopping") {
      kioskWS.sendWsMessage("keep shopping");
      setCartModalOpen(false);
      setPairUpModalOpen(false);
      return;
    }

    if (btnId === "restart") {
      restartSession();
      return;
    }

    kioskWS.sendButtonClick(btn);
  }, [presence, restartSession, skipName, stopSpeechForUserAction]);

  const requestRecommendation = useCallback(() => {
    stopSpeechForUserAction("user_request_recommendation");
    lastInputAtRef.current = Date.now();
    console.log("[Reco] requested");
    kioskWS.sendWsAction({ action: "REQUEST_RECOMMENDATION" });
  }, [stopSpeechForUserAction]);

  const acceptRecommendation = useCallback(() => {
    stopSpeechForUserAction("user_accept_recommendation");
    lastInputAtRef.current = Date.now();
    console.log("[Reco] accepted");

    const reco = latestRef.current.recommendationData;
    const base = reco?.base_product;
    const sugg = reco?.suggested_product;

    if (sugg || base) {
      setCartItems((prev) => {
        let updated = [...prev];
        if (base) {
          const baseId = base.id || base.sku;
          const hasBase = updated.some((i) => i.id === baseId || i.sku === baseId);
          if (!hasBase) {
            updated.push({
              id: baseId,
              sku: base.sku || baseId,
              name: base.name,
              price: base.salePrice || base.price || 0,
              quantity: 1,
              selectedColor: "Natural Olive",
              image: base.image,
              shape: base.shape,
              isPairUp: false,
            });
          }
        }
        if (sugg) {
          const suggId = sugg.id || sugg.sku;
          const hasSugg = updated.some((i) => i.id === suggId || i.sku === suggId);
          if (!hasSugg) {
            updated.push({
              id: suggId,
              sku: sugg.sku || suggId,
              name: sugg.name,
              price: sugg.salePrice || sugg.price || 0,
              quantity: 1,
              image: sugg.image,
              shape: sugg.shape,
              isPairUp: true,
            });
          }
        }
        return updated;
      });

      if (sugg) {
        say(`Added the ${cleanProductName(sugg.name)} to your cart.`);
      } else if (base) {
        say(`Added the ${cleanProductName(base.name)} to your cart.`);
      }
    }

    setRecommendationOpen(false);
    kioskWS.sendWsAction({ action: "ACCEPT_RECOMMENDATION" });
  }, [stopSpeechForUserAction, say]);

  const declineRecommendation = useCallback(() => {
    stopSpeechForUserAction("user_decline_recommendation");
    lastInputAtRef.current = Date.now();
    console.log("[Reco] declined");
    setRecommendationOpen(false);
    kioskWS.sendWsAction({ action: "DECLINE_RECOMMENDATION" });
  }, [stopSpeechForUserAction]);

  // ── Pair-Up Speech & Action Handlers ─────────────────────────────────────
  const isNavigatingToCartRef = useRef(false);

  const speakPairUpLine = useCallback(
    (type, extraName = "", openTime = 0) => {
      const activeName = extraName || latestRef.current?.name || KioskStepCache.getCustomerName() || "";
      const isNameSub = Boolean(nameSubmittedRef.current && activeName);
      const lastIdx = pairUpVariantIdxRef.current[type] ?? -1;
      const { text, displayText, chunks, nextIndex } = getPairUpSpeech(type, {
        name: activeName,
        nameSubmitted: isNameSub,
        lastIndex: lastIdx,
      });
      pairUpVariantIdxRef.current[type] = nextIndex;

      if (displayText) {
        setPairUpCaption(displayText);
        setCaption(displayText);
      } else if (text) {
        setPairUpCaption(text);
        setCaption(text);
      }

      if (text) {
        cancelPendingReturnFromDetail("pairup_action");
        speechController.cancelAll("pairup_action");
        const replyId = `pu_${type}_${Date.now()}`;
        speechController.beginReply(replyId, { source: "pairup" });
        const lineChunks = Array.isArray(chunks) && chunks.length > 0 ? chunks : [text];
        console.log(`[PairUp] chunk1="${lineChunks[0] || ''}" chunk2="${lineChunks[1] || ''}" enqueued for replyId=${replyId}`);
        for (const chunk of lineChunks) {
          speechController.appendSentence(replyId, chunk, { turnId: replyId, openTime });
        }
        speechController.endReply(replyId);
      }
      return text;
    },
    [cancelPendingReturnFromDetail]
  );

  const openCart = useCallback(
    ({ fromPairUp = true } = {}) => {
      if (isNavigatingToCartRef.current) return;
      isNavigatingToCartRef.current = true;
      setTimeout(() => {
        isNavigatingToCartRef.current = false;
      }, 800);

      cancelPendingReturnFromDetail("open_cart");
      setPairUpModalOpen(false);
      setCartModalOpen(false);
      setShowCheckout(true);
      kioskWS.sendScreenChanged({
        type: "cart",
        category: null,
        sku: productId || null,
        skus: cartItemsRef.current.map((i) => i.sku || i.id).filter(Boolean),
      });
    },
    [cancelPendingReturnFromDetail, productId]
  );

  const removeCartItem = useCallback((idOrSku) => {
    setCartItems((prev) => prev.filter((it) => it.id !== idOrSku && it.sku !== idOrSku));
  }, []);

  const lastAddToCartRef = useRef(0);
  const lastAddedIdRef = useRef(null);

  const handleAddToCart = useCallback(
    async ({ product, quantity = 1, selectedColor = "Natural Olive" } = {}) => {
      if (!product) return;
      const pid = product.id || product.sku;

      // Debounce duplicate triggers (tap + voice, double-tap within 450ms)
      const now = Date.now();
      if (now - lastAddToCartRef.current < 450 && lastAddedIdRef.current === pid) {
        console.log(`[Cart] Debounced duplicate add-to-cart for pid=${pid}`);
        return;
      }
      lastAddToCartRef.current = now;
      lastAddedIdRef.current = pid;

      const openTime = Date.now();

      cancelPendingReturnFromDetail("add_to_cart");
      speechController.cancelAll("pairup_action");

      // 1. Add primary product to cart
      const primaryItem = {
        id: pid,
        sku: product.sku || pid,
        name: product.name,
        price: product.salePrice || product.price || 0,
        quantity,
        selectedColor,
        image: product.image,
        shape: product.shape,
        isPairUp: false,
      };

      setCartItems((prev) => {
        const existingIdx = prev.findIndex(
          (i) => (i.id === primaryItem.id || i.sku === primaryItem.sku) && i.selectedColor === primaryItem.selectedColor
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            quantity: (updated[existingIdx].quantity || 1) + primaryItem.quantity,
          };
          return updated;
        }
        return [...prev, primaryItem];
      });

      // 2. Compute 3-4 suggestions (balancing same category and different categories)
      let suggestions = pairupCacheRef.current.get(pid);
      if (!suggestions || suggestions.length === 0) {
        suggestions = getPairUpSuggestions(product, cartItemsRef.current, backendCatalog);
      }
      setPairUpProducts(suggestions);

      // 3. Open pair-up bottom sheet pop-up immediately (never block on TTS)
      setPairUpModalOpen(true);
      setCartModalOpen(false);

      // 4. In the exact same tick, speak pairUpIntro
      speakPairUpLine("pairUpIntro", "", openTime);

      // Background verify with backend /pairups if not cached yet
      if (!pairupCacheRef.current.has(pid)) {
        try {
          const cartSkus = cartItemsRef.current.map((i) => i.sku || i.id).join(",");
          const res = await fetch(
            `${BACKEND_URL}/pairups?product_id=${encodeURIComponent(pid)}&cart=${encodeURIComponent(cartSkus)}`
          );
          if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : [];
            if (list.length > 0) {
              const mapped = list.map(normalizeBackendProduct).filter(Boolean);
              if (mapped.length > 0) {
                pairupCacheRef.current.set(pid, mapped);
                setPairUpProducts(mapped);
              }
            }
          }
        } catch (_) { }
      }
    },
    [backendCatalog, cancelPendingReturnFromDetail, getPairUpSuggestions, speakPairUpLine]
  );

  const handlePairUpYes = useCallback(() => {
    if (pairUpTimerRef.current) clearTimeout(pairUpTimerRef.current);
    consecutiveNoCountRef.current = 0;
    setPairUpPromptOpen(false);
    speakPairUpLine("pairUpIntro");
    setPairUpModalOpen(true);
  }, [speakPairUpLine]);

  const handlePairUpNo = useCallback(() => {
    if (pairUpTimerRef.current) clearTimeout(pairUpTimerRef.current);
    consecutiveNoCountRef.current += 1;
    setPairUpPromptOpen(false);
    speakPairUpLine("pairUpSkipped");
    openCart({ fromPairUp: true });
  }, [openCart, speakPairUpLine]);

  const handlePairUpAddProduct = useCallback(
    (item) => {
      if (!item) return;
      const pid = item.id || item.sku;

      // Debounce duplicate triggers (tap + voice, double-tap within 450ms)
      const now = Date.now();
      if (now - lastAddToCartRef.current < 450 && lastAddedIdRef.current === pid) {
        console.log(`[Cart] Debounced duplicate pair-up add-to-cart for pid=${pid}`);
        return;
      }
      lastAddToCartRef.current = now;
      lastAddedIdRef.current = pid;

      const pairItem = {
        id: pid,
        sku: item.sku || pid,
        name: item.name,
        price: item.salePrice || item.price || 0,
        quantity: 1,
        image: item.image,
        shape: item.shape,
        isPairUp: true,
      };

      setCartItems((prev) => {
        const existing = prev.find((i) => i.id === pairItem.id || i.sku === pairItem.sku);
        if (existing) return prev;
        return [...prev, pairItem];
      });

      addedPairUpInCurrentModalRef.current = true;
      say(`Added the ${cleanProductName(item.name)} to your cart.`);
    },
    [say]
  );

  const handlePairUpSkip = useCallback(() => {
    const hasPairUpAdded = cartItemsRef.current.some((i) => i.isPairUp);
    if (hasPairUpAdded) {
      speakPairUpLine("pairUpAdded");
    } else {
      speakPairUpLine("pairUpSkipped");
    }
    openCart({ fromPairUp: true });
  }, [openCart, speakPairUpLine]);

  const handlePairUpProceed = useCallback(() => {
    const hasPairUpAdded = cartItemsRef.current.some((i) => i.isPairUp);
    if (hasPairUpAdded) {
      speakPairUpLine("pairUpAdded");
    } else {
      speakPairUpLine("pairUpSkipped");
    }
    openCart({ fromPairUp: true });
  }, [openCart, speakPairUpLine]);

  const handlePairUpClose = useCallback(() => {
    const hasPairUpAdded = cartItemsRef.current.some((i) => i.isPairUp);
    if (hasPairUpAdded) {
      speakPairUpLine("pairUpAdded");
    } else {
      speakPairUpLine("pairUpSkipped");
    }
    openCart({ fromPairUp: true });
  }, [openCart, speakPairUpLine]);

  const handlePairUpDone = useCallback(() => {
    handlePairUpProceed();
  }, [handlePairUpProceed]);

  const products = useMemo(() => {
    const catalog = backendCatalog;
    if (!catalog || catalog.length === 0) return [];
    if (!showDetail && filtersApplied && liveTurnProducts.length > 0) {
      return liveTurnProducts;
    }
    if (!category || category === "all") return catalog;
    const clean = normalizeCategory(category);
    return catalog.filter((p) => {
      const pCat = normalizeCategory(p.category || "");
      const pCats = Array.isArray(p.categories) ? p.categories.map(normalizeCategory) : [];
      return pCat === clean || pCats.includes(clean);
    });
  }, [backendCatalog, category, filtersApplied, liveTurnProducts, showDetail]);

  const product = useMemo(() => {
    const catalog = backendCatalog;
    if (!catalog || catalog.length === 0) return null;
    return (
      catalog.find((p) => p.id === productId || p.sku === productId) ||
      products[0] ||
      catalog[0] ||
      null
    );
  }, [backendCatalog, productId, products]);

  // ── Single Source of Truth: Current Screen State broadcast to backend ──
  const currentScreenState = useMemo(() => {
    if (cartModalOpen) {
      return { type: "cart", category: null, sku: null, skus: [] };
    }
    if (showDetail && product) {
      const sku = product.sku || product.id || null;
      return { type: "product", category: product.category || (category !== "all" ? category : null), sku, skus: sku ? [sku] : [] };
    }
    if (onboardingOpen) {
      if (onboardingStep === 1) {
        return { type: "home", category: null, sku: null, skus: [] };
      }
      return { type: "categories", category: null, sku: null, skus: [] };
    }
    const skus = products.map((p) => p.sku || p.id).filter(Boolean);
    return {
      type: "list",
      category: category && category !== "all" ? category : null,
      sku: null,
      skus,
    };
  }, [cartModalOpen, showDetail, product, onboardingOpen, onboardingStep, category, products]);

  const lastBroadcastScreenRef = useRef(null);
  useEffect(() => {
    const screenKey = JSON.stringify(currentScreenState);
    if (lastBroadcastScreenRef.current !== screenKey) {
      lastBroadcastScreenRef.current = screenKey;
      kioskWS.sendScreenChanged(currentScreenState);
    }
  }, [currentScreenState]);

  const maxFaceBox = presenceTracker.largestFace?.box;
  const currentFaceBox = maxFaceBox
    ? {
      cx: (maxFaceBox.minX + maxFaceBox.maxX) / 2,
      cy: (maxFaceBox.minY + maxFaceBox.maxY) / 2,
      w: maxFaceBox.width,
    }
    : null;

  // Keep latestRef synchronized every render
  latestRef.current = {
    backendCatalog,
    product,
    productId,
    name,
    identityMasked,
    faceEnrolled,
    faceBox: currentFaceBox,
    kioskMode,
    isEngaged,
    enterEngaged,
    engage,
    category,
    categories,
    selectCategory,
    presence,
    showDetail,
    onboardingStep,
    onboardingOpen,
    sessionId: sessionIdRef.current,
    say,
    reset,
    resetSession,
    identityPrompt,
    confirmIdentity,
    multipleFaces: presence.multipleFaces,
    setCaption,
    submitName,
    skipName,
    showAll,
    navigateBack,
    restartSession,
    handleServerAction,
    stageRef,
    _stageRef: stageRef,
    cartModalOpen,
    recommendationOpen,
    recommendationData,
    requestRecommendation,
    acceptRecommendation,
    declineRecommendation,
    pairUpPromptOpen,
    pairUpModalOpen,
    pairUpProducts,
    handlePairUpYes,
    handlePairUpNo,
    handlePairUpAddProduct,
    handlePairUpSkip,
    handlePairUpDone,
    handlePairUpProceed,
    handleAddToCart,
    cartItems,
    cartTotals,
  };

  // ── Diagnostic: 5-second State Snapshot (Requirement 2e) ──────────────────
  const snapshotDataRef = useRef();
  snapshotDataRef.current = {
    kioskMode,
    showDetail,
    onboardingOpen,
    onboardingStep,
    category,
    productsLength: products?.length ?? 0,
    liveTurnProductsLength: liveTurnProducts?.length ?? 0,
    backendCatalogLength: backendCatalog?.length ?? 0,
    productId,
    productIsNull: product === null,
    goodbyeOpen,
    cartModalOpen,
    qrModalOpen,
    recommendationOpen,
    identityMasked,
    identityPromptActive: Boolean(identityPrompt?.active),
    speaking,
    convState,
    wsReadyState: kioskWS?.ws?.readyState ?? -1,
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const snap = snapshotDataRef.current;
      if (!snap) return;
      const now = Date.now();
      trace("snapshot", {
        kioskMode: snap.kioskMode,
        showDetail: snap.showDetail,
        onboardingOpen: snap.onboardingOpen,
        onboardingStep: snap.onboardingStep,
        category: snap.category,
        productsLength: snap.productsLength,
        liveTurnProductsLength: snap.liveTurnProductsLength,
        backendCatalogLength: snap.backendCatalogLength,
        productId: snap.productId,
        productIsNull: snap.productIsNull,
        goodbyeOpen: snap.goodbyeOpen,
        cartModalOpen: snap.cartModalOpen,
        qrModalOpen: snap.qrModalOpen,
        recommendationOpen: snap.recommendationOpen,
        identityMasked: snap.identityMasked,
        identityPromptActive: snap.identityPromptActive,
        speaking: snap.speaking,
        convState: snap.convState,
        wsReadyState: snap.wsReadyState,
        faceAbsentMs: now - (lastFaceAtRef.current || now),
        lastInputAgoMs: now - (lastInputAtRef.current || now),
        lastAttentionAgoMs: now - (lastAttentionAtRef.current || now),
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return {
    kioskMode,
    isEngaged,
    enterEngaged,
    engage,
    caption,
    speechId,
    category,
    categories,
    product,
    products,
    catalog: backendCatalog,
    isLoadingCatalog,
    isLoading: isLoadingCatalog,
    name: identityMasked ? "" : name,
    rawName: name,
    identityMasked,
    faceEnrolled,
    convState,
    speaking,
    listening: deepgram.listening || listening,
    liveTranscript: deepgram.liveTranscript || liveTranscript,
    lastUserSpeech,
    userSpeaking,
    evidence,
    speakingForMs,
    silentForMs,
    audioLevel,
    vadSpeech,
    signals,
    presence,
    send,
    selectCategory,
    selectProduct,
    submitName,
    skipName,
    continueAsGuest,
    showAll,
    navigateBack,
    restartSession,
    backendAction,
    actionButtons,
    showDetail,
    setShowDetail,
    enquire,
    reset,
    resetSession,
    identityPrompt,
    confirmIdentity,
    handleButtonClick,
    cartModalOpen,
    setCartModalOpen,
    cartModalData,
    qrModalOpen,
    setQrModalOpen,
    qrModalData,
    goodbyeOpen,
    setGoodbyeOpen,
    goodbyeData,
    staffBanner,
    setStaffBanner,
    hintBubble,
    setHintBubble,
    onboardingOpen,
    setOnboardingOpen,
    onboardingStep,
    setOnboardingStep,
    onboardingDone,
    markOnboardingDone,
    openCategoryPicker,
    handleServerAction,
    setStageRef,
    handleSpeakingChange,
    setSpeaking,
    showPTT,
    micError,
    sessionTimeoutWarning,
    continueSession,
    exitSession,
    stopSpeechForUserAction,
    recommendationOpen,
    setRecommendationOpen,
    recommendationData,
    setRecommendationData,
    requestRecommendation,
    acceptRecommendation,
    declineRecommendation,
    kioskModeRef,
    replayingRef,
    cartItems,
    cartTotals,
    removeCartItem,
    pairUpPromptOpen,
    setPairUpPromptOpen,
    pairUpModalOpen,
    setPairUpModalOpen,
    pairUpCaption,
    setPairUpCaption,
    pairUpProducts,
    pairUpQuestionText,
    showCheckout,
    setShowCheckout,
    openCart,
    handleAddToCart,
    handlePairUpYes,
    handlePairUpNo,
    handlePairUpAddProduct,
    handlePairUpSkip,
    handlePairUpProceed,
    handlePairUpClose,
    handlePairUpDone,
    sessionResetKey,
    clearCart,
    backendCatalog,
    filtersApplied,
    highlightSku,
    clearFilters,
  };
}
