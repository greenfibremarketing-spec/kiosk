"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCTS } from "@/data/products";
import { GREETING, describeProduct, productsIn, reply } from "@/lib/agent";
import { useSpeech } from "@/hooks/useSpeech";
import { usePresenceDetection } from "@/lib/presence/usePresenceDetection";
import { useUserSignals } from "@/hooks/useUserSignals";

const IDLE_MS = 60_000;          // Reset after 60s of no interaction
const SILENCE_CHECK_MS = 9_000;  // How often to check silence/proactive prompts

export function useKiosk() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("all");
  const [productId, setProductId] = useState(PRODUCTS[0].id);
  const [caption, setCaption] = useState(GREETING);
  const idle = useRef(null);
  const proactiveRef = useRef(null);
  const lastProactiveRef = useRef(0);

  const reset = useCallback(() => {
    setName("");
    setCategory("all");
    setProductId(PRODUCTS[0].id);
    setCaption(GREETING);
  }, []);

  const handleEnterEngaged = useCallback(() => {
    reset();
    setCaption(GREETING);
  }, [reset]);

  const handleExitToIdle = useCallback(() => {
    reset();
  }, [reset]);

  const presence = usePresenceDetection({
    onEnterEngaged: handleEnterEngaged,
    onExitToIdle: handleExitToIdle,
  });

  const isEngaged = presence.state === "ENGAGED";

  const say = useCallback((text) => {
    setCaption(text);
  }, []);

  const selectCategory = useCallback(
    (id) => {
      presence.triggerTouchEngaged();
      setCategory(id);
      const items = productsIn(id);
      if (items.length > 0) setProductId(items[0].id);
    },
    [presence]
  );

  const selectProduct = useCallback(
    (p) => {
      presence.triggerTouchEngaged();
      setProductId(p.id);
      say(describeProduct(p, name));
    },
    [name, presence, say]
  );

  // Core send — accepts text + optional signals context
  const sendRef = useRef(null);
  const send = useCallback(
    async (text, signals = null) => {
      presence.triggerTouchEngaged();
      try {
        const data = reply({
          text: String(text ?? ""),
          name: String(name ?? ""),
          signals,
        });
        if (!data) return;
        if (data.name) setName(data.name);
        const a = data.action;
        if (a?.category) selectCategory(a.category);
        if (a?.type === "SHOW_PRODUCT" && a.productId) setProductId(a.productId);
        say(data.message);
      } catch {
        say("Sorry, I'm having trouble right now. Please tap a product to continue.");
      }
    },
    [name, presence, say, selectCategory]
  );
  sendRef.current = send;

  // ─── Behaviour signals hook ───────────────────────────────────────────────
  // Jaw-VAD: when face-jaw detects user speaking → interrupt avatar speech
  const onSpeechStart = useCallback(() => {
    // Interruption handled inside useSpeech via stopContinuousListening pause
  }, []);
  const onSpeechEnd = useCallback(() => {}, []);

  const signals = useUserSignals({
    videoRef: presence.videoRef,
    isEngaged,
    onSpeechStart,
    onSpeechEnd,
  });

  // ─── Always-listening speech recognition (Web Speech API) ─────────────────
  const speech = useSpeech({
    onTranscript: useCallback(
      (t) => { if (t) sendRef.current?.(t, signals); },
      [signals]
    ),
    isEngaged,
  });

  // ─── Proactive signal-driven prompts ──────────────────────────────────────
  // Periodically check signals and fire a proactive message if appropriate
  useEffect(() => {
    clearInterval(proactiveRef.current);
    if (!isEngaged) return;

    proactiveRef.current = setInterval(() => {
      const now = Date.now();
      // Debounce proactive messages — at least 20s apart
      if (now - lastProactiveRef.current < 20_000) return;
      // Don't interrupt while avatar is speaking
      if (speech.speaking) return;

      const data = reply({ text: "", name, signals });
      if (data?.message) {
        lastProactiveRef.current = now;
        say(data.message);
      }
    }, SILENCE_CHECK_MS);

    return () => clearInterval(proactiveRef.current);
  }, [isEngaged, signals, name, speech.speaking, say]);

  // ─── Idle reset ───────────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(idle.current);
    idle.current = setTimeout(reset, IDLE_MS);
    return () => clearTimeout(idle.current);
  }, [caption, productId, reset]);

  const enquire = useCallback(() => {
    presence.triggerTouchEngaged();
    say(
      `Happy to help with a bulk enquiry${
        name ? ", " + name : ""
      }! Our team offers volume discounts, custom logo engraving, and certified eco packaging.`
    );
  }, [name, presence, say]);

  const product = PRODUCTS.find((p) => p.id === productId) || PRODUCTS[0];
  const products = productsIn(category);

  return {
    ...speech,
    caption,
    category,
    product,
    products,
    presence,
    signals,          // expose so UI can show debug / emote reactions
    send,
    selectCategory,
    selectProduct,
    enquire,
  };
}
