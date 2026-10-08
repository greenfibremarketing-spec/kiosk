"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useSpeech({ onTranscript, isEngaged = false } = {}) {
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isRunningRef = useRef(false);
  const restartTimerRef = useRef(null);
  const clearLiveTimerRef = useRef(null);
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

    if (isRunningRef.current) {
      return;
    }

    try {
      if (!recognitionRef.current) {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-IN";
        rec.maxAlternatives = 1;

        rec.onstart = () => {
          isRunningRef.current = true;
          setListening(true);
        };

        rec.onresult = (event) => {
          if (!shouldListenRef.current || isSpeakingRef.current) return;

          let interim = "";
          let final = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0]?.transcript || "";
            if (event.results[i].isFinal) {
              final += transcript;
            } else {
              interim += transcript;
            }
          }

          if (interim) {
            setLiveTranscript(interim);
          }

          const cleanFinal = final.trim();
          if (cleanFinal) {
            setLiveTranscript(cleanFinal);
            clearTimeout(clearLiveTimerRef.current);
            clearLiveTimerRef.current = setTimeout(() => setLiveTranscript(""), 4000);

            if (onTranscriptRef.current) {
              onTranscriptRef.current(cleanFinal);
            }
          }
        };

        rec.onerror = (event) => {
          if (event.error !== "aborted" && event.error !== "no-speech") {
            console.warn("Speech recognition notice:", event.error);
          }
        };

        rec.onend = () => {
          isRunningRef.current = false;
          setListening(false);

          // Auto-restart listening if engaged and not speaking
          if (shouldListenRef.current && !isSpeakingRef.current) {
            clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              if (shouldListenRef.current && !isSpeakingRef.current && !isRunningRef.current) {
                try {
                  rec.start();
                } catch (_) {
                  isRunningRef.current = false;
                }
              }
            }, 600);
          }
        };

        recognitionRef.current = rec;
      }

      recognitionRef.current.start();
    } catch (e) {
      if (e.name !== "InvalidStateError") {
        console.warn("Speech recognition init notice:", e);
      }
    }
  }, []);

  // Sync listening state with kiosk engagement and avatar speaking state
  useEffect(() => {
    shouldListenRef.current = isEngaged && !speaking;

    if (shouldListenRef.current) {
      startContinuousListening();
    } else {
      stopContinuousListening();
    }

    return () => {
      clearTimeout(restartTimerRef.current);
      clearTimeout(clearLiveTimerRef.current);
    };
  }, [isEngaged, speaking, startContinuousListening, stopContinuousListening]);

  const toggleListening = useCallback(() => {
    if (listening) {
      stopContinuousListening();
    } else {
      startContinuousListening();
    }
  }, [listening, startContinuousListening, stopContinuousListening]);

  return {
    speaking,
    listening,
    liveTranscript,
    setSpeaking,
    toggleListening,
    startContinuousListening,
    stopContinuousListening,
  };
}
