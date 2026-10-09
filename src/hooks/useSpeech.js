"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const DEEPGRAM_DEFAULT_KEY = "8ede28576db8d02d8ab30f8ec9a0c5ac2be3986f";

const URL =
  "wss://api.deepgram.com/v1/listen" +
  "?model=nova-3&language=en-IN&smart_format=true" +
  "&interim_results=true&endpointing=800&utterance_end_ms=1500";

export function useSpeech({ onTranscript, onHypothesis, isEngaged = false, speaking = false } = {}) {
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");

  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const wantRef = useRef(false);
  const bufferRef = useRef("");
  const clearTimerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  const onHypothesisRef = useRef(onHypothesis);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onHypothesisRef.current = onHypothesis;
  }, [onHypothesis]);

  const cleanup = useCallback(() => {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch (_) {}
    recorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onclose = null;
      try {
        ws.close();
      } catch (_) {}
    }
    bufferRef.current = "";
    setListening(false);
  }, []);

  const flush = useCallback(() => {
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    if (!text) return;
    setLiveTranscript(text);
    clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setLiveTranscript(""), 4000);
    onTranscriptRef.current?.(text);
  }, []);

  const stopContinuousListening = useCallback(() => {
    wantRef.current = false;
    clearTimeout(restartTimerRef.current);
    cleanup();
  }, [cleanup]);

  const startContinuousListening = useCallback(async () => {
    wantRef.current = true;
    if (wsRef.current) return;

    try {
      let key = DEEPGRAM_DEFAULT_KEY;
      if (typeof window !== "undefined") {
        if (window.electronAPI?.getDeepgramKey) {
          try {
            const k = await window.electronAPI.getDeepgramKey();
            if (k) key = k;
          } catch (_) {}
        } else if (window.kiosk?.getDeepgramKey) {
          try {
            const k = await window.kiosk.getDeepgramKey();
            if (k) key = k;
          } catch (_) {}
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });

      if (!wantRef.current || wsRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const ws = new WebSocket(URL, ["token", key]);
      wsRef.current = ws;
      streamRef.current = stream;

      ws.onopen = () => {
        setListening(true);
        console.log("[Deepgram STT] Connected to Nova-3 WebSocket");

        let mimeType = "audio/webm;codecs=opus";
        if (typeof MediaRecorder !== "undefined" && !MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/webm";
        }

        const rec = new MediaRecorder(stream, { mimeType });
        recorderRef.current = rec;
        rec.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };
        rec.start(250);
      };

      ws.onmessage = (msg) => {
        let data;
        try {
          data = JSON.parse(msg.data);
        } catch (_) {
          return;
        }

        if (data.type === "UtteranceEnd") {
          flush();
          return;
        }
        if (data.type !== "Results") return;

        const text = data.channel?.alternatives?.[0]?.transcript?.trim() || "";
        if (!text) return;

        if (data.is_final) {
          bufferRef.current += (bufferRef.current ? " " : "") + text;
          setLiveTranscript(bufferRef.current);
          onHypothesisRef.current?.(bufferRef.current);
          if (data.speech_final) {
            flush();
          }
        } else {
          const live = (bufferRef.current + " " + text).trim();
          setLiveTranscript(live);
          onHypothesisRef.current?.(live);
        }
      };

      ws.onerror = (e) => console.warn("[Deepgram STT] WebSocket error:", e);

      ws.onclose = () => {
        cleanup();
        if (wantRef.current) {
          restartTimerRef.current = setTimeout(startContinuousListening, 1000);
        }
      };
    } catch (e) {
      console.warn("[Deepgram STT] Init failed:", e);
      cleanup();
    }
  }, [cleanup, flush]);

  // Listen only while engaged AND the avatar is not talking
  useEffect(() => {
    if (isEngaged && !speaking) {
      startContinuousListening();
    } else {
      stopContinuousListening();
    }
  }, [isEngaged, speaking, startContinuousListening, stopContinuousListening]);

  useEffect(() => {
    return () => {
      clearTimeout(clearTimerRef.current);
      stopContinuousListening();
    };
  }, [stopContinuousListening]);

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
    toggleListening,
    startContinuousListening,
    stopContinuousListening,
  };
}
