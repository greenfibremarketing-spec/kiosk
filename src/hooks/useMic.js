"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import speechConfig from "@/lib/speechConfig";

const RING_CHUNKS = 50; // 50 x 20 ms = 1 s of pre-roll

export function useMic({ isEngaged = false } = {}) {
  const [vadSpeech, setVadSpeech] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micError, setMicError] = useState(null);

  const listeners = useRef(new Set());
  const ring = useRef([]);

  const subscribePcm = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);
  const getRecent = useCallback(() => ring.current.slice(), []);

  useEffect(() => {
    if (!isEngaged) return;
    let cancelled = false;
    let stream, ctx, node, source, zero;
    let loud = 0, lastLoud = 0, vadOn = false, lastLevelTs = 0;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
          },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());

        ctx = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
        await ctx.audioWorklet.addModule("/pcm-worklet.js");
        if (cancelled) {
          ctx.close();
          return stream.getTracks().forEach((t) => t.stop());
        }
        await ctx.resume();

        node = new AudioWorkletNode(ctx, "pcm-processor");
        source = ctx.createMediaStreamSource(stream);
        source.connect(node);
        zero = ctx.createGain();
        zero.gain.value = 0;
        node.connect(zero);
        zero.connect(ctx.destination);
        setMicError(null);

        node.port.onmessage = (e) => {
          const { pcm, rms } = e.data;

          ring.current.push(pcm);
          if (ring.current.length > RING_CHUNKS) ring.current.shift();
          listeners.current.forEach((fn) => fn(pcm));

          // VAD with hysteresis: on after 2 loud frames (40 ms), off after 250 ms quiet
          const now = performance.now();
          if (rms > speechConfig.audioLevelThreshold) {
            loud++;
            lastLoud = now;
            if (!vadOn && loud >= 2) {
              vadOn = true;
              setVadSpeech(true);
            }
          } else {
            loud = 0;
            if (vadOn && now - lastLoud > 250) {
              vadOn = false;
              setVadSpeech(false);
            }
          }
          if (now - lastLevelTs > 100) {
            lastLevelTs = now;
            setAudioLevel(rms);
          }
        };
      } catch (err) {
        if (!cancelled) {
          console.warn("[Mic] failed:", err);
          setMicError(err.message || "Microphone unavailable");
        }
      }
    })();

    return () => {
      cancelled = true;
      try { node && (node.port.onmessage = null); } catch (_) {}
      try { source && source.disconnect(); } catch (_) {}
      try { node && node.disconnect(); } catch (_) {}
      try { zero && zero.disconnect(); } catch (_) {}
      try { ctx && ctx.close(); } catch (_) {}
      stream && stream.getTracks().forEach((t) => t.stop());
      ring.current = [];
      setVadSpeech(false);
      setAudioLevel(0);
    };
  }, [isEngaged]);

  return { vadSpeech, audioLevel, micError, subscribePcm, getRecent };
}
