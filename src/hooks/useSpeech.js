"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(false);
  const voiceRef = useRef(false);
  const timer = useRef(null);

  useEffect(() => { voiceRef.current = voice; }, [voice]);

  const speak = useCallback((text) => {
    clearTimeout(timer.current);
    setSpeaking(true);
    if (voiceRef.current && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-IN";
      u.onend = () => setSpeaking(false);
      speechSynthesis.speak(u);
    } else {
      timer.current = setTimeout(() => setSpeaking(false), Math.min(8000, text.length * 55));
    }
  }, []);

  const listen = useCallback((onText) => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return onText(null);
    const r = new Rec();
    r.lang = "en-IN";
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.onresult = (e) => onText(e.results[0][0].transcript);
    r.start();
  }, []);

  const stopSpeaking = useCallback(() => {
    clearTimeout(timer.current);
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  return {
    speaking,
    listening,
    voice,
    toggleVoice: () => setVoice((v) => !v),
    speak,
    stopSpeaking,
    listen
  };
}
