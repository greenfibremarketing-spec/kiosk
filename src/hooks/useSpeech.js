"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useSpeech({ onTranscript, isEngaged = false } = {}) {
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isRunningRef = useRef(false);
  const restartTimerRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    isSpeakingRef.current = speaking;
  }, [speaking]);

  const stopContinuousListening = useCallback(() => {
    setListening(false);
    shouldListenRef.current = false;
    clearTimeout(restartTimerRef.current);

    if (recognitionRef.current && isRunningRef.current) {
      try {
        // Use stop() instead of abort() for graceful pipe teardown
        recognitionRef.current.stop();
      } catch (_) {}
      isRunningRef.current = false;
    }
  }, []);

  const startContinuousListening = useCallback(() => {
    if (typeof window === "undefined") return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setListening(false);
      return;
    }

    shouldListenRef.current = true;
    clearTimeout(restartTimerRef.current);

    // If already running, do not re-create or abort
    if (isRunningRef.current) {
      return;
    }

    try {
      if (!recognitionRef.current) {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = "en-IN";
        rec.maxAlternatives = 1;

        rec.onstart = () => {
          isRunningRef.current = true;
          setListening(true);
        };

        rec.onresult = (event) => {
          if (!shouldListenRef.current || isSpeakingRef.current) return;
          const lastResultIndex = event.results.length - 1;
          const text = event.results[lastResultIndex][0]?.transcript?.trim();
          if (text && onTranscriptRef.current) {
            onTranscriptRef.current(text);
          }
        };

        rec.onerror = (event) => {
          // "no-speech" or "aborted" are normal lifecycle events
          if (event.error === "aborted" || event.error === "no-speech") {
            // expected normal events
          } else {
            console.warn("Speech recognition notice:", event.error);
          }
        };

        rec.onend = () => {
          isRunningRef.current = false;
          setListening(false);

          // Graceful backoff restart (1000ms debounce allows Chromium audio stream pipe to cleanly close)
          if (shouldListenRef.current && !isSpeakingRef.current) {
            clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              if (shouldListenRef.current && !isSpeakingRef.current && !isRunningRef.current) {
                try {
                  rec.start();
                } catch (_) {
                  // Fallback retry
                  isRunningRef.current = false;
                }
              }
            }, 1000);
          }
        };

        recognitionRef.current = rec;
      }

      recognitionRef.current.start();
    } catch (e) {
      // If already started or audio pipeline busy, set flag and retry later
      if (e.name !== "InvalidStateError") {
        console.warn("Speech recognition notice:", e);
      }
    }
  }, []);

  // Determine if recognition should actively be running
  useEffect(() => {
    shouldListenRef.current = isEngaged && !speaking;

    if (shouldListenRef.current) {
      startContinuousListening();
    } else {
      stopContinuousListening();
    }

    return () => {
      clearTimeout(restartTimerRef.current);
    };
  }, [isEngaged, speaking, startContinuousListening, stopContinuousListening]);

  const speak = useCallback((text) => {
    setSpeaking(true);
    isSpeakingRef.current = true;
    stopContinuousListening();

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-IN";
      u.rate = 0.93;
      u.pitch = 1.12;

      u.onend = () => {
        setSpeaking(false);
        isSpeakingRef.current = false;
      };

      u.onerror = () => {
        setSpeaking(false);
        isSpeakingRef.current = false;
      };

      window.speechSynthesis.speak(u);
    } else {
      setTimeout(() => {
        setSpeaking(false);
        isSpeakingRef.current = false;
      }, Math.min(8000, (text?.length || 20) * 55));
    }
  }, [stopContinuousListening]);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    isSpeakingRef.current = false;
  }, []);

  return {
    speaking,
    listening,
    setSpeaking,
    speak,
    stopSpeaking,
    startContinuousListening,
    stopContinuousListening,
  };
}
