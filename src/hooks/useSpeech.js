"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-IN" +
  "&encoding=linear16&sample_rate=16000&channels=1" +
  "&smart_format=true&interim_results=true" +
  "&endpointing=250";

export function useSpeech({
  mic,                 // { subscribePcm, getRecent } from useMic
  isEngaged = false,
  onTranscript,        // final text of a turn
  onHypothesis,        // live interim text
  shouldDrop,          // (text) => true if it is the avatar's own echo
  getGate,             // () => ({ blocked: boolean, bargeIn: boolean })
} = {}) {
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [status, setStatus] = useState("closed");

  const wsRef = useRef(null);
  const wantRef = useRef(false);
  const bufferRef = useRef("");
  const keepAliveRef = useRef(null);
  const retryRef = useRef(null);
  const retryCountRef = useRef(0);
  const unsubRef = useRef(null);
  const clearTimerRef = useRef(null);
  const finalFlushTimerRef = useRef(null);
  const connectRef = useRef(null);

  const wasOpenRef = useRef(true);
  const getGateRef = useRef(getGate);
  getGateRef.current = getGate;

  const cbRef = useRef({});
  cbRef.current = { onTranscript, onHypothesis, shouldDrop };
  const micRef = useRef(mic);
  micRef.current = mic;

  const flush = useCallback(() => {
    clearTimeout(finalFlushTimerRef.current);
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    if (!text) return;
    clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setLiveTranscript(""), 3000);
    cbRef.current.onTranscript?.(text);
  }, []);

  const teardownSocket = useCallback(() => {
    clearInterval(keepAliveRef.current);
    clearTimeout(finalFlushTimerRef.current);
    unsubRef.current?.();
    unsubRef.current = null;
    wsRef.current = null;
    setListening(false);
    setStatus("closed");
  }, []);

  const connect = useCallback(async () => {
    if (!wantRef.current || wsRef.current) return;
    setStatus("connecting");

    let key;
    try {
      if (typeof window !== "undefined") {
        if (window.electronAPI?.getDeepgramKey) {
          key = await window.electronAPI.getDeepgramKey();
        } else if (window.kiosk?.getDeepgramKey) {
          key = await window.kiosk.getDeepgramKey();
        }
      }
    } catch (_) {}

    key =
      key ||
      process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ||
      "8ede28576db8d02d8ab30f8ec9a0c5ac2be3986f";

    if (!key) {
      console.warn("[STT] No Deepgram key found");
      return;
    }
    if (!wantRef.current || wsRef.current) return;

    const ws = new WebSocket(WS_URL, ["token", key]);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;
      setListening(true);
      setStatus("open");

      unsubRef.current = micRef.current?.subscribePcm?.((b) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const g = getGateRef.current?.() || { blocked: false, bargeIn: false };
        const open = !g.blocked || g.bargeIn;

        if (!open) { // avatar talking: send NOTHING
          wasOpenRef.current = false;
          bufferRef.current = "";
          return;
        }
        if (!wasOpenRef.current && g.bargeIn) {
          // user cut in: replay only the last ~300 ms (not the avatar's audio)
          micRef.current?.getRecent?.().slice(-15).forEach((c) => ws.send(c));
        }
        wasOpenRef.current = true;
        ws.send(b);
      });

      keepAliveRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 5000);
    };

    ws.onmessage = (msg) => {
      const g = getGateRef.current?.() || { blocked: false, bargeIn: false };
      if (g.blocked && !g.bargeIn) {
        bufferRef.current = "";
        setLiveTranscript("");
        return;
      }

      let d;
      try { d = JSON.parse(msg.data); } catch (_) { return; }

      if (d.type === "UtteranceEnd") {
        clearTimeout(finalFlushTimerRef.current);
        flush();
        return;
      }
      if (d.type !== "Results") return;

      const text = d.channel?.alternatives?.[0]?.transcript?.trim();
      if (!text) return;

      const full = (bufferRef.current + " " + text).trim();

      if (cbRef.current.shouldDrop?.(full)) { // Avatar hearing itself
        bufferRef.current = "";
        setLiveTranscript("");
        return;
      }

      setLiveTranscript(full);
      cbRef.current.onHypothesis?.(full);

      if (d.is_final) {
        bufferRef.current = full;
        clearTimeout(finalFlushTimerRef.current);
        const isTrailing = /[,;]\s*$|\b(?:and|or|but|because|with|ki|aur)\s*$/i.test(full);
        if (d.speech_final && !isTrailing) {
          flush();
        } else {
          // Fallback debounce: if UtteranceEnd / speech_final doesn't arrive in 250ms, flush
          const waitMs = isTrailing ? 1200 : 250;
          finalFlushTimerRef.current = setTimeout(() => {
            flush();
          }, waitMs);
        }
      }
    };

    ws.onerror = (e) => {
      console.warn("[STT] socket error", e);
      setStatus("error");
    };

    ws.onclose = () => {
      teardownSocket();
      if (wantRef.current) {
        if (retryCountRef.current > 4) {
          retryRef.current = setTimeout(() => connectRef.current?.(), 15000);
          return;
        }
        const delay = Math.min(500 * 2 ** retryCountRef.current++, 5000);
        retryRef.current = setTimeout(() => connectRef.current?.(), delay);
      }
    };
  }, [flush, teardownSocket]);
  connectRef.current = connect;

  const stopContinuousListening = useCallback(() => {
    wantRef.current = false;
    clearTimeout(retryRef.current);
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        ws.close();
      } catch (_) {}
    }
    teardownSocket();
    bufferRef.current = "";
  }, [teardownSocket]);

  const startContinuousListening = useCallback(() => {
    wantRef.current = true;
    connect();
  }, [connect]);

  // Always-on STT: start Deepgram immediately on mount.
  // PCM gating (getGate) inside the stream handler prevents avatar self-hearing.
  // isEngaged controls whether we reconnect if the connection drops.
  useEffect(() => {
    startContinuousListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only — always-on

  // Reconnect if dropped while engaged
  useEffect(() => {
    if (isEngaged) startContinuousListening();
  }, [isEngaged, startContinuousListening]);

  useEffect(() => () => {
    clearTimeout(clearTimerRef.current);
    stopContinuousListening();
  }, [stopContinuousListening]);

  const toggleListening = useCallback(() => {
    if (wantRef.current) stopContinuousListening();
    else startContinuousListening();
  }, [startContinuousListening, stopContinuousListening]);

  return {
    listening,
    liveTranscript,
    status,
    toggleListening,
    startContinuousListening,
    stopContinuousListening,
  };
}
