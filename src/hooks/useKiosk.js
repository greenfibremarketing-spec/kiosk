"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCTS } from "@/data/products";
import { GREETING, describeProduct, productsIn, reply } from "@/lib/agent";
import { useSpeech } from "@/hooks/useSpeech";
import { usePresenceDetection } from "@/lib/presence/usePresenceDetection";

const IDLE_MS = 60000;

export function useKiosk() {
  const speech = useSpeech();
  const { speak, stopSpeaking, listen } = speech;
  const [name, setName] = useState("");
  const [category, setCategory] = useState("all");
  const [productId, setProductId] = useState(PRODUCTS[0].id);
  const [caption, setCaption] = useState(GREETING);
  const idle = useRef(null);

  const say = useCallback((text) => {
    setCaption(text);
    speak(text);
  }, [speak]);

  const reset = useCallback(() => {
    setName("");
    setCategory("all");
    setProductId(PRODUCTS[0].id);
    stopSpeaking();
    setCaption(GREETING);
  }, [stopSpeaking]);

  const handleEnterEngaged = useCallback(() => {
    reset();
    say(GREETING);
  }, [reset, say]);

  const handleExitToIdle = useCallback(() => {
    reset();
  }, [reset]);

  // Presence Detection Hook
  const presence = usePresenceDetection({
    onEnterEngaged: handleEnterEngaged,
    onExitToIdle: handleExitToIdle
  });

  useEffect(() => {
    clearTimeout(idle.current);
    idle.current = setTimeout(reset, IDLE_MS);
    return () => clearTimeout(idle.current);
  }, [caption, productId, reset]);

  const selectCategory = useCallback((id) => {
    presence.triggerTouchEngaged();
    setCategory(id);
    const items = productsIn(id);
    if (items.length > 0) {
      setProductId(items[0].id);
    }
  }, [presence]);

  const selectProduct = useCallback((p) => {
    presence.triggerTouchEngaged();
    setProductId(p.id);
    say(describeProduct(p, name));
  }, [name, presence, say]);

  const send = useCallback(async (text) => {
    presence.triggerTouchEngaged();
    try {
      const data = reply({ text: String(text ?? ""), name: String(name ?? "") });
      if (data.name) setName(data.name);
      const a = data.action;
      if (a?.category) selectCategory(a.category);
      if (a?.type === "SHOW_PRODUCT" && a.productId) setProductId(a.productId);
      say(data.message);
    } catch {
      say("Sorry, I am having trouble right now. Please tap a product to continue.");
    }
  }, [name, presence, say, selectCategory]);

  const talk = useCallback(() => {
    presence.triggerTouchEngaged();
    listen((t) => (t ? send(t) : say("Voice input is not available in this browser. Please tap a suggestion.")));
  }, [listen, presence, say, send]);

  const enquire = useCallback(() => {
    presence.triggerTouchEngaged();
    say(`Happy to help with a bulk enquiry${name ? ", " + name : ""}. Our team can offer volume discounts, customized logo engraving, and certified eco packaging.`);
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
    send,
    talk,
    selectCategory,
    selectProduct,
    enquire
  };
}
