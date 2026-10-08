"use client";
/**
 * useAudioCapture.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Opens the microphone ONCE and keeps it open. Never start/stop per turn.
 *
 * Provides:
 *   • audioLevel (RMS, 0–1) updated ~every 100 ms via AnalyserNode
 *   • vadSpeech  (boolean) – true when mic RMS exceeds threshold
 *   • a rolling pre-roll ring-buffer (~500 ms) of Float32Array PCM chunks
 *   • stream ref so callers can attach their own STT logic
 *
 * Constraints: echoCancellation true, noiseSuppression true,
 *              autoGainControl false, channelCount 1.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import speechConfig from "@/lib/speechConfig";

const ANALYSE_INTERVAL_MS = 60; // how often we poll the AnalyserNode

export function useAudioCapture({ isEngaged = false } = {}) {
  const [audioLevel, setAudioLevel] = useState(0);
  const [vadSpeech, setVadSpeech] = useState(false);
  const [micError, setMicError] = useState(null);

  // refs that survive re-renders
  const ctxRef       = useRef(null);
  const analyserRef  = useRef(null);
  const streamRef    = useRef(null);
  const bufDataRef   = useRef(null); // Uint8Array for AnalyserNode
  const timerRef     = useRef(null);
  const preRollRef   = useRef([]);   // ring-buffer of Float32Array chunks
  const scriptRef    = useRef(null); // ScriptProcessorNode (kept for pre-roll)

  // keep a stable ref to the current audioLevel so event handlers don't stale-close
  const audioLevelRef = useRef(0);
  audioLevelRef.current = audioLevel;

  // ─── Open mic when engaged (Greenie visible), stop completely when idle (video only) ───
  useEffect(() => {
    if (!isEngaged) {
      try { scriptRef.current?.disconnect(); } catch (_) {}
      try { analyserRef.current?.disconnect(); } catch (_) {}
      try { ctxRef.current?.close(); } catch (_) {}
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      ctxRef.current = null;
      analyserRef.current = null;
      scriptRef.current = null;
      preRollRef.current = [];
      setAudioLevel(0);
      setVadSpeech(false);
      return;
    }
    if (typeof window === "undefined") return;

    let active = true;

    async function openMic() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
          },
          video: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setMicError(null);

        // Build audio graph
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx({ sampleRate: 16000 });
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }
        ctxRef.current = ctx;

        const resumeCtx = () => {
          if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
          }
        };
        window.addEventListener("pointerdown", resumeCtx, { passive: true });
        window.addEventListener("keydown", resumeCtx, { passive: true });

        const source = ctx.createMediaStreamSource(stream);

        // Analyser for RMS / VAD
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        analyserRef.current = analyser;
        bufDataRef.current = new Uint8Array(analyser.frequencyBinCount);

        source.connect(analyser);

        // ScriptProcessor for pre-roll buffer (low-overhead, 512-sample chunks)
        const sp = ctx.createScriptProcessor(512, 1, 1);
        scriptRef.current = sp;
        sp.onaudioprocess = (e) => {
          const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
          preRollRef.current.push(chunk);

          // Trim pre-roll to ~500 ms
          const preRollSamples = Math.ceil(
            (speechConfig.preRollMs / 1000) * (ctx.sampleRate || 16000)
          );
          let total = preRollRef.current.reduce((s, c) => s + c.length, 0);
          while (total > preRollSamples && preRollRef.current.length > 1) {
            total -= preRollRef.current[0].length;
            preRollRef.current.shift();
          }
        };
        source.connect(sp);
        
        // Zero gain node to prevent speaker feedback while keeping processor alive
        const zeroGain = ctx.createGain();
        zeroGain.gain.value = 0;
        sp.connect(zeroGain);
        zeroGain.connect(ctx.destination);

      } catch (err) {
        if (active) {
          console.warn("[AudioCapture] getUserMedia failed:", err);
          setMicError(err.message || "Microphone unavailable");
        }
      }
    }

    openMic();

    return () => {
      active = false;
      try { scriptRef.current?.disconnect(); } catch (_) {}
      try { analyserRef.current?.disconnect(); } catch (_) {}
      try { ctxRef.current?.close(); } catch (_) {}
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      ctxRef.current = null;
      analyserRef.current = null;
      scriptRef.current = null;
      preRollRef.current = [];
    };
  }, [isEngaged]);

  const lastLevelUpdateRef = useRef(0);
  const lastLevelValRef = useRef(0);

  // ─── RMS polling loop ─────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(timerRef.current);
    if (!isEngaged) {
      setAudioLevel(0);
      setVadSpeech(false);
      return;
    }

    timerRef.current = setInterval(() => {
      const analyser = analyserRef.current;
      const buf = bufDataRef.current;
      if (!analyser || !buf) return;

      analyser.getByteTimeDomainData(buf);

      // RMS in 0–1 range (byte domain: 0–255, centre at 128)
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const s = (buf[i] - 128) / 128;
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / buf.length);

      // Only trigger re-render if vadSpeech state actually changes
      const isVad = rms > speechConfig.audioLevelThreshold;
      setVadSpeech((prev) => (prev !== isVad ? isVad : prev));

      // Throttle audioLevel state updates to ~150ms to keep UI 60 FPS smooth
      const now = Date.now();
      if (now - lastLevelUpdateRef.current >= 150 || Math.abs(rms - lastLevelValRef.current) > 0.08) {
        lastLevelUpdateRef.current = now;
        lastLevelValRef.current = rms;
        setAudioLevel(rms);
      }
    }, ANALYSE_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
  }, [isEngaged]);

  // ─── Tear down on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      try { scriptRef.current?.disconnect(); } catch (_) {}
      try { analyserRef.current?.disconnect(); } catch (_) {}
      try { ctxRef.current?.close(); } catch (_) {}
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ─── Expose pre-roll buffer ────────────────────────────────────────────────
  const getPreRoll = useCallback(() => {
    // Concatenate all buffered chunks into one Float32Array
    const chunks = preRollRef.current;
    if (!chunks.length) return new Float32Array(0);
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }, []);

  return {
    audioLevel,
    vadSpeech,
    micError,
    streamRef,    // the live MediaStream (for Web Speech API src if needed)
    getPreRoll,
  };
}
